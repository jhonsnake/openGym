import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';

const op = n => `123e4567-e89b-42d3-a456-426614179${String(n).padStart(3, '0')}`;
const stamp = '2027-01-15T12:00:00.000Z';

function setup() {
  const users = new Map(['admin', 'trainer', 'client', 'coordinator', 'new-client'].map(uid => [uid, { active: true }]));
  const store = createAuthorityStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'authority-review-corrections-')) });
  const service = createAuthorityService({
    store,
    clock: () => stamp,
    identity: { get: uid => ({ uid, active: users.get(uid)?.active === true, activity: users.get(uid)?.active ? 'ACTIVE' : users.has(uid) ? 'DISABLED' : 'UNKNOWN' }) },
    isAdmin: uid => uid === 'admin'
  });
  service.setRoles({ actorId: 'admin', operationId: op(1), expectedVersion: 0, payload: { accountId: 'trainer', roles: ['TRAINER'], reason: 'test' } });
  service.setRoles({ actorId: 'admin', operationId: op(2), expectedVersion: 0, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'test' } });
  service.setRoles({ actorId: 'admin', operationId: op(3), expectedVersion: 0, payload: { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'test' } });
  service.setScope({ actorId: 'admin', operationId: op(4), expectedVersion: 0, payload: { coordinatorId: 'coordinator', clientId: 'client', assigned: true, reason: 'test' } });
  return { users, store, service };
}

test('review correction: terminal invitation and relation replays are authorized now but do not require their consumed prior state', () => {
  const { service } = setup();
  const invitation = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(10), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  const accepted = service.acceptInvitation({ actorId: 'client', requestId: 'accept', body: { operationId: op(11), expectedVersion: invitation.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: invitation.result.token, grants: [{ kind: 'PLAN' }] } } });
  assert.equal(service.acceptInvitation({ actorId: 'client', requestId: 'accept-retry', body: { operationId: op(11), expectedVersion: invitation.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: invitation.result.token, grants: [{ kind: 'PLAN' }] } } }).replayed, true);
  const ended = service.changeRelation({ actorId: 'client', requestId: 'end', action: 'revoke', body: { operationId: op(12), expectedVersion: accepted.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId: accepted.result.relationId, reason: 'withdraw' } } });
  assert.equal(service.changeRelation({ actorId: 'client', requestId: 'end-retry', action: 'revoke', body: { operationId: op(12), expectedVersion: accepted.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId: accepted.result.relationId, reason: 'withdraw' } } }).replayed, true);
  assert.equal(ended.result.state, 'ENDED');
});

test('review correction: dependent aggregate tokens begin at one and commercial state requires an active CLIENT', () => {
  const { users, store, service } = setup();
  const invitation = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(20), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  assert.equal(invitation.versionTokens.find(token => token.kind === 'INVITATION').version, 1);
  const accepted = service.acceptInvitation({ actorId: 'client', requestId: 'accept', body: { operationId: op(21), expectedVersion: 1, payload: { token: invitation.result.token, grants: [{ kind: 'PLAN' }] } } });
  assert.equal(accepted.versionTokens.find(token => token.kind === 'RELATION').version, 1);
  users.get('client').active = false;
  assert.throws(() => service.confirmCommercialOperation({ actorId: 'coordinator', requestId: 'commercial', body: { operationId: op(22), expectedVersion: 0, payload: { clientId: 'client', kind: 'MONTHLY', reference: 'external record', reason: 'manual' } } }), /forbidden/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM subscription_intervals').get().n, 0);
});

test('review correction: pending unknown acceptance persists exactly its selected grants until confirmation', () => {
  const { store, service } = setup();
  const invitation = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(30), expectedVersion: 0, payload: { commercialName: 'Alias', grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }] } } });
  const enrollmentHandle = 'B'.repeat(43);
  service.reserveEnrollment({ token: invitation.result.token, uid: 'new-client', challenge: 'challenge', enrollmentHandle });
  service.completeEnrollment({ uid: 'new-client', challenge: 'challenge', enrollmentHandle });
  const accepted = service.acceptInvitation({ actorId: 'new-client', requestId: 'accept', body: { operationId: op(31), expectedVersion: 1, payload: { token: invitation.result.token, grants: [{ kind: 'PLAN' }] } } });
  const pendingGrant = store.db.prepare("SELECT id,kind,eligible_from_utc FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").get(accepted.result.relationId);
  assert.deepEqual({ kind: pendingGrant.kind, eligibleFromUtc: pendingGrant.eligible_from_utc }, { kind: 'PLAN', eligibleFromUtc: stamp });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM relation_access_windows WHERE relation_id=?').get(accepted.result.relationId).n, 0);
  assert.deepEqual(service.clientRelations('new-client', { limit: 10, offset: 0 }).relations[0].grants, []);
  assert.deepEqual(service.clientRelations('new-client', { limit: 10, offset: 0 }).relations[0].pendingProposals, [{ kind: 'PLAN' }]);
  assert.deepEqual(service.trainerRelations('trainer', { limit: 10, offset: 0 }).relations[0].grants, []);
  const confirmed = service.changeRelation({ actorId: 'trainer', requestId: 'confirm', action: 'confirm', body: { operationId: op(32), expectedVersion: accepted.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId: accepted.result.relationId } } });
  assert.equal(confirmed.result.state, 'ACTIVE');
  const confirmedGrant = store.db.prepare("SELECT id,kind,eligible_from_utc FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").get(accepted.result.relationId);
  assert.deepEqual({ id: confirmedGrant.id, kind: confirmedGrant.kind, eligibleFromUtc: confirmedGrant.eligible_from_utc }, { id: pendingGrant.id, kind: 'PLAN', eligibleFromUtc: stamp });
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").get(accepted.result.relationId).n, 1);
});

test('invitation acceptance permits only exact selected proposal subsets', () => {
  const { service } = setup();
  const history = { kind: 'HISTORY', startUtc: '2027-01-01T00:00:00.000Z', endExclusiveUtc: '2027-02-01T00:00:00.000Z', includeWeight: true };
  let inviteSetVersion = 0;
  const create = (n, grants) => {
    const created = service.createInvitation({ actorId: 'trainer', requestId: `create-${n}`, body: { operationId: op(n), expectedVersion: inviteSetVersion, payload: { knownClientId: 'client', commercialName: 'Alias', grants } } });
    inviteSetVersion = created.versionTokens.find(token => token.kind === 'INVITE_SET').version;
    return created;
  };
  const proposal = [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }, history];
  const accepted = create(40, proposal);
  assert.equal(service.acceptInvitation({ actorId: 'client', requestId: 'accept-plan-only', body: { operationId: op(41), expectedVersion: accepted.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: accepted.result.token, grants: [{ kind: 'PLAN' }] } } }).result.state, 'ACTIVE');
  const unproposed = create(42, [{ kind: 'PLAN' }]);
  assert.throws(() => service.acceptInvitation({ actorId: 'client', requestId: 'accept-unproposed', body: { operationId: op(43), expectedVersion: unproposed.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: unproposed.result.token, grants: [{ kind: 'WEIGHT' }] } } }), /forbidden/);
  const ranged = create(44, [history, { kind: 'WEIGHT' }]);
  assert.throws(() => service.acceptInvitation({ actorId: 'client', requestId: 'accept-broadened-range', body: { operationId: op(45), expectedVersion: ranged.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: ranged.result.token, grants: [{ ...history, endExclusiveUtc: '2027-03-01T00:00:00.000Z' }, { kind: 'WEIGHT' }] } } }), /forbidden/);
});

test('review correction: exact revokeGrant PLAN replay returns its receipt after ending the relation', () => {
  const { users, service } = setup();
  const invitation = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(40), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  const accepted = service.acceptInvitation({ actorId: 'client', requestId: 'accept', body: { operationId: op(41), expectedVersion: invitation.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: invitation.result.token, grants: [{ kind: 'PLAN' }] } } });
  const relationVersion = accepted.versionTokens.find(token => token.kind === 'RELATION').version;
  const body = { operationId: op(42), expectedVersion: relationVersion, payload: { relationId: accepted.result.relationId, kind: 'PLAN', reason: 'withdraw' } };
  const fresh = service.revokeGrant({ actorId: 'client', requestId: 'revoke', body });
  assert.equal(fresh.result.state, 'ENDED');
  assert.equal(service.revokeGrant({ actorId: 'client', requestId: 'revoke-replay', body }).replayed, true);
  users.get('client').active = false;
  assert.throws(() => service.revokeGrant({ actorId: 'client', requestId: 'disabled', body }), /forbidden/);
  users.get('client').active = true;
  assert.throws(() => service.revokeGrant({ actorId: 'trainer', requestId: 'foreign', body }), /forbidden/);
});

test('review correction: replace initializes new invitation and INVITE_SET tokens without persisting plaintext', () => {
  const { store, service } = setup();
  const created = service.createInvitation({ actorId: 'trainer', requestId: 'create', body: { operationId: op(50), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  const replaced = service.replaceInvitation({ actorId: 'trainer', requestId: 'replace', body: { operationId: op(51), expectedVersion: created.entity.version, payload: { invitationId: created.result.inviteId, knownClientId: 'client', commercialName: 'Alias two', grants: [{ kind: 'PLAN' }] } } });
  const newInviteToken = replaced.versionTokens.find(token => token.kind === 'INVITATION' && token.key !== created.versionTokens.find(token => token.kind === 'INVITATION').key);
  assert.equal(newInviteToken.version, 1);
  assert.equal(replaced.versionTokens.find(token => token.kind === 'INVITE_SET').version, 2);
  assert.equal(replaced.entity.version, 1);
  assert.equal(service.previewInvitation({ token: replaced.result.token }).trainer.id, 'trainer');
  const accepted = service.acceptInvitation({ actorId: 'client', requestId: 'accept', body: { operationId: op(52), expectedVersion: newInviteToken.version, payload: { token: replaced.result.token, grants: [{ kind: 'PLAN' }] } } });
  assert.equal(accepted.result.state, 'ACTIVE');
  const replay = service.replaceInvitation({ actorId: 'trainer', requestId: 'replace-replay', body: { operationId: op(51), expectedVersion: created.entity.version, payload: { invitationId: created.result.inviteId, knownClientId: 'client', commercialName: 'Alias two', grants: [{ kind: 'PLAN' }] } } });
  assert.equal(replay.result.tokenUnavailable, true);
  const metadata = store.db.prepare('SELECT result_metadata_json FROM mutation_results WHERE operation_id=?').get(op(51)).result_metadata_json;
  assert.doesNotMatch(metadata, /[A-Za-z0-9_-]{43}/);
});

test('review correction: commercial current clock is consistent for past, current, and future CUSTOM intervals', () => {
  for (const [n, start, end, expected] of [[61, '2027-01-01', '2027-01-10', false], [62, '2027-01-15', '2027-01-15', true], [63, '2027-02-01', '2027-02-10', false]]) {
    const { service } = setup();
    const receipt = service.confirmCommercialOperation({ actorId: 'coordinator', requestId: `commercial-${n}`, body: { operationId: op(n), expectedVersion: 0, payload: { clientId: 'client', kind: 'CUSTOM', customStartPanama: start, customEndPanamaInclusive: end, reference: `ref-${n}`, reason: 'test' } } });
    const commercial = service.commercialClients('coordinator').find(row => row.clientId === 'client');
    assert.equal(receipt.result.entitlement.active, expected);
    assert.equal(commercial.entitlement.active, expected);
    assert.equal(service.accessSnapshot('client').entitlement.active, expected);
  }
});

test('review correction: scoped readbacks page 101 rows, retain expired consent, and collapse scope history', () => {
  const { users, service } = setup();
  for (let index = 0; index < 100; index += 1) {
    const clientId = `scope-client-${index}`;
    users.set(clientId, { active: true });
    service.setScope({ actorId: 'admin', body: { operationId: op(100 + index), expectedVersion: 0, payload: { coordinatorId: 'coordinator', clientId, assigned: true, reason: 'page fixture' } } });
  }
  const first = service.scopePairs('admin', 'coordinator', undefined, { limit: 100, offset: 0 });
  const second = service.scopePairs('admin', 'coordinator', undefined, { limit: 100, offset: 100 });
  assert.equal(first.scopes.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(second.scopes.length, 1);
  const target = 'scope-client-0';
  const removed = service.setScope({ actorId: 'admin', body: { operationId: op(250), expectedVersion: 1, payload: { coordinatorId: 'coordinator', clientId: target, assigned: false, reason: 'remove' } } });
  const reassigned = service.setScope({ actorId: 'admin', body: { operationId: op(251), expectedVersion: removed.entity.version, payload: { coordinatorId: 'coordinator', clientId: target, assigned: true, reason: 'reassign' } } });
  const current = service.scopePairs('admin', 'coordinator', target);
  assert.deepEqual(current, [{ coordinatorId: 'coordinator', clientId: target, assigned: true, version: reassigned.entity.version }]);
});

test('T6 SQL-bound portfolio, relation and commercial pages retain all 101 authorized rows', () => {
  const { users, store, service } = setup();
  const db = store.db; const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
  db.prepare("DELETE FROM coordinator_scopes WHERE coordinator_id='coordinator' AND client_id='client'").run();
  const recorded = []; const prepare = db.prepare.bind(db);
  db.prepare = sql => { if (/FROM (?:relations|coordinator_scopes)/.test(sql)) recorded.push(sql); return prepare(sql); };
  try {
    for (const [index, clientId] of ids.entries()) {
      users.set(clientId, { active: true });
      const startedAt = stamp;
      db.prepare('INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), clientId, 'CLIENT', 'seed', startedAt, 1, 'seed');
      db.prepare('INSERT INTO coordinator_scopes(id,coordinator_id,client_id,assigned_by,assigned_at_utc,version,reason) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), 'coordinator', clientId, 'admin', startedAt, 1, 'seed');
      const invitationId = crypto.randomUUID(); const relationId = crypto.randomUUID();
      db.prepare("INSERT INTO invitations(id,trainer_id,known_client_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES (?,?,?,?,?,'ACCEPTED',?,?,1)").run(invitationId, 'trainer', clientId, `alias-${index}`, crypto.randomBytes(32).toString('hex'), '2099-01-01T00:00:00.000Z', startedAt);
      db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES (?,?,?,?,'ACTIVE',?,?,1)").run(relationId, 'trainer', clientId, invitationId, startedAt, startedAt);
      db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES (?,?,?, ?,1,'MONTHLY','seed','seed','admin',?,1)").run(crypto.randomUUID(), clientId, '2027-01-01T05:00:00.000Z', '2027-02-01T05:00:00.000Z', startedAt);
    }
    for (const [name, read] of [
      ['portfolio', page => service.trainerPortfolio('trainer', page).portfolio],
      ['relations', page => service.trainerRelations('trainer', page).relations],
      ['commercial', page => service.commercialClients('coordinator', page).clients]
    ]) {
      const first = read({ limit: 100, offset: 0 }); const second = read({ limit: 100, offset: 100 });
      assert.equal(first.length, 100, `${name} first page`);
      assert.equal(second.length, 1, `${name} second page`);
      assert.equal(new Set([...first, ...second].map(row => row.clientId ?? row.relationId)).size, 101, `${name} has no duplicates or skips`);
    }
    assert.equal(recorded.length >= 6, true);
    assert.equal(recorded.every(sql => /LIMIT \? OFFSET \?$/.test(sql)), true, recorded.join('\n'));
  } finally { db.prepare = prepare; store.close(); }
});
