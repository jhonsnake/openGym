import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('./exercise-catalogue.json', import.meta.url), 'utf8'));
if (!Array.isArray(manifest) || manifest.some(id => typeof id !== 'string')) {
  throw new TypeError('exercise catalogue manifest must be an array of literal IDs');
}

export const AUTHORITY_EXERCISE_IDS = new Set(manifest);
Object.freeze(manifest);

export function createExerciseResolver({ resolveOwnedCustomExerciseId } = {}) {
  return (exerciseId, { subjectId } = {}) => {
    if (AUTHORITY_EXERCISE_IDS.has(exerciseId)) return { kind: 'catalogue' };
    if (typeof resolveOwnedCustomExerciseId === 'function' && resolveOwnedCustomExerciseId(exerciseId, subjectId) === true) {
      return { kind: 'custom', ownerId: subjectId };
    }
    return null;
  };
}

export const exerciseResolver = createExerciseResolver();

