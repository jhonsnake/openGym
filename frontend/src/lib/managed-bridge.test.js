import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiUpload } from './api.js'
import { activateManagedBridge, deactivateManagedBridge, isManagedProtectedPath, managedModeHint, managedModeHintFromBuild } from './managed-bridge.js'

const access = (overrides = {}) => ({
  account: { id: 'account-a', activity: 'ACTIVE' }, managedSubscriptions: true,
  roles: ['CLIENT'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 },
  capabilities: ['ACCESS_PERSONAL_TRAINING'], compatibility: { protectedTraining: 'supported' }, requestId: 'access-1', versionTokens: [], ...overrides,
})
const response = body => ({ ok: true, json: async () => body })
const pathOf = url => new URL(url, 'https://app.test').pathname + new URL(url, 'https://app.test').search
const headerOf = call => call[1]?.headers?.['X-OpenGym-Contract-Version']
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}
const personalClientRequests = [
  ['/api/client/plan/current', { method: 'GET' }],
  ['/api/client/sessions/current', { method: 'GET' }],
  ['/api/client/sessions/start', { method: 'POST', body: '{}' }],
  ['/api/client/sessions/finish', { method: 'POST', body: '{}' }],
  ['/api/client/executions?limit=1', { method: 'GET' }],
  ['/api/client/bodyweight', { method: 'GET' }],
  ['/api/client/bodyweight', { method: 'POST', body: '{}' }],
]
const nonPersonalClientRequests = [
  ['/api/client/relations?cursor=opaque', { method: 'GET' }],
  ['/api/client/relations/grants/replace', { method: 'POST', body: '{}' }],
  ['/api/client/relations/grants/revoke', { method: 'POST', body: '{}' }],
  ['/api/client/relations/revoke', { method: 'POST', body: '{}' }],
  ['/api/client/relations/reactivate-accept', { method: 'POST', body: '{}' }],
  ['/api/client/sessions/abandon', { method: 'POST', body: '{}' }],
  ['/api/client/exports', { method: 'POST', body: '{}' }],
  ['/api/client/exports/00000000-0000-4000-8000-000000000001', { method: 'GET' }],
  ['/api/client/deletion-requests', { method: 'POST', body: '{}' }],
]

afterEach(() => { deactivateManagedBridge(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('managed legacy transport bridge (controlled transport)', () => {
  it('treats only build hint 1 as a deny-only managed boot signal', () => {
    expect(managedModeHintFromBuild('1')).toBe(true)
    expect(managedModeHintFromBuild('0')).toBe(false)
    expect(managedModeHintFromBuild(undefined)).toBe(false)
  })

  it('makes the real api seam obtain access before a legacy data pull', async () => {
    const fetch = vi.fn(async url => response(String(url).endsWith('/api/access') ? access() : { state: {}, rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    await api('/api/data')
    const paths = fetch.mock.calls.map(([url]) => new URL(url, 'https://app.test').pathname)
    expect(paths).toEqual(['/api/access', '/api/access', '/api/data'])
  })

  it('keeps the guard marker on api data pulls that omit options', async () => {
    const fetch = vi.fn(async url => response(String(url).endsWith('/api/access') ? access() : { state: {}, rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    await api('/api/data')
    expect(pathOf(fetch.mock.calls[2][0])).toBe('/api/data')
    expect(headerOf(fetch.mock.calls[2])).toBe('1')
  })

  it('retains the original method, body, headers, and timeout-only behavior after guarding', async () => {
    const fetch = vi.fn(async url => response(String(url).endsWith('/api/access') ? access() : { state: {}, rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    await api('/api/data', { method: 'PUT', body: '{"revision":1}', timeout: 321, headers: { 'X-Caller': 'kept' } })
    const init = fetch.mock.calls[2][1]
    expect(init).toMatchObject({ method: 'PUT', body: '{"revision":1}', headers: { 'X-Caller': 'kept', 'X-OpenGym-Contract-Version': '1' } })
    expect(init).not.toHaveProperty('timeout')
  })

  it('freshly gates every exact personal client training route, including query reads', async () => {
    const fetch = vi.fn(async url => response(String(url).endsWith('/api/access') ? access() : { ok: true }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    for (const [path, options] of personalClientRequests) await api(path, options)
    const calls = fetch.mock.calls
    expect(calls.filter(([url]) => pathOf(url) === '/api/access')).toHaveLength(personalClientRequests.length + 1)
    personalClientRequests.forEach(([path], index) => {
      const call = calls[(index + 1) * 2]
      expect(pathOf(call[0])).toBe(path)
      expect(headerOf(call)).toBe('1')
      expect(pathOf(calls[(index + 1) * 2 - 1][0])).toBe('/api/access')
    })
  })

  it('leaves every non-personal client route accessible and marker-free when unentitled', async () => {
    const fetch = vi.fn(async url => response(String(url).endsWith('/api/access')
      ? access({ entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 2 } })
      : { ok: true }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    for (const [path, options] of nonPersonalClientRequests) await api(path, options)
    expect(fetch.mock.calls.map(([url]) => pathOf(url))).toEqual(['/api/access', ...nonPersonalClientRequests.map(([path]) => path)])
    expect(fetch.mock.calls.slice(1).map(headerOf)).toEqual(Array(nonPersonalClientRequests.length).fill(undefined))
  })

  it('keeps M0 transport unguarded and marker-free', async () => {
    const fetch = vi.fn(async () => response({ state: {}, rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: false } })
    await api('/api/data')
    expect(fetch.mock.calls).toHaveLength(1)
    expect(pathOf(fetch.mock.calls[0][0])).toBe('/api/data')
    expect(headerOf(fetch.mock.calls[0])).toBeUndefined()
  })

  it('fails closed on a configured managed build hint without current config instead of using the hint as an allow', async () => {
    vi.stubEnv('VITE_MANAGED_SUBSCRIPTIONS_HINT', '1')
    expect(managedModeHint()).toBe(true)
    const fetch = vi.fn(async () => response({ state: {}, rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await expect(activateManagedBridge({ account: { id: 'account-a' } })).resolves.toMatchObject({ status: 'blocked', reason: 'authority-unavailable' })
    await expect(api('/api/data')).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not dispatch again after a 426 invalidates the allowed authority state and the next refresh is denied', async () => {
    let accessCalls = 0
    const fetch = vi.fn(async url => {
      if (String(url).endsWith('/api/access')) {
        accessCalls++
        return response(accessCalls < 3 ? access() : access({ entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 2 } }))
      }
      return { ok: false, status: 426, json: async () => ({ error: 'upgrade required' }) }
    })
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    await expect(api('/api/data')).rejects.toMatchObject({ status: 426 })
    await expect(api('/api/data')).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    expect(fetch.mock.calls.map(([url]) => pathOf(url))).toEqual(['/api/access', '/api/access', '/api/data', '/api/access'])
  })

  it('does not dispatch a protected request whose fresh account-A decision settles after account B replaces it', async () => {
    let resolveARefresh
    let accessCalls = 0
    const fetch = vi.fn(async url => {
      if (!String(url).endsWith('/api/access')) return response({ state: {}, rev: 1 })
      accessCalls++
      if (accessCalls === 2) return new Promise(resolve => { resolveARefresh = () => resolve(response(access())) })
      return response(access({ account: { id: accessCalls === 3 ? 'account-b' : 'account-a', activity: 'ACTIVE' }, requestId: `access-${accessCalls}` }))
    })
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    const staleRequest = api('/api/data')
    await Promise.resolve()
    await activateManagedBridge({ account: { id: 'account-b' }, config: { managed_subscriptions: true } })
    resolveARefresh()
    await expect(staleRequest).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    expect(fetch.mock.calls.map(([url]) => pathOf(url))).not.toContain('/api/data')
  })

  it('never sends data or media transport when fresh authority is blocked or malformed', async () => {
    const fetch = vi.fn(async url => response(String(url).endsWith('/api/access')
      ? access({ entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 2 } })
      : { state: {}, rev: 1 }))
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    await expect(api('/api/data', { method: 'PUT', body: '{}' })).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    const XHR = vi.fn(() => { throw new Error('upload must not start') })
    await expect(apiUpload('/api/media/a'.repeat(1), new Blob(['a']), 'image/webp', { XHR })).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    expect(XHR).not.toHaveBeenCalled()
    expect(fetch.mock.calls.map(([url]) => new URL(url, 'https://app.test').pathname)).toEqual(['/api/access', '/api/access', '/api/access'])
  })

  it('disposes account A authority before account B can use the central personal transport', async () => {
    let resolveA
    const firstAuthorityStarted = deferred()
    const fetch = vi.fn(async url => {
      if (!String(url).endsWith('/api/access')) return response({ state: {}, rev: 1 })
      if (!resolveA) {
        firstAuthorityStarted.resolve()
        return new Promise(resolve => { resolveA = () => resolve(response(access())) })
      }
      return response(access({ account: { id: 'account-b', activity: 'ACTIVE' }, requestId: 'access-b' }))
    })
    vi.stubGlobal('fetch', fetch)
    const first = activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    await firstAuthorityStarted.promise
    const second = activateManagedBridge({ account: { id: 'account-b' }, config: { managed_subscriptions: true } })
    resolveA()
    await Promise.all([first, second])
    await api('/api/data')
    expect(fetch.mock.calls.map(([url]) => new URL(url, 'https://app.test').pathname)).toEqual(['/api/access', '/api/access', '/api/access', '/api/data'])
  })

  it('queues fresh authority checks for concurrent protected requests and marks every allowed dispatch', async () => {
    const firstAuthorityStarted = deferred()
    const secondAuthorityStarted = deferred()
    const thirdAuthorityStarted = deferred()
    const firstAuthority = deferred()
    const secondAuthority = deferred()
    const thirdAuthority = deferred()
    let accessCalls = 0
    const fetch = vi.fn(url => {
      if (pathOf(url) !== '/api/access') return Promise.resolve(response({ ok: true }))
      accessCalls++
      if (accessCalls === 1) return Promise.resolve(response(access()))
      const queued = [
        [firstAuthorityStarted, firstAuthority, 'fresh-1'],
        [secondAuthorityStarted, secondAuthority, 'fresh-2'],
        [thirdAuthorityStarted, thirdAuthority, 'fresh-3'],
      ][accessCalls - 2]
      queued[0].resolve()
      return queued[1].promise.then(() => response(access({ requestId: queued[2] })))
    })
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })

    const first = api('/api/client/plan/current')
    const second = api('/api/client/sessions/current')
    const third = api('/api/client/bodyweight')
    await firstAuthorityStarted.promise
    expect(accessCalls).toBe(2)

    firstAuthority.resolve()
    await first
    await secondAuthorityStarted.promise
    expect(accessCalls).toBe(3)

    secondAuthority.resolve()
    await second
    await thirdAuthorityStarted.promise
    expect(accessCalls).toBe(4)

    thirdAuthority.resolve()
    await third
    const protectedCalls = fetch.mock.calls.filter(([url]) => pathOf(url) !== '/api/access')
    expect(protectedCalls.map(([url]) => pathOf(url))).toEqual([
      '/api/client/plan/current',
      '/api/client/sessions/current',
      '/api/client/bodyweight',
    ])
    expect(protectedCalls.map(headerOf)).toEqual(['1', '1', '1'])
  })

  it('serializes an initial authority check before an overlapping protected request check', async () => {
    const initialStarted = deferred()
    const requestStarted = deferred()
    const initialAuthority = deferred()
    const requestAuthority = deferred()
    let accessCalls = 0
    const fetch = vi.fn(url => {
      if (pathOf(url) !== '/api/access') return Promise.resolve(response({ state: {}, rev: 1 }))
      accessCalls++
      const queued = accessCalls === 1
        ? [initialStarted, initialAuthority, 'initial']
        : [requestStarted, requestAuthority, 'protected']
      queued[0].resolve()
      return queued[1].promise.then(() => response(access({ requestId: queued[2] })))
    })
    vi.stubGlobal('fetch', fetch)

    const initial = activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })
    const request = api('/api/data')
    await initialStarted.promise
    expect(accessCalls).toBe(1)

    initialAuthority.resolve()
    await initial
    await requestStarted.promise
    expect(accessCalls).toBe(2)
    requestAuthority.resolve()
    await request
    const protectedCall = fetch.mock.calls.find(([url]) => pathOf(url) === '/api/data')
    expect(headerOf(protectedCall)).toBe('1')
  })

  it('allows an earlier fresh request but denies a later queued request without its private GET', async () => {
    const firstStarted = deferred()
    const secondStarted = deferred()
    const firstAuthority = deferred()
    const secondAuthority = deferred()
    let accessCalls = 0
    const fetch = vi.fn(url => {
      if (pathOf(url) !== '/api/access') return Promise.resolve(response({ ok: true }))
      accessCalls++
      if (accessCalls === 1) return Promise.resolve(response(access()))
      const queued = accessCalls === 2 ? [firstStarted, firstAuthority] : [secondStarted, secondAuthority]
      queued[0].resolve()
      return queued[1].promise.then(value => response(value))
    })
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })

    const first = api('/api/client/plan/current')
    const second = api('/api/client/bodyweight')
    await firstStarted.promise
    expect(accessCalls).toBe(2)
    firstAuthority.resolve(access({ requestId: 'allowed-first' }))
    await first
    await secondStarted.promise
    secondAuthority.resolve(access({ entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 2 }, requestId: 'denied-second' }))
    await expect(second).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    expect(fetch.mock.calls.filter(([url]) => pathOf(url) !== '/api/access').map(([url]) => pathOf(url))).toEqual(['/api/client/plan/current'])
  })

  it('does not dispatch queued account-A requests after an account switch', async () => {
    const firstStarted = deferred()
    const firstAuthority = deferred()
    let accessCalls = 0
    const fetch = vi.fn(url => {
      if (pathOf(url) !== '/api/access') return Promise.resolve(response({ ok: true }))
      accessCalls++
      if (accessCalls === 1) return Promise.resolve(response(access({ account: { id: 'account-a', activity: 'ACTIVE' } })))
      if (accessCalls === 2) {
        firstStarted.resolve()
        return firstAuthority.promise.then(() => response(access({ account: { id: 'account-a', activity: 'ACTIVE' }, requestId: 'stale-a' })))
      }
      return Promise.resolve(response(access({ account: { id: 'account-b', activity: 'ACTIVE' }, requestId: 'initial-b' })))
    })
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })

    const first = api('/api/client/plan/current')
    const second = api('/api/client/bodyweight')
    await firstStarted.promise
    expect(accessCalls).toBe(2)
    const accountB = activateManagedBridge({ account: { id: 'account-b' }, config: { managed_subscriptions: true } })
    firstAuthority.resolve()
    await accountB
    await expect(Promise.all([first, second])).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    expect(accessCalls).toBe(3)
    expect(fetch.mock.calls.filter(([url]) => pathOf(url) !== '/api/access')).toHaveLength(0)
  })

  it('does not let a failed queued check authorize its request or poison a later fresh check', async () => {
    const firstStarted = deferred()
    const secondStarted = deferred()
    const firstAuthority = deferred()
    const secondAuthority = deferred()
    let accessCalls = 0
    const fetch = vi.fn(url => {
      if (pathOf(url) !== '/api/access') return Promise.resolve(response({ ok: true }))
      accessCalls++
      if (accessCalls === 1) return Promise.resolve(response(access()))
      const queued = accessCalls === 2 ? [firstStarted, firstAuthority] : [secondStarted, secondAuthority]
      queued[0].resolve()
      return queued[1].promise.then(value => {
        if (value instanceof Error) throw value
        return response(value)
      })
    })
    vi.stubGlobal('fetch', fetch)
    await activateManagedBridge({ account: { id: 'account-a' }, config: { managed_subscriptions: true } })

    const failed = api('/api/client/plan/current')
    const later = api('/api/client/bodyweight')
    await firstStarted.promise
    firstAuthority.resolve(new Error('authority unavailable'))
    await expect(failed).rejects.toMatchObject({ status: 403, code: 'managed-access-unverified' })
    await secondStarted.promise
    secondAuthority.resolve(access({ requestId: 'recovered' }))
    await later
    expect(fetch.mock.calls.filter(([url]) => pathOf(url) !== '/api/access').map(([url]) => pathOf(url))).toEqual(['/api/client/bodyweight'])
  })

  it('treats only the inventory of personal legacy paths as protected, leaving access and backoffice independent', () => {
    expect(isManagedProtectedPath('/api/data')).toBe(true)
    expect(isManagedProtectedPath('/api/media/hash')).toBe(true)
    expect(isManagedProtectedPath('/api/push/status')).toBe(true)
    expect(isManagedProtectedPath('/api/access')).toBe(false)
    expect(isManagedProtectedPath('/api/admin/operations/users')).toBe(false)
    personalClientRequests.forEach(([path]) => expect(isManagedProtectedPath(path)).toBe(true))
    nonPersonalClientRequests.forEach(([path]) => expect(isManagedProtectedPath(path)).toBe(false))
  })
})
