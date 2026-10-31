import { describe, expect, it } from 'vitest'
import { createTrainerDraftStore, draftStorageKey } from './trainer-draft.js'

const accountUid = 'UID-Literal-01'
const sessionId = '123e4567-e89b-42d3-a456-426614174000'
const planId = '123e4567-e89b-42d3-a456-426614174001'
const makeStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed))
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    has: key => map.has(key),
    raw: map,
  }
}

describe('trainer-draft', () => {
  it('isolates the exact account/session/plan scope and returns a copy on explicit recovery', () => {
    const storage = makeStorage({ foreign: 'sentinel' })
    const store = createTrainerDraftStore({ storage, accountUid, serverSessionId: sessionId, planVersionId: planId })
    const input = { title: 'draft', blocks: [{ exerciseId: 'x' }] }
    store.save(input)
    input.blocks[0].exerciseId = 'changed'
    const recovered = store.recover()
    recovered.blocks[0].exerciseId = 'caller-change'
    expect(store.recover().blocks[0].exerciseId).toBe('x')
    expect(storage.has('foreign')).toBe(true)
    expect(store.key).toBe(draftStorageKey(accountUid, sessionId, planId))
  })

  it('reports corruption without reading or deleting foreign keys', () => {
    const storage = makeStorage({ [draftStorageKey(accountUid, sessionId, planId)]: '{bad', foreign: 'keep' })
    const store = createTrainerDraftStore({ storage, accountUid, serverSessionId: sessionId, planVersionId: planId })
    expect(() => store.recover()).toThrow(/corrupt/i)
    expect(storage.has('foreign')).toBe(true)
  })

  it('propagates quota/storage failures and clear removes only the exact key', () => {
    const storage = makeStorage({ foreign: 'keep' })
    const store = createTrainerDraftStore({ storage, accountUid, serverSessionId: sessionId, planVersionId: planId })
    storage.setItem = () => { throw new Error('quota') }
    expect(() => store.save({ title: 'x' })).toThrow('quota')
    storage.setItem = (key, value) => storage.raw.set(key, String(value))
    store.save({ title: 'x' })
    store.clear()
    expect(storage.has('foreign')).toBe(true)
    expect(storage.has(store.key)).toBe(false)
  })

  it('rejects mismatched identity scope and unknown top-level stored fields', () => {
    const spaced = createTrainerDraftStore({ storage: makeStorage(), accountUid: ' ', serverSessionId: sessionId, planVersionId: planId })
    spaced.save({ title: 'preserve whitespace UID' })
    expect(spaced.recover().title).toBe('preserve whitespace UID')
    const storage = makeStorage({ [draftStorageKey(accountUid, sessionId, planId)]: JSON.stringify({ schemaVersion: 1, accountUid, serverSessionId: sessionId, planVersionId: planId, draft: {}, extra: true }) })
    const store = createTrainerDraftStore({ storage, accountUid, serverSessionId: sessionId, planVersionId: planId })
    expect(() => store.recover()).toThrow(/unknown/i)
  })

  it('measures UTF-8 bytes, accepts a large valid session draft, and rejects non-JSON values', () => {
    const storage = makeStorage()
    const store = createTrainerDraftStore({ storage, accountUid, serverSessionId: sessionId, planVersionId: planId })
    const draft = { exercises: Array.from({ length: 40 }, (_, exercise) => ({ name: ` упражнение-${exercise}`, sets: Array.from({ length: 50 }, (_, set) => ({ reps: set + 1, note: '✓'.repeat(20) })) })) }
    expect(() => store.save(draft)).not.toThrow()
    expect(store.recover()).toEqual(draft)
    expect(() => store.save({ bad: NaN })).toThrow(/JSON/i)
    const cyclic = {}; cyclic.self = cyclic
    expect(() => store.save(cyclic)).toThrow(/JSON|cycle/i)
    expect(() => store.save(Object.create({ bad: true }))).toThrow(/plain|JSON/i)
  })
})
