import { describe, expect, it, vi } from 'vitest'
import { createAccessGate } from './access-gate.js'

const access = ({ account = { id: 'a', activity: 'ACTIVE' }, managedSubscriptions = true, roles = ['CLIENT'], entitlement = { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities = ['ACCESS_PERSONAL_TRAINING'] } = {}) => {
  const normalizedEntitlement = { version: entitlement.version ?? 1, ...entitlement, ...(entitlement.active === false && (entitlement.startUtc === undefined || entitlement.endExclusiveUtc === undefined) ? { startUtc: null, endExclusiveUtc: null } : {}) }
  return { account, managedSubscriptions, roles, entitlement: normalizedEntitlement, capabilities, compatibility: { protectedTraining: 'supported' }, requestId: 'r', versionTokens: [] }
}

describe('access-gate', () => {
  it('starts unverified and allows only a fresh managed personal-training authority answer', async () => {
    let resolve
    const getAccess = vi.fn(() => new Promise(r => { resolve = r }))
    const gate = createAccessGate({ getAccess })
    expect(gate.getState()).toMatchObject({ status: 'unverified' })
    const pending = gate.refresh('route-entry')
    expect(gate.getState().status).toBe('unverified')
    resolve(access())
    await pending
    expect(gate.getState()).toMatchObject({ status: 'allowed' })
  })

  it('invalidates a late answer after an account reset', async () => {
    let resolve
    const gate = createAccessGate({ getAccess: () => new Promise(r => { resolve = r }) })
    const pending = gate.refresh('old-account')
    gate.resetAccount('new-account')
    resolve(access())
    await pending
    expect(gate.getState()).toMatchObject({ status: 'unverified', reason: 'account-reset' })
  })

  it('fails closed for offline, malformed, unauthorized, and managed denial answers', async () => {
    const getAccess = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'network' }))
      .mockResolvedValueOnce({ account: { id: 'a', activity: 'ACTIVE' } })
      .mockResolvedValueOnce(access({ entitlement: { active: false } }))
    const gate = createAccessGate({ getAccess })
    await gate.refresh('offline')
    expect(gate.getState().status).toBe('blocked')
    await gate.refresh('malformed')
    expect(gate.getState().status).toBe('blocked')
    await gate.refresh('expired')
    expect(gate.getState()).toMatchObject({ status: 'blocked', reason: 'not-entitled' })
  })

  it('retains validated operational metadata when personal training is denied', async () => {
    const gate = createAccessGate({ getAccess: async () => access({
      roles: ['TRAINER', 'COORDINATOR'],
      entitlement: { active: false },
      capabilities: ['CREATE_INVITATION', 'CONFIRM_SUBSCRIPTION'],
    }) })
    await gate.refresh('expired')
    expect(gate.getState()).toMatchObject({ status: 'blocked', reason: 'client-role-required' })
    expect(gate.getState().access.roles).toEqual(['TRAINER', 'COORDINATOR'])
    expect(gate.personalCanProceed()).toBe(false)
    expect(gate.canBackoffice('CREATE_INVITATION')).toBe(true)
    expect(gate.canBackoffice('CONFIRM_SUBSCRIPTION')).toBe(true)
  })

  it('preserves upstream mode 0 while still requiring a valid fresh DTO', async () => {
    const getAccess = vi.fn().mockResolvedValue(access({ managedSubscriptions: false, entitlement: { active: false }, capabilities: [] }))
    const gate = createAccessGate({ getAccess })
    await gate.refresh('legacy')
    expect(gate.getState().status).toBe('allowed')
  })

  it('invalidates after protected HTTP statuses without auto-refreshing', async () => {
    const getAccess = vi.fn().mockResolvedValue(access())
    const gate = createAccessGate({ getAccess })
    await gate.refresh('initial')
    gate.noteHttpError({ status: 409 })
    expect(gate.getState()).toMatchObject({ status: 'unverified', reason: 'server-status-409' })
    expect(getAccess).toHaveBeenCalledTimes(1)
  })

  it('snapshots nested authority data and does not expose mutable aliases', async () => {
    const answer = access({ capabilities: ['ACCESS_PERSONAL_TRAINING'] })
    const gate = createAccessGate({ getAccess: async () => answer })
    await gate.refresh()
    answer.account.id = 'other'
    answer.capabilities.push('MANAGE_OPERATIONAL_ROLES')
    const exposed = gate.getState().access
    expect(exposed.account.id).toBe('a')
    expect(() => exposed.capabilities.push('x')).toThrow()
    expect(exposed.capabilities).toEqual(['ACCESS_PERSONAL_TRAINING'])
  })

  it('rejects literal-invalid account IDs, roles, tokens, and active intervals', async () => {
    const answer = access()
    answer.account.id = ''
    const gate = createAccessGate({ getAccess: async () => answer })
    await gate.refresh()
    expect(gate.getState()).toMatchObject({ status: 'blocked', reason: 'malformed-access' })
  })
})
