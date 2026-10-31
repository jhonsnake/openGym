import fs from 'node:fs';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createIdentityAuthority } from '../identity-authority.js';
import { createAuthorityService } from '../authority-service.js';
import { normalizeEmail, nameKey } from '../password.js';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const uid = value('--uid'); const email = value('--email'); const roles = value('--roles'); const reason = value('--reason'); const operationId = value('--operation-id'); const indefinite = args.includes('--indefinite-client'); const revoke = args.includes('--revoke-indefinite-client');
const dataDir = value('--data-dir') || process.env.DATA_DIR || '/data';
const flags = new Set(['--uid', '--email', '--roles', '--reason', '--operation-id', '--data-dir', '--indefinite-client', '--revoke-indefinite-client']);
const unknown = args.some((arg, index) => arg.startsWith('--') ? !flags.has(arg) : index === 0 || !flags.has(args[index - 1]));
if (!uid || !reason || !operationId || unknown || (indefinite && revoke) || (!revoke && !roles) || (indefinite !== !!email) || (revoke && (email || roles))) {
  console.error('usage: bootstrap-operational-role.mjs --uid <existing-owner-uid> --roles <CLIENT,TRAINER,COORDINATOR> --reason <reason> --operation-id <uuid> [--data-dir <dir>] [--email <exact-email> --indefinite-client | --revoke-indefinite-client]'); process.exit(2);
}
const dbPath = path.join(dataDir, 'db.json');
let legacy;
try { legacy = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { console.error('preflight failed: db.json is unreadable'); process.exit(2); }
const users = Array.isArray(legacy.users) ? legacy.users : [];
const user = users.find(row => row?.id === uid);
const owner = users.find(row => row?.owner === true && row.admin === true) || users.find(row => row?.admin === true);
if (!user || user !== owner || user.disabled || user.deleted) { console.error('preflight failed: uid is not an active existing owner'); process.exit(2); }
const normalizedEmail = indefinite ? normalizeEmail(email) : null;
if (indefinite && !normalizedEmail) { console.error('preflight failed: email is invalid'); process.exit(2); }
if (indefinite && users.some(candidate => candidate?.id !== uid && (candidate?.email === normalizedEmail || nameKey(candidate?.name) === normalizedEmail))) { console.error('preflight failed: email is taken'); process.exit(2); }
const authorityPath = path.join(dataDir, 'authority.sqlite');
const snapshotPath = `${authorityPath}.pre-bootstrap-${Date.now()}.sqlite`;
const store = createAuthorityStore({ dataDir });
try {
  await store.snapshot(snapshotPath);
  const identity = createIdentityAuthority({ getUser: candidate => users.find(row => row?.id === candidate) || null });
  const service = createAuthorityService({ store, identity, isAdmin: candidate => candidate === uid, isOwner: candidate => candidate === uid && users.find(row => row?.id === candidate) === owner });
  const payload = !revoke ? { accountId: uid, roles: roles.split(',').filter(Boolean), reason } : null;
  const result = revoke ? service.revokeIndefiniteClientOffline({ ownerId: uid, operationId, reason }) : indefinite ? service.bootstrapIndefiniteClientOffline({ ownerId: uid, operationId, payload }) : service.bootstrapOffline({ ownerId: uid, operationId, payload });
  if (indefinite && user.email !== normalizedEmail) {
    user.email = normalizedEmail;
    const temporary = `${dbPath}.pre-bootstrap-${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(legacy), { mode: 0o600 }); fs.renameSync(temporary, dbPath);
  }
  const readback = indefinite ? { email: normalizedEmail, roles: result.result.roles, entitlement: result.result.entitlement } : revoke ? { entitlement: result.result.entitlement } : undefined;
  console.log(JSON.stringify({ ok: true, operationId: result.operationId, snapshot: snapshotPath, ...(readback ? { readback } : {}) }));
} finally { store.close(); }
