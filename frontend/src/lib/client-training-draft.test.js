import { describe, expect, it } from 'vitest'
import { clientTrainingDraftKey, createClientTrainingDraftStore } from './client-training-draft.js'

const id = '11111111-1111-4111-8111-111111111111'
const plan = '22222222-2222-4222-8222-222222222222'
const snapshot = { planVersionId: plan, exercises: [{ entryId: '33333333-3333-4333-8333-333333333333', exerciseId: '0001', mode: 'reps' }] }
const memory = () => { const values = new Map(); return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values } }

describe('client training draft scope', () => {
  it('binds a draft to literal owner, server session, plan, goal and immutable snapshot', () => {
    const storage = memory()
    const store = createClientTrainingDraftStore({ storage, accountUid: 'account-A', serverSessionId: id, planVersionId: plan, originalSnapshot: snapshot })
    store.save({ entries: {}, extras: [] })
    expect(store.recover()).toEqual({ entries: {}, extras: [] })
    expect(createClientTrainingDraftStore({ storage, accountUid: 'account-B', serverSessionId: id, planVersionId: plan, originalSnapshot: snapshot }).recover()).toBeNull()
    expect(() => createClientTrainingDraftStore({ storage, accountUid: 'account-A', serverSessionId: id, planVersionId: plan, originalSnapshot: { ...snapshot, exercises: [] } }).recover()).toThrow(/stale|mismatched/i)
    expect(clientTrainingDraftKey({ accountUid: 'account-A', serverSessionId: id, planVersionId: plan, goalVersionId: null })).toContain('account-A')
  })
})
