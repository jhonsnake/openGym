// Pure, allowlisted projections used while publishing and reading historical shares.
// This module does not read files, SQLite, clocks, or authority state. Callers must select
// the owner data, take/recheck the legacy rev/wid, and enforce grants in their transaction.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const POISON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const hasOwn = (value, key) => Object.hasOwn(value, key);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeJsonValue(value, depth = 0) {
  if (depth > 100) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => safeJsonValue(item, depth + 1));
  if (!plainObject(value)) return false;
  return Object.keys(value).every(key => !POISON_KEYS.has(key) && safeJsonValue(value[key], depth + 1));
}

function cloneJson(value) {
  if (!safeJsonValue(value)) throw new TypeError('projection input must be safe JSON');
  return JSON.parse(JSON.stringify(value));
}

function parseUtc(value, name) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) throw new TypeError(`${name} must be ISO UTC`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${name} must be ISO UTC`);
  const iso = new Date(milliseconds).toISOString();
  const expected = value.includes('.') ? iso : iso.replace('.000Z', 'Z');
  if (value !== expected) throw new TypeError(`${name} must be a real ISO UTC timestamp`);
  return { milliseconds, iso };
}

function validateRange({ fromUtc, toExclusiveUtc, consentAtUtc, serverNowUtc }) {
  const from = parseUtc(fromUtc, 'fromUtc');
  const to = parseUtc(toExclusiveUtc, 'toExclusiveUtc');
  const consentAt = parseUtc(consentAtUtc, 'consentAtUtc');
  const serverNow = parseUtc(serverNowUtc, 'serverNowUtc');
  if (from.milliseconds >= to.milliseconds) throw new RangeError('range start must be before range end');
  if (to.milliseconds > serverNow.milliseconds) throw new RangeError('range must not be in the future');
  if (consentAt.milliseconds > serverNow.milliseconds) throw new RangeError('consentAtUtc must not be in the future');
  if (to.milliseconds > consentAt.milliseconds) throw new RangeError('range must end at or before consentAtUtc');
  return { from, to, consentAt, serverNow };
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const date = new Date(utcMidnight);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  // Panama has no DST and its business day is UTC-05:00 year-round.
  const start = utcMidnight + 5 * 60 * 60 * 1000;
  return { value, start, end: start + 24 * 60 * 60 * 1000 };
}

// `d` has day precision only. Include it only when its whole Panama business day is inside the
// requested range; a partial-day request would otherwise silently publish data outside consent.
function legacyDayInRange(date, range) {
  return date.start >= range.from.milliseconds && date.end <= range.to.milliseconds;
}

function profileUnit(value) {
  return value === 'kg' || value === 'KG' ? 'KG' : value === 'lb' || value === 'LB' ? 'LB' : 'UNKNOWN';
}

function legacySourceId(kind, source, index, legacyRevision, legacyWid) {
  if (typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 512) return source.id;
  // `_rev: 0` and an absent `_wid` are valid legacy snapshot identities.  The tuple is
  // scoped to the immutable share source; it is never fabricated as a document id.
  if (!((typeof legacyRevision === 'string' && legacyRevision.length > 0) || (Number.isSafeInteger(legacyRevision) && legacyRevision >= 0))) return null;
  if (legacyWid !== null && legacyWid !== undefined && (typeof legacyWid !== 'string' || !legacyWid)) return null;
  return JSON.stringify([kind, legacyRevision, legacyWid ?? null, index]);
}

function warning(list, code, sourceKind, index) {
  list.push({ code, sourceKind, index });
}

function legacyPhase(source) {
  if (source.phase === 'warmup' || source.phase === 'warm-up' || source.phase === 'warm_up' || source.warmup === true) return 'warmup';
  return 'work';
}

function validFiniteFields(source, fields) {
  return fields.every(field => !hasOwn(source, field) || Number.isFinite(source[field]));
}

function legacyLoad(source, unit) {
  const kind = source.loadKind;
  if (kind === 'BODY_WEIGHT' || source.bodyweight === true) return { kind: 'BODY_WEIGHT' };
  if (hasOwn(source, 'w')) {
    if (kind === 'EXTERNAL' || kind === 'ASSISTANCE') return { kind, value: source.w, unit };
    return { kind: 'REPORTED_UNKNOWN', value: source.w, unit };
  }
  return undefined;
}

function legacySet(source, unit, side) {
  if (!plainObject(source) || !safeJsonValue(source) || !validFiniteFields(source, ['w', 'r', 'sec', 'min', 'rir', 'rpe'])) return null;
  const phase = legacyPhase(source);
  const out = {};
  if (side) out.side = side;
  out.phase = phase;
  const load = legacyLoad(source, unit);
  if (load) out.load = load;
  if (hasOwn(source, 'r')) out.reps = source.r;
  if (hasOwn(source, 'sec')) out.seconds = source.sec;
  if (hasOwn(source, 'min')) out.minutes = source.min;
  // A legacy record may omit either field; absence remains absence, never an inferred rating.
  if (phase === 'work' && hasOwn(source, 'rir') !== hasOwn(source, 'rpe')) {
    if (hasOwn(source, 'rir')) out.effort = { kind: 'RIR', value: source.rir };
    if (hasOwn(source, 'rpe')) out.effort = { kind: 'RPE', value: source.rpe };
  }
  if (phase === 'work' && typeof source.failure === 'boolean') out.failure = source.failure;
  return out;
}

function projectLegacyExercise(entry, unit, warnings, workoutIndex) {
  if (!plainObject(entry) || !safeJsonValue(entry) || typeof entry.id !== 'string' || !entry.id || !Array.isArray(entry.sets)) {
    warning(warnings, 'malformed-legacy-entry', 'LEGACY_WORKOUT', workoutIndex);
    return null;
  }
  const sets = [];
  for (const source of entry.sets) {
    if (!plainObject(source) || !safeJsonValue(source)) {
      warning(warnings, 'malformed-legacy-set', 'LEGACY_WORKOUT', workoutIndex);
      continue;
    }
    const sides = source.sides;
    if (plainObject(sides) && plainObject(sides.L) && plainObject(sides.R)) {
      for (const side of ['L', 'R']) {
        if (sides[side].done !== true) continue;
        const sideSource = { ...sides[side] };
        if (hasOwn(source, 'phase')) sideSource.phase = source.phase;
        if (hasOwn(source, 'warmup')) sideSource.warmup = source.warmup;
        const actual = legacySet(sideSource, unit, side);
        if (actual) sets.push(actual);
        else warning(warnings, 'malformed-legacy-set', 'LEGACY_WORKOUT', workoutIndex);
      }
      continue;
    }
    if (source.done !== true) continue;
    const actual = legacySet(source, unit);
    if (actual) sets.push(actual);
    else warning(warnings, 'malformed-legacy-set', 'LEGACY_WORKOUT', workoutIndex);
  }
  return sets.length ? { exerciseId: entry.id, sets } : null;
}

/**
 * Project selected `readState(ownerId).workouts` rows.
 * Arguments: `{workouts, profileUnit, legacyRevision, legacyWid, fromUtc, toExclusiveUtc,
 * consentAtUtc, serverNowUtc}`. The caller owns snapshot consistency and authorization.
 */
export function projectLegacyWorkouts(input) {
  const range = validateRange(input || {});
  const warnings = [];
  const records = [];
  const unit = profileUnit(input.profileUnit);
  const workouts = Array.isArray(input.workouts) ? input.workouts : [];
  for (let index = 0; index < workouts.length; index += 1) {
    const workout = workouts[index];
    if (!plainObject(workout) || !safeJsonValue(workout)) {
      warning(warnings, 'malformed-legacy-workout', 'LEGACY_WORKOUT', index);
      continue;
    }
    const date = validDateOnly(workout.d);
    if (!date) {
      warning(warnings, 'malformed-legacy-date', 'LEGACY_WORKOUT', index);
      continue;
    }
    if (!legacyDayInRange(date, range)) {
      warning(warnings, 'legacy-day-partial-range', 'LEGACY_WORKOUT', index);
      continue;
    }
    const sourceRecordId = legacySourceId('legacy-workout', workout, index, input.legacyRevision, input.legacyWid);
    if (!sourceRecordId) {
      warning(warnings, 'missing-legacy-snapshot-identity', 'LEGACY_WORKOUT', index);
      continue;
    }
    const entries = Array.isArray(workout.entries) ? workout.entries : [];
    const exercises = entries
      .map(entry => projectLegacyExercise(entry, unit, warnings, index))
      .filter(Boolean);
    if (!exercises.length) continue;
    records.push({
      kind: 'WORKOUT', sourceKind: 'LEGACY_WORKOUT', sourceRecordId,
      reportedDate: date.value, reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED',
      unit, exercises,
    });
  }
  return { records, warnings };
}

/**
 * Project selected legacy `bodyweight` rows only. Its output is owner data, not sharing
 * permission. Arguments match `projectLegacyWorkouts`, replacing `workouts` with `bodyweight`.
 */
export function projectLegacyBodyweight(input) {
  const range = validateRange(input || {});
  const warnings = [];
  const records = [];
  const unit = profileUnit(input.profileUnit);
  const rows = Array.isArray(input.bodyweight) ? input.bodyweight : [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!plainObject(row) || !safeJsonValue(row) || !Number.isFinite(row.w)) {
      warning(warnings, 'malformed-legacy-bodyweight', 'LEGACY_BODY_WEIGHT', index);
      continue;
    }
    const date = validDateOnly(row.d);
    if (!date) {
      warning(warnings, 'malformed-legacy-date', 'LEGACY_BODY_WEIGHT', index);
      continue;
    }
    if (!legacyDayInRange(date, range)) {
      warning(warnings, 'legacy-day-partial-range', 'LEGACY_BODY_WEIGHT', index);
      continue;
    }
    const sourceRecordId = legacySourceId('legacy-bodyweight', row, index, input.legacyRevision, input.legacyWid);
    if (!sourceRecordId) {
      warning(warnings, 'missing-legacy-snapshot-identity', 'LEGACY_BODY_WEIGHT', index);
      continue;
    }
    records.push({
      kind: 'BODY_WEIGHT', sourceKind: 'LEGACY_BODY_WEIGHT', sourceRecordId,
      reportedDate: date.value, reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED',
      value: row.w, unit,
    });
  }
  return { records, warnings };
}

function sqliteLoad(value) {
  if (!plainObject(value) || !safeJsonValue(value)) return null;
  if (value.kind === 'BODY_WEIGHT' && !hasOwn(value, 'kg')) return { kind: 'BODY_WEIGHT' };
  if ((value.kind === 'EXTERNAL' || value.kind === 'ASSISTANCE') && Number.isFinite(value.kg)) return { kind: value.kind, kg: value.kg };
  return null;
}

function sqliteSet(source) {
  if (!plainObject(source) || !safeJsonValue(source) || source.completed !== true || !['warmup', 'work'].includes(source.phase)) return null;
  const hasReps = hasOwn(source, 'reps');
  const hasSeconds = hasOwn(source, 'seconds');
  if (hasReps === hasSeconds || (hasReps && !Number.isFinite(source.reps)) || (hasSeconds && !Number.isFinite(source.seconds))) return null;
  const out = { phase: source.phase };
  if (hasOwn(source, 'load')) {
    const load = sqliteLoad(source.load);
    if (!load) return null;
    out.load = load;
  }
  if (hasReps) out.reps = source.reps;
  else out.seconds = source.seconds;
  if (source.phase === 'work' && hasOwn(source, 'effort')) {
    const effort = source.effort;
    if (!plainObject(effort) || !safeJsonValue(effort) || !['RIR', 'RPE'].includes(effort.kind) || !Number.isFinite(effort.value)) return null;
    out.effort = { kind: effort.kind, value: effort.value };
  }
  if (source.phase === 'work' && hasOwn(source, 'failure')) {
    if (typeof source.failure !== 'boolean') return null;
    out.failure = source.failure;
  }
  return out;
}

function sqliteExercises(payload) {
  if (!plainObject(payload) || !safeJsonValue(payload) || !Array.isArray(payload.entries)) return null;
  const exercises = [];
  for (const entry of payload.entries) {
    if (!plainObject(entry) || !safeJsonValue(entry) || typeof entry.exerciseId !== 'string' || !entry.exerciseId || !Array.isArray(entry.sets)) return null;
    if (!['PERFORMED', 'SUBSTITUTED', 'ADDED', 'OMITTED'].includes(entry.disposition)) return null;
    if (entry.disposition === 'OMITTED') continue;
    const sets = entry.sets.map(sqliteSet).filter(Boolean);
    if (sets.length) exercises.push({ exerciseId: entry.exerciseId, sets });
  }
  return exercises;
}

/**
 * Project already-selected `session_executions` rows. Each row is `{id, payloadJson,
 * submittedAtUtc}`; optional session/snapshot columns are intentionally ignored. `submittedAtUtc`
 * is server time and is the only SQLite range boundary used here.
 */
export function projectSqliteExecutions(input) {
  const range = validateRange(input || {});
  const warnings = [];
  const records = [];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!plainObject(row) || !safeJsonValue(row) || typeof row.id !== 'string' || !row.id) {
      warning(warnings, 'malformed-sqlite-row', 'SQLITE_EXECUTION', index);
      continue;
    }
    let submitted;
    try { submitted = parseUtc(row.submittedAtUtc, 'submittedAtUtc'); } catch {
      warning(warnings, 'malformed-sqlite-timestamp', 'SQLITE_EXECUTION', index);
      continue;
    }
    if (submitted.milliseconds < range.from.milliseconds || submitted.milliseconds >= range.to.milliseconds || submitted.milliseconds >= range.consentAt.milliseconds) continue;
    if (typeof row.payloadJson !== 'string') {
      warning(warnings, 'malformed-sqlite-payload', 'SQLITE_EXECUTION', index);
      continue;
    }
    let payload;
    try { payload = JSON.parse(row.payloadJson); } catch {
      warning(warnings, 'malformed-sqlite-payload', 'SQLITE_EXECUTION', index);
      continue;
    }
    const exercises = sqliteExercises(payload);
    if (exercises === null) {
      warning(warnings, 'malformed-sqlite-payload', 'SQLITE_EXECUTION', index);
      continue;
    }
    if (!exercises.length) continue;
    records.push({
      kind: 'WORKOUT', sourceKind: 'SQLITE_EXECUTION', sourceRecordId: row.id,
      reportedAtUtc: submitted.iso, reportedAtProvenance: 'SERVER_RECORDED', exercises,
    });
  }
  return { records, warnings };
}

/** Project already-selected bodyweight_entries rows. The caller owns row selection and grants. */
export function projectSqliteBodyweight(input) {
  const range = validateRange(input || {});
  const warnings = [];
  const records = [];
  const rows = Array.isArray(input.rows) ? input.rows : [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!plainObject(row) || !safeJsonValue(row) || typeof row.id !== 'string' || !row.id || !Number.isFinite(row.weight) || (row.unit !== 'KG' && row.unit !== 'LB')) {
      warning(warnings, 'malformed-sqlite-bodyweight-row', 'SQLITE_BODY_WEIGHT', index);
      continue;
    }
    let received;
    try { received = parseUtc(row.receivedAtUtc, 'receivedAtUtc'); } catch {
      warning(warnings, 'malformed-sqlite-bodyweight-timestamp', 'SQLITE_BODY_WEIGHT', index);
      continue;
    }
    if (received.milliseconds < range.from.milliseconds || received.milliseconds >= range.to.milliseconds || received.milliseconds >= range.consentAt.milliseconds) continue;
    const date = validDateOnly(row.reportedDatePanama);
    if (!date) {
      warning(warnings, 'malformed-sqlite-bodyweight-date', 'SQLITE_BODY_WEIGHT', index);
      continue;
    }
    records.push({
      kind: 'BODY_WEIGHT', sourceKind: 'SQLITE_BODY_WEIGHT', sourceRecordId: row.id,
      reportedDate: date.value, reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED',
      value: row.weight, unit: row.unit, receivedAtUtc: received.iso,
    });
  }
  return { records, warnings };
}

function dedupeRecords(records, warnings) {
  const seen = new Set();
  const output = [];
  for (const record of records) {
    const key = `${record.sourceKind}\u0000${record.sourceRecordId}`;
    if (seen.has(key)) {
      warnings.push({ code: 'duplicate-source-record', sourceKind: record.sourceKind });
      continue;
    }
    seen.add(key);
    output.push(cloneJson(record));
  }
  return output;
}

function exactKeys(value, allowed) {
  return Object.keys(value).every(key => allowed.has(key));
}

function readSet(value) {
  if (!plainObject(value) || !safeJsonValue(value) || !exactKeys(value, new Set(['side', 'phase', 'load', 'reps', 'seconds', 'minutes', 'effort', 'failure']))) return null;
  if (hasOwn(value, 'side') && value.side !== 'L' && value.side !== 'R') return null;
  if (value.phase !== 'warmup' && value.phase !== 'work') return null;
  for (const field of ['reps', 'seconds', 'minutes']) if (hasOwn(value, field) && !Number.isFinite(value[field])) return null;
  if (hasOwn(value, 'failure') && typeof value.failure !== 'boolean') return null;
  if (hasOwn(value, 'load')) {
    const load = value.load;
    if (!plainObject(load) || !safeJsonValue(load)) return null;
    if (load.kind === 'BODY_WEIGHT') {
      if (!exactKeys(load, new Set(['kind']))) return null;
    } else if (load.kind === 'EXTERNAL' || load.kind === 'ASSISTANCE') {
      if (!exactKeys(load, new Set(['kind', 'kg'])) || !Number.isFinite(load.kg)) return null;
    } else if (load.kind === 'REPORTED_UNKNOWN') {
      if (!exactKeys(load, new Set(['kind', 'value', 'unit'])) || !Number.isFinite(load.value) || !['KG', 'LB', 'UNKNOWN'].includes(load.unit)) return null;
    } else return null;
  }
  if (hasOwn(value, 'effort')) {
    const effort = value.effort;
    if (!plainObject(effort) || !safeJsonValue(effort) || !exactKeys(effort, new Set(['kind', 'value'])) || !['RIR', 'RPE'].includes(effort.kind) || !Number.isFinite(effort.value)) return null;
  }
  return cloneJson(value);
}

function readExercises(value) {
  if (!Array.isArray(value)) return null;
  const exercises = [];
  for (const exercise of value) {
    if (!plainObject(exercise) || !safeJsonValue(exercise) || !exactKeys(exercise, new Set(['exerciseId', 'sets'])) || typeof exercise.exerciseId !== 'string' || !exercise.exerciseId || !Array.isArray(exercise.sets)) return null;
    const sets = exercise.sets.map(readSet);
    if (sets.some(set => set === null)) return null;
    exercises.push({ exerciseId: exercise.exerciseId, sets });
  }
  return exercises;
}

function readProjectRecord(record) {
  if (!plainObject(record) || !safeJsonValue(record) || typeof record.kind !== 'string') return null;
  if (record.kind === 'WORKOUT') {
    if (!['LEGACY_WORKOUT', 'SQLITE_EXECUTION'].includes(record.sourceKind) || typeof record.sourceRecordId !== 'string' || !record.sourceRecordId || !Array.isArray(record.exercises)) return null;
    const exercises = readExercises(record.exercises);
    if (!exercises) return null;
    if (record.sourceKind === 'LEGACY_WORKOUT') {
      if (!exactKeys(record, new Set(['kind', 'sourceKind', 'sourceRecordId', 'reportedDate', 'reportedDatePrecision', 'reportedDateProvenance', 'unit', 'exercises']))
        || !validDateOnly(record.reportedDate) || record.reportedDatePrecision !== 'DAY' || record.reportedDateProvenance !== 'OWNER_REPORTED' || !['KG', 'LB', 'UNKNOWN'].includes(record.unit)) return null;
      return { kind: 'WORKOUT', sourceKind: record.sourceKind, sourceRecordId: record.sourceRecordId, reportedDate: record.reportedDate, reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED', unit: record.unit, exercises };
    }
    if (!exactKeys(record, new Set(['kind', 'sourceKind', 'sourceRecordId', 'reportedAtUtc', 'reportedAtProvenance', 'exercises'])) || record.reportedAtProvenance !== 'SERVER_RECORDED') return null;
    let reported;
    try { reported = parseUtc(record.reportedAtUtc, 'reportedAtUtc'); } catch { return null; }
    return { kind: 'WORKOUT', sourceKind: record.sourceKind, sourceRecordId: record.sourceRecordId, reportedAtUtc: reported.iso, reportedAtProvenance: 'SERVER_RECORDED', exercises };
  }
  if (record.kind !== 'BODY_WEIGHT' || !['LEGACY_BODY_WEIGHT', 'SQLITE_BODY_WEIGHT'].includes(record.sourceKind) || typeof record.sourceRecordId !== 'string' || !record.sourceRecordId || !exactKeys(record, new Set(['kind', 'sourceKind', 'sourceRecordId', 'reportedDate', 'reportedDatePrecision', 'reportedDateProvenance', 'value', 'unit', 'receivedAtUtc'])) || !validDateOnly(record.reportedDate) || record.reportedDatePrecision !== 'DAY' || record.reportedDateProvenance !== 'OWNER_REPORTED' || !Number.isFinite(record.value) || !['KG', 'LB', 'UNKNOWN'].includes(record.unit)) return null;
  if (record.sourceKind === 'LEGACY_BODY_WEIGHT' && hasOwn(record, 'receivedAtUtc')) return null;
  if (record.sourceKind === 'SQLITE_BODY_WEIGHT') {
    let received;
    try { received = parseUtc(record.receivedAtUtc, 'receivedAtUtc'); } catch { return null; }
    return { kind: 'BODY_WEIGHT', sourceKind: record.sourceKind, sourceRecordId: record.sourceRecordId, reportedDate: record.reportedDate, reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED', value: record.value, unit: record.unit, receivedAtUtc: received.iso };
  }
  return { kind: 'BODY_WEIGHT', sourceKind: record.sourceKind, sourceRecordId: record.sourceRecordId, reportedDate: record.reportedDate, reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED', value: record.value, unit: record.unit };
}

/**
 * Build an immutable historical-share payload. Weight enters only when both `includeWeight` and
 * the independently verified `weightAllowed` are exactly true. It does not grant access itself.
 */
export function composeHistoryShare(input) {
  const common = { ...input };
  const legacyWorkouts = projectLegacyWorkouts({ ...common, workouts: input.workouts });
  const sqlite = projectSqliteExecutions({ ...common, rows: input.sqliteRows });
  const warnings = [...legacyWorkouts.warnings, ...sqlite.warnings];
  const records = [...legacyWorkouts.records, ...sqlite.records];
  if (input.includeWeight === true && input.weightAllowed === true) {
    const legacyWeight = projectLegacyBodyweight({ ...common, bodyweight: input.bodyweight });
    const sqliteWeight = projectSqliteBodyweight({ ...common, rows: input.sqliteBodyweightRows });
    warnings.push(...legacyWeight.warnings);
    warnings.push(...sqliteWeight.warnings);
    records.push(...legacyWeight.records, ...sqliteWeight.records);
  }
  return { records: dedupeRecords(records, warnings), warnings };
}

/**
 * Read-time redaction for an already immutable share. It never mutates or rewrites `share`.
 * HISTORY hides everything; WEIGHT hides only `BODY_WEIGHT` when history remains authorized.
 */
export function filterHistoryShareForCurrentGrants(share, { historyAllowed, weightAllowed } = {}) {
  if (!plainObject(share) || !Array.isArray(share.records)) throw new TypeError('share records are required');
  if (historyAllowed !== true) return { records: [] };
  const records = share.records
    .map(readProjectRecord)
    .filter(record => record !== null && (record.kind !== 'BODY_WEIGHT' || weightAllowed === true));
  return { records };
}

