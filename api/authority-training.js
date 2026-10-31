import crypto from 'node:crypto';
import { canonicalAggregateKey, hashPayload, parseAuthorityPayload, validateMutationEnvelope } from './authority-contract.js';
import { composeHistoryShare, filterHistoryShareForCurrentGrants, projectLegacyBodyweight } from './authority-projections.js';
import { exerciseResolver } from './exercise-catalogue.js';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const id = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
const grant = (db, relationId, kind, at) => db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND kind=? AND state='ACTIVE' AND eligible_from_utc IS NOT NULL AND eligible_from_utc<=? ORDER BY version DESC,id DESC LIMIT 1").get(relationId, kind, at);
const activeWindow = (db, relationId, at) => db.prepare("SELECT * FROM relation_access_windows WHERE relation_id=? AND enabled_from_utc<=? AND (ended_at_utc IS NULL OR ended_at_utc>?)").get(relationId, at, at);
const activeSessionWindow = (db, session, at) => db.prepare("SELECT * FROM relation_access_windows WHERE id=? AND relation_id=? AND enabled_from_utc<=? AND (ended_at_utc IS NULL OR ended_at_utc>?)").get(session.access_window_id, session.relation_id, session.server_started_at_utc, at);
const relation = (db, relationId) => db.prepare('SELECT * FROM relations WHERE id=?').get(relationId);
const entitled = (db, clientId, at) => !!db.prepare('SELECT 1 FROM subscription_intervals WHERE client_id=? AND start_utc<=? AND end_exclusive_utc>?').get(clientId, at, at);
const equalSnapshotIdentity = (a, b) => (a?._rev ?? 0) === (b?._rev ?? 0) && (a?._wid ?? null) === (b?._wid ?? null);

function localPage({ rows, cursor, limit = 25 }) {
  const n = Number(limit); if (!Number.isInteger(n) || n < 1 || n > 100) fail('validation-error');
  const start = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
  if (!Number.isInteger(start) || start < 0) fail('validation-error');
  const items = rows.slice(start, start + n);
  return { items, nextCursor: start + n < rows.length ? Buffer.from(String(start + n)).toString('base64url') : null };
}

function snapshotEntries(plan) {
  return new Map(plan.exercises.map(entry => [entry.entryId, entry]));
}

export function createTrainingAuthority({ store, service, identity, readStateStrict, clock = iso, resolveOwnedCustomExerciseId, pageCodec } = {}) {
  if (!store || !service || !identity || typeof readStateStrict !== 'function') throw new TypeError('training authority dependencies are required');
  const resolver = resolveOwnedCustomExerciseId ? ((value, ctx) => exerciseResolver(value, ctx) || (resolveOwnedCustomExerciseId(value, ctx.subjectId) === true ? { kind: 'custom', ownerId: ctx.subjectId } : null)) : exerciseResolver;
  const optionsFor = subjectId => ({ clock: () => new Date(clock()), exerciseResolver: resolver, subjectId });
  const page = pageCodec || (({ rows, cursor, limit }) => localPage({ rows, cursor, limit }));
  const assertSession = (tx, clientId, session, requiredGrant) => {
    const at = clock();
    if (session.client_id !== clientId) fail('not-found');
    const r = relation(tx.db, session.relation_id);
    if (!r || r.client_id !== clientId || r.state !== 'ACTIVE' || !entitled(tx.db, clientId, at) || !activeSessionWindow(tx.db, session, at) || !grant(tx.db, r.id, requiredGrant, at)) fail('forbidden');
    return r;
  };
  const currentPlan = (db, clientId) => db.prepare("SELECT p.* FROM plan_versions p JOIN relations r ON r.id=p.relation_id WHERE r.client_id=? AND r.state='ACTIVE' ORDER BY p.published_at_utc DESC LIMIT 1").get(clientId);
  const parsePlan = (body, clientId) => validateMutationEnvelope(body, 'plan', optionsFor(clientId));

  function publishPlan({ actorId, body, requestId }) {
    const raw = body?.payload?.relationId;
    const target = typeof raw === 'string' ? relation(store.db, raw)?.client_id : null;
    const { operationId, expectedVersion, payload } = parsePlan(body, target);
    return service.mutateAuthority({ actorId, capability: 'PUBLISH_PLAN', subjectId: target, aggregateKind: 'PLAN_SET', aggregateKey: [payload.relationId], operationId, expectedVersion, payload, requestId, authorityContext: { relationId: payload.relationId, grantKind: 'PLAN' } }, tx => {
      const r = relation(tx.db, payload.relationId); if (!r || r.trainer_id !== actorId || r.client_id !== target) fail('not-found');
      const checked = validateMutationEnvelope(body, 'plan', optionsFor(r.client_id));
      if (checked.operationId !== operationId || checked.expectedVersion !== expectedVersion || hashPayload(checked.payload) !== hashPayload(payload)) fail('conflict');
      if (checked.payload.goalVersionId && !tx.db.prepare('SELECT 1 FROM goal_versions WHERE id=? AND relation_id=?').get(checked.payload.goalVersionId, r.id)) fail('conflict');
      const versionNumber = tx.db.prepare('SELECT coalesce(max(version_number),0)+1 AS n FROM plan_versions WHERE relation_id=?').get(r.id).n;
      const exercises = checked.payload.exercises.map(entry => ({ ...entry, entryId: entry.entryId ?? id() }));
      if (new Set(exercises.map(entry => entry.entryId)).size !== exercises.length) fail('validation-error');
      const planId = id(); const stamp = clock(); const stored = { relationId: r.id, exercises };
      tx.db.prepare('INSERT INTO plan_versions(id,relation_id,version_number,goal_version_id,payload_json,payload_sha256,created_by,published_at_utc,version) VALUES (?,?,?,?,?,?,?,?,1)').run(planId, r.id, versionNumber, checked.payload.goalVersionId ?? null, JSON.stringify(stored), hashPayload(stored), actorId, stamp);
      return { entity: { type: 'plan-version', id: planId }, result: { planVersionId: planId, relationId: r.id, versionNumber, goalVersionId: checked.payload.goalVersionId ?? null, exercises }, after: { planVersionId: planId, versionNumber } };
    });
  }

  function publishGoals({ actorId, body, requestId }) {
    const raw = body?.payload?.relationId; const target = typeof raw === 'string' ? relation(store.db, raw)?.client_id : null;
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'goalsPublish', optionsFor(target));
    return service.mutateAuthority({ actorId, capability: 'PUBLISH_PLAN', subjectId: target, aggregateKind: 'GOAL_SET', aggregateKey: [payload.relationId], operationId, expectedVersion, payload, requestId, authorityContext: { relationId: payload.relationId, grantKind: 'PLAN' } }, tx => {
      const r = relation(tx.db, payload.relationId); if (!r || r.trainer_id !== actorId) fail('not-found');
      const checked = validateMutationEnvelope(body, 'goalsPublish', optionsFor(r.client_id));
      if (checked.operationId !== operationId || checked.expectedVersion !== expectedVersion || hashPayload(checked.payload) !== hashPayload(payload)) fail('conflict');
      const versionNumber = tx.db.prepare('SELECT coalesce(max(version_number),0)+1 AS n FROM goal_versions WHERE relation_id=?').get(r.id).n;
      const goalId = id(); const stamp = clock(); const stored = { relationId: r.id, goals: checked.payload.goals };
      tx.db.prepare('INSERT INTO goal_versions(id,relation_id,version_number,payload_json,payload_sha256,created_by,created_at_utc,version) VALUES (?,?,?,?,?,?,?,1)').run(goalId, r.id, versionNumber, JSON.stringify(stored), hashPayload(stored), actorId, stamp);
      return { entity: { type: 'goal-version', id: goalId }, result: { goalVersionId: goalId, relationId: r.id, versionNumber, goals: checked.payload.goals } };
    });
  }

  function startSession({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'sessionStart');
    return service.mutateAuthority({ actorId, capability: 'START_SESSION', subjectId: actorId, aggregateKind: 'SESSION_SET', aggregateKey: [actorId], operationId, expectedVersion, payload, requestId }, tx => {
      const plan = tx.db.prepare('SELECT * FROM plan_versions WHERE id=?').get(payload.planVersionId); if (!plan) fail('not-found');
      const r = relation(tx.db, plan.relation_id); if (!r || r.client_id !== actorId || r.state !== 'ACTIVE' || !grant(tx.db, r.id, 'PLAN', clock())) fail('forbidden');
      const window = activeWindow(tx.db, r.id, clock()); if (!window) fail('forbidden');
      if (tx.db.prepare("SELECT 1 FROM client_sessions WHERE client_id=? AND state='OPEN'").get(actorId)) fail('conflict');
      const planPayload = JSON.parse(plan.payload_json); const goalId = plan.goal_version_id ?? null;
      const snapshot = { planVersionId: plan.id, planVersionNumber: plan.version_number, goalVersionId: goalId, relationId: r.id, accessWindowId: window.id, exercises: planPayload.exercises };
      const sessionId = id(); const stamp = clock();
      tx.db.prepare("INSERT INTO client_sessions(id,client_id,relation_id,plan_version_id,goal_version_id,access_window_id,server_started_at_utc,snapshot_json,state,version) VALUES (?,?,?,?,?,?,?,?, 'OPEN',1)").run(sessionId, actorId, r.id, plan.id, goalId, window.id, stamp, JSON.stringify(snapshot));
      const token = tx.bumpAggregate('SESSION', [sessionId]);
      return { entity: { type: 'session', id: sessionId, version: token.version }, versionTokens: [token], result: { sessionId, state: 'OPEN', serverStartedAtUtc: stamp, snapshot } };
    });
  }

  function finishSession({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'execution', optionsFor(actorId));
    return service.mutateAuthority({ actorId, capability: 'FINISH_SESSION', subjectId: actorId, aggregateKind: 'SESSION', aggregateKey: [payload.sessionId], operationId, expectedVersion, payload, requestId }, tx => {
      const session = tx.db.prepare('SELECT * FROM client_sessions WHERE id=?').get(payload.sessionId); if (!session) fail('not-found');
      const checked = validateMutationEnvelope(body, 'execution', optionsFor(actorId));
      if (checked.operationId !== operationId || checked.expectedVersion !== expectedVersion || hashPayload(checked.payload) !== hashPayload(payload)) fail('conflict');
      assertSession(tx, actorId, session, 'EXECUTION'); if (session.state !== 'OPEN') fail('conflict');
      const entries = snapshotEntries(JSON.parse(session.snapshot_json)); const seen = new Set();
      for (const entry of checked.payload.entries) {
        if (entry.disposition === 'ADDED') continue;
        const prescribed = entries.get(entry.planEntryId); if (!prescribed || seen.has(entry.planEntryId)) fail('validation-error'); seen.add(entry.planEntryId);
        if ((entry.disposition === 'PERFORMED' || entry.disposition === 'OMITTED') && entry.exerciseId !== prescribed.exerciseId) fail('validation-error');
        if (entry.disposition === 'SUBSTITUTED' && entry.exerciseId === prescribed.exerciseId) fail('validation-error');
      }
      if (seen.size !== entries.size) fail('validation-error');
      const executionId = id(); const stamp = clock();
      tx.db.prepare("INSERT INTO session_executions(id,session_id,client_id,payload_json,payload_sha256,operation_id,submitted_at_utc,version) VALUES (?,?,?,?,?,?,?,1)").run(executionId, session.id, actorId, JSON.stringify(checked.payload), hashPayload(checked.payload), operationId, stamp);
      tx.db.prepare("UPDATE client_sessions SET state='FINISHED',finished_at_utc=?,version=version+1 WHERE id=?").run(stamp, session.id);
      return { entity: { type: 'execution', id: executionId }, result: { executionId, sessionId: session.id, submittedAtUtc: stamp, state: 'FINISHED' }, after: { executionId, sessionId: session.id } };
    });
  }

  function abandonSession({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'sessionClose');
    return service.mutateAuthority({ actorId, capability: 'FINISH_SESSION', subjectId: actorId, aggregateKind: 'SESSION', aggregateKey: [payload.sessionId], operationId, expectedVersion, payload, requestId }, tx => {
      const session = tx.db.prepare('SELECT * FROM client_sessions WHERE id=?').get(payload.sessionId); if (!session || session.client_id !== actorId) fail('not-found');
      // Closing is intentionally available after grant/relationship loss, otherwise an expired
      // open session could permanently deadlock the owner. It creates no execution.
      if (session.state !== 'OPEN') fail('conflict'); const stamp = clock();
      tx.db.prepare("UPDATE client_sessions SET state='CLOSED',finished_at_utc=?,version=version+1 WHERE id=?").run(stamp, session.id);
      return { entity: { type: 'session', id: session.id }, result: { sessionId: session.id, state: 'CLOSED', closedAtUtc: stamp } };
    });
  }

  function current(actorId) {
    return store.transaction({ actorId }, tx => {
      service.requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'READ_CLIENT_PLAN' });
      const plan = currentPlan(tx.db, actorId); if (!plan) return { plan: null, goals: null, versionTokens: [{ kind: 'SESSION_SET', key: canonicalAggregateKey([actorId]), version: tx.getAggregateVersion('SESSION_SET', [actorId]) }] };
      const goals = plan.goal_version_id ? tx.db.prepare('SELECT * FROM goal_versions WHERE id=?').get(plan.goal_version_id) : null;
      return { plan: { id: plan.id, versionNumber: plan.version_number, ...JSON.parse(plan.payload_json) }, goals: goals && { id: goals.id, versionNumber: goals.version_number, ...JSON.parse(goals.payload_json) }, versionTokens: [{ kind: 'SESSION_SET', key: canonicalAggregateKey([actorId]), version: tx.getAggregateVersion('SESSION_SET', [actorId]) }] };
    });
  }

  function trainerCurrentPlan(actorId, relationId) {
    return store.transaction({ actorId }, tx => {
      const r = relation(tx.db, relationId); if (!r || r.trainer_id !== actorId) fail('not-found');
      service.requireCapabilityTx(tx, { actorId, subjectId: r.client_id, capability: 'PUBLISH_PLAN', relationId, grantKind: 'PLAN' });
      const token = { kind: 'PLAN_SET', key: canonicalAggregateKey([relationId]), version: tx.getAggregateVersion('PLAN_SET', [relationId]) };
      const plan = tx.db.prepare('SELECT * FROM plan_versions WHERE relation_id=? ORDER BY published_at_utc DESC,id DESC LIMIT 1').get(relationId);
      return { plan: plan ? { id: plan.id, versionNumber: plan.version_number, ...JSON.parse(plan.payload_json) } : null, versionTokens: [token] };
    });
  }

  function trainerCurrentGoals(actorId, relationId) {
    return store.transaction({ actorId }, tx => {
      const r = relation(tx.db, relationId); if (!r || r.trainer_id !== actorId) fail('not-found');
      service.requireCapabilityTx(tx, { actorId, subjectId: r.client_id, capability: 'PUBLISH_PLAN', relationId, grantKind: 'PLAN' });
      const token = { kind: 'GOAL_SET', key: canonicalAggregateKey([relationId]), version: tx.getAggregateVersion('GOAL_SET', [relationId]) };
      const goals = tx.db.prepare('SELECT * FROM goal_versions WHERE relation_id=? ORDER BY created_at_utc DESC,id DESC LIMIT 1').get(relationId);
      return { goals: goals ? { id: goals.id, versionNumber: goals.version_number, ...JSON.parse(goals.payload_json) } : null, versionTokens: [token] };
    });
  }

  // Recovery intentionally returns only the stored OPEN record. It neither starts a new
  // session nor rewrites the historical snapshot when a newer plan is published. If its
  // original window is gone, the owner receives only the explicit-close identifier.
  function currentSession(actorId) {
    return store.transaction({ actorId }, tx => {
      service.requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'ACCESS_PERSONAL_TRAINING' });
      const setToken = { kind: 'SESSION_SET', key: canonicalAggregateKey([actorId]), version: tx.getAggregateVersion('SESSION_SET', [actorId]) };
      const session = tx.db.prepare("SELECT * FROM client_sessions WHERE client_id=? AND state='OPEN' ORDER BY server_started_at_utc DESC,id DESC LIMIT 1").get(actorId);
      if (!session) return { session: null, closeOnlySession: null, versionTokens: [setToken] };
      const sessionToken = { kind: 'SESSION', key: canonicalAggregateKey([session.id]), version: tx.getAggregateVersion('SESSION', [session.id]) };
      try { assertSession(tx, actorId, session, 'PLAN'); } catch (error) {
        if (error.code !== 'forbidden') throw error;
        return { session: null, closeOnlySession: { sessionId: session.id, state: 'OPEN' }, versionTokens: [sessionToken, setToken] };
      }
      const snapshot = JSON.parse(session.snapshot_json);
      return {
        session: {
          sessionId: session.id,
          planVersionId: session.plan_version_id,
          goalVersionId: session.goal_version_id,
          serverStartedAtUtc: session.server_started_at_utc,
          state: session.state,
          snapshot
        },
        closeOnlySession: null,
        versionTokens: [sessionToken, setToken]
      };
    });
  }

  function ownExecutions(actorId, cursor, limit) {
    return store.transaction({ actorId }, tx => { service.requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'READ_OWN_EXECUTIONS' }); const rows = tx.db.prepare('SELECT id,session_id,submitted_at_utc,payload_json FROM session_executions WHERE client_id=? ORDER BY submitted_at_utc DESC,id DESC').all(actorId).map(row => ({ executionId: row.id, sessionId: row.session_id, submittedAtUtc: row.submitted_at_utc, actual: JSON.parse(row.payload_json) })); return page({ actorId, collection: 'training-own-executions', rows, cursor, limit }); });
  }

  function bodyweight({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'bodyweight', optionsFor(actorId));
    return service.mutateAuthority({ actorId, capability: 'ACCESS_PERSONAL_TRAINING', subjectId: actorId, aggregateKind: 'BODYWEIGHT_SET', aggregateKey: [actorId], operationId, expectedVersion, payload, requestId }, tx => {
      const entryId = id(); const receipt = clock(); tx.db.prepare('INSERT INTO bodyweight_entries(id,client_id,weight,unit,reported_date_panama,received_at_utc,operation_id,version) VALUES (?,?,?,?,?,?,?,1)').run(entryId, actorId, payload.weight, payload.unit, payload.reportedDatePanama, receipt, operationId);
      return { entity: { type: 'bodyweight', id: entryId }, result: { bodyweightId: entryId, weight: payload.weight, unit: payload.unit, reportedDatePanama: payload.reportedDatePanama, receivedAtUtc: receipt } };
    });
  }

  function ownBodyweight(actorId) {
    return store.transaction({ actorId }, tx => {
      service.requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'READ_OWN_EXECUTIONS' });
      const state = readStateStrict(actorId); const far = '9999-12-31T23:59:59.999Z'; const epoch = '1970-01-01T00:00:00.000Z';
      const legacy = state && typeof state === 'object' ? projectLegacyBodyweight({ bodyweight: state.bodyweight, profileUnit: state.unit, legacyRevision: state._rev ?? 0, legacyWid: state._wid ?? null, fromUtc: epoch, toExclusiveUtc: far, consentAtUtc: far, serverNowUtc: far }).records : [];
      const sqlite = tx.db.prepare('SELECT id,weight,unit,reported_date_panama,received_at_utc FROM bodyweight_entries WHERE client_id=? ORDER BY received_at_utc DESC').all(actorId).map(row => ({ sourceKind: 'SQLITE_BODY_WEIGHT', sourceRecordId: row.id, weight: row.weight, unit: row.unit, reportedDatePanama: row.reported_date_panama, receivedAtUtc: row.received_at_utc }));
      return { entries: [...legacy, ...sqlite], versionTokens: [{ kind: 'BODYWEIGHT_SET', key: canonicalAggregateKey([actorId]), version: tx.getAggregateVersion('BODYWEIGHT_SET', [actorId]) }] };
    });
  }

  function trainerExecutions(actorId, relationId, cursor, limit) {
    return store.transaction({ actorId }, tx => { const r = relation(tx.db, relationId); if (!r || r.trainer_id !== actorId) fail('not-found'); service.requireCapabilityTx(tx, { actorId, subjectId: r.client_id, capability: 'READ_TRAINER_EXECUTIONS', relationId, grantKind: 'EXECUTION' }); const executionGrant = grant(tx.db, relationId, 'EXECUTION', clock()); const rows = tx.db.prepare("SELECT e.id,e.session_id,e.submitted_at_utc,e.payload_json FROM session_executions e JOIN client_sessions s ON s.id=e.session_id WHERE e.client_id=? AND s.relation_id=? AND e.submitted_at_utc>=? AND s.access_window_id IN (SELECT id FROM relation_access_windows WHERE relation_id=? AND enabled_from_utc<=e.submitted_at_utc AND (ended_at_utc IS NULL OR ended_at_utc>e.submitted_at_utc)) ORDER BY e.submitted_at_utc DESC,e.id DESC").all(r.client_id, relationId, executionGrant.eligible_from_utc, relationId).map(row => ({ executionId: row.id, sessionId: row.session_id, submittedAtUtc: row.submitted_at_utc, actual: JSON.parse(row.payload_json) })); return page({ actorId, collection: `training-trainer-executions:${relationId}`, rows, cursor, limit }); });
  }

  function replaceGrants({ actorId, body, requestId }) {
    const initial = validateMutationEnvelope(body, 'grant');
    return service.mutateAuthority({ actorId, capability: 'CHANGE_GRANT', subjectId: actorId, aggregateKind: 'RELATION', aggregateKey: [initial.payload.relationId], operationId: initial.operationId, expectedVersion: initial.expectedVersion, payload: initial.payload, requestId, authorityContext: { relationId: initial.payload.relationId } }, tx => {
      const r = relation(tx.db, initial.payload.relationId); if (!r || r.client_id !== actorId) fail('not-found');
      const active = tx.db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND state='ACTIVE'").all(r.id);
      const identity = item => `${item.kind}\u0000${item.startUtc ?? item.window_start_utc ?? ''}\u0000${item.endExclusiveUtc ?? item.window_end_exclusive_utc ?? ''}\u0000${item.kind === 'HISTORY' ? (item.includeWeight === true || item.include_weight === 1 ? 1 : 0) : 0}`;
      const desired = new Map(initial.payload.grants.map(item => [identity(item), item]));
      const current = new Map(active.map(item => [identity(item), item]));
      const unchanged = new Set([...desired.keys()].filter(key => current.has(key)));
      const changedHistory = initial.payload.grants.filter(item => item.kind === 'HISTORY' && !unchanged.has(identity(item)));
      const stamp = clock();
      for (const row of active) if (!unchanged.has(identity(row))) {
        tx.db.prepare("UPDATE relation_grants SET state='REVOKED',revoked_at_utc=?,version=version+1 WHERE id=? AND state='ACTIVE'").run(stamp, row.id);
      }
      const insert = tx.db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,window_end_exclusive_utc,include_weight,granted_by,eligible_from_utc,version) VALUES (?,? ,?,'ACTIVE',?,?,?,?,?,1)");
      const created = initial.payload.grants.filter(item => !unchanged.has(identity(item))).map(item => { const grantId = id(); insert.run(grantId, r.id, item.kind, item.startUtc ?? null, item.endExclusiveUtc ?? null, item.includeWeight === true ? 1 : 0, actorId, stamp); return { item, grantId }; });
      const initialState = changedHistory.length ? readStateStrict(actorId) : null;
      const currentState = changedHistory.length ? readStateStrict(actorId) : null;
      if (changedHistory.length && (!initialState || typeof initialState !== 'object' || !currentState || typeof currentState !== 'object' || !equalSnapshotIdentity(initialState, currentState))) fail('conflict');
      for (const { item, grantId } of created.filter(createdGrant => createdGrant.item.kind === 'HISTORY')) {
        const share = composeHistoryShare({ workouts: currentState.workouts, bodyweight: currentState.bodyweight, profileUnit: currentState.unit, legacyRevision: currentState._rev ?? 0, legacyWid: currentState._wid ?? null, sqliteRows: tx.db.prepare('SELECT id,payload_json AS payloadJson,submitted_at_utc AS submittedAtUtc FROM session_executions WHERE client_id=?').all(actorId), sqliteBodyweightRows: tx.db.prepare('SELECT id,weight,unit,reported_date_panama AS reportedDatePanama,received_at_utc AS receivedAtUtc FROM bodyweight_entries WHERE client_id=?').all(actorId), fromUtc: item.startUtc, toExclusiveUtc: item.endExclusiveUtc, consentAtUtc: stamp, serverNowUtc: stamp, includeWeight: item.includeWeight === true, weightAllowed: initial.payload.grants.some(grantItem => grantItem.kind === 'WEIGHT') });
        const shareId = id(); tx.db.prepare('INSERT INTO history_shares(id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,source_personal_rev,source_personal_wid,source_sqlite_version,projection_json,projection_sha256,published_at_utc,operation_id,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)').run(shareId, actorId, r.id, grantId, item.startUtc, item.endExclusiveUtc, String(currentState._rev ?? 0), currentState._wid ?? null, tx.getAggregateVersion('SESSION_SET', [actorId]), JSON.stringify(share), hashPayload(share), stamp, initial.operationId);
      }
      return { entity: { type: 'relation', id: r.id }, result: { relationId: r.id, grants: initial.payload.grants } };
    });
  }

  function trainerHistory(actorId, relationId, grantId, cursor, limit) {
    return store.transaction({ actorId }, tx => { const r = relation(tx.db, relationId); if (!r || r.trainer_id !== actorId) fail('not-found'); service.requireCapabilityTx(tx, { actorId, subjectId: r.client_id, capability: 'READ_TRAINER_HISTORY', relationId, grantKind: 'HISTORY' }); const at = clock(); const active = tx.db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND kind='HISTORY' AND state='ACTIVE' AND eligible_from_utc IS NOT NULL AND eligible_from_utc<=? ORDER BY window_start_utc,id").all(relationId, at); const h = grantId ? active.find(item => item.id === grantId) : active.length === 1 ? active[0] : null; if (!h) fail(grantId ? 'not-found' : 'validation-error'); const weight = !!grant(tx.db, relationId, 'WEIGHT', at); const rows = tx.db.prepare('SELECT * FROM history_shares WHERE relation_id=? AND grant_id=? ORDER BY published_at_utc DESC,id DESC').all(relationId, h.id).flatMap(row => filterHistoryShareForCurrentGrants(JSON.parse(row.projection_json), { historyAllowed: true, weightAllowed: weight && h.include_weight === 1 }).records); return page({ actorId, collection: `training-trainer-history:${relationId}:${h.id}`, rows, cursor, limit }); });
  }
  function trainerBodyweight(actorId, relationId, cursor, limit) {
    return store.transaction({ actorId }, tx => { const r = relation(tx.db, relationId); if (!r || r.trainer_id !== actorId) fail('not-found'); service.requireCapabilityTx(tx, { actorId, subjectId: r.client_id, capability: 'READ_TRAINER_BODYWEIGHT', relationId, grantKind: 'WEIGHT' }); const weightGrant = grant(tx.db, relationId, 'WEIGHT', clock()); const rows = tx.db.prepare("SELECT b.id,b.weight,b.unit,b.reported_date_panama,b.received_at_utc FROM bodyweight_entries b WHERE b.client_id=? AND b.received_at_utc>=? AND EXISTS(SELECT 1 FROM relation_access_windows w WHERE w.relation_id=? AND w.enabled_from_utc<=b.received_at_utc AND (w.ended_at_utc IS NULL OR w.ended_at_utc>b.received_at_utc)) ORDER BY b.received_at_utc DESC,b.id DESC").all(r.client_id, weightGrant.eligible_from_utc, relationId).map(row => ({ sourceKind: 'SQLITE_BODY_WEIGHT', sourceRecordId: row.id, weight: row.weight, unit: row.unit, reportedDatePanama: row.reported_date_panama, receivedAtUtc: row.received_at_utc })); return page({ actorId, collection: `training-trainer-bodyweight:${relationId}`, rows, cursor, limit }); });
  }
  return { publishPlan, publishGoals, startSession, finishSession, abandonSession, current, trainerCurrentPlan, trainerCurrentGoals, currentSession, ownExecutions, bodyweight, ownBodyweight, trainerExecutions, replaceGrants, trainerHistory, trainerBodyweight };
}

