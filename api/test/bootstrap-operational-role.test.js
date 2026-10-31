import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAuthorityStore } from '../authority-store.js';

const script = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'bootstrap-operational-role.mjs');
const operationId = '123e4567-e89b-42d3-a456-426614174000';
function run(dir, uid) { return spawnSync(process.execPath, [script, '--data-dir', dir, '--uid', uid, '--roles', 'CLIENT,COORDINATOR', '--reason', 'initial operational setup', '--operation-id', operationId], { encoding: 'utf8' }); }
function runIndefinite(dir, uid, email = 'jhonprada@gmail.com') { return spawnSync(process.execPath, [script, '--data-dir', dir, '--uid', uid, '--email', email, '--roles', 'CLIENT,TRAINER,COORDINATOR', '--indefinite-client', '--reason', 'authorized no-payment client entitlement', '--operation-id', operationId], { encoding: 'utf8' }); }
function revokeIndefinite(dir, uid) { return spawnSync(process.execPath, [script, '--data-dir', dir, '--uid', uid, '--revoke-indefinite-client', '--reason', 'operator revocation', '--operation-id', '123e4567-e89b-42d3-a456-426614174001'], { encoding: 'utf8' }); }
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
