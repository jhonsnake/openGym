import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXDB, EXALIAS } from '../../frontend/src/lib/exercises-data.js';
import { buildAuthorityManifest } from '../../scripts/catalogue/build-authority-manifest.mjs';
import {
  AUTHORITY_EXERCISE_IDS,
  createExerciseResolver,
} from '../exercise-catalogue.js';

const sourceIds = new Set([...EXDB.map(({ id }) => id), ...Object.keys(EXALIAS)]);
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-exercise-catalogue-'));

test('generated authority manifest is the literal EXDB plus EXALIAS key set', () => {
  assert.deepEqual([...AUTHORITY_EXERCISE_IDS].sort(), [...sourceIds].sort());
  assert.ok(AUTHORITY_EXERCISE_IDS.has('0001'));
  assert.ok(AUTHORITY_EXERCISE_IDS.has('0004'));
  assert.ok(AUTHORITY_EXERCISE_IDS.has('11383'));
  assert.ok(!AUTHORITY_EXERCISE_IDS.has('1'));
});

test('resolver recognizes catalogue literals and rejects unknown, normalized, and alias-target substitutions', () => {
  const resolve = createExerciseResolver();
  assert.deepEqual(resolve('0001', { subjectId: 'owner' }), { kind: 'catalogue' });
  assert.deepEqual(resolve('0004', { subjectId: 'owner' }), { kind: 'catalogue' });
  assert.equal(resolve('1', { subjectId: 'owner' }), null);
  assert.equal(resolve('not-an-exercise', { subjectId: 'owner' }), null);
});

test('custom resolver is explicit, owner-scoped, and does not grant arbitrary custom prefixes', () => {
  const resolve = createExerciseResolver({
    resolveOwnedCustomExerciseId: (id, subjectId) => id === 'custom-owned' && subjectId === 'owner',
  });
  assert.deepEqual(resolve('custom-owned', { subjectId: 'owner' }), { kind: 'custom', ownerId: 'owner' });
  assert.equal(resolve('custom-owned', { subjectId: 'other' }), null);
  assert.equal(resolve('custom-anything', { subjectId: 'owner' }), null);
});

test('standalone generation is deterministic and byte-identical to the checked-in manifest', () => {
  const dir = scratch();
  const first = path.join(dir, 'one.json');
  const second = path.join(dir, 'two.json');
  const one = buildAuthorityManifest({ exdb: EXDB, exalias: EXALIAS, outputPath: first });
  const two = buildAuthorityManifest({ exdb: EXDB, exalias: EXALIAS, outputPath: second });
  assert.equal(one, two);
  assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(second, 'utf8'));
  assert.equal(fs.readFileSync(first, 'utf8'), fs.readFileSync(new URL('../exercise-catalogue.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(one), [...sourceIds].sort());
});

