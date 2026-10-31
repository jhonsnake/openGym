import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';
import { boundPort } from './helpers.mjs';

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = '2027-01-15T12:00:00.000Z';
const op = n => `123e4567-e89b-42d3-a456-426614178${String(n).padStart(3, '0')}`;
const historyWithWeight = { kind: 'HISTORY', startUtc: '2027-01-01T00:00:00.000Z', endExclusiveUtc: '2027-02-01T00:00:00.000Z', includeWeight: true };
const historyWithoutWeight = { kind: 'HISTORY', startUtc: '2027-02-01T00:00:00.000Z', endExclusiveUtc: '2027-03-01T00:00:00.000Z' };

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-pending-proposals-'));
  const users = ['admin', 'trainer', 'fresh-client', 'fresh-client-no-weight', 'other-client', 'coordinator'];
  fs.writeFileSync(path.join(dataDir, 'secret'), 'pending-proposals-test-secret');
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: users.map(id => ({ id, name: id, ...(id === 'admin' ? { admin: true, owner: true } : {}) })), creds: [], subs: [], invites: [] }));
  const active = new Set(users);
  const store = createAuthorityStore({ dataDir });
  const service = createAuthorityService({
    store,
    clock: () => stamp,
    identity: { get: uid => ({ uid, active: active.has(uid), activity: active.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) },
    isAdmin: uid => uid === 'admin'
  });
  service.setRoles({ actorId: 'admin', body: { operationId: op(1), expectedVersion: 0, payload: { accountId: 'trainer', roles: ['TRAINER'], reason: 'synthetic fixture' } } });
  service.setRoles({ actorId: 'admin', body: { operationId: op(2), expectedVersion: 0, payload: { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'synthetic fixture' } } });
  return { dataDir, store, service };
}

function acceptFreshInvitation(service, { uid, sequence, selected }) {
  const invitation = service.createInvitation({
    actorId: 'trainer',
    body: { operationId: op(sequence), expectedVersion: sequence === 10 ? 0 : 1, payload: { commercialName: 'Synthetic client', grants: [historyWithWeight, historyWithoutWeight, { kind: 'WEIGHT' }] } }
  });
  const enrollmentHandle = `${String.fromCharCode(65 + sequence)}${'x'.repeat(42)}`;
  service.reserveEnrollment({ token: invitation.result.token, uid, challenge: `challenge-${sequence}`, enrollmentHandle });
  service.completeEnrollment({ uid, challenge: `challenge-${sequence}`, enrollmentHandle });
  return service.acceptInvitation({
    actorId: uid,
    body: { operationId: op(sequence + 1), expectedVersion: invitation.entity.version, payload: { token: invitation.result.token, grants: selected } }
  });
}

test('clientRelations projects only the fresh client pending subset and clears it after confirmation', t => {
  const { dataDir, store, service } = fixture();
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const selected = [historyWithWeight, historyWithoutWeight, { kind: 'WEIGHT' }];
  const accepted = acceptFreshInvitation(service, { uid: 'fresh-client', sequence: 10, selected });
  assert.equal(accepted.result.state, 'PENDING_CONFIRMATION');

  const pendingPage = service.clientRelations('fresh-client', { limit: 1, offset: 0 });
  assert.equal(pendingPage.hasMore, false);
  assert.deepEqual(pendingPage.relations, [{
    relationId: accepted.result.relationId,
    trainer: { id: 'trainer' },
    state: 'PENDING_CONFIRMATION',
    acceptedAt: stamp,
    confirmedAt: null,
    endedAt: null,
    grants: [],
    pendingProposals: selected,
    version: accepted.entity.version
  }]);

  const confirmed = service.changeRelation({ actorId: 'trainer', action: 'confirm', body: { operationId: op(12), expectedVersion: accepted.entity.version, payload: { relationId: accepted.result.relationId } } });
  const active = service.clientRelations('fresh-client', { limit: 1, offset: 0 });
  assert.deepEqual(active.relations[0].pendingProposals, []);
  assert.deepEqual(active.relations[0].grants, selected);
  assert.equal(active.relations[0].version, confirmed.entity.version);

  store.db.prepare("INSERT INTO relation_pending_grants(id,relation_id,kind,window_start_utc,window_end_exclusive_utc,include_weight,consented_at_utc,version) VALUES ('stale-pending',?,'HISTORY','2027-04-01T00:00:00.000Z','2027-05-01T00:00:00.000Z',1,?,1)").run(accepted.result.relationId, stamp);
  const suspended = service.changeRelation({ actorId: 'trainer', action: 'suspend', body: { operationId: op(13), expectedVersion: confirmed.entity.version, payload: { relationId: accepted.result.relationId, reason: 'synthetic pause' } } });
  assert.deepEqual(service.clientRelations('fresh-client', { limit: 1, offset: 0 }).relations[0].pendingProposals, [], 'suspended relations do not disclose stale pending choices');
  service.changeRelation({ actorId: 'trainer', action: 'end', body: { operationId: op(14), expectedVersion: suspended.entity.version, payload: { relationId: accepted.result.relationId, reason: 'synthetic end' } } });
  assert.deepEqual(service.clientRelations('fresh-client', { limit: 1, offset: 0 }).relations[0].pendingProposals, [], 'ended relations do not disclose stale pending choices');

  const noWeight = acceptFreshInvitation(service, { uid: 'fresh-client-no-weight', sequence: 20, selected: [historyWithoutWeight] });
  assert.deepEqual(service.clientRelations('fresh-client-no-weight', { limit: 1, offset: 0 }).relations[0].pendingProposals, [historyWithoutWeight], 'a HISTORY selection without includeWeight does not gain WEIGHT');
  assert.deepEqual(service.clientRelations('other-client', { limit: 1, offset: 0 }).relations, []);
  assert.equal(noWeight.result.state, 'PENDING_CONFIRMATION');
});

test('HTTP own-client relations readback preserves pending proposals and rejects foreign selectors', async t => {
  const { dataDir, store, service } = fixture();
  const selected = [historyWithWeight, historyWithoutWeight, { kind: 'WEIGHT' }];
  const accepted = acceptFreshInvitation(service, { uid: 'fresh-client', sequence: 10, selected });
  store.close();
  const secret = fs.readFileSync(path.join(dataDir, 'secret'), 'utf8');
  const cookie = uid => {
    const payload = `${uid}:${Date.now() + 86400000}:0`;
    return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
  };
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => output)}`;
  const get = async (uid, suffix = '') => {
    const response = await fetch(`${base}/api/client/relations${suffix}`, { headers: { Cookie: cookie(uid), 'Sec-Fetch-Site': 'same-origin' } });
    return { status: response.status, body: await response.json() };
  };

  const own = await get('fresh-client', '?limit=1');
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.deepEqual(own.body.relations[0].pendingProposals, selected);
  assert.equal(own.body.relations[0].relationId, accepted.result.relationId);
  assert.equal(own.body.relations[0].version, accepted.entity.version);
  assert.equal(own.body.nextCursor, null);
  assert.deepEqual((await get('other-client')).body.relations, []);
  assert.deepEqual((await get('trainer')).body.relations, []);
  assert.deepEqual((await get('coordinator')).body.relations, []);
  assert.deepEqual((await get('admin')).body.relations, []);
  assert.equal((await get('other-client', '?clientId=fresh-client')).status, 400);
});
