const PROTECTED_STATUSES = new Set([401, 403, 409, 426])
const ROLES = new Set(['CLIENT', 'TRAINER', 'COORDINATOR'])
const CAPABILITIES = new Set(['ACCESS_PERSONAL_TRAINING', 'MANAGE_OPERATIONAL_ROLES', 'MANAGE_COORDINATOR_SCOPE', 'CREATE_INVITATION', 'CONFIRM_RELATION', 'CHANGE_RELATION', 'CHANGE_GRANT', 'PUBLISH_PLAN', 'READ_CLIENT_PLAN', 'READ_OWN_EXECUTIONS', 'START_SESSION', 'FINISH_SESSION', 'READ_TRAINER_EXECUTIONS', 'CONFIRM_SUBSCRIPTION', 'READ_COMMERCIAL_CLIENTS', 'EXPORT_OWN_DATA', 'REQUEST_OWN_DELETION'])

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const cloneFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-JSON access value')
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('non-JSON access value')
    return value
  }
  if (seen.has(value)) throw new Error('cyclic access value')
  if (!Array.isArray(value) && !isPlain(value)) throw new Error('non-plain access value')
  seen.add(value)
  const result = Array.isArray(value) ? value.map(child => cloneFreeze(child, seen)) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneFreeze(child, seen)]))
  seen.delete(value)
  return Object.freeze(result)
}

const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
const literalUid = value => typeof value === 'string' && value.length >= 1 && value.length <= 128

function validateAccess(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'malformed-access' }
  if (!isPlain(value.account) || !literalUid(value.account.id)) return { ok: false, reason: 'malformed-access' }
  if (value.account.activity !== 'ACTIVE') return { ok: false, reason: 'inactive-identity' }
  if (typeof value.managedSubscriptions !== 'boolean' || !Array.isArray(value.roles) || value.roles.some(role => typeof role !== 'string' || !ROLES.has(role)) || !Array.isArray(value.capabilities) || value.capabilities.some(capability => typeof capability !== 'string' || !CAPABILITIES.has(capability)) || !value.entitlement || !isPlain(value.entitlement) || typeof value.entitlement.active !== 'boolean' || !Number.isSafeInteger(value.entitlement.version) || value.entitlement.version < 0 || !value.compatibility || !isPlain(value.compatibility) || value.compatibility.protectedTraining !== 'supported' || typeof value.requestId !== 'string' || value.requestId.length === 0 || !Array.isArray(value.versionTokens) || value.versionTokens.some(token => !isPlain(token) || typeof token.kind !== 'string' || token.kind.length === 0 || typeof token.key !== 'string' || token.key.length === 0 || !Number.isSafeInteger(token.version) || token.version < 0)) return { ok: false, reason: 'malformed-access' }
  const { startUtc, endExclusiveUtc } = value.entitlement
  if (value.entitlement.active ? !(utc(startUtc) && utc(endExclusiveUtc) && Date.parse(startUtc) < Date.parse(endExclusiveUtc)) : !(startUtc === null && endExclusiveUtc === null)) return { ok: false, reason: 'malformed-access' }
  if (value.compatibility.protectedTraining !== 'supported') return { ok: false, reason: 'unsupported-client' }
  if (!value.managedSubscriptions) return { ok: true }
  if (!value.roles.includes('CLIENT')) return { ok: false, reason: 'client-role-required' }
  if (value.entitlement.active !== true) return { ok: false, reason: 'not-entitled' }
  if (!value.capabilities.includes('ACCESS_PERSONAL_TRAINING')) return { ok: false, reason: 'personal-training-forbidden' }
  return { ok: true }
}

export function createAccessGate({ getAccess } = {}) {
  if (typeof getAccess !== 'function') throw new TypeError('getAccess is required')
  let generation = 0
  let state = Object.freeze({ status: 'unverified', reason: 'not-checked', generation })
  const set = next => { state = Object.freeze({ ...next, generation }); return state }

  async function refresh(reason = 'explicit') {
    const mine = ++generation
    state = Object.freeze({ status: 'unverified', reason: 'checking', generation: mine })
    try {
      const answer = await getAccess()
      if (mine !== generation) return state
      const decision = validateAccess(answer)
      if (!decision.ok) return set({ status: 'blocked', reason: decision.reason })
      try { return set({ status: 'allowed', reason: reason === 'explicit' ? 'authority-confirmed' : reason, access: cloneFreeze(answer) }) } catch { return set({ status: 'blocked', reason: 'malformed-access' }) }
    } catch (error) {
      if (mine !== generation) return state
      return set({ status: 'blocked', reason: error?.status ? `server-status-${error.status}` : 'authority-unavailable', error })
    }
  }

  return Object.freeze({
    getState: () => state,
    refresh,
    resetAccount: () => { generation++; return set({ status: 'unverified', reason: 'account-reset' }) },
    invalidate: (reason = 'invalidated') => { generation++; return set({ status: 'unverified', reason }) },
    noteHttpError: error => PROTECTED_STATUSES.has(error?.status) ? (generation++, set({ status: 'unverified', reason: `server-status-${error.status}` })) : state,
    canProceed: () => state.status === 'allowed',
  })
}

