/* M1 client-side bridge for legacy personal transports.
 *
 * The server remains authoritative.  This module only makes it impossible for the existing
 * store/media/background callers to send private legacy requests before a fresh /api/access
 * decision.  It intentionally has no cached allow path: a stored hint may deny a retry, never
 * authorize it.  M0 and native retain their current behaviour.
 */
import { MOBILE } from './mobile.js'
import { api, setManagedTransportGuard } from './api.js'
import { createAuthorityApi } from './authority-api.js'
import { createAccessGate } from './access-gate.js'

// Keep this exact inventory aligned with api/server.js personalClientRoutes.  The other
// /api/client/ routes are relationship, consent, export, deletion, or abandon operations and
// intentionally remain available without the current personal-training entitlement.
const personalClientPaths = new Set([
  '/api/client/plan/current',
  '/api/client/sessions/current',
  '/api/client/sessions/start',
  '/api/client/sessions/finish',
  '/api/client/executions',
  '/api/client/bodyweight',
])

const protectedPath = path => {
  const clean = String(path || '').split('?')[0]
  return clean === '/api/data' || clean === '/api/data/rev' || clean === '/api/nudge-check' ||
    clean === '/api/activity' || clean.startsWith('/api/media/') || clean.startsWith('/api/push/') ||
    clean.startsWith('/api/coach/') || personalClientPaths.has(clean)
}

export const managedWeb = config => !MOBILE && config?.managed_subscriptions === true
export const managedModeHintFromBuild = value => value === '1'
export const managedModeHint = () => !MOBILE && managedModeHintFromBuild(import.meta.env.VITE_MANAGED_SUBSCRIPTIONS_HINT)
// This seam is intentionally compile-time rather than persisted. A past visit must not affect a
// later account, and a hint never authorizes a role, entitlement, guest session, or transport.
export const rememberManagedMode = () => {}
// Until current public config verifies M0 or M1, a web build explicitly marked M1 remains closed.
export const managedWebOrDeniedHint = config => managedWeb(config) || (!config && managedModeHint())
const blocked = state => Object.assign(new Error('Managed personal access is not verified.'), {
  code: 'managed-access-unverified', status: 403, managedAccess: state?.reason || 'not-checked',
})

let current = null
const purgeManagedShell = () => {
  // The worker never caches /api/, but its shell contains lazy private view chunks.  In M1 a
  // logout/switch/denial removes that shell cache instead of presenting an old protected screen
  // offline.  M0 never installs this bridge, so its upstream offline cache is untouched.
  globalThis.navigator?.serviceWorker?.controller?.postMessage?.({ type: 'PURGE_MANAGED_PRIVATE_CACHE' })
}

function queueFreshCheck(bridge, reason) {
  const check = bridge.authorityQueue.then(async () => {
    // A queued check belongs to this bridge/account.  Once it has been replaced, it must not
    // make another authority request or let its guarded operation reach the legacy transport.
    if (!bridge.alive || current !== bridge) return bridge.gate.getState()
    return bridge.gate.refresh(reason)
  })
  // Gate refresh normally resolves to a blocked state, but retain a live queue if an unexpected
  // authority implementation failure rejects.
  bridge.authorityQueue = check.catch(() => undefined)
  return check
}

function install(currentBridge) {
  const guard = async (path, opts = {}) => {
    if (current !== currentBridge || !protectedPath(path)) return
    // Always revalidate immediately before a protected legacy operation.  A prior response,
    // local role cache or subscription hint cannot authorize a data pull/push/upload.
    const state = await queueFreshCheck(currentBridge, 'protected-request')
    if (!currentBridge.alive || state.status !== 'allowed') { purgeManagedShell(); throw blocked(state) }
    // The server checks this marker only after this same fresh authority decision.  It is added
    // here rather than at call sites so the guarded keepalive transport cannot omit it.
    opts.headers = Object.assign({}, opts.headers, { 'X-OpenGym-Contract-Version': '1' })
  }
  guard.noteHttpError = error => {
    if (current !== currentBridge) return
    const before = currentBridge.gate.getState().generation
    const after = currentBridge.gate.noteHttpError(error)
    if (after.generation !== before && typeof CustomEvent === 'function') {
      purgeManagedShell()
      globalThis.dispatchEvent?.(new CustomEvent('opengym-managed-access-invalidated', { detail: { accountId: currentBridge.accountId, reason: after.reason } }))
    }
  }
  setManagedTransportGuard(guard)
}

/** Configure synchronously (so a following pull cannot escape) and return its fresh check. */
export function activateManagedBridge({ account, config } = {}) {
  const hinted = !config && managedModeHint()
  if ((!managedWeb(config) && !hinted) || !account?.id) return deactivateManagedBridge()
  if (current?.alive && current.accountId === account.id && current.hinted === hinted) return current.check
  deactivateManagedBridge()
  const client = createAuthorityApi({ transport: api })
  // No current config means an M1 build hint blocks. It does not probe access and turn that hint
  // into an allow decision; the next successful config refresh replaces this bridge.
  const getAccess = hinted ? async () => { throw Object.assign(new Error('managed config unavailable'), { code: 'managed-config-unverified' }) } : client.getAccess
  const bridge = { accountId: account.id, client, gate: createAccessGate({ getAccess }), alive: true, hinted, check: null, authorityQueue: Promise.resolve() }
  current = bridge
  install(bridge)
  bridge.check = queueFreshCheck(bridge, 'authenticated-entry')
  return bridge.check
}

export function deactivateManagedBridge() {
  if (current) {
    current.alive = false
    current.gate.resetAccount()
    current.client.dispose()
    purgeManagedShell()
  }
  current = null
  setManagedTransportGuard(null)
  return Promise.resolve(null)
}

export const managedBridgeState = () => current?.gate.getState() || Object.freeze({ status: 'unverified', reason: 'not-managed' })
export const managedBridgeActive = () => !!current?.alive

// Exposed for focused controlled-transport tests; app callers only use the central api seam.
export const isManagedProtectedPath = protectedPath
