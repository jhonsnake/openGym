import { api as defaultTransport } from './api.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export const isUuidV4 = value => typeof value === 'string' && UUID_V4.test(value)

function secureUuidV4() {
  const value = globalThis.crypto?.randomUUID?.()
  if (!isUuidV4(value)) throw new Error('secure UUID v4 generation is unavailable')
  return value
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  throw new TypeError('mutation payload must contain only JSON values')
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freeze(child, seen)
  return Object.freeze(value)
}

function attemptedPayload(value) {
  return freeze(clone(value))
}

function validateReceipt(value) {
  if (!isObject(value) || typeof value.requestId !== 'string' || !value.requestId) throw new Error('invalid authority mutation readback')
  if (!isObject(value.entity) || typeof value.entity.type !== 'string' || typeof value.entity.id !== 'string' || !Number.isSafeInteger(value.entity.version) || value.entity.version < 1) throw new Error('invalid authority mutation readback entity')
  if (!Array.isArray(value.versionTokens) || value.versionTokens.some(token => !isObject(token) || typeof token.kind !== 'string' || typeof token.key !== 'string' || !Number.isSafeInteger(token.version) || token.version < 0)) throw new Error('invalid authority mutation readback version tokens')
  if (typeof value.operationId !== 'string' || !isUuidV4(value.operationId)) throw new Error('invalid authority mutation readback operation')
  return value
}

const json = value => JSON.stringify(value)
const get = (transport, path) => transport(path, { method: 'GET' })

export function createAuthorityApi({ transport = defaultTransport } = {}) {
  if (typeof transport !== 'function') throw new TypeError('authority transport must be a function')
  const attempts = new Map()
  let disposed = false

  async function mutation(path, expectedVersion, payload, operationId = secureUuidV4()) {
    if (disposed) throw new Error('authority API is disposed; create a new client for the account')
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new RangeError('expectedVersion must be a non-negative safe integer')
    if (!isUuidV4(operationId)) throw new TypeError('operationId must be UUID v4')
    const body = Object.freeze({ operationId, expectedVersion, payload: attemptedPayload(payload) })
    const signature = `${path}|${expectedVersion}|${canonicalJson(body.payload)}`
    const previous = attempts.get(operationId)
    if (previous && previous.signature !== signature) throw new Error('contradictory mutation intent for operationId')
    const attempt = previous || { path, body: clone(body), signature }
    if (!previous) attempts.set(operationId, attempt)
    const response = await transport(path, { method: 'POST', body: json(attempt.body) })
    const checked = validateReceipt(response)
    if (checked.operationId !== operationId) throw new Error('authority mutation readback operation mismatch')
    attempts.delete(operationId)
    return checked
  }

  async function retry(operationId) {
    if (disposed) throw new Error('authority API is disposed; create a new client for the account')
    if (!isUuidV4(operationId) || !attempts.has(operationId)) throw new TypeError('unknown operationId; changed intent requires a new operationId')
    const { path, body } = attempts.get(operationId)
    const response = await transport(path, { method: 'POST', body: json(clone(body)) })
    const checked = validateReceipt(response)
    if (checked.operationId !== operationId) throw new Error('authority mutation retry operation mismatch')
    attempts.delete(operationId)
    return checked
  }

  const wrap = (path, kind) => ({ expectedVersion, payload, operationId }) => mutation(path, expectedVersion, payload, operationId)
  const relation = action => wrap(`/api/${action === 'confirm' ? 'trainer' : action === 'revoke' || action === 'reactivate-accept' ? 'client' : 'trainer'}/relations/${action}`, 'relation')
  const changeRelation = (action, options) => relation(action)(options)

  // Recreate this client per account, or call clearAttempts() before switching accounts.
  const clearAttempts = () => attempts.clear()
  const dispose = () => { clearAttempts(); disposed = true }

  return Object.freeze({
    getAccess: () => get(transport, '/api/access'),
    getAdminUsers: () => get(transport, '/api/admin/operations/users'),
    getTrainerPortfolio: () => get(transport, '/api/trainer/portfolio'),
    getTrainerRelations: () => get(transport, '/api/trainer/relations'),
    getCommercialClients: () => get(transport, '/api/admin/commercial/clients'),
    getClientPlan: () => get(transport, '/api/client/plan/current'),
    getClientExecutions: ({ cursor } = {}) => get(transport, `/api/client/executions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    getTrainerExecutions: ({ cursor } = {}) => get(transport, `/api/trainer/executions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    getTrainerHistory: ({ relationId, grantId, cursor } = {}) => {
      const params = new URLSearchParams()
      if (relationId) params.set('relationId', relationId)
      if (grantId) params.set('grantId', grantId)
      if (cursor) params.set('cursor', cursor)
      return get(transport, `/api/trainer/history${params.size ? `?${params}` : ''}`)
    },
    getClientBodyweight: () => get(transport, '/api/client/bodyweight'),
    getTrainerBodyweight: ({ relationId, cursor } = {}) => get(transport, `/api/trainer/bodyweight?${new URLSearchParams({ ...(relationId ? { relationId } : {}), ...(cursor ? { cursor } : {}) })}`),
    previewInvitation: token => transport('/api/invitations/preview', { method: 'POST', body: json({ token }) }),
    createInvitation: wrap('/api/trainer/invitations', 'invitation'),
    replaceInvitation: wrap('/api/trainer/invitations/replace', 'invitationReplace'),
    acceptInvitation: wrap('/api/invitations/accept', 'acceptInvitation'),
    rejectInvitation: wrap('/api/invitations/reject', 'invitationToken'),
    revokeInvitation: wrap('/api/trainer/invitations/revoke', 'invitationRevoke'),
    confirmRelation: relation('confirm'),
    changeRelation,
    revokeRelation: relation('revoke'),
    suspendRelation: relation('suspend'),
    endRelation: relation('end'),
    requestRelationReactivation: relation('reactivate-request'),
    acceptRelationReactivation: relation('reactivate-accept'),
    replaceGrants: wrap('/api/client/relations/grants/replace', 'grant'),
    revokeGrant: wrap('/api/client/relations/grants/revoke', 'grantRevoke'),
    confirmCommercialOperation: wrap('/api/admin/commercial/operations/confirm', 'commercial'),
    publishPlan: wrap('/api/trainer/plans/publish', 'plan'),
    startSession: wrap('/api/client/sessions/start', 'sessionStart'),
    finishSession: wrap('/api/client/sessions/finish', 'execution'),
    postBodyweight: wrap('/api/client/bodyweight', 'bodyweight'),
    retry,
    clearAttempts,
    dispose,
  })
}

