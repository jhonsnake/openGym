import crypto from 'node:crypto';

export const OPERATIONAL_ROLES = Object.freeze(['CLIENT', 'TRAINER', 'COORDINATOR']);
export const ACCOUNT_ACTIVITIES = Object.freeze(['ACTIVE', 'DISABLED', 'DELETED', 'UNKNOWN']);
export const CAPABILITIES = Object.freeze([
  'ACCESS_PERSONAL_TRAINING', 'MANAGE_OPERATIONAL_ROLES', 'MANAGE_COORDINATOR_SCOPE',
  'CREATE_INVITATION', 'PREVIEW_INVITATION', 'ACCEPT_INVITATION', 'CONFIRM_RELATION',
  'CHANGE_RELATION', 'CHANGE_GRANT', 'PUBLISH_PLAN', 'READ_CLIENT_PLAN', 'READ_OWN_EXECUTIONS',
  'START_SESSION', 'FINISH_SESSION', 'READ_TRAINER_EXECUTIONS', 'CONFIRM_SUBSCRIPTION',
  'READ_COMMERCIAL_CLIENTS', 'EXPORT_OWN_DATA', 'REQUEST_OWN_DELETION'
]);
export const AGGREGATE_KINDS = Object.freeze(['ROLES', 'SCOPE', 'INVITE_SET', 'INVITATION', 'RELATION', 'SUBSCRIPTION', 'PLAN_SET', 'GOAL_SET', 'SESSION_SET', 'SESSION', 'BODYWEIGHT_SET', 'EXPORT_SET', 'DELETION_REQUEST_SET']);

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const panamaDate = /^\d{4}-\d{2}-\d{2}$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const requireKeys = (value, required, optional = []) => {
  if (!plain(value)) throw new TypeError('object required');
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown field: ${key}`);
  for (const key of required) if (!(key in value)) throw new TypeError(`missing field: ${key}`);
};
const string = (value, name, min = 1, max = 65535) => {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const out = value.trim();
  if (out.length < min || out.length > max) throw new RangeError(`${name} must be ${min}-${max} characters`);
  return out;
};
const finite = (value, name, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be ${min}-${max}`);
  return value;
};
const integer = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer ${min}-${max}`);
  return value;
};
const halfStep = value => Number.isFinite(value) && Math.round(value * 2) === value * 2;

export function existingAccountId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new RangeError('existing account ID must be 1-128 literal characters');
  return value;
}
export function uuid(value, name = 'UUID') {
  if (typeof value !== 'string' || !uuidV4.test(value)) throw new TypeError(`${name} must be UUID v4`);
  return value;
}
export function version(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('version must be a non-negative safe integer');
  return value;
}
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON requires finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!plain(value)) throw new TypeError('canonical JSON requires plain objects');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
export function canonicalAggregateKey(parts) {
  if (!Array.isArray(parts) || parts.some(value => typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && value !== null)) throw new TypeError('aggregate key parts must be primitive');
  return canonicalJson(parts);
}
export const hashPayload = payload => crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');

const utc = (value, name) => {
  if (typeof value !== 'string' || !isoUtc.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError(`${name} must be ISO UTC`);
  return value;
};
const validPanamaDate = (value, name, { notFuture = false, clock = () => new Date() } = {}) => {
  if (typeof value !== 'string' || !panamaDate.test(value)) throw new TypeError(`${name} must be a Panama calendar date`);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new RangeError(`${name} is not a real calendar date`);
  if (notFuture) {
    const today = new Date(clock().getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (value > today) throw new RangeError(`${name} cannot be in the future`);
  }
  return value;
};
const reason = value => string(value, 'reason', 1, 280);
const load = value => {
  requireKeys(value, ['kind'], ['kg']);
  if (value.kind === 'BODY_WEIGHT') {
    if ('kg' in value) throw new TypeError('BODY_WEIGHT load omits kg');
    return { kind: value.kind };
  }
  if (!['EXTERNAL', 'ASSISTANCE'].includes(value.kind)) throw new TypeError('invalid load kind');
  return { kind: value.kind, kg: finite(value.kg, 'load.kg', 0, 2000) };
};
const effort = value => {
  requireKeys(value, ['kind', 'value']);
  if (!['RIR', 'RPE'].includes(value.kind) || !halfStep(value.value)) throw new TypeError('invalid effort');
  finite(value.value, 'effort.value', value.kind === 'RIR' ? 0 : 6, 10);
  return { kind: value.kind, value: value.value };
};
const repsTarget = value => {
  if (!plain(value)) throw new TypeError('reps target must be an object');
  const exact = Object.hasOwn(value, 'exact');
  const range = Object.hasOwn(value, 'min') || Object.hasOwn(value, 'max');
  if (exact === range) throw new TypeError('reps target must use exactly one form');
  if (exact) {
    requireKeys(value, ['exact']);
    return { exact: integer(value.exact, 'reps.exact', 1, 1000) };
  }
  requireKeys(value, ['min', 'max']);
  const min = integer(value.min, 'reps.min', 1, 1000);
  const max = integer(value.max, 'reps.max', 1, 1000);
  if (min > max) throw new RangeError('reps.min cannot exceed reps.max');
  return { min, max };
};
const planTarget = (value, mode) => {
  if (mode === 'reps') {
    requireKeys(value, ['reps'], ['load', 'effort']);
    return { ...(value.load === undefined ? {} : { load: load(value.load) }), reps: repsTarget(value.reps), ...(value.effort === undefined ? {} : { effort: effort(value.effort) }) };
  }
  requireKeys(value, ['seconds']);
  return { seconds: integer(value.seconds, 'seconds', 1, 21600) };
};

export function createExerciseIdResolver({ catalogueIds, resolveOwnedCustomExerciseId } = {}) {
  if (!catalogueIds || typeof catalogueIds.has !== 'function') throw new TypeError('catalogueIds allowlist is required');
  return (exerciseId, { subjectId } = {}) => {
    if (catalogueIds.has(exerciseId)) return { kind: 'catalogue' };
    if (typeof resolveOwnedCustomExerciseId === 'function' && resolveOwnedCustomExerciseId(exerciseId, subjectId) === true) return { kind: 'custom', ownerId: subjectId };
    return null;
  };
}
const exerciseId = (value, options) => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new TypeError('exerciseId must be a literal ID');
  if (typeof options.exerciseResolver !== 'function') throw new TypeError('authorized exercise resolver is required');
  const resolved = options.exerciseResolver(value, { subjectId: options.subjectId });
  if (resolved?.kind === 'catalogue' || (resolved?.kind === 'custom' && resolved.ownerId === options.subjectId)) return value;
  throw new TypeError('unrecognized or unauthorized exerciseId');
};
const grants = value => {
  if (!Array.isArray(value)) throw new TypeError('grants must be an array');
  return value.map(grant => {
    if (!plain(grant)) throw new TypeError('grant must be an object');
    const history = grant.kind === 'HISTORY';
    requireKeys(grant, history ? ['kind', 'startUtc', 'endExclusiveUtc'] : ['kind'], history ? ['includeWeight'] : ['startUtc', 'endExclusiveUtc']);
    if (!['PLAN', 'EXECUTION', 'HISTORY', 'WEIGHT'].includes(grant.kind)) throw new TypeError('invalid grant kind');
    const out = { kind: grant.kind };
    if (history || grant.startUtc !== undefined || grant.endExclusiveUtc !== undefined) {
      out.startUtc = utc(grant.startUtc, 'startUtc');
      out.endExclusiveUtc = utc(grant.endExclusiveUtc, 'endExclusiveUtc');
      if (out.startUtc >= out.endExclusiveUtc) throw new RangeError('grant range must be non-empty');
    }
    if (history && grant.includeWeight !== undefined) {
      if (typeof grant.includeWeight !== 'boolean') throw new TypeError('includeWeight must be boolean');
      out.includeWeight = grant.includeWeight;
    }
    return out;
  });
};

export function parseAuthorityPayload(kind, payload, options = {}) {
  if (kind === 'roles') {
    requireKeys(payload, ['accountId', 'roles', 'reason']);
    if (!Array.isArray(payload.roles) || new Set(payload.roles).size !== payload.roles.length || payload.roles.some(role => !OPERATIONAL_ROLES.includes(role))) throw new TypeError('invalid operational roles');
    return { accountId: existingAccountId(payload.accountId), roles: [...payload.roles].sort(), reason: reason(payload.reason) };
  }
  if (kind === 'scope') {
    requireKeys(payload, ['coordinatorId', 'clientId', 'assigned', 'reason']);
    if (typeof payload.assigned !== 'boolean') throw new TypeError('assigned must be boolean');
    return { coordinatorId: existingAccountId(payload.coordinatorId), clientId: existingAccountId(payload.clientId), assigned: payload.assigned, reason: reason(payload.reason) };
  }
  if (kind === 'grant') {
    requireKeys(payload, ['relationId', 'grants']);
    return { relationId: uuid(payload.relationId, 'relationId'), grants: grants(payload.grants) };
  }
  if (kind === 'commercial') {
    requireKeys(payload, ['clientId', 'kind', 'reference', 'reason'], ['customStartPanama', 'customEndPanamaInclusive']);
    if (!['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM'].includes(payload.kind)) throw new TypeError('invalid period kind');
    const hasCustomStart = Object.hasOwn(payload, 'customStartPanama');
    const hasCustomEnd = Object.hasOwn(payload, 'customEndPanamaInclusive');
    if (payload.kind === 'CUSTOM' && (!hasCustomStart || !hasCustomEnd)) throw new TypeError('custom period requires both dates');
    if (payload.kind !== 'CUSTOM' && (hasCustomStart || hasCustomEnd)) throw new TypeError('only custom periods accept dates');
    return { clientId: existingAccountId(payload.clientId), kind: payload.kind, reference: string(payload.reference, 'reference', 1, 160), reason: reason(payload.reason), ...(hasCustomStart ? { customStartPanama: validPanamaDate(payload.customStartPanama, 'customStartPanama') } : {}), ...(hasCustomEnd ? { customEndPanamaInclusive: validPanamaDate(payload.customEndPanamaInclusive, 'customEndPanamaInclusive') } : {}) };
  }
  if (kind === 'invitation') {
    requireKeys(payload, ['commercialName', 'grants'], ['knownClientId']);
    return { ...(payload.knownClientId === undefined ? {} : { knownClientId: existingAccountId(payload.knownClientId) }), commercialName: string(payload.commercialName, 'commercialName', 1, 120), grants: grants(payload.grants) };
  }
  if (kind === 'relation') { requireKeys(payload, ['relationId', 'reason']); return { relationId: uuid(payload.relationId, 'relationId'), reason: reason(payload.reason) }; }
  if (kind === 'bodyweight') {
    requireKeys(payload, ['weight', 'unit', 'reportedDatePanama']);
    if (!['KG', 'LB'].includes(payload.unit)) throw new TypeError('invalid bodyweight unit');
    return { weight: finite(payload.weight, 'weight', 1, 500), unit: payload.unit, reportedDatePanama: validPanamaDate(payload.reportedDatePanama, 'reportedDatePanama', { notFuture: true, clock: options.clock }) };
  }
  if (kind === 'goal') return goal(payload, options);
  if (kind === 'plan') {
    requireKeys(payload, ['relationId', 'exercises'], ['goalVersionId']);
    if (!Array.isArray(payload.exercises) || payload.exercises.length > 40) throw new TypeError('invalid plan exercises');
    return { relationId: uuid(payload.relationId, 'relationId'), ...(payload.goalVersionId === undefined ? {} : { goalVersionId: uuid(payload.goalVersionId, 'goalVersionId') }), exercises: payload.exercises.map(value => planExercise(value, options)) };
  }
  if (kind === 'sessionStart') { requireKeys(payload, ['planVersionId']); return { planVersionId: uuid(payload.planVersionId, 'planVersionId') }; }
  if (kind === 'execution') {
    requireKeys(payload, ['sessionId', 'entries']);
    if (!Array.isArray(payload.entries) || payload.entries.length > 40) throw new TypeError('invalid execution entries');
    return { sessionId: uuid(payload.sessionId, 'sessionId'), entries: payload.entries.map(value => executionEntry(value, options)) };
  }
  throw new TypeError(`unknown authority payload kind: ${kind}`);
}

function goal(payload, options) {
  if (!plain(payload) || !['CONSISTENCY', 'BODY_WEIGHT', 'PERFORMANCE'].includes(payload.kind)) throw new TypeError('invalid goal kind');
  const specific = payload.kind === 'CONSISTENCY' ? ['targetSessionsPerWeek'] : payload.kind === 'BODY_WEIGHT' ? ['targetWeight', 'unit'] : ['exerciseId', 'targetLoad', 'targetReps'];
  requireKeys(payload, ['label', 'kind', ...specific], ['dueDatePanama']);
  const out = { label: string(payload.label, 'label', 1, 120), kind: payload.kind, ...(payload.dueDatePanama === undefined ? {} : { dueDatePanama: validPanamaDate(payload.dueDatePanama, 'dueDatePanama') }) };
  if (payload.kind === 'CONSISTENCY') return { ...out, targetSessionsPerWeek: integer(payload.targetSessionsPerWeek, 'targetSessionsPerWeek', 1, 365) };
  if (payload.kind === 'BODY_WEIGHT') {
    if (!['KG', 'LB'].includes(payload.unit)) throw new TypeError('invalid body weight unit');
    return { ...out, targetWeight: finite(payload.targetWeight, 'targetWeight', 1, 500), unit: payload.unit };
  }
  return { ...out, exerciseId: exerciseId(payload.exerciseId, options), targetLoad: load(payload.targetLoad), targetReps: integer(payload.targetReps, 'targetReps', 1, 1000) };
}
function planExercise(value, options) {
  requireKeys(value, ['exerciseId', 'mode', 'sets', 'commonTarget', 'setOverrides'], ['entryId', 'restSeconds']);
  if (!['reps', 'time'].includes(value.mode)) throw new TypeError('invalid plan mode');
  const sets = integer(value.sets, 'sets', 1, 50);
  if (!plain(value.setOverrides)) throw new TypeError('setOverrides must be an object');
  const out = { ...(value.entryId === undefined ? {} : { entryId: uuid(value.entryId, 'entryId') }), exerciseId: exerciseId(value.exerciseId, options), mode: value.mode, sets, ...(value.restSeconds === undefined ? {} : { restSeconds: integer(value.restSeconds, 'restSeconds', 0, 21600) }), commonTarget: planTarget(value.commonTarget, value.mode), setOverrides: {} };
  for (const [key, target] of Object.entries(value.setOverrides)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= sets || Number(key) > 49) throw new TypeError('invalid set override index');
    out.setOverrides[key] = planTarget(target, value.mode);
  }
  return out;
}
function executionEntry(value, options) {
  requireKeys(value, ['exerciseId', 'disposition', 'sets'], ['planEntryId']);
  if (!['PERFORMED', 'OMITTED', 'SUBSTITUTED', 'ADDED'].includes(value.disposition) || !Array.isArray(value.sets) || value.sets.length > 50) throw new TypeError('invalid execution entry');
  if (value.disposition === 'OMITTED' && value.sets.length !== 0) throw new TypeError('omitted execution has no sets');
  const hasPlanEntry = value.planEntryId !== undefined;
  if ((value.disposition === 'ADDED' && hasPlanEntry) || (value.disposition !== 'ADDED' && !hasPlanEntry)) throw new TypeError('invalid plan entry binding');
  const sets = value.sets.map(executionSet);
  if (new Set(sets.map(set => set.seconds === undefined ? 'reps' : 'time')).size > 1) throw new TypeError('mixed execution modes are not allowed');
  return { ...(hasPlanEntry ? { planEntryId: uuid(value.planEntryId, 'planEntryId') } : {}), exerciseId: exerciseId(value.exerciseId, options), disposition: value.disposition, sets };
}
function executionSet(value) {
  requireKeys(value, ['phase', 'completed'], ['load', 'reps', 'seconds', 'effort', 'failure']);
  if (!['warmup', 'work'].includes(value.phase) || typeof value.completed !== 'boolean') throw new TypeError('invalid execution set');
  const reps = Object.hasOwn(value, 'reps'); const seconds = Object.hasOwn(value, 'seconds');
  if (reps === seconds) throw new TypeError('execution set needs exactly one mode');
  if (value.phase === 'warmup' && (Object.hasOwn(value, 'effort') || Object.hasOwn(value, 'failure'))) throw new TypeError('warmups cannot have effort or failure');
  if (Object.hasOwn(value, 'failure') && typeof value.failure !== 'boolean') throw new TypeError('failure must be boolean');
  return { phase: value.phase, ...(value.load === undefined ? {} : { load: load(value.load) }), ...(reps ? { reps: integer(value.reps, 'reps', 1, 1000) } : { seconds: integer(value.seconds, 'seconds', 1, 21600) }), ...(value.effort === undefined ? {} : { effort: effort(value.effort) }), completed: value.completed, ...(value.failure === undefined ? {} : { failure: value.failure }) };
}
export function validateMutationEnvelope(body, kind, options = {}) {
  requireKeys(body, ['operationId', 'expectedVersion', 'payload']);
  return { operationId: uuid(body.operationId, 'operationId'), expectedVersion: version(body.expectedVersion), payload: parseAuthorityPayload(kind, body.payload, options) };
}
