import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  composeHistoryShare,
  filterHistoryShareForCurrentGrants,
  projectLegacyBodyweight,
  projectLegacyWorkouts,
  projectSqliteBodyweight,
  projectSqliteExecutions,
} from '../authority-projections.js';

const range = {
  fromUtc: '2026-10-10T00:00:00.000Z',
  toExclusiveUtc: '2026-10-13T00:00:00.000Z',
  consentAtUtc: '2026-10-20T00:00:00.000Z',
  serverNowUtc: '2026-10-30T00:00:00.000Z',
};

const snapshot = { legacyRevision: 'rev-8', legacyWid: 'writer-A' };
const clone = value => JSON.parse(JSON.stringify(value));

test('legacy workout projection is a narrow, immutable actuals-only projection', () => {
  const workouts = [{
    id: 'legacy-1', d: '2026-10-11', name: 'private workout', note: 'private note', picture: 'secret.jpg',
    routineIds: ['routine-7'], privateProfile: { email: 'not-for-share' },
    entries: [
      {
        id: '0294', note: 'private exercise note', target: { reps: 12 }, planned: { r: 12 },
        muscleSnapshot: { biceps: 1 }, sets: [
          { w: 12, r: 10, done: true, rir: 2, failure: true, phase: 'work', target: 99 },
          { w: 14, r: 12, done: false, rpe: 10, failure: true },
          { w: 0, sec: 30, done: true, warmup: true },
          { w: 11, r: 8, done: true, sides: {
            L: { w: 11, r: 8, done: true, rpe: 8 },
            R: { w: 12, r: 7, done: false, rir: 1 },
          } },
        ],
      },
      { id: '0001', target: { r: 8 }, sets: [{ w: 99, r: 8, done: false }] },
    ],
  }];
  const before = clone(workouts);
  const result = projectLegacyWorkouts({ workouts, profileUnit: 'kg', ...snapshot, ...range });

  assert.deepEqual(workouts, before);
  assert.equal(result.records.length, 1);
  const record = result.records[0];
  assert.deepEqual(Object.keys(record).sort(), ['exercises', 'kind', 'reportedDate', 'reportedDatePrecision', 'reportedDateProvenance', 'sourceKind', 'sourceRecordId', 'unit']);
  assert.equal(record.kind, 'WORKOUT');
  assert.equal(record.sourceKind, 'LEGACY_WORKOUT');
  assert.equal(record.reportedDate, '2026-10-11');
  assert.equal(record.reportedDatePrecision, 'DAY');
  assert.equal(record.reportedDateProvenance, 'OWNER_REPORTED');
  assert.equal(record.unit, 'KG');
  assert.equal(record.exercises.length, 1);
  assert.equal(record.exercises[0].exerciseId, '0294');
  assert.deepEqual(record.exercises[0].sets, [
    { phase: 'work', load: { kind: 'REPORTED_UNKNOWN', value: 12, unit: 'KG' }, reps: 10, effort: { kind: 'RIR', value: 2 }, failure: true },
    { phase: 'warmup', load: { kind: 'REPORTED_UNKNOWN', value: 0, unit: 'KG' }, seconds: 30 },
    { side: 'L', phase: 'work', load: { kind: 'REPORTED_UNKNOWN', value: 11, unit: 'KG' }, reps: 8, effort: { kind: 'RPE', value: 8 } },
  ]);
  assert.equal(JSON.stringify(record).includes('private'), false);
  assert.equal(JSON.stringify(record).includes('target'), false);
  assert.equal(JSON.stringify(record).includes('routine'), false);
});

test('legacy source ids use literal ids and snapshot-bound ids when absent', () => {
  const result = projectLegacyWorkouts({
    workouts: [
      { id: 'literal-id', d: '2026-10-10', entries: [{ id: 'e', sets: [{ done: true, r: 0, w: 0 }] }] },
      { d: '2026-10-11', entries: [{ id: 'e', sets: [{ done: true, r: 1 }] }] },
    ], profileUnit: 'lb', ...snapshot, ...range,
  });
  assert.deepEqual(result.records.map(record => record.sourceRecordId), ['literal-id', '["legacy-workout","rev-8","writer-A",1]']);
  assert.deepEqual(result.records[0].exercises[0].sets[0], { phase: 'work', load: { kind: 'REPORTED_UNKNOWN', value: 0, unit: 'LB' }, reps: 0 });
});

test('legacy keeps explicit load semantics and repeated exercise entries without reading targets', () => {
  const result = projectLegacyWorkouts({
    workouts: [{ d: '2026-10-10', entries: [
      { id: 'same-exercise', target: { load: 'do not read' }, sets: [{ done: true, r: 5, w: 25, loadKind: 'ASSISTANCE' }] },
      { id: 'same-exercise', planned: { bodyweight: false }, sets: [{ done: true, r: 10, w: 0, loadKind: 'BODY_WEIGHT' }] },
    ] }], profileUnit: 'kg', ...snapshot, ...range,
  });
  assert.equal(result.records[0].exercises.length, 2);
  assert.deepEqual(result.records[0].exercises.map(exercise => exercise.sets[0].load), [
    { kind: 'ASSISTANCE', value: 25, unit: 'KG' }, { kind: 'BODY_WEIGHT' },
  ]);
  assert.equal(JSON.stringify(result.records).includes('target'), false);
  assert.equal(JSON.stringify(result.records).includes('planned'), false);
});

test('partial legacy days are conservatively withheld rather than expanded', () => {
  const workout = { d: '2026-10-11', entries: [{ id: 'e', sets: [{ done: true, r: 1 }] }] };
  const partial = projectLegacyWorkouts({
    workouts: [workout], profileUnit: 'kg', ...snapshot,
    fromUtc: '2026-10-11T12:00:00.000Z', toExclusiveUtc: '2026-10-12T12:00:00.000Z',
    consentAtUtc: '2026-10-20T00:00:00.000Z', serverNowUtc: range.serverNowUtc,
  });
  assert.equal(partial.records.length, 0);
  assert.equal(partial.warnings[0].code, 'legacy-day-partial-range');
});

test('date-only legacy records use complete America/Panama business days', () => {
  const panamaRange = {
    fromUtc: '2026-10-20T05:00:00.000Z', toExclusiveUtc: '2026-10-21T05:00:00.000Z',
    consentAtUtc: '2026-10-21T05:00:00.000Z', serverNowUtc: range.serverNowUtc,
  };
  const input = { profileUnit: 'kg', ...snapshot, ...panamaRange };
  const workout = d => ({ d, entries: [{ id: 'e', sets: [{ done: true, r: 1 }] }] });
  const weight = d => ({ d, w: 80 });
  assert.equal(projectLegacyWorkouts({ workouts: [workout('2026-10-20')], ...input }).records.length, 1);
  assert.equal(projectLegacyBodyweight({ bodyweight: [weight('2026-10-20')], ...input }).records.length, 1);
  assert.equal(projectLegacyWorkouts({ workouts: [workout('2026-10-19'), workout('2026-10-21')], ...input }).records.length, 0);
  const partial = projectLegacyBodyweight({ bodyweight: [weight('2026-10-20')], ...input, fromUtc: '2026-10-20T06:00:00.000Z' });
  assert.equal(partial.records.length, 0);
  assert.equal(projectLegacyBodyweight({ bodyweight: [weight('2024-02-29')], ...input, fromUtc: '2024-02-29T05:00:00.000Z', toExclusiveUtc: '2024-03-01T05:00:00.000Z', consentAtUtc: '2024-03-01T05:00:00.000Z', serverNowUtc: '2024-03-02T00:00:00.000Z' }).records.length, 1);
});

test('legacy bodyweight is own-data-only and only exposes date, value, unit and provenance', () => {
  const bodyweight = [
    { d: '2026-10-10', w: 80.2, t: 123, note: 'private', waist: 82 },
    { d: '2026-10-13', w: 79.9 },
    { d: 'not-a-date', w: 70 },
  ];
  const before = clone(bodyweight);
  const result = projectLegacyBodyweight({ bodyweight, profileUnit: 'lb', ...snapshot, ...range });
  assert.deepEqual(bodyweight, before);
  assert.deepEqual(result.records, [{
    kind: 'BODY_WEIGHT', sourceKind: 'LEGACY_BODY_WEIGHT', sourceRecordId: '["legacy-bodyweight","rev-8","writer-A",0]',
    reportedDate: '2026-10-10', reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED', value: 80.2, unit: 'LB',
  }]);
  assert.equal(JSON.stringify(result.records).includes('waist'), false);
});

test('sqlite executions accept selected rows only and strip snapshots, plans and prior trainer data', () => {
  const rows = [{
    id: 'execution-1', submittedAtUtc: '2026-10-11T10:00:00.000Z', sessionId: 'do-not-export', snapshotJson: '{"private":true}',
    payloadJson: JSON.stringify({
      sessionId: 'hidden-session', priortrainer: { name: 'hidden' }, entries: [
        { exerciseId: '0294', disposition: 'PERFORMED', planEntryId: 'target-sentinel', sets: [
          { phase: 'work', completed: true, reps: 8, load: { kind: 'EXTERNAL', kg: 20 }, effort: { kind: 'RPE', value: 8 }, failure: false },
          { phase: 'work', completed: false, reps: 12, load: { kind: 'EXTERNAL', kg: 99 } },
        ] },
        { exerciseId: '0002', disposition: 'OMITTED', sets: [] },
        { exerciseId: '0003', disposition: 'ADDED', sets: [{ phase: 'warmup', completed: true, seconds: 30, load: { kind: 'BODY_WEIGHT' } }] },
      ],
    }),
  }];
  const before = clone(rows);
  const result = projectSqliteExecutions({ rows, ...range });
  assert.deepEqual(rows, before);
  assert.deepEqual(result.records, [{
    kind: 'WORKOUT', sourceKind: 'SQLITE_EXECUTION', sourceRecordId: 'execution-1',
    reportedAtUtc: '2026-10-11T10:00:00.000Z', reportedAtProvenance: 'SERVER_RECORDED',
    exercises: [
      { exerciseId: '0294', sets: [{ phase: 'work', load: { kind: 'EXTERNAL', kg: 20 }, reps: 8, effort: { kind: 'RPE', value: 8 }, failure: false }] },
      { exerciseId: '0003', sets: [{ phase: 'warmup', load: { kind: 'BODY_WEIGHT' }, seconds: 30 }] },
    ],
  }]);
  assert.equal(JSON.stringify(result.records).includes('target-sentinel'), false);
  assert.equal(JSON.stringify(result.records).includes('priortrainer'), false);
  assert.equal(JSON.stringify(result.records).includes('snapshot'), false);
});

test('sqlite executions accept actual null-prototype node:sqlite rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE executions (id TEXT, payloadJson TEXT, submittedAtUtc TEXT)');
  const payload = JSON.stringify({ entries: [{ exerciseId: 'added', disposition: 'ADDED', sets: [{ phase: 'work', completed: true, reps: 3 }] }] });
  db.prepare('INSERT INTO executions VALUES (?, ?, ?)').run('real-row', payload, '2026-10-11T10:00:00.000Z');
  const row = db.prepare('SELECT id, payloadJson, submittedAtUtc FROM executions').get();
  assert.equal(Object.getPrototypeOf(row), null);
  assert.equal(projectSqliteExecutions({ rows: [row], ...range }).records[0].sourceRecordId, 'real-row');
  db.close();
});

test('generated legacy ids are stable and collision-free for delimiter-containing snapshot ids', () => {
  const make = (legacyRevision, legacyWid) => projectLegacyWorkouts({
    workouts: [{ d: '2026-10-10', entries: [{ id: 'e', sets: [{ done: true, r: 1 }] }] }],
    profileUnit: 'kg', legacyRevision, legacyWid, ...range,
  }).records[0].sourceRecordId;
  const first = make('a:b', 'c');
  const second = make('a', 'b:c');
  assert.notEqual(first, second);
  assert.equal(first, make('a:b', 'c'));
  assert.equal(first.includes('filename'), false);
  assert.equal(first.includes('health'), false);
});

test('composer dedupes exact source tuples and weight needs both explicit switches', () => {
  const shared = composeHistoryShare({
    workouts: [{ id: 'w1', d: '2026-10-10', entries: [{ id: 'e', sets: [{ done: true, r: 1 }] }] }],
    bodyweight: [{ d: '2026-10-10', w: 80 }], profileUnit: 'kg', ...snapshot, ...range,
    includeWeight: true, weightAllowed: false,
  });
  assert.deepEqual(shared.records.map(record => record.kind), ['WORKOUT']);
  const withWeight = composeHistoryShare({
    workouts: [], bodyweight: [{ d: '2026-10-10', w: 80 }], profileUnit: 'kg', ...snapshot, ...range,
    includeWeight: true, weightAllowed: true,
  });
  assert.equal(withWeight.records[0].kind, 'BODY_WEIGHT');
  const repeated = filterHistoryShareForCurrentGrants(withWeight, { historyAllowed: true, weightAllowed: false });
  assert.deepEqual(repeated.records, []);
  assert.equal(withWeight.records.length, 1);
});

test('composer projects selected sqlite bodyweight only with both weight grants', () => {
  const args = {
    workouts: [], bodyweight: [{ d: '2026-10-10', w: 80 }],
    sqliteBodyweightRows: [{ id: 'bw-1', weight: 81, unit: 'KG', reportedDatePanama: '2026-10-10', receivedAtUtc: '2026-10-11T00:00:00.000Z', waist: 99 }],
    profileUnit: 'kg', ...snapshot, ...range, includeWeight: true, weightAllowed: true,
  };
  const shared = composeHistoryShare(args);
  assert.deepEqual(shared.records.map(record => record.sourceKind), ['LEGACY_BODY_WEIGHT', 'SQLITE_BODY_WEIGHT']);
  assert.equal(JSON.stringify(shared.records).includes('waist'), false);
  assert.equal(projectSqliteBodyweight({ rows: args.sqliteBodyweightRows, ...range }).records[0].reportedDateProvenance, 'OWNER_REPORTED');
  assert.equal(composeHistoryShare({ ...args, includeWeight: false }).records.length, 0);
  assert.equal(composeHistoryShare({ ...args, weightAllowed: false }).records.length, 0);
});

test('read filtering is closed-world and redacts malformed or private records', () => {
  const valid = composeHistoryShare({ workouts: [{ d: '2026-10-10', entries: [{ id: 'e', sets: [{ done: true, r: 1 }] }] }], bodyweight: [], profileUnit: 'kg', ...snapshot, ...range });
  const share = { records: [...valid.records, { kind: 'PROFILE', email: 'private@example.test' }, { ...valid.records[0], privateNote: 'sentinel' }] };
  const filtered = filterHistoryShareForCurrentGrants(share, { historyAllowed: true, weightAllowed: true });
  assert.equal(filtered.records.length, 1);
  assert.equal(JSON.stringify(filtered.records).includes('private'), false);
  assert.deepEqual(share.records[2].privateNote, 'sentinel');
  assert.deepEqual(filterHistoryShareForCurrentGrants({ records: [{ kind: 'BODY_WEIGHT', value: 80, unit: 'KG', privateNote: 'weight' }] }, { historyAllowed: true, weightAllowed: false }).records, []);
});

test('invalid ranges, malformed values and JSON poisoning produce safe failures without raw disclosure', () => {
  assert.throws(() => projectLegacyWorkouts({ workouts: [], profileUnit: 'kg', ...snapshot, ...range, toExclusiveUtc: range.fromUtc }), /range/);
  assert.throws(() => projectLegacyWorkouts({ workouts: [], profileUnit: 'kg', ...snapshot, ...range, toExclusiveUtc: '2026-11-01T00:00:00.000Z' }), /future/);
  const poisoned = JSON.parse('{"entries":[{"exerciseId":"e","sets":[]}],"__proto__":{"leak":"no"}}');
  const result = projectSqliteExecutions({ rows: [{ id: 'bad', submittedAtUtc: '2026-10-11T00:00:00.000Z', payloadJson: JSON.stringify(poisoned) }], ...range });
  assert.equal(result.records.length, 0);
  assert.equal(result.warnings[0].code, 'malformed-sqlite-payload');
  assert.equal(JSON.stringify(result.warnings).includes('leak'), false);
});

