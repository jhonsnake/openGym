import test from 'node:test';
import assert from 'node:assert/strict';
import { createExerciseIdResolver, hashPayload, validateMutationEnvelope, canonicalAggregateKey, parseAuthorityPayload } from '../authority-contract.js';

const operationId = '123e4567-e89b-42d3-a456-426614174000';

test('authority envelopes reject unknown keys and preserve exact existing UIDs', () => {
  const envelope = validateMutationEnvelope({ operationId, expectedVersion: 0, payload: { accountId: ' A-UID ', roles: ['CLIENT'], reason: ' initial role ' } }, 'roles');
  assert.equal(envelope.payload.accountId, ' A-UID ');
  assert.deepEqual(envelope.payload.roles, ['CLIENT']);
  assert.equal(envelope.payload.reason, 'initial role');
  assert.throws(() => validateMutationEnvelope({ operationId, expectedVersion: 0, payload: { accountId: 'u', roles: ['CLIENT'], reason: 'ok', extra: true } }, 'roles'), /unknown/i);
});

test('authority payload validators are closed for future domain inputs', () => {
  assert.deepEqual(parseAuthorityPayload('grant', { relationId: '123e4567-e89b-42d3-a456-426614174000', grants: [{ kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-01-02T00:00:00.000Z' }] }).grants[0].kind, 'HISTORY');
  assert.throws(() => parseAuthorityPayload('commercial', { clientId: 'client', kind: 'MONTHLY', reference: 'ref', reason: 'reason', price: 1 }), /unknown/i);
  assert.throws(() => parseAuthorityPayload('grant', { relationId: 'bad', grants: [] }), /UUID/i);
});

test('aggregate keys are server-safe canonical tuples', () => {
  assert.equal(canonicalAggregateKey(['a', 'b']), '["a","b"]');
  assert.throws(() => canonicalAggregateKey(['a', { bad: true }]), /primitive/i);
});

const resolver = createExerciseIdResolver({ catalogueIds: new Set(['0001']), resolveOwnedCustomExerciseId: (id, owner) => id === 'custom-1' && owner === 'owner' });
const plan = { relationId: operationId, exercises: [{ exerciseId: '0001', mode: 'reps', sets: 2, commonTarget: { reps: { min: 8, max: 12 }, effort: { kind: 'RIR', value: 2.5 } }, setOverrides: { 1: { reps: { exact: 10 }, load: { kind: 'EXTERNAL', kg: 20 } } } }] };
test('nested plan, execution and goal variants are closed and use an authorized exercise resolver', () => {
  assert.equal(parseAuthorityPayload('plan', plan, { exerciseResolver: resolver, subjectId: 'owner' }).exercises[0].exerciseId, '0001');
  assert.equal(parseAuthorityPayload('goal', { label: 'lift', kind: 'PERFORMANCE', exerciseId: 'custom-1', targetLoad: { kind: 'BODY_WEIGHT' }, targetReps: 8 }, { exerciseResolver: resolver, subjectId: 'owner' }).exerciseId, 'custom-1');
  assert.throws(() => parseAuthorityPayload('plan', { ...plan, exercises: [{ ...plan.exercises[0], commonTarget: { reps: { exact: 8 }, seconds: 30 } }] }, { exerciseResolver: resolver, subjectId: 'owner' }), /unknown/i);
  assert.throws(() => parseAuthorityPayload('plan', { ...plan, exercises: [{ ...plan.exercises[0], exerciseId: 'invented' }] }, { exerciseResolver: resolver, subjectId: 'owner' }), /unrecognized/i);
  assert.throws(() => parseAuthorityPayload('goal', { label: 'bad', kind: 'CONSISTENCY', targetSessionsPerWeek: 3, targetWeight: 80 }, { exerciseResolver: resolver }), /unknown/i);
  assert.throws(() => parseAuthorityPayload('execution', { sessionId: operationId, entries: [{ planEntryId: operationId, exerciseId: '0001', disposition: 'PERFORMED', sets: [{ phase: 'warmup', completed: true, reps: 8, failure: false }] }] }, { exerciseResolver: resolver }), /warmups/i);
  assert.throws(() => parseAuthorityPayload('execution', { sessionId: operationId, entries: [{ planEntryId: operationId, exerciseId: '0001', disposition: 'PERFORMED', sets: [{ phase: 'work', completed: true, reps: 8 }, { phase: 'work', completed: true, seconds: 30 }] }] }, { exerciseResolver: resolver }), /mixed/i);
  assert.throws(() => parseAuthorityPayload('bodyweight', { weight: 70, unit: 'KG', reportedDatePanama: '2026-02-30' }), /calendar/i);
  assert.throws(() => parseAuthorityPayload('bodyweight', { weight: 70, unit: 'KG', reportedDatePanama: '2027-01-01' }, { clock: () => new Date('2026-01-01T12:00:00Z') }), /future/i);
});
test('payload hashing is recursive canonical JSON', () => {
  assert.equal(hashPayload({ z: [{ b: 2, a: 1 }], a: true }), hashPayload({ a: true, z: [{ a: 1, b: 2 }] }));
});
