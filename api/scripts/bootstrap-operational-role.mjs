import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createAuthorityStore } from '../authority-store.js';
import { createIdentityAuthority } from '../identity-authority.js';
import { createAuthorityService } from '../authority-service.js';
import { normalizeEmail, nameKey } from '../password.js';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const uid = value('--uid'); const email = value('--email'); const roles = value('--roles'); const reason = value('--reason'); const operationId = value('--operation-id'); const indefinite = args.includes('--indefinite-client'); const revoke = args.includes('--revoke-indefinite-client');
const dataDir = value('--data-dir') || process.env.DATA_DIR || '/data';
const flags = new Set(['--offline', '--uid', '--email', '--roles', '--reason', '--operation-id', '--data-dir', '--indefinite-client', '--revoke-indefinite-client']);
const unknown = args.some((arg, index) => arg.startsWith('--') ? !flags.has(arg) : index === 0 || !flags.has(args[index - 1]));
if (!args.includes('--offline') || !uid || !reason || !operationId || unknown || (indefinite && revoke) || (!revoke && !roles) || (indefinite !== !!email) || (revoke && (email || roles))) {
  console.error('usage: bootstrap-operational-role.mjs --offline --uid <existing-owner-uid> --roles <CLIENT,TRAINER,COORDINATOR> --reason <reason> --operation-id <uuid> [--data-dir <dir>] [--email <exact-email> --indefinite-client | --revoke-indefinite-client]'); process.exit(2);
}
// --offline is an operator assertion: stop ALL writers (including old images)
// before invocation. A pending journal makes this image refuse startup.
const dbPath = path.join(dataDir, 'db.json');
const journalPath = path.join(dataDir, '.bootstrap-recovery.json');
const syncDirectory = () => { const fd = fs.openSync(dataDir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
function durableFile(file, contents) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomicReplace(contents) {
  const temporary = `${dbPath}.bootstrap-${crypto.randomUUID()}.tmp`;
  try { durableFile(temporary, contents); fs.renameSync(temporary, dbPath); syncDirectory(); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function recover(store) {
  if (!fs.existsSync(journalPath)) return;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (journal.version !== 1 || typeof journal.before !== 'string' || typeof journal.after !== 'string' || typeof journal.operationId !== 'string') throw new Error('invalid bootstrap recovery journal; keep stopped and restore coherent backup');
  const current = fs.readFileSync(dbPath, 'utf8');
  if (current !== journal.before && current !== journal.after) throw new Error('db.json changed during offline bootstrap; keep stopped, preserve journal and investigate writers');
  // The operation did not exist before this journal. Its SQLite receipt is the
  // commit decision, including after a crash between COMMIT and journal removal.
  const committed = !!store.db.prepare('SELECT 1 FROM mutation_results WHERE operation_id=?').get(journal.operationId);
  const desired = committed ? journal.after : journal.before;
  if (current !== desired) { failpoint('recovery-write'); atomicReplace(desired); }
  fs.unlinkSync(journalPath); syncDirectory();
}
const failpoint = point => {
  if (process.env.NODE_ENV !== 'test') return;
  if (process.env.BOOTSTRAP_FAILPOINT === `crash-${point}`) process.exit(86);
  if (process.env.BOOTSTRAP_FAILPOINT === point) throw new Error(`bootstrap failpoint: ${point}`);
};
// Recover BEFORE identity/uniqueness preflight: a crash may have renamed db.json
// while SQLite rolled back. No service or session may run until this completes.
if (fs.existsSync(journalPath)) {
  const recoveryStore = createAuthorityStore({ dataDir });
  try { recover(recoveryStore); } finally { recoveryStore.close(); }
}
let legacy; let original;
try { original = fs.readFileSync(dbPath, 'utf8'); legacy = JSON.parse(original); } catch { console.error('preflight failed: db.json is unreadable'); process.exit(2); }
const users = Array.isArray(legacy.users) ? legacy.users : [];
const matches = users.filter(row => row?.id === uid);
const user = matches.length === 1 ? matches[0] : null;
const owners = users.filter(row => row?.owner === true);
const admins = users.filter(row => row?.admin === true);
// Explicit sole owner may coexist with ordinary administrators. Legacy fallback
// is safe only when no owner marker exists and exactly one administrator exists.
const owner = owners.length === 1 && owners[0].admin === true ? owners[0] : owners.length === 0 && admins.length === 1 ? admins[0] : null;
if (!user || user !== owner || (!revoke && (user.disabled || user.deleted))) { console.error('preflight failed: uid is not an active existing owner (or owner is ambiguous; inactive owners may only revoke)'); process.exit(2); }
const normalizedEmail = indefinite ? normalizeEmail(email) : null;
if (indefinite && !normalizedEmail) { console.error('preflight failed: email is invalid'); process.exit(2); }
if (indefinite && users.some(candidate => candidate?.id !== uid && (normalizeEmail(candidate?.email) === normalizedEmail || nameKey(candidate?.name) === normalizedEmail))) { console.error('preflight failed: email is taken'); process.exit(2); }
const authorityPath = path.join(dataDir, 'authority.sqlite');
const snapshotPath = `${authorityPath}.pre-bootstrap-${crypto.randomUUID()}.sqlite`;
const store = createAuthorityStore({ dataDir });
let ownsJournal = false;
let temporary;
try {
  await store.snapshot(snapshotPath);
  const identity = createIdentityAuthority({ getUser: candidate => users.find(row => row?.id === candidate) || null });
  let coordinatedStore = store;
  if (indefinite && user.email !== normalizedEmail) {
    // A replay cannot change identity under an already committed receipt.
    if (store.db.prepare('SELECT 1 FROM mutation_results WHERE operation_id=?').get(operationId)) throw new Error('conflict: replay email differs');
    user.email = normalizedEmail;
    const after = JSON.stringify(legacy);
    temporary = `${dbPath}.bootstrap-${crypto.randomUUID()}.tmp`;
    failpoint('stage-write');
    durableFile(temporary, after);
    const journalTemporary = `${journalPath}.${crypto.randomUUID()}.tmp`;
    try {
      durableFile(journalTemporary, JSON.stringify({ version: 1, operationId, before: original, after }));
      // link is exclusive and publishes only a complete, fsynced journal.
      fs.linkSync(journalTemporary, journalPath); ownsJournal = true; syncDirectory();
    } finally { if (fs.existsSync(journalTemporary)) fs.unlinkSync(journalTemporary); }
    coordinatedStore = { ...store, transaction: (context, work) => store.transaction(context, tx => {
      const result = work(tx);
      // Detect another writer rather than overwriting its sessions or accounts.
      if (fs.readFileSync(dbPath, 'utf8') !== original) throw new Error('db.json changed during offline bootstrap');
      failpoint('json-rename');
      fs.renameSync(temporary, dbPath); syncDirectory();
      failpoint('after-rename');
      failpoint('before-commit');
      return result;
    }) };
  }
  const service = createAuthorityService({ store: coordinatedStore, identity, isAdmin: candidate => candidate === uid, isOwner: candidate => candidate === uid && users.find(row => row?.id === candidate) === owner });
  const payload = !revoke ? { accountId: uid, roles: roles.split(',').filter(Boolean), reason } : null;
  const result = revoke ? service.revokeIndefiniteClientOffline({ ownerId: uid, operationId, reason }) : indefinite ? service.bootstrapIndefiniteClientOffline({ ownerId: uid, operationId, payload }) : service.bootstrapOffline({ ownerId: uid, operationId, payload });
  failpoint('after-commit');
  if (ownsJournal) recover(store);
  const readback = indefinite ? { email: normalizedEmail, roles: result.result.roles, entitlement: result.result.entitlement } : revoke ? { entitlement: result.result.entitlement } : undefined;
  console.log(JSON.stringify({ ok: true, operationId: result.operationId, snapshot: snapshotPath, ...(readback ? { readback } : {}) }));
} catch (error) {
  // Ordinary write/rename/COMMIT failures roll SQLite back and restore the exact
  // original JSON bytes. If recovery also fails, retain the journal and fail shut.
  if (ownsJournal) recover(store);
  throw error;
} finally {
  if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  store.close();
}
