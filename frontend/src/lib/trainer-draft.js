const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BYTES = 2 * 1024 * 1024
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const jsonSafe = (value, seen = new WeakSet()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && !isPlain(value))) throw new TypeError('trainer draft must contain only JSON values')
  if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) throw new TypeError('trainer draft must contain only JSON values')
  seen.add(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) jsonSafe(child, seen)
  seen.delete(value)
}
const clone = value => Array.isArray(value) ? value.map(clone) : isPlain(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])) : value
const byteLength = value => new TextEncoder().encode(value).byteLength
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } return value }
const validUuid = value => typeof value === 'string' && UUID_V4.test(value)
const corrupt = message => Object.assign(new Error(message), { code: 'corrupt-draft' })

export const draftStorageKey = (accountUid, serverSessionId, planVersionId) => `trainer-draft:${accountUid}:${serverSessionId}:${planVersionId}`

function assertScope(accountUid, serverSessionId, planVersionId) {
  if (typeof accountUid !== 'string' || accountUid.length < 1 || accountUid.length > 128) throw new TypeError('account UID must be literal and non-empty')
  if (!validUuid(serverSessionId) || !validUuid(planVersionId)) throw new TypeError('server session and plan version IDs must be UUID v4')
}

function validateRecord(record, scope) {
  if (!isPlain(record)) throw corrupt('corrupt trainer draft')
  const keys = Object.keys(record).sort().join(',')
  if (keys !== 'accountUid,draft,planVersionId,schemaVersion,serverSessionId') throw corrupt('unknown trainer draft field')
  if (record.schemaVersion !== 1 || record.accountUid !== scope.accountUid || record.serverSessionId !== scope.serverSessionId || record.planVersionId !== scope.planVersionId || !isPlain(record.draft)) throw corrupt('mismatched or malformed trainer draft')
  return record
}

export function createTrainerDraftStore({ storage = globalThis.localStorage, accountUid, serverSessionId, planVersionId } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new TypeError('storage adapter is required')
  assertScope(accountUid, serverSessionId, planVersionId)
  const scope = { accountUid, serverSessionId, planVersionId }
  const key = draftStorageKey(accountUid, serverSessionId, planVersionId)
  const read = () => {
    const raw = storage.getItem(key)
    if (raw === null) return null
    if (typeof raw !== 'string' || byteLength(raw) > MAX_BYTES) throw corrupt('corrupt trainer draft')
    let record
    try { record = JSON.parse(raw) } catch { throw corrupt('corrupt trainer draft') }
    return validateRecord(record, scope)
  }
  return Object.freeze({
    key,
    save(draft) {
      if (!isPlain(draft)) throw new TypeError('trainer draft must be a plain object')
      jsonSafe(draft)
      const record = { schemaVersion: 1, ...scope, draft: clone(draft) }
      const encoded = JSON.stringify(record)
      if (byteLength(encoded) > MAX_BYTES) throw new RangeError('trainer draft exceeds bounded size')
      storage.setItem(key, encoded)
      return clone(record.draft)
    },
    recover() {
      const record = read()
      return record ? clone(record.draft) : null
    },
    inspect() {
      try { return { present: read() !== null, corrupt: false } } catch (error) { if (error?.code !== 'corrupt-draft') throw error; return { present: true, corrupt: true, reason: error.message } }
    },
    clear() { storage.removeItem(key) },
  })
}

