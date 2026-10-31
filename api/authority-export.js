import crypto from 'node:crypto';
import { uuid, version } from './authority-contract.js';
import { projectSqliteBodyweight, projectSqliteExecutions } from './authority-projections.js';

const iso = () => new Date().toISOString();
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const poison = new Set(['__proto__', 'prototype', 'constructor']);
// These are credentials or server-side implementation details, not profile data.  Matching is
// deliberately exact: an owned routine field called `target` is still legitimate user data.
const privateKeys = new Set([
  'password', 'passwordHash', 'credential', 'credentials', 'token', 'tokens', 'accessToken',
  'refreshToken', 'sessionToken', 'authorization', 'auth', 'secret', 'secrets', 'apiKey',
  'privateKey', 'privateToken', 'authToken', 'snapshot_json', 'snapshotJson', 'planSnapshot', 'planVersionPayload'
]);
const mediaKeys = new Set(['kind', 'hash', 'mime', 'size', 'width', 'height', 'duration', 'at', 'caption']);

// This is the current persisted profile surface: frontend/src/store/useStore.js's DEF, its
// documented sync bookkeeping, plus the established local Coach document.  It is intentionally
// a whitelist rather than a copy of every property read from a legacy JSON file.
const legacyRoots = new Set([
  '_rev', '_ts', '_wid', '_wids', 'deleted', 'edited', 'undone', 'unit', 'unitSet', 'resetAt', 'resetIds',
  'restSec', 'restPauseSec', 'sound', 'soundOnSilent', 'vibrateOnSilent', 'timerFlash', 'timedSetOvertime', 'keepAwake', 'lang',
  'theme', 'accent', 'accentCustom', 'body', 'targetW', 'rateGoal', 'bodyweight', 'routines', 'week', 'dayPlan', 'dayNotes',
  'measurements', 'measurementEnabled', 'customMeasurements', 'queue', 'rotation', 'scheduleMode', 'exWeights', 'workouts', 'customEx',
  'gifSize', 'heatmapMetric', 'volumeWarmups', 'workoutView', 'collapseCompleted', 'exerciseView', 'wc', 'hints', 'reminder', 'effort',
  'autoBackup', 'equipProfiles', 'activeEquipId', 'equipFilterOn', 'exNotes', 'exAliases', 'favEx', 'weekStart', 'wdec', 'speedUnit',
  'barWeights', 'plates', 'loadKind', 'dbLoad', 'dumbbells', 'stackWeights', 'gymCards', 'lastGymCardId', 'checkIn', 'showWeightCard',
  'weighIn', 'connStatus', 'shareMap', 'connLocal', 'startFrom', 'lastFrom', 'enParens', 'enOnly', 'logRef', 'balanceTemplate',
  'balanceOverrides', 'coach'
]);

function closed(value, name) {
  if (!plain(value)) throw new TypeError(`${name} must be a plain object`);
  if (Object.keys(value).length !== 0) throw new TypeError(`unknown ${name} field`);
  return {};
}

function parseEnvelope(command, name) {
  if (!plain(command)) throw new TypeError(`${name} command must be a plain object`);
  const allowed = new Set(['actorId', 'body', 'requestId']);
  for (const key of Object.keys(command)) if (!allowed.has(key)) throw new TypeError(`unknown ${name} command field: ${key}`);
  if (typeof command.actorId !== 'string' || command.actorId.length < 1 || command.actorId.length > 128) throw new TypeError('actorId must be an existing account ID');
  if (!plain(command.body)) throw new TypeError(`${name} body must be a plain object`);
  const body = command.body;
  for (const key of Object.keys(body)) if (!['operationId', 'expectedVersion', 'payload'].includes(key)) throw new TypeError(`unknown ${name} body field: ${key}`);
  if (!Object.hasOwn(body, 'operationId') || !Object.hasOwn(body, 'expectedVersion') || !Object.hasOwn(body, 'payload')) throw new TypeError(`${name} mutation envelope is incomplete`);
  return { actorId: command.actorId, operationId: uuid(body.operationId, 'operationId'), expectedVersion: version(body.expectedVersion), payload: closed(body.payload, name), requestId: command.requestId };
}

function cloneLegacy(value, depth = 0, media = false) {
  if (depth > 100) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(item => cloneLegacy(item, depth + 1, media)).filter(item => item !== undefined);
    return items;
  }
  if (!plain(value)) return undefined;
  const out = {};
  const keys = media ? mediaKeys : null;
  for (const [key, item] of Object.entries(value)) {
    if (poison.has(key) || privateKeys.has(key) || (keys && !keys.has(key))) continue;
    const copied = cloneLegacy(item, depth + 1, key === 'media');
    if (copied !== undefined) out[key] = copied;
  }
  return out;
}

function legacyDocument(value) {
  if (!plain(value)) return {};
  const out = {};
  for (const key of Object.keys(value)) {
    if (!legacyRoots.has(key)) continue;
    const copied = cloneLegacy(value[key], 0, key === 'media');
    if (copied !== undefined) out[key] = copied;
  }
  return out;
}

function downloadInput(input) {
  if (!plain(input)) throw new TypeError('download command must be a plain object');
  for (const key of Object.keys(input)) if (!['actorId', 'jobId'].includes(key)) throw new TypeError(`unknown download command field: ${key}`);
  if (typeof input.actorId !== 'string' || input.actorId.length < 1 || input.actorId.length > 128) throw new TypeError('actorId must be an existing account ID');
  return { actorId: input.actorId, jobId: uuid(input.jobId, 'jobId') };
}

function futureOf(stamp) {
  const time = Date.parse(stamp);
  if (!Number.isFinite(time)) throw new TypeError('clock must return ISO UTC');
  return new Date(time + 1).toISOString();
}

export function createAuthorityExport({ store, authority, identity, readLegacyData, clock = iso } = {}) {
  if (!store || !authority || !identity || typeof readLegacyData !== 'function') throw new TypeError('export authority dependencies are required');
  if (typeof authority.mutateAuthority !== 'function' || typeof authority.requireCapabilityTx !== 'function') throw new TypeError('authority service is required');

  function requestExport(command) {
    const { actorId, operationId, expectedVersion, payload, requestId } = parseEnvelope(command, 'ExportInput');
    return authority.mutateAuthority({ actorId, capability: 'EXPORT_OWN_DATA', subjectId: actorId, aggregateKind: 'EXPORT_SET', aggregateKey: [actorId], operationId, expectedVersion, payload, requestId }, tx => {
      const jobId = crypto.randomUUID(); const createdAtUtc = clock();
      tx.db.prepare("INSERT INTO export_jobs(id,account_id,state,path,created_at_utc,expires_at_utc,version) VALUES (?,?,'READY',NULL,?,NULL,1)").run(jobId, actorId, createdAtUtc);
      const result = { jobId, state: 'READY' };
      return { entity: { type: 'export-job', id: jobId }, result, after: result };
    });
  }

  function requestDeletion(command) {
    const { actorId, operationId, expectedVersion, payload, requestId } = parseEnvelope(command, 'DeleteInput');
    return authority.mutateAuthority({ actorId, capability: 'REQUEST_OWN_DELETION', subjectId: actorId, aggregateKind: 'DELETION_REQUEST_SET', aggregateKey: [actorId], operationId, expectedVersion, payload, requestId }, tx => {
      const open = tx.db.prepare("SELECT id FROM deletion_requests WHERE account_id=? AND state='REQUESTED'").get(actorId);
      if (open) fail('conflict');
      const requestIdValue = crypto.randomUUID(); const requestedAtUtc = clock();
      tx.db.prepare("INSERT INTO deletion_requests(id,account_id,requested_at_utc,state,version) VALUES (?,?,?,'REQUESTED',1)").run(requestIdValue, actorId, requestedAtUtc);
      const result = { deletionRequestId: requestIdValue, state: 'REQUESTED' };
      return { entity: { type: 'deletion-request', id: requestIdValue }, result, after: result };
    });
  }

  function authorizedSnapshot(actorId, jobId) {
    if (!identity.get(actorId)?.active) fail('forbidden');
    return store.transaction({ actorId }, tx => {
      authority.requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'EXPORT_OWN_DATA' });
      // One owner-qualified lookup deliberately gives unknown and foreign IDs the same result.
      const job = tx.db.prepare("SELECT id FROM export_jobs WHERE id=? AND account_id=? AND state='READY'").get(jobId, actorId);
      if (!job) fail('not-found');
      const executions = tx.db.prepare('SELECT id,payload_json AS payloadJson,submitted_at_utc AS submittedAtUtc FROM session_executions WHERE client_id=? ORDER BY submitted_at_utc,id').all(actorId);
      const bodyweight = tx.db.prepare('SELECT id,weight,unit,reported_date_panama AS reportedDatePanama,received_at_utc AS receivedAtUtc FROM bodyweight_entries WHERE client_id=? ORDER BY received_at_utc,id').all(actorId);
      const subscriptions = tx.db.prepare('SELECT id,start_utc AS startUtc,end_exclusive_utc AS endExclusiveUtc,anchor_day AS anchorDay,kind,reference,reason,created_at_utc AS createdAtUtc FROM subscription_intervals WHERE client_id=? ORDER BY start_utc,id').all(actorId);
      const indefiniteEntitlements = tx.db.prepare('SELECT id,granted_at_utc AS grantedAtUtc,revoked_at_utc AS revokedAtUtc,reason,revoke_reason AS revokeReason FROM indefinite_client_entitlements WHERE client_id=? ORDER BY granted_at_utc,id').all(actorId).map(row => ({ ...row }));
      const relations = tx.db.prepare('SELECT id,state,accepted_at_utc AS acceptedAtUtc,confirmed_at_utc AS confirmedAtUtc,ended_at_utc AS endedAtUtc FROM relations WHERE client_id=? ORDER BY accepted_at_utc,id').all(actorId);
      const grants = tx.db.prepare('SELECT relation_id AS relationId,kind,state,window_start_utc AS startUtc,window_end_exclusive_utc AS endExclusiveUtc,revoked_at_utc AS revokedAtUtc FROM relation_grants WHERE relation_id IN (SELECT id FROM relations WHERE client_id=?) ORDER BY relation_id,kind,version,id').all(actorId);
      return { executions, bodyweight, subscriptions, indefiniteEntitlements, relations, grants };
    });
  }

  async function downloadExport(input) {
    const { actorId, jobId } = downloadInput(input);
    // This preflight is intentionally before the legacy callback; unauthorized callers cannot
    // cause a profile read. The second check below covers identity changes while an async callback runs.
    authorizedSnapshot(actorId, jobId);
    const legacy = await readLegacyData(actorId);
    const snapshot = authorizedSnapshot(actorId, jobId);
    const generatedAtUtc = clock(); const throughUtc = futureOf(generatedAtUtc);
    const projectionInput = { fromUtc: '1970-01-01T00:00:00.000Z', toExclusiveUtc: throughUtc, consentAtUtc: throughUtc, serverNowUtc: throughUtc };
    const actuals = projectSqliteExecutions({ ...projectionInput, rows: snapshot.executions }).records;
    const bodyweight = projectSqliteBodyweight({ ...projectionInput, rows: snapshot.bodyweight }).records;
    const grantsByRelation = new Map(snapshot.relations.map(row => [row.id, []]));
    for (const row of snapshot.grants) grantsByRelation.get(row.relationId)?.push({ kind: row.kind, state: row.state, startUtc: row.startUtc, endExclusiveUtc: row.endExclusiveUtc, revokedAtUtc: row.revokedAtUtc });
    return {
      schema: 'opengym.owned-export.v1', generatedAtUtc,
      legacyState: legacyDocument(legacy),
      sqlite: { sessionExecutionActuals: actuals, bodyweightEntries: bodyweight },
      commercial: { subscriptionIntervals: snapshot.subscriptions, indefiniteClientEntitlements: snapshot.indefiniteEntitlements },
      consent: { relations: snapshot.relations.map(row => ({ id: row.id, state: row.state, acceptedAtUtc: row.acceptedAtUtc, confirmedAtUtc: row.confirmedAtUtc, endedAtUtc: row.endedAtUtc, grants: grantsByRelation.get(row.id) || [] })) }
    };
  }

  return { requestExport, downloadExport, requestDeletion };
}
