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
