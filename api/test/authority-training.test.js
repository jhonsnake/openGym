import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';
import { createTrainingAuthority } from '../authority-training.js';

const uid = () => crypto.randomUUID();
function fixture(t, { state = null, readStateStrict = () => state } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-training-'));
  const store = createAuthorityStore({ dataDir });
  const people = new Map(['trainer', 'client'].map(id => [id, { id, active: true, activity: 'ACTIVE' }]));
  const service = createAuthorityService({ store, identity: { get: id => people.get(id) } });
  const training = createTrainingAuthority({ store, service, identity: { get: id => people.get(id) }, readStateStrict });
  const relationId = uid(); const invitationId = uid(); const stamp = new Date().toISOString();
  const db = store.db;
  for (const [account, role] of [['trainer', 'TRAINER'], ['client', 'CLIENT']]) db.prepare('INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES (?,?,?,?,?,?,?)').run(uid(), account, role, 'seed', stamp, 1, 'test');
  db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES (?,?,?,'seed','ACCEPTED',?,?,1)").run(invitationId, 'trainer', 'Client', '2099-01-01T00:00:00.000Z', stamp);
  db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES (?,?,?,?,'ACTIVE',?,?,1)").run(relationId, 'trainer', 'client', invitationId, stamp, stamp);
  db.prepare('INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES (?,?,?,?,?,1)').run(uid(), relationId, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', 'test');
  for (const kind of ['PLAN', 'EXECUTION']) db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,granted_by,eligible_from_utc,version) VALUES (?,? ,?,'ACTIVE','client',?,1)").run(uid(), relationId, kind, stamp);
  db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES (?,?,?, ?,1,'MONTHLY','test','test','seed',?,1)").run(uid(), 'client', '2000-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', stamp);
  t.after(() => { store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { store, training, relationId, people };
}
test('T5 publishes immutable repeated entries, snapshots a session and writes actuals exactly once', t => {
  const { store, training, relationId } = fixture(t);
  const publish = training.publishPlan({ actorId: 'trainer', requestId: 'test', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, exercises: [
    { exerciseId: '0025', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 10 } }, setOverrides: {} },
    { exerciseId: '0025', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 8 } }, setOverrides: {} }
  ] } } });
  assert.equal(publish.result.exercises.length, 2);
  assert.notEqual(publish.result.exercises[0].entryId, publish.result.exercises[1].entryId);
  const started = training.startSession({ actorId: 'client', requestId: 'test', body: { operationId: uid(), expectedVersion: 0, payload: { planVersionId: publish.result.planVersionId } } });
  const entry = started.result.snapshot.exercises[0]; const finishBody = { operationId: uid(), expectedVersion: 1, payload: { sessionId: started.result.sessionId, entries: [
    { planEntryId: entry.entryId, exerciseId: entry.exerciseId, disposition: 'PERFORMED', sets: [{ phase: 'work', completed: true, reps: 9, load: { kind: 'BODY_WEIGHT' }, effort: { kind: 'RPE', value: 9.5 }, failure: true }] },
    { planEntryId: started.result.snapshot.exercises[1].entryId, exerciseId: '0025', disposition: 'OMITTED', sets: [] },
    { exerciseId: '0025', disposition: 'ADDED', sets: [{ phase: 'work', completed: true, reps: 6 }] }
  ] } };
  const finished = training.finishSession({ actorId: 'client', requestId: 'test', body: finishBody });
  assert.equal(finished.result.state, 'FINISHED');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM session_executions').get().n, 1);
  const replay = training.finishSession({ actorId: 'client', requestId: 'test', body: finishBody });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.executionId, finished.result.executionId);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM session_executions').get().n, 1);
});

test('T6 recovers only the original authorized OPEN snapshot and its SESSION_SET token', t => {
  const { store, training, relationId } = fixture(t);
  const publish = training.publishPlan({ actorId: 'trainer', requestId: 'current', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, exercises: [{ exerciseId: '0025', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 8 } }, setOverrides: {} }] } } });
  assert.deepEqual(training.currentSession('client').session, null);
  const started = training.startSession({ actorId: 'client', requestId: 'current', body: { operationId: uid(), expectedVersion: 0, payload: { planVersionId: publish.result.planVersionId } } });
  const recovered = training.currentSession('client');
  assert.equal(recovered.session.sessionId, started.result.sessionId);
  assert.equal(recovered.session.planVersionId, publish.result.planVersionId);
  assert.deepEqual(recovered.session.snapshot, started.result.snapshot, 'recovery returns the exact stored snapshot');
  assert.deepEqual(recovered.versionTokens.map(token => token.kind), ['SESSION', 'SESSION_SET']);
  // A later plan does not mutate an already-open recovery record.
  const second = training.publishPlan({ actorId: 'trainer', requestId: 'current', body: { operationId: uid(), expectedVersion: 1, payload: { relationId, exercises: [{ exerciseId: '0026', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 9 } }, setOverrides: {} }] } } });
  assert.notEqual(second.result.planVersionId, recovered.session.planVersionId);
  assert.equal(training.currentSession('client').session.planVersionId, publish.result.planVersionId);
  training.abandonSession({ actorId: 'client', requestId: 'current', body: { operationId: uid(), expectedVersion: started.versionTokens.find(token => token.kind === 'SESSION').version, payload: { sessionId: started.result.sessionId } } });
  assert.equal(training.currentSession('client').session, null, 'closed sessions are not recovery candidates');
  assert.equal(store.db.prepare("SELECT state FROM client_sessions WHERE id=?").get(started.result.sessionId).state, 'CLOSED');
});

test('T5 rejects an incomplete prescribed snapshot before it writes an execution', t => {
  const { store, training, relationId } = fixture(t);
  const publish = training.publishPlan({ actorId: 'trainer', requestId: 'completeness', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, exercises: [
    { exerciseId: '0025', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 8 } }, setOverrides: {} },
    { exerciseId: '0026', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 10 } }, setOverrides: {} }
  ] } } });
  const started = training.startSession({ actorId: 'client', requestId: 'completeness', body: { operationId: uid(), expectedVersion: 0, payload: { planVersionId: publish.result.planVersionId } } });
  const [first, second] = started.result.snapshot.exercises;
  const finish = entries => training.finishSession({ actorId: 'client', requestId: 'completeness', body: { operationId: uid(), expectedVersion: 1, payload: { sessionId: started.result.sessionId, entries } } });
  const performed = { planEntryId: first.entryId, exerciseId: first.exerciseId, disposition: 'PERFORMED', sets: [{ phase: 'work', completed: true, reps: 8 }] };
  assert.throws(() => finish([performed]), /validation-error/, 'one submitted row cannot finish two prescribed rows');
  assert.throws(() => finish([{ exerciseId: '0025', disposition: 'ADDED', sets: [{ phase: 'work', completed: true, reps: 8 }] }]), /validation-error/, 'an added exercise never satisfies a prescribed entry');
  assert.throws(() => finish([performed, performed]), /validation-error/, 'duplicate prescribed entries are rejected');
  assert.throws(() => finish([{ ...performed, planEntryId: uid() }, { planEntryId: second.entryId, exerciseId: second.exerciseId, disposition: 'OMITTED', sets: [] }]), /validation-error/, 'foreign snapshot IDs are rejected');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM session_executions').get().n, 0);
  assert.equal(store.db.prepare('SELECT state FROM client_sessions WHERE id=?').get(started.result.sessionId).state, 'OPEN');
  const complete = finish([performed, { planEntryId: second.entryId, exerciseId: second.exerciseId, disposition: 'OMITTED', sets: [] }]);
  assert.equal(complete.result.state, 'FINISHED');
});

test('T6 uses the original window exactly, exposes a minimal stale close escape, and permits explicit renewal recovery', t => {
  const { store, training, relationId, people } = fixture(t);
  const publish = training.publishPlan({ actorId: 'trainer', requestId: 'window', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, exercises: [{ exerciseId: '0025', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 8 } }, setOverrides: {} }] } } });
  const started = training.startSession({ actorId: 'client', requestId: 'window', body: { operationId: uid(), expectedVersion: 0, payload: { planVersionId: publish.result.planVersionId } } });
  const readable = training.currentSession('client');
  assert.deepEqual(readable.versionTokens.map(token => token.kind), ['SESSION', 'SESSION_SET']);
  assert.equal(readable.versionTokens[0].key, JSON.stringify([started.result.sessionId]));
  assert.equal(readable.versionTokens[1].key, JSON.stringify(['client']));
  const session = store.db.prepare('SELECT * FROM client_sessions WHERE id=?').get(started.result.sessionId);
  const subscription = store.db.prepare('SELECT * FROM subscription_intervals WHERE client_id=?').get('client');
  store.db.prepare('UPDATE subscription_intervals SET end_exclusive_utc=? WHERE id=?').run(session.server_started_at_utc, subscription.id);
  assert.throws(() => training.currentSession('client'), /forbidden/, 'an expired paid account cannot obtain a close-state fallback');
  store.db.prepare('UPDATE subscription_intervals SET end_exclusive_utc=? WHERE id=?').run('2099-01-01T00:00:00.000Z', subscription.id);
  assert.equal(training.currentSession('client').session.sessionId, started.result.sessionId, 'renewal on the same valid original window permits explicit recovery only');
  people.get('client').active = false;
  assert.throws(() => training.currentSession('client'), /forbidden/, 'disabled identities have no recovery path');
  people.get('client').active = true;
  store.db.prepare('UPDATE relation_access_windows SET ended_at_utc=? WHERE id=?').run(session.server_started_at_utc, session.access_window_id);
  store.db.prepare('INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES (?,?,?,?,?,1)').run(uid(), relationId, session.server_started_at_utc, session.server_started_at_utc, 'reactivation');
  const stale = training.currentSession('client');
  assert.equal(stale.session, null);
  assert.deepEqual(stale.closeOnlySession, { sessionId: started.result.sessionId, state: 'OPEN' });
  assert.deepEqual(stale.versionTokens.map(token => token.kind), ['SESSION', 'SESSION_SET']);
  const entry = started.result.snapshot.exercises[0];
  assert.throws(() => training.finishSession({ actorId: 'client', requestId: 'window', body: { operationId: uid(), expectedVersion: stale.versionTokens[0].version, payload: { sessionId: started.result.sessionId, entries: [{ planEntryId: entry.entryId, exerciseId: entry.exerciseId, disposition: 'PERFORMED', sets: [{ phase: 'work', completed: true, reps: 8 }] }] } } }), /forbidden/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM session_executions').get().n, 0);
  const closed = training.abandonSession({ actorId: 'client', requestId: 'window', body: { operationId: uid(), expectedVersion: stale.versionTokens[0].version, payload: { sessionId: stale.closeOnlySession.sessionId } } });
  assert.equal(closed.result.state, 'CLOSED');
  const fresh = training.startSession({ actorId: 'client', requestId: 'window', body: { operationId: uid(), expectedVersion: 1, payload: { planVersionId: publish.result.planVersionId } } });
  assert.notEqual(fresh.result.sessionId, started.result.sessionId, 'abandon is explicit; a new window starts a fresh session');
});

test('T5 HISTORY keeps one immutable share per exact non-overlapping grant and fails closed without grantId', t => {
  const state = { _rev: 7, _wid: 'wid-7', workouts: [], bodyweight: [], customEx: [] };
  const { store, training, relationId } = fixture(t, { state });
  const operationId = uid();
  const body = { operationId, expectedVersion: 0, payload: { relationId, grants: [
    { kind: 'PLAN' }, { kind: 'EXECUTION' },
    { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' },
    { kind: 'HISTORY', startUtc: '2026-02-01T00:00:00.000Z', endExclusiveUtc: '2026-03-01T00:00:00.000Z' }
  ] } };
  assert.equal(training.replaceGrants({ actorId: 'client', requestId: 'history', body }).result.relationId, relationId);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM history_shares WHERE operation_id=?').get(operationId).n, 2);
  assert.equal(training.replaceGrants({ actorId: 'client', requestId: 'history-replay', body }).replayed, true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM history_shares WHERE operation_id=?').get(operationId).n, 2);
  const grants = store.db.prepare("SELECT id FROM relation_grants WHERE relation_id=? AND kind='HISTORY' AND state='ACTIVE' ORDER BY window_start_utc").all(relationId);
  assert.equal(training.trainerHistory('trainer', relationId, grants[0].id, null, 25).items.length, 0);
  assert.equal(training.trainerHistory('trainer', relationId, grants[1].id, null, 25).items.length, 0);
  assert.throws(() => training.trainerHistory('trainer', relationId, undefined, null, 25), /validation-error/);
  assert.throws(() => training.trainerHistory('trainer', relationId, uid(), null, 25), /not-found/);
  const invalid = { operationId: uid(), expectedVersion: 1, payload: { relationId, grants: [
    { kind: 'HISTORY', startUtc: '2026-04-01T00:00:00.000Z', endExclusiveUtc: '2026-06-01T00:00:00.000Z' },
    { kind: 'HISTORY', startUtc: '2026-05-01T00:00:00.000Z', endExclusiveUtc: '2026-07-01T00:00:00.000Z' }
  ] } };
  assert.throws(() => training.replaceGrants({ actorId: 'client', requestId: 'history-invalid', body: invalid }), /overlap/);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").get(relationId).n, 4);
});

test('T5 rejects HISTORY includeWeight unless WEIGHT is independently selected', t => {
  const { training, relationId } = fixture(t, { state: { _rev: 1, _wid: 'weight-rule', unit: 'kg', workouts: [], bodyweight: [] } });
  assert.throws(() => training.replaceGrants({ actorId: 'client', requestId: 'weight-rule', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, grants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z', includeWeight: true }] } } }), /explicit WEIGHT grant/);
});

test('T5 captures a fresh HISTORY source outside the replace commit and revalidates it inside', t => {
  const state = { _rev: 1, _wid: 'ordering', unit: 'kg', workouts: [], bodyweight: [], customEx: [] };
  const sourceReadContexts = [];
  let inTransaction = false;
  const { store, training, relationId } = fixture(t, { state, readStateStrict: () => {
    sourceReadContexts.push(inTransaction ? 'inside' : 'outside');
    return state;
  } });
  const transaction = store.transaction.bind(store);
  store.transaction = (context, apply) => transaction(context, tx => {
    inTransaction = true;
    try { return apply(tx); } finally { inTransaction = false; }
  });
  training.replaceGrants({ actorId: 'client', requestId: 'ordering', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, grants: [
    { kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }
  ] } } });
  assert.deepEqual(sourceReadContexts, ['outside', 'inside']);
});

test('T5 replace preflight never reads HISTORY for denied, stale, or replayed requests and rolls back a changed source', t => {
  let reads = 0;
  let snapshots = [
    { _rev: 1, _wid: 'before', unit: 'kg', workouts: [], bodyweight: [], customEx: [] },
    { _rev: 2, _wid: 'changed', unit: 'kg', workouts: [], bodyweight: [], customEx: [] }
  ];
  const { store, training, relationId } = fixture(t, { readStateStrict: () => { reads += 1; return snapshots.shift(); } });
  const grants = [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }];
  assert.throws(() => training.replaceGrants({ actorId: 'trainer', requestId: 'denied', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, grants } } }), /forbidden/);
  assert.equal(reads, 0);
  assert.throws(() => training.replaceGrants({ actorId: 'client', requestId: 'stale', body: { operationId: uid(), expectedVersion: 1, payload: { relationId, grants } } }), /conflict/);
  assert.equal(reads, 0);
  const body = { operationId: uid(), expectedVersion: 0, payload: { relationId, grants } };
  assert.throws(() => training.replaceGrants({ actorId: 'client', requestId: 'changed-source', body }), /conflict/);
  assert.equal(reads, 2);
  assert.deepEqual(store.db.prepare("SELECT kind FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(relationId).map(row => row.kind), ['EXECUTION', 'PLAN']);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM history_shares WHERE relation_id=?').get(relationId).n, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM mutation_results WHERE operation_id=?").get(body.operationId).n, 0);
  snapshots = [
    { _rev: 3, _wid: 'committed', unit: 'kg', workouts: [], bodyweight: [], customEx: [] },
    { _rev: 3, _wid: 'committed', unit: 'kg', workouts: [], bodyweight: [], customEx: [] }
  ];
  const committed = training.replaceGrants({ actorId: 'client', requestId: 'fresh', body: { ...body, operationId: uid() } });
  const readCount = reads;
  const replay = training.replaceGrants({ actorId: 'client', requestId: 'replay', body: { ...body, operationId: committed.operationId } });
  assert.equal(replay.replayed, true);
  assert.equal(reads, readCount);
});

test('T5 grant replacement preserves identical active grants and only snapshots changed HISTORY consent', t => {
  const state = { _rev: 7, _wid: 'wid-7', workouts: [], bodyweight: [], customEx: [] };
  const { store, training, relationId } = fixture(t, { state });
  const window = store.db.prepare('SELECT id FROM relation_access_windows WHERE relation_id=?').get(relationId);
  const planId = uid();
  store.db.prepare('INSERT INTO plan_versions(id,relation_id,version_number,goal_version_id,payload_json,payload_sha256,created_by,published_at_utc,version) VALUES (?,?,?,?,?,?,?,?,1)').run(planId, relationId, 1, null, '{}', 'hash', 'trainer', '2026-01-01T00:00:00.000Z');
  const sessionId = uid();
  store.db.prepare("INSERT INTO client_sessions(id,client_id,relation_id,plan_version_id,goal_version_id,access_window_id,server_started_at_utc,snapshot_json,state,version) VALUES (?,?,?,?,?,?,?,?, 'FINISHED',1)").run(sessionId, 'client', relationId, planId, null, window.id, '2026-01-02T00:00:00.000Z', JSON.stringify({ exercises: [] }));
  const initial = training.replaceGrants({ actorId: 'client', requestId: 'diff-initial', body: { operationId: uid(), expectedVersion: 0, payload: { relationId, grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }] } } });
  const receipt = new Date().toISOString();
  store.db.prepare('INSERT INTO session_executions(id,session_id,client_id,payload_json,payload_sha256,operation_id,submitted_at_utc,version) VALUES (?,?,?,?,?,?,?,1)').run(uid(), sessionId, 'client', '{}', 'hash', uid(), receipt);
  store.db.prepare('INSERT INTO bodyweight_entries(id,client_id,weight,unit,reported_date_panama,received_at_utc,operation_id,version) VALUES (?,?,?,?,?,?,?,1)').run(uid(), 'client', 80, 'KG', '2026-10-30', receipt, uid());
  const before = store.db.prepare("SELECT kind,id,eligible_from_utc,version FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(relationId);
  assert.equal(training.trainerExecutions('trainer', relationId, null, 25).items.length, 1);
  assert.equal(training.trainerBodyweight('trainer', relationId, null, 25).items.length, 1);

  const historyEnd = '2026-02-01T00:00:00.000Z';
  const replaced = training.replaceGrants({ actorId: 'client', requestId: 'diff-history', body: { operationId: uid(), expectedVersion: initial.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId, grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }, { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: historyEnd, includeWeight: true }] } } });
  const after = store.db.prepare("SELECT kind,id,eligible_from_utc,version FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(relationId);
  assert.deepEqual(after.filter(row => row.kind !== 'HISTORY'), before);
  assert.equal(training.trainerExecutions('trainer', relationId, null, 25).items.length, 1);
  assert.equal(training.trainerBodyweight('trainer', relationId, null, 25).items.length, 1);
  const history = store.db.prepare("SELECT id,grant_id,projection_json FROM history_shares WHERE relation_id=?").all(relationId);
  assert.equal(history.length, 1);
  const historyGrantId = after.find(row => row.kind === 'HISTORY').id;

  const noop = training.replaceGrants({ actorId: 'client', requestId: 'diff-noop', body: { operationId: uid(), expectedVersion: replaced.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId, grants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: historyEnd, includeWeight: true }, { kind: 'WEIGHT' }, { kind: 'PLAN' }, { kind: 'EXECUTION' }] } } });
  const afterNoop = store.db.prepare("SELECT kind,id,eligible_from_utc,version FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(relationId);
  assert.deepEqual(afterNoop, after);
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM history_shares WHERE relation_id=?").get(relationId).n, 1);
  assert.equal(store.db.prepare("SELECT id FROM history_shares WHERE relation_id=?").get(relationId).id, history[0].id);
  assert.equal(store.db.prepare("SELECT grant_id FROM history_shares WHERE relation_id=?").get(relationId).grant_id, historyGrantId);
  assert.equal(noop.versionTokens.find(token => token.kind === 'RELATION').version, replaced.versionTokens.find(token => token.kind === 'RELATION').version + 1);
});

