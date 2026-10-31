import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';

const op = n => `123e4567-e89b-42d3-a456-426614175${String(n).padStart(3, '0')}`;
const clock = () => '2027-01-15T12:00:00.000Z';
function setup() {
  const store = createAuthorityStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'authority-life-')) });
  const ids = new Set(['admin', 'trainer', 'client', 'other-client', 'new-uid']);
  const service = createAuthorityService({ store, clock, identity: { get: uid => ({ uid, active: ids.has(uid), activity: ids.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) }, isAdmin: uid => uid === 'admin' });
  service.setRoles({ actorId: 'admin', operationId: op(1), expectedVersion: 0, payload: { accountId: 'trainer', roles: ['TRAINER'], reason: 'trainer role' } });
  service.setRoles({ actorId: 'admin', operationId: op(2), expectedVersion: 0, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'client role' } });
  return { store, service };
}

test('known invitation binds exact UID, never persists plaintext and closes/reopens separate windows without grants', () => {
  const { store, service } = setup();
  const made = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(10), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Client', grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }] } } });
  assert.match(made.result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.db.prepare('SELECT token_sha256 FROM invitations').get().token_sha256.length, 64);
  assert.equal(JSON.stringify(store.db.prepare('SELECT result_metadata_json FROM mutation_results').all()).includes(made.result.token), false);
  assert.throws(() => service.acceptInvitation({ actorId: 'other-client', requestId: 'wrong', body: { operationId: op(11), expectedVersion: 0, payload: { token: made.result.token, grants: [{ kind: 'PLAN' }] } } }), /invite-invalid/);
  const accepted = service.acceptInvitation({ actorId: 'client', requestId: 'accept', body: { operationId: op(12), expectedVersion: made.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: made.result.token, grants: [{ kind: 'PLAN' }] } } });
  assert.equal(accepted.result.state, 'ACTIVE');
  const relationId = accepted.result.relationId;
  assert.equal(service.createInvitation({ actorId: 'trainer', requestId: 'retry', body: { operationId: op(10), expectedVersion: 1, payload: { knownClientId: 'client', commercialName: 'Client', grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }] } } }).result.tokenUnavailable, true);
  const suspend = service.changeRelation({ actorId: 'trainer', requestId: 'suspend', action: 'suspend', body: { operationId: op(13), expectedVersion: accepted.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId, reason: 'pause sharing' } } });
  assert.equal(suspend.result.state, 'SUSPENDED');
  assert.equal(store.db.prepare("SELECT count(*) n FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").get(relationId).n, 0);
  const requested = service.changeRelation({ actorId: 'trainer', requestId: 'request', action: 'reactivate-request', body: { operationId: op(14), expectedVersion: suspend.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId, reason: 'resume request' } } });
  service.changeRelation({ actorId: 'client', requestId: 'accept-reactivation', action: 'reactivate-accept', body: { operationId: op(15), expectedVersion: requested.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId, reason: 'resume accepted' } } });
  assert.equal(store.db.prepare('SELECT count(*) n FROM relation_access_windows WHERE relation_id=?').get(relationId).n, 2);
  assert.equal(store.db.prepare("SELECT count(*) n FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").get(relationId).n, 0);
});

test('unknown-account enrollment reserves only a durable challenge and acceptance waits for trainer confirmation', () => {
  const { store, service } = setup();
  const made = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(20), expectedVersion: 0, payload: { commercialName: 'New client', grants: [{ kind: 'PLAN' }] } } });
  const enrollmentHandle = 'A'.repeat(43);
  const reservation = service.reserveEnrollment({ token: made.result.token, uid: 'new-uid', challenge: 'challenge-value', enrollmentHandle });
  assert.equal(reservation.resumed, false);
  service.verifyEnrollment({ uid: 'new-uid', challenge: 'challenge-value', enrollmentHandle });
  service.completeEnrollment({ uid: 'new-uid', challenge: 'challenge-value', enrollmentHandle });
  assert.equal(service.enrollmentMetadata('new-uid'), true);
  // An existing identity can accept an unbound invitation but does not gain reads before confirmation.
  const accepted = service.acceptInvitation({ actorId: 'new-uid', requestId: 'accept', body: { operationId: op(21), expectedVersion: made.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: made.result.token, grants: [{ kind: 'PLAN' }] } } });
  assert.equal(accepted.result.state, 'PENDING_CONFIRMATION');
  assert.equal(store.db.prepare('SELECT count(*) n FROM relation_access_windows').get().n, 0);
  service.changeRelation({ actorId: 'trainer', requestId: 'confirm', action: 'confirm', body: { operationId: op(22), expectedVersion: accepted.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId: accepted.result.relationId } } });
  assert.equal(store.db.prepare('SELECT count(*) n FROM relation_access_windows').get().n, 1);
});
