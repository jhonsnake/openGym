// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beacon } from './api.js'
import { activateManagedBridge, deactivateManagedBridge } from './managed-bridge.js'

const deniedAccess = {
  account: { id: 'account-a', activity: 'ACTIVE' }, managedSubscriptions: true,
  roles: [], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 },
  capabilities: [], compatibility: { protectedTraining: 'supported' }, requestId: 'access-denied', versionTokens: [],
}

afterEach(() => { deactivateManagedBridge(); vi.unstubAllGlobals() })

describe('managed activity keepalive transport', () => {
  it('does not submit activity when fresh managed authority denies it', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => deniedAccess }))
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon })

    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    expect(await beacon('/api/activity', { active: false, reason: 'closed' })).toBe(false)

    expect(sendBeacon).not.toHaveBeenCalled()
    expect(fetch.mock.calls.map(([url]) => new URL(url, 'https://app.test').pathname)).toEqual(['/api/access', '/api/access'])
  })
})
