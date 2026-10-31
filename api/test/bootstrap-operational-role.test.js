import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAuthorityStore } from '../authority-store.js';

const script = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'bootstrap-operational-role.mjs');
const operationId = '123e4567-e89b-42d3-a456-426614174000';
function run(dir, uid) { return spawnSync(process.execPath, [script, '--offline', '--data-dir', dir, '--uid', uid, '--roles', 'CLIENT,COORDINATOR', '--reason', 'initial operational setup', '--operation-id', operationId], { encoding: 'utf8' }); }
function runIndefinite(dir, uid, email = 'jhonprada@gmail.com', failpoint) { return spawnSync(process.execPath, [script, '--offline', '--data-dir', dir, '--uid', uid, '--email', email, '--roles', 'CLIENT,TRAINER,COORDINATOR', '--indefinite-client', '--reason', 'authorized no-payment client entitlement', '--operation-id', operationId], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', BOOTSTRAP_FAILPOINT: failpoint || '' } }); }
function revokeIndefinite(dir, uid) { return spawnSync(process.execPath, [script, '--offline', '--data-dir', dir, '--uid', uid, '--revoke-indefinite-client', '--reason', 'operator revocation', '--operation-id', '123e4567-e89b-42d3-a456-426614174001'], { encoding: 'utf8' }); }
test('offline bootstrap only grants an existing active owner and records snapshot plus audit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-authority-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'owner uid', admin: true, owner: true }, { id: 'admin-not-owner', admin: true }] }));
  const ok = run(dir, 'owner uid'); assert.equal(ok.status, 0, ok.stderr);
  assert.ok(fs.readdirSync(dir).some(name => /^authority\.sqlite\.pre-bootstrap-.*\.sqlite$/.test(name)));
  const store = createAuthorityStore({ dataDir: dir });
  assert.deepEqual(store.db.prepare('SELECT role FROM operational_roles WHERE account_id=? AND removed_at_utc IS NULL ORDER BY role').all('owner uid').map(row => row.role), ['CLIENT', 'COORDINATOR']);
  assert.equal(store.db.prepare('SELECT actor_id FROM authority_audit').get().actor_id, 'offline-owner:owner uid'); store.close();
  const replay = run(dir, 'owner uid'); assert.equal(replay.status, 0, replay.stderr);
  const replayStore = createAuthorityStore({ dataDir: dir });
  assert.equal(replayStore.getAggregateVersion('ROLES', '["owner uid"]'), 1);
  assert.equal(replayStore.db.prepare('SELECT count(*) AS n FROM authority_audit').get().n, 1);
  replayStore.close();
  const bad = run(dir, 'admin-not-owner'); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /not an active existing owner/);
});

test('offline owner provisioning attaches one normalized unique email, all roles, entitlement and auditable readback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-indefinite-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'owner uid', admin: true, owner: true }, { id: 'other', email: 'taken@example.com' }] }));
  const ok = runIndefinite(dir, 'owner uid'); assert.equal(ok.status, 0, ok.stderr);
  const receipt = JSON.parse(ok.stdout); assert.deepEqual(receipt.readback.roles, ['CLIENT', 'COORDINATOR', 'TRAINER']); assert.equal(receipt.readback.entitlement.indefinite, true); assert.equal(receipt.readback.email, 'jhonprada@gmail.com');
  const legacy = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); assert.equal(legacy.users[0].email, 'jhonprada@gmail.com');
  const store = createAuthorityStore({ dataDir: dir });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM indefinite_client_entitlements WHERE client_id=? AND revoked_at_utc IS NULL').get('owner uid').n, 1);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM authority_audit WHERE entity_type='indefinite-client-entitlement'").get().n, 1); store.close();
  const duplicate = runIndefinite(dir, 'owner uid', 'taken@example.com'); assert.notEqual(duplicate.status, 0); assert.match(duplicate.stderr, /email.*taken/i);
  const malformed = runIndefinite(dir, 'owner uid', 'not-an-email'); assert.notEqual(malformed.status, 0); assert.match(malformed.stderr, /email.*invalid/i);
  const revoked = revokeIndefinite(dir, 'owner uid'); assert.equal(revoked.status, 0, revoked.stderr);
  const revokedStore = createAuthorityStore({ dataDir: dir }); assert.equal(revokedStore.db.prepare('SELECT count(*) AS n FROM indefinite_client_entitlements WHERE client_id=? AND revoked_at_utc IS NULL').get('owner uid').n, 0); assert.equal(revokedStore.db.prepare("SELECT count(*) AS n FROM authority_audit WHERE entity_type='indefinite-client-entitlement'").get().n, 2); revokedStore.close();
});

function fixture(users = [{ id: 'owner', admin: true, owner: true }]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-regression-'));
  const legacy = { users, sessions: { cookie: { uid: 'owner', expires: 9999999999999 } }, unknown: ['preserve'] };
  const raw = JSON.stringify(legacy, null, 2);
  fs.writeFileSync(path.join(dir, 'db.json'), raw);
  return { dir, raw, legacy };
}
for (const users of [
  [{ id: 'owner', admin: true }, { id: 'other', admin: true }],
  [{ id: 'owner', admin: true, owner: true }, { id: 'other', admin: true, owner: true }],
  [{ id: 'owner', admin: true }, { id: 'other', owner: true }],
  [{ id: 'owner', admin: true, owner: true }, { id: 'owner', admin: true }]
]) test(`ambiguous owner preflight rejects ${JSON.stringify(users)}`, () => {
  const { dir, raw } = fixture(users);
  assert.notEqual(runIndefinite(dir, 'owner').status, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), raw);
  assert.equal(fs.existsSync(path.join(dir, 'authority.sqlite')), false);
});
test('sole legacy administrator can bootstrap, normalized existing emails cannot collide', () => {
  const { dir } = fixture([{ id: 'owner', admin: true }]);
  assert.equal(runIndefinite(dir, 'owner').status, 0);
  for (const email of [' TAKEN@EXAMPLE.COM ', 'ＴＡＫＥＮ@example.com']) {
    const f = fixture([{ id: 'owner', admin: true, owner: true }, { id: 'other', email }]);
    const result = runIndefinite(f.dir, 'owner', 'taken@example.com');
    assert.notEqual(result.status, 0); assert.match(result.stderr, /email is taken/);
    assert.equal(fs.existsSync(path.join(f.dir, 'authority.sqlite')), false);
  }
});
for (const activity of ['disabled', 'deleted']) test(`offline revoke permits ${activity} owner but grants remain denied`, () => {
  const { dir, legacy } = fixture();
  assert.equal(runIndefinite(dir, 'owner').status, 0);
  legacy.users[0][activity] = true;
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(legacy));
  assert.notEqual(runIndefinite(dir, 'owner').status, 0);
  assert.notEqual(run(dir, 'owner').status, 0);
  const revoked = revokeIndefinite(dir, 'owner'); assert.equal(revoked.status, 0, revoked.stderr);
  assert.equal(revokeIndefinite(dir, 'owner').status, 0);
  const store = createAuthorityStore({ dataDir: dir });
  assert.equal(store.db.prepare('SELECT count(*) n FROM indefinite_client_entitlements WHERE revoked_at_utc IS NULL').get().n, 0);
  assert.equal(store.db.prepare("SELECT count(*) n FROM authority_audit WHERE entity_type='indefinite-client-entitlement'").get().n, 2);
  store.close();
});
for (const failpoint of ['stage-write', 'json-rename', 'before-commit', 'after-rename']) test(`write failure ${failpoint} rolls back both stores and preserves sessions`, () => {
  const { dir, raw } = fixture();
  const result = runIndefinite(dir, 'owner', undefined, failpoint);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, new RegExp(failpoint));
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), raw);
  const store = createAuthorityStore({ dataDir: dir });
  for (const table of ['operational_roles', 'indefinite_client_entitlements', 'mutation_results', 'authority_audit'])
    assert.equal(store.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  store.close();
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-recovery.json')), false);
  assert.equal(runIndefinite(dir, 'owner').status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.deepEqual(after.sessions, JSON.parse(raw).sessions);
  assert.deepEqual(after.unknown, ['preserve']);
});
for (const failpoint of ['crash-after-rename', 'crash-after-commit']) test(`interruption ${failpoint} recovers coherently on offline retry`, () => {
  const { dir, legacy } = fixture();
  const interrupted = runIndefinite(dir, 'owner', undefined, failpoint);
  assert.notEqual(interrupted.status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-recovery.json')), true);
  const retried = runIndefinite(dir, 'owner'); assert.equal(retried.status, 0, retried.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-recovery.json')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).sessions, legacy.sessions);
  const store = createAuthorityStore({ dataDir: dir });
  assert.equal(store.db.prepare('SELECT count(*) n FROM mutation_results').get().n, 1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM authority_audit').get().n, 2);
  store.close();
});
test('offline acknowledgment is required before opening either store', () => {
  const { dir, raw } = fixture();
  const result = spawnSync(process.execPath, [script, '--data-dir', dir, '--uid', 'owner', '--roles', 'CLIENT', '--reason', 'setup', '--operation-id', operationId], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /offline/);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), raw);
  assert.equal(fs.existsSync(path.join(dir, 'authority.sqlite')), false);
});

test('pending recovery blocks API startup before any account or authority writes', () => {
  const { dir, raw } = fixture();
  const marker = path.join(dir, '.bootstrap-recovery.json');
  fs.writeFileSync(marker, '{}');
  const server = path.join(path.dirname(script), '..', 'server.js');
  const result = spawnSync(process.execPath, [server], { encoding: 'utf8', timeout: 10000, env: { ...process.env, DATA_DIR: dir, PORT: '0' } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Offline bootstrap recovery pending/);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), raw);
  assert.equal(fs.existsSync(path.join(dir, 'authority.sqlite')), false);
});
test('failed recovery retains journal and remains retryable without clobbering sessions', () => {
  const { dir, raw } = fixture();
  assert.equal(runIndefinite(dir, 'owner', undefined, 'crash-after-rename').status, 86);
  const failed = runIndefinite(dir, 'owner', undefined, 'recovery-write');
  assert.notEqual(failed.status, 0); assert.match(failed.stderr, /recovery-write/);
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-recovery.json')), true);
  assert.equal(runIndefinite(dir, 'owner').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).sessions, JSON.parse(raw).sessions);
});
test('recovery refuses to overwrite sessions written by an unexpected writer', () => {
  const { dir } = fixture();
  assert.equal(runIndefinite(dir, 'owner', undefined, 'crash-after-rename').status, 86);
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'db.json')));
  current.sessions.newCookie = { uid: 'owner' };
  const changed = JSON.stringify(current);
  fs.writeFileSync(path.join(dir, 'db.json'), changed);
  const result = runIndefinite(dir, 'owner');
  assert.notEqual(result.status, 0); assert.match(result.stderr, /db.json changed/);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), changed);
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-recovery.json')), true);
});
test('bootstrap preserves SQLite enrollment, client sessions and executions on success and failure', () => {
  const { dir } = fixture();
  const store = createAuthorityStore({ dataDir: dir });
  store.db.exec(`
    INSERT INTO invitations VALUES ('invite','trainer',NULL,'Synthetic','token-hash','PENDING','2099-01-01','2026-01-01',NULL,NULL,1);
    INSERT INTO enrollment_sessions VALUES ('enrollment','invite','owner','challenge','initiator','PENDING_OPERATIONAL_ROLE','2026-01-01','2026-01-01','2099-01-01',1);
    INSERT INTO relations VALUES ('relation','trainer','owner','invite','ACTIVE','2026-01-01','2026-01-01',NULL,NULL,1);
    INSERT INTO relation_access_windows VALUES ('window','relation','2026-01-01','2026-01-01',NULL,'synthetic',1);
    INSERT INTO plan_versions VALUES ('plan','relation',1,NULL,'{}','plan-hash','trainer','2026-01-01',1);
    INSERT INTO client_sessions VALUES ('session','owner','relation','plan',NULL,'window','2026-01-01','{}','FINISHED','2026-01-02',1);
    INSERT INTO session_executions VALUES ('execution','session','owner','{}','execution-hash','operation','2026-01-02',1);
  `);
  const tables = ['enrollment_sessions', 'client_sessions', 'session_executions'];
  const before = tables.map(table => store.db.prepare(`SELECT * FROM ${table}`).all()); store.close();
  for (const failpoint of ['after-rename', undefined]) {
    const result = runIndefinite(dir, 'owner', undefined, failpoint);
    assert.equal(result.status === 0, !failpoint, result.stderr);
    const check = createAuthorityStore({ dataDir: dir });
    assert.deepEqual(tables.map(table => check.db.prepare(`SELECT * FROM ${table}`).all()), before); check.close();
  }
});
test('replaying an operation cannot silently change its email', () => {
  const { dir } = fixture();
  assert.equal(runIndefinite(dir, 'owner').status, 0);
  const before = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  const result = runIndefinite(dir, 'owner', 'different@example.com');
  assert.notEqual(result.status, 0); assert.match(result.stderr, /conflict/);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), before);
});
