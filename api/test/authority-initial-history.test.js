import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { boundPort } from './helpers.mjs';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';
import { createHistoryPublisher } from '../authority-history.js';
import { createTrainingAuthority } from '../authority-training.js';

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratchRoot = os.tmpdir();
const op = n => `123e4567-e89b-42d3-a456-42661417${String(n).padStart(4, '0')}`;

function start(dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MANAGED_SUBSCRIPTIONS: '1', INVITE_ONLY: '1', PASSWORD_LOGIN: '1', FIRST_USER_ADMIN: '0', ADMIN_UIDS: 'admin', NODE_ENV: 'test' }
  });
  let log = ''; child.stdout.on('data', chunk => { log += chunk; }); child.stderr.on('data', chunk => { log += chunk; });
  return { child, base: boundPort(child, () => log).then(port => `http://127.0.0.1:${port}`) };
}

test('initial known HISTORY acceptance freezes the selected history projection', async t => {
  assert.ok(scratchRoot, 'TMPDIR must point at the approved scratch directory');
  const dataDir = fs.mkdtempSync(path.join(scratchRoot, 'authority-initial-history-'));
  fs.chmodSync(dataDir, 0o700);
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'state-client.json'), JSON.stringify({ _rev: 1, _wid: 'initial', unit: 'kg', workouts: [{ id: 'initial-workout', d: '2026-10-30', entries: [{ id: '0025', sets: [{ done: true, r: 8, w: 20 }] }] }], bodyweight: [{ d: '2026-10-30', w: 80 }] }), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [
    { id: 'admin', name: 'admin', admin: true, owner: true }, { id: 'trainer', name: 'trainer' }, { id: 'coordinator', name: 'coordinator' }, { id: 'client', name: 'client' }
  ], creds: [], subs: [], invites: [] }), { mode: 0o600 });
  const running = start(dataDir); const base = await running.base;
  t.after(() => { running.child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const cookie = uid => { const payload = `${uid}:${Date.now() + 3600000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; };
  const request = async (method, pathname, uid, body) => {
    const response = await fetch(base + pathname, { method, headers: { Cookie: cookie(uid), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-OpenGym-Contract-Version': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const mutation = (n, payload, expectedVersion = 0) => ({ operationId: op(n), expectedVersion, payload });
  for (const [n, accountId, roles] of [[1, 'trainer', ['TRAINER']], [2, 'coordinator', ['COORDINATOR']], [3, 'client', ['CLIENT']]]) {
    assert.equal((await request('POST', '/api/admin/operations/roles', 'admin', mutation(n, { accountId, roles, reason: 'test fixture' }))).status, 200);
  }
  assert.equal((await request('POST', '/api/admin/operations/scopes', 'admin', mutation(4, { coordinatorId: 'coordinator', clientId: 'client', assigned: true, reason: 'test fixture' }))).status, 200);
  assert.equal((await request('POST', '/api/admin/commercial/operations/confirm', 'coordinator', mutation(5, { clientId: 'client', kind: 'MONTHLY', reference: 'test fixture', reason: 'test fixture' }))).status, 200);
  const grants = [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-10-31T05:00:00.000Z', includeWeight: true }];
  const invite = await request('POST', '/api/trainer/invitations', 'trainer', mutation(6, { knownClientId: 'client', commercialName: 'test client', grants }));
  assert.equal(invite.status, 200);
  const accepted = await request('POST', '/api/invitations/accept', 'client', mutation(7, { token: invite.body.result.token, grants }, invite.body.versionTokens.find(token => token.kind === 'INVITATION').version));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const relationId = accepted.body.result.relationId;
  const db = new DatabaseSync(path.join(dataDir, 'authority.sqlite'), { readOnly: true });
  const share = db.prepare('SELECT id,grant_id,projection_sha256 FROM history_shares WHERE relation_id=?').get(relationId); db.close();
  assert.ok(share, 'initial HISTORY acceptance persists a frozen share');
  const history = await request('GET', `/api/trainer/history?relationId=${encodeURIComponent(relationId)}&grantId=${encodeURIComponent(share.grant_id)}`, 'trainer');
  assert.equal(history.status, 200);
  assert.equal(history.body.items.filter(item => item.sourceKind === 'LEGACY_WORKOUT').length, 1);
  assert.equal((await request('PUT', '/api/data', 'client', { state: { _rev: 2, _wid: 'after-accept', unit: 'kg', workouts: [{ id: 'after-accept-workout', d: '2026-10-30', entries: [{ id: '0025', sets: [{ done: true, r: 9, w: 25 }] }] }], bodyweight: [] } })).status, 200);
  const replay = await request('POST', '/api/invitations/accept', 'client', mutation(7, { token: invite.body.result.token, grants }, invite.body.versionTokens.find(token => token.kind === 'INVITATION').version));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  const replayDb = new DatabaseSync(path.join(dataDir, 'authority.sqlite'), { readOnly: true });
  const replayShare = replayDb.prepare('SELECT id,grant_id,projection_sha256 FROM history_shares WHERE relation_id=?').get(relationId); replayDb.close();
  assert.deepEqual(replayShare, share, 'a completed acceptance replay never recaptures current private state');
  const frozen = await request('GET', `/api/trainer/history?relationId=${encodeURIComponent(relationId)}&grantId=${encodeURIComponent(share.grant_id)}`, 'trainer');
  assert.equal(frozen.body.items.filter(item => item.sourceKind === 'LEGACY_WORKOUT').length, 1);
});

test('initial HISTORY capture failure rolls back invitation consumption and all authority rows', t => {
  assert.ok(scratchRoot, 'TMPDIR must point at the approved scratch directory');
  const dataDir = fs.mkdtempSync(path.join(scratchRoot, 'authority-initial-history-atomic-'));
  const store = createAuthorityStore({ dataDir });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const identities = new Set(['admin', 'trainer', 'client']);
  const service = createAuthorityService({
    store,
    identity: { get: uid => ({ uid, active: identities.has(uid), activity: identities.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) },
    isAdmin: uid => uid === 'admin',
    historyPublisher: { prepare: () => ({ _rev: 1, _wid: 'atomic' }), publish: () => { const error = new Error('conflict'); error.code = 'conflict'; throw error; } }
  });
  service.setRoles({ actorId: 'admin', body: mutationFor(20, { accountId: 'trainer', roles: ['TRAINER'], reason: 'test fixture' }) });
  const grants = [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }];
  const invitation = service.createInvitation({ actorId: 'trainer', body: mutationFor(21, { knownClientId: 'client', commercialName: 'test client', grants }) });
  assert.throws(() => service.acceptInvitation({ actorId: 'client', body: mutationFor(22, { token: invitation.result.token, grants }, invitation.entity.version) }), /conflict/);
  assert.equal(store.db.prepare("SELECT state FROM invitations WHERE id=?").get(invitation.result.inviteId).state, 'PENDING');
  for (const table of ['relations', 'relation_grants', 'history_shares']) assert.equal(store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} is rolled back`);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM mutation_results WHERE capability='ACCEPT_INVITATION'").get().n, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM authority_audit WHERE entity_type='relation'").get().n, 0);
});

function mutationFor(n, payload, expectedVersion = 0) {
  return { operationId: op(n), expectedVersion, payload };
}

function publisherFixture(t, states) {
  const dataDir = fs.mkdtempSync(path.join(scratchRoot, 'authority-initial-history-publisher-'));
  const store = createAuthorityStore({ dataDir });
  const active = new Set(['admin', 'trainer', 'client']);
  let reads = 0;
  const service = createAuthorityService({
    store,
    identity: { get: uid => ({ uid, active: active.has(uid), activity: active.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) },
    isAdmin: uid => uid === 'admin',
    historyPublisher: createHistoryPublisher({ readStateStrict: () => { reads += 1; return states.shift(); } }),
    clock: () => '2027-03-15T12:00:00.000Z'
  });
  service.setRoles({ actorId: 'admin', body: mutationFor(70, { accountId: 'trainer', roles: ['TRAINER'], reason: 'fixture' }) });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { store, service, reads: () => reads };
}

test('shared HISTORY publisher commits matching snapshots, rejects changed or unreadable sources, and freezes missing state empty', t => {
  const history = [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-03-01T00:00:00.000Z' }];
  const accepted = ({ service }, n) => {
    const invite = service.createInvitation({ actorId: 'trainer', body: mutationFor(n, { knownClientId: 'client', commercialName: 'Client', grants: history }) });
    return service.acceptInvitation({ actorId: 'client', body: mutationFor(n + 1, { token: invite.result.token, grants: history }, invite.entity.version) });
  };
  const stable = { _rev: 1, _wid: 'stable', unit: 'kg', workouts: [], bodyweight: [] };
  const matching = publisherFixture(t, [stable, stable]);
  const matchingResult = accepted(matching, 71);
  assert.equal(matching.reads(), 2);
  assert.equal(matching.store.db.prepare('SELECT count(*) AS n FROM history_shares WHERE relation_id=?').get(matchingResult.result.relationId).n, 1);

  const changed = publisherFixture(t, [stable, { ...stable, _rev: 2 }]);
  const changedInvite = changed.service.createInvitation({ actorId: 'trainer', body: mutationFor(73, { knownClientId: 'client', commercialName: 'Client', grants: history }) });
  assert.throws(() => changed.service.acceptInvitation({ actorId: 'client', body: mutationFor(74, { token: changedInvite.result.token, grants: history }, changedInvite.entity.version) }), /conflict/);
  assert.equal(changed.store.db.prepare('SELECT state FROM invitations WHERE id=?').get(changedInvite.result.inviteId).state, 'PENDING');
  for (const table of ['relations', 'relation_grants', 'history_shares']) assert.equal(changed.store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} rolls back on source identity conflict`);
  assert.equal(changed.store.db.prepare("SELECT count(*) AS n FROM mutation_results WHERE capability='ACCEPT_INVITATION'").get().n, 0);
  assert.equal(changed.store.db.prepare("SELECT count(*) AS n FROM authority_audit WHERE entity_type='relation'").get().n, 0);

  const missing = publisherFixture(t, [null, null]);
  const missingResult = accepted(missing, 75);
  const empty = JSON.parse(missing.store.db.prepare('SELECT projection_json FROM history_shares WHERE relation_id=?').get(missingResult.result.relationId).projection_json);
  assert.deepEqual(empty.records, []);

  const unreadable = publisherFixture(t, [false]);
  const unreadableInvite = unreadable.service.createInvitation({ actorId: 'trainer', body: mutationFor(77, { knownClientId: 'client', commercialName: 'Client', grants: history }) });
  assert.throws(() => unreadable.service.acceptInvitation({ actorId: 'client', body: mutationFor(78, { token: unreadableInvite.result.token, grants: history }, unreadableInvite.entity.version) }), /conflict/);
  assert.equal(unreadable.reads(), 1);
  assert.equal(unreadable.store.db.prepare('SELECT state FROM invitations WHERE id=?').get(unreadableInvite.result.inviteId).state, 'PENDING');
  assert.equal(unreadable.store.db.prepare('SELECT count(*) AS n FROM relations').get().n, 0);
});

test('legacy pending HISTORY without a frozen share confirms and reads fail closed without source capture', t => {
  const dataDir = fs.mkdtempSync(path.join(scratchRoot, 'authority-initial-history-legacy-'));
  const store = createAuthorityStore({ dataDir });
  const active = new Set(['trainer', 'client']);
  let reads = 0;
  const clock = () => '2027-03-15T12:00:00.000Z';
  const service = createAuthorityService({ store, identity: { get: uid => ({ uid, active: active.has(uid), activity: active.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) }, clock });
  const training = createTrainingAuthority({ store, service, identity: { get: uid => ({ uid, active: active.has(uid) }) }, clock, readStateStrict: () => { reads += 1; return { _rev: 9, _wid: 'private-now', workouts: [{ id: 'private', d: '2027-03-01', entries: [] }], bodyweight: [] }; } });
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const db = store.db; const relationId = crypto.randomUUID(); const invitationId = crypto.randomUUID(); const acceptedAt = '2027-03-10T12:00:00.000Z';
  for (const [account, role] of [['trainer', 'TRAINER'], ['client', 'CLIENT']]) db.prepare('INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), account, role, 'seed', acceptedAt, 1, 'legacy');
  db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES (?,?,'Client','legacy','ACCEPTED','2099-01-01T00:00:00.000Z',?,1)").run(invitationId, 'trainer', acceptedAt);
  db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,version) VALUES (?,?,?,?,'PENDING_CONFIRMATION',?,1)").run(relationId, 'trainer', 'client', invitationId, acceptedAt);
  db.prepare("INSERT INTO relation_pending_grants(id,relation_id,kind,window_start_utc,window_end_exclusive_utc,include_weight,consented_at_utc,version) VALUES (?,?, 'HISTORY','2026-01-01T00:00:00.000Z','2027-03-01T00:00:00.000Z',0,?,1)").run(crypto.randomUUID(), relationId, acceptedAt);
  db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES (?,?,'2027-01-01T00:00:00.000Z','2028-01-01T00:00:00.000Z',1,'MONTHLY','legacy','legacy','seed',?,1)").run(crypto.randomUUID(), 'client', acceptedAt);
  const confirmed = service.changeRelation({ actorId: 'trainer', action: 'confirm', body: mutationFor(90, { relationId }, 0) });
  const historyGrant = db.prepare("SELECT id FROM relation_grants WHERE relation_id=? AND kind='HISTORY' AND state='ACTIVE'").get(relationId);
  assert.ok(historyGrant);
  assert.equal(db.prepare('SELECT count(*) AS n FROM history_shares WHERE relation_id=?').get(relationId).n, 0);
  assert.deepEqual(training.trainerHistory('trainer', relationId, historyGrant.id, null, 25).items, []);
  assert.equal(reads, 0);
  assert.equal(confirmed.result.state, 'ACTIVE');
});

test('initial unknown HISTORY acceptance freezes nonempty HTTP/SQLite state and denies trainer reads before confirmation', async t => {
  const dataDir = fs.mkdtempSync(path.join(scratchRoot, 'authority-initial-history-unknown-'));
  fs.chmodSync(dataDir, 0o700);
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [
    { id: 'admin', name: 'admin', admin: true, owner: true }, { id: 'trainer', name: 'trainer' }, { id: 'coordinator', name: 'coordinator' }
  ], creds: [], subs: [], invites: [] }), { mode: 0o600 });
  const running = start(dataDir); const base = await running.base;
  t.after(() => { running.child.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const cookie = uid => { const payload = `${uid}:${Date.now() + 3600000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; };
  const request = async (method, pathname, uid, body) => {
    const response = await fetch(base + pathname, { method, headers: { ...(uid ? { Cookie: cookie(uid) } : {}), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-OpenGym-Contract-Version': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const mutation = (n, payload, expectedVersion = 0) => ({ operationId: op(100 + n), expectedVersion, payload });
  const relationVersion = receipt => receipt.body.versionTokens.find(token => token.kind === 'RELATION').version;
  const invitationVersion = receipt => receipt.body.versionTokens.find(token => token.kind === 'INVITATION').version;
  for (const [n, accountId, roles] of [[1, 'trainer', ['TRAINER']], [2, 'coordinator', ['COORDINATOR']]]) assert.equal((await request('POST', '/api/admin/operations/roles', 'admin', mutation(n, { accountId, roles, reason: 'test fixture' }))).status, 200);
  const history = { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-10-31T05:00:00.000Z' };
  const invitation = await request('POST', '/api/trainer/invitations', 'trainer', mutation(3, { commercialName: 'unknown', grants: [history] }));
  const registered = await request('POST', '/api/register/password', undefined, { name: 'unknown', password: 'correct horse battery staple', inviteToken: invitation.body.result.token });
  assert.equal(registered.status, 200);
  const clientId = registered.body.user.id;
  assert.equal((await request('POST', '/api/admin/operations/roles', 'admin', mutation(4, { accountId: clientId, roles: ['CLIENT'], reason: 'test fixture' }))).status, 200);
  assert.equal((await request('POST', '/api/admin/operations/scopes', 'admin', mutation(5, { coordinatorId: 'coordinator', clientId, assigned: true, reason: 'test fixture' }))).status, 200);
  assert.equal((await request('POST', '/api/admin/commercial/operations/confirm', 'coordinator', mutation(6, { clientId, kind: 'MONTHLY', reference: 'test fixture', reason: 'test fixture' }))).status, 200);
  const initial = { _rev: 1, _wid: 'accepted', unit: 'kg', workouts: [{ id: 'accepted-workout', d: '2026-10-30', entries: [{ id: '0025', sets: [{ done: true, r: 8 }] }] }], bodyweight: [] };
  assert.equal((await request('PUT', '/api/data', clientId, { state: initial })).status, 200);
  const accepted = await request('POST', '/api/invitations/accept', clientId, mutation(7, { token: invitation.body.result.token, grants: [history] }, invitationVersion(invitation)));
  assert.equal(accepted.status, 200);
  const relationId = accepted.body.result.relationId;
  assert.equal(accepted.body.result.state, 'PENDING_CONFIRMATION');
  const db = new DatabaseSync(path.join(dataDir, 'authority.sqlite'), { readOnly: true });
  const share = db.prepare('SELECT grant_id FROM history_shares WHERE relation_id=?').get(relationId); db.close();
  assert.ok(share, 'acceptance persists a nonempty immutable share before confirmation');
  assert.equal((await request('GET', `/api/trainer/history?relationId=${encodeURIComponent(relationId)}&grantId=${encodeURIComponent(share.grant_id)}`, 'trainer')).status, 403);
  assert.equal((await request('PUT', '/api/data', clientId, { state: { ...initial, _rev: 2, _wid: 'after-accept', workouts: [...initial.workouts, { id: 'private-after-accept', d: '2026-10-29', entries: [{ id: '0025', sets: [{ done: true, r: 9 }] }] }] } })).status, 200);
  const confirmed = await request('POST', '/api/trainer/relations/confirm', 'trainer', mutation(8, { relationId }, relationVersion(accepted)));
  assert.equal(confirmed.status, 200);
  const historyRead = await request('GET', `/api/trainer/history?relationId=${encodeURIComponent(relationId)}&grantId=${encodeURIComponent(share.grant_id)}`, 'trainer');
  assert.equal(historyRead.status, 200);
  assert.deepEqual(historyRead.body.items.map(item => item.sourceRecordId), ['accepted-workout']);
});
