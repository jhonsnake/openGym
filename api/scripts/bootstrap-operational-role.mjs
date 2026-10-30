import fs from 'node:fs';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createIdentityAuthority } from '../identity-authority.js';
import { createAuthorityService } from '../authority-service.js';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const uid = value('--uid'); const roles = value('--roles'); const reason = value('--reason'); const operationId = value('--operation-id');
const dataDir = value('--data-dir') || process.env.DATA_DIR || '/data';
const flags = new Set(['--uid', '--roles', '--reason', '--operation-id', '--data-dir']);
const unknown = args.some((arg, index) => arg.startsWith('--') ? !flags.has(arg) : index === 0 || !flags.has(args[index - 1]));
if (!uid || !roles || !reason || !operationId || unknown) {
  console.error('usage: bootstrap-operational-role.mjs --uid <existing-owner-uid> --roles <CLIENT,TRAINER,COORDINATOR> --reason <reason> --operation-id <uuid> [--data-dir <dir>]'); process.exit(2);
}
const dbPath = path.join(dataDir, 'db.json');
let legacy;
try { legacy = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { console.error('preflight failed: db.json is unreadable'); process.exit(2); }
const users = Array.isArray(legacy.users) ? legacy.users : [];
const user = users.find(row => row?.id === uid);
const owner = users.find(row => row?.owner === true && row.admin === true) || users.find(row => row?.admin === true);
if (!user || user !== owner || user.disabled || user.deleted) { console.error('preflight failed: uid is not an active existing owner'); process.exit(2); }
const authorityPath = path.join(dataDir, 'authority.sqlite');
const snapshotPath = `${authorityPath}.pre-bootstrap-${Date.now()}.sqlite`;
const store = createAuthorityStore({ dataDir });
try {
  await store.snapshot(snapshotPath);
  const identity = createIdentityAuthority({ getUser: candidate => users.find(row => row?.id === candidate) || null });
  const service = createAuthorityService({ store, identity, isAdmin: candidate => candidate === uid, isOwner: candidate => candidate === uid && users.find(row => row?.id === candidate) === owner });
  const result = service.bootstrapOffline({ ownerId: uid, operationId, payload: { accountId: uid, roles: roles.split(',').filter(Boolean), reason } });
  console.log(JSON.stringify({ ok: true, operationId: result.operationId, snapshot: snapshotPath }));
} finally { store.close(); }
