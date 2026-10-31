const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BYTES = 2 * 1024 * 1024

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const validId = value => typeof value === 'string' && UUID_V4.test(value)
const clone = value => Array.isArray(value) ? value.map(clone) : plain(value) ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])) : value
const safeJson = (value, seen = new WeakSet()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && !plain(value))) throw new TypeError('client draft must contain JSON values')
  seen.add(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) safeJson(child, seen)
  seen.delete(value)
}
const canonical = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!plain(value)) throw new TypeError('client snapshot must be JSON')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
const corrupt = message => Object.assign(new Error(message), { code: 'corrupt-client-draft' })

export const clientTrainingDraftKey = ({ accountUid, serverSessionId, planVersionId, goalVersionId }) => {
  if (typeof accountUid !== 'string' || !accountUid || accountUid.length > 128 || !validId(serverSessionId) || !validId(planVersionId) || (goalVersionId !== null && !validId(goalVersionId))) throw new TypeError('invalid client draft scope')
  return `client-training-draft:${accountUid}:${serverSessionId}:${planVersionId}:${goalVersionId || 'none'}`
}

export function createClientTrainingDraftStore({ storage = globalThis.localStorage, accountUid, serverSessionId, planVersionId, goalVersionId = null, originalSnapshot } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') throw new TypeError('storage adapter is required')
  const key = clientTrainingDraftKey({ accountUid, serverSessionId, planVersionId, goalVersionId })
  if (!plain(originalSnapshot)) throw new TypeError('original snapshot is required')
  const fingerprint = canonical(originalSnapshot)
  const scope = { accountUid, serverSessionId, planVersionId, goalVersionId, originalSnapshot: clone(originalSnapshot) }
  const read = () => {
    const raw = storage.getItem(key)
    if (raw === null) return null
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw corrupt('corrupt client draft')
    let record
    try { record = JSON.parse(raw) } catch { throw corrupt('corrupt client draft') }
    if (!plain(record) || Object.keys(record).sort().join(',') !== 'accountUid,draft,goalVersionId,originalSnapshot,planVersionId,schemaVersion,serverSessionId' || record.schemaVersion !== 1 || record.accountUid !== accountUid || record.serverSessionId !== serverSessionId || record.planVersionId !== planVersionId || record.goalVersionId !== goalVersionId || !plain(record.draft)) throw corrupt('mismatched client draft')
    try { if (canonical(record.originalSnapshot) !== fingerprint) throw corrupt('stale client draft snapshot') } catch (error) { if (error?.code) throw error; throw corrupt('corrupt client draft snapshot') }
    return clone(record.draft)
  }
  return Object.freeze({
    key,
    save(draft) {
      if (!plain(draft)) throw new TypeError('client draft must be a plain object')
      safeJson(draft)
      const record = { schemaVersion: 1, ...scope, draft: clone(draft) }
      const encoded = JSON.stringify(record)
      if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) throw new RangeError('client draft exceeds bounded size')
      storage.setItem(key, encoded)
      return clone(record.draft)
    },
    recover: read,
    clear: () => storage.removeItem(key),
    inspect: () => { try { return { present: read() !== null, corrupt: false } } catch (error) { if (error?.code === 'corrupt-client-draft') return { present: true, corrupt: true, reason: error.message }; throw error } },
  })
}
