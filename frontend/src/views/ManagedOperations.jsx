import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const ROLES = Object.freeze(['CLIENT', 'TRAINER', 'COORDINATOR'])
const isId = value => typeof value === 'string' && value.length >= 1 && value.length <= 128

// The endpoint intentionally returns only these authority fields. Do not fill activity, names,
// scope membership, or versions from a personal profile/cache: each would be an authorization
// claim the server did not make.
export function parseOperationalUsers(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.users)) throw new TypeError('invalid operational users readback')
  return value.users.map(row => {
    if (!row || typeof row !== 'object' || !row.account || !isId(row.account.id) || !Array.isArray(row.roles) || row.roles.some(role => !ROLES.includes(role)) || !Number.isSafeInteger(row.version) || row.version < 0) throw new TypeError('invalid operational user')
    return Object.freeze({ id: row.account.id, roles: [...row.roles], version: row.version })
  })
}

export function parseOperationalScopes(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.scopes) || (typeof value.nextCursor !== 'string' && value.nextCursor !== null) || typeof value.requestId !== 'string' || !value.requestId) throw new TypeError('invalid operational scopes readback')
  return Object.freeze({
    scopes: Object.freeze(value.scopes.map(row => {
      if (!row || typeof row !== 'object' || !isId(row.coordinatorId) || !isId(row.clientId) || typeof row.assigned !== 'boolean' || !Number.isSafeInteger(row.version) || row.version < 0) throw new TypeError('invalid operational scope')
      return Object.freeze({ coordinatorId: row.coordinatorId, clientId: row.clientId, assigned: row.assigned, version: row.version })
    })),
    nextCursor: value.nextCursor,
    requestId: value.requestId,
  })
}

const uuid = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (typeof value !== 'string') throw new Error('No se pudo crear un identificador de operación seguro.')
  return value
}

export default function ManagedOperations({ client, access, reportHttpError }) {
  const navigate = useNavigate()
  const [load, setLoad] = useState({ kind: 'loading', users: [] })
  const [selectedId, setSelectedId] = useState('')
  const [roles, setRoles] = useState([])
  const [reason, setReason] = useState('')
  const [write, setWrite] = useState({ kind: 'idle', warning: '' })
  const [scopePair, setScopePair] = useState({ coordinatorId: '', clientId: '' })
  const [scopeLoad, setScopeLoad] = useState({ kind: 'idle', scope: null, nextCursor: null })
  const [scopeAssigned, setScopeAssigned] = useState(false)
  const [scopeReason, setScopeReason] = useState('')
  const [scopeWrite, setScopeWrite] = useState({ kind: 'idle', warning: '' })
  const attempt = useRef(null)
  const scopeAttempt = useRef(null)
  const scopeRead = useRef(0)
  const mayManage = access?.capabilities?.includes('MANAGE_OPERATIONAL_ROLES') === true

  const reload = async () => {
    setLoad(previous => ({ kind: 'loading', users: previous.users || [] }))
    try {
      const users = parseOperationalUsers(await client.getAdminUsers())
      setLoad({ kind: users.length ? 'ready' : 'empty', users })
    } catch (error) {
      reportHttpError?.(error)
      setLoad({ kind: error?.status === 401 || error?.status === 403 ? 'denied' : 'failure', users: [] })
    }
  }
  useEffect(() => { reload() }, [client])
  const selected = useMemo(() => load.users.find(user => user.id === selectedId) || null, [load.users, selectedId])
  const coordinatorCandidates = useMemo(() => load.users.filter(user => user.roles.includes('COORDINATOR') && user.id !== access?.account?.id), [load.users, access?.account?.id])
  const clientCandidates = useMemo(() => load.users.filter(user => user.roles.includes('CLIENT') && user.id !== access?.account?.id), [load.users, access?.account?.id])
  const choose = id => {
    const user = load.users.find(candidate => candidate.id === id)
    setSelectedId(id); setRoles(user?.roles || []); setWrite({ kind: 'idle', warning: '' }); attempt.current = null
  }
  const toggle = role => setRoles(current => current.includes(role) ? current.filter(value => value !== role) : [...current, role].sort())
  const submit = async () => {
    if (!selected || !reason.trim() || !mayManage) return
    const payload = { accountId: selected.id, roles: [...roles].sort(), reason: reason.trim() }
    const signature = JSON.stringify(payload)
    let operationId = attempt.current?.operationId
    let warning = ''
    if (attempt.current && attempt.current.signature !== signature) {
      operationId = undefined
      warning = 'Cambiaste la intención. Se creará una operación nueva; revisa y confirma de nuevo.'
    }
    try { operationId ||= uuid() } catch (error) { setWrite({ kind: 'failure', message: error.message, warning }); return }
    attempt.current = { operationId, signature }
    setWrite({ kind: 'saving', warning })
    try {
      await client.setOperationalRoles({ operationId, expectedVersion: selected.version, payload })
      attempt.current = null
      setWrite({ kind: 'success', warning: '' })
      await reload() // authority readback followed by a current list, never an optimistic role claim
    } catch (error) {
      reportHttpError?.(error)
      setWrite({ kind: error?.status === 409 ? 'conflict' : error?.status === 401 || error?.status === 403 ? 'denied' : 'uncertain', message: error?.message, warning })
    }
  }

  const readScope = async (coordinatorId, clientId) => {
    const readId = ++scopeRead.current
    setScopeLoad({ kind: 'loading', scope: null, nextCursor: null })
    try {
      const result = parseOperationalScopes(await client.getAdminScopes({ coordinatorId, clientId }))
      if (readId !== scopeRead.current) return
      const scope = result.scopes.find(row => row.coordinatorId === coordinatorId && row.clientId === clientId)
      if (!scope) throw new TypeError('scope pair missing from authorized readback')
      setScopeAssigned(scope.assigned)
      setScopeLoad({ kind: 'ready', scope, nextCursor: result.nextCursor })
      setScopeWrite({ kind: 'idle', warning: '' })
      scopeAttempt.current = null
    } catch (error) {
      if (readId !== scopeRead.current) return
      reportHttpError?.(error)
      setScopeLoad({ kind: error?.status === 401 || error?.status === 403 ? 'denied' : 'failure', scope: null, nextCursor: null })
    }
  }

  useEffect(() => {
    if (scopePair.coordinatorId && scopePair.clientId && mayManage) readScope(scopePair.coordinatorId, scopePair.clientId)
  }, [scopePair.coordinatorId, scopePair.clientId, mayManage, client])

  const submitScope = async () => {
    const scope = scopeLoad.scope
    if (!scope || !scopeReason.trim() || !scopePair.coordinatorId || !scopePair.clientId || !mayManage) return
    const payload = { coordinatorId: scopePair.coordinatorId, clientId: scopePair.clientId, assigned: scopeAssigned, reason: scopeReason.trim() }
    const signature = JSON.stringify(payload)
    let operationId = scopeAttempt.current?.operationId
    let warning = ''
    if (scopeAttempt.current && scopeAttempt.current.signature !== signature) {
      operationId = undefined
      warning = 'Cambiaste la intención. Se creará una operación nueva; revisa y confirma de nuevo.'
    }
    try { operationId ||= uuid() } catch (error) { setScopeWrite({ kind: 'failure', message: error.message, warning }); return }
    scopeAttempt.current = { operationId, signature }
    setScopeWrite({ kind: 'saving', warning })
    try {
      await client.setCoordinatorScope({ operationId, expectedVersion: scope.version, payload })
      await readScope(scopePair.coordinatorId, scopePair.clientId)
      scopeAttempt.current = null
      setScopeWrite({ kind: 'success', warning: '' })
    } catch (error) {
      reportHttpError?.(error)
      setScopeWrite({ kind: error?.status === 409 ? 'conflict' : error?.status === 401 || error?.status === 403 ? 'denied' : 'uncertain', message: error?.message, warning })
    }
  }

  if (!mayManage) return <section className="narrow"><h1>Administración operativa</h1><p className="muted">No tienes capacidad del servidor para gestionar roles operativos.</p></section>
  return <section className="narrow" data-managed-operations="true">
    <button className="back" onClick={() => navigate('/admin')}>‹ Administración</button>
    <h1>Administración operativa</h1>
    <p className="muted">Roles y ámbito comercial se validan en el servidor. No cambia el modelo de administrador existente.</p>
    {load.kind === 'loading' && <p aria-live="polite">Cargando cuentas autorizadas…</p>}
    {load.kind === 'empty' && <p>No hay cuentas operativas disponibles.</p>}
    {load.kind === 'denied' && <p role="alert">El servidor denegó la lectura de cuentas operativas.</p>}
    {load.kind === 'failure' && <p role="alert">No se pudieron cargar las cuentas. <button onClick={reload}>Reintentar</button></p>}
    {load.users.length > 0 && <>
      <label>Cuenta existente del servidor
        <select value={selectedId} onChange={event => choose(event.target.value)}>
          <option value="">Selecciona una cuenta</option>
          {load.users.map(user => <option key={user.id} value={user.id}>{user.id}</option>)}
        </select>
      </label>
      {selected && <>
        <p className="muted">Actividad: no publicada por este contrato. Roles actuales: {selected.roles.join(', ') || 'ninguno'}.</p>
        <fieldset><legend>Roles operativos</legend>{ROLES.map(role => <label key={role}><input type="checkbox" checked={roles.includes(role)} onChange={() => toggle(role)} /> {role}</label>)}</fieldset>
        <label>Motivo
          <textarea value={reason} maxLength={280} onChange={event => setReason(event.target.value)} />
        </label>
        {write.warning && <p role="alert">{write.warning}</p>}
        {write.kind === 'conflict' && <p role="alert">Conflicto de versión. Actualiza la lista y confirma de forma explícita; no se sobrescribió nada.</p>}
        {write.kind === 'uncertain' && <p role="alert">No se confirmó el resultado. Reintenta sin cambiar la intención para conservar el mismo identificador de operación.</p>}
        {write.kind === 'denied' && <p role="alert">El servidor denegó el cambio; se conservó el formulario.</p>}
        {write.kind === 'failure' && <p role="alert">{write.message || 'No se pudo preparar el cambio.'}</p>}
        {write.kind === 'success' && <p role="status">Roles confirmados por el servidor.</p>}
        <button className="btn" disabled={!reason.trim() || write.kind === 'saving'} onClick={submit}>{write.kind === 'uncertain' ? 'Reintentar misma operación' : 'Guardar roles'}</button>
        <button className="btn ghost" onClick={reload}>Actualizar y revisar</button>
      </>}
    </>}
    <hr />
    <h2>Ámbito de coordinación</h2>
    <p className="muted">Selecciona identidades existentes con rol operativo. La asignación y su versión se leen del servidor para este par exacto.</p>
    <label>Coordinador existente
      <select value={scopePair.coordinatorId} onChange={event => { setScopePair(pair => ({ ...pair, coordinatorId: event.target.value })); setScopeLoad({ kind: 'idle', scope: null, nextCursor: null }); setScopeWrite({ kind: 'idle', warning: '' }) }}>
        <option value="">Selecciona un coordinador</option>
        {coordinatorCandidates.map(user => <option key={user.id} value={user.id}>{user.id}</option>)}
      </select>
    </label>
    <label>Cliente existente
      <select value={scopePair.clientId} onChange={event => { setScopePair(pair => ({ ...pair, clientId: event.target.value })); setScopeLoad({ kind: 'idle', scope: null, nextCursor: null }); setScopeWrite({ kind: 'idle', warning: '' }) }}>
        <option value="">Selecciona un cliente</option>
        {clientCandidates.map(user => <option key={user.id} value={user.id}>{user.id}</option>)}
      </select>
    </label>
    {scopeLoad.kind === 'loading' && <p aria-live="polite">Leyendo ámbito…</p>}
    {scopeLoad.kind === 'denied' && <p role="alert">El servidor denegó la lectura del ámbito.</p>}
    {scopeLoad.kind === 'failure' && <p role="alert">No se pudo leer el ámbito. <button onClick={() => readScope(scopePair.coordinatorId, scopePair.clientId)}>Reintentar</button></p>}
    {scopeLoad.scope && <>
      <p className="muted">Estado actual: {scopeLoad.scope.assigned ? 'Asignado' : 'Sin asignar'} · versión {scopeLoad.scope.version}.</p>
      <label><input data-scope-assigned type="checkbox" checked={scopeAssigned} onChange={event => setScopeAssigned(event.target.checked)} /> Asignar este par</label>
      <label>Motivo
        <textarea value={scopeReason} maxLength={280} onChange={event => setScopeReason(event.target.value)} />
      </label>
      {scopeWrite.warning && <p role="alert">{scopeWrite.warning}</p>}
      {scopeWrite.kind === 'conflict' && <p role="alert">Conflicto de versión. Actualiza el par y confirma de forma explícita; no se sobrescribió nada.</p>}
      {scopeWrite.kind === 'uncertain' && <p role="alert">No se confirmó el resultado. Reintenta sin cambiar la intención para conservar el mismo identificador de operación.</p>}
      {scopeWrite.kind === 'denied' && <p role="alert">El servidor denegó el cambio; se conservó el formulario.</p>}
      {scopeWrite.kind === 'failure' && <p role="alert">{scopeWrite.message || 'No se pudo preparar el cambio.'}</p>}
      {scopeWrite.kind === 'success' && <p role="status">Ámbito confirmado por el servidor.</p>}
      <button className="btn" disabled={!scopeReason.trim() || scopeWrite.kind === 'saving'} onClick={submitScope}>{scopeWrite.kind === 'uncertain' ? 'Reintentar misma operación' : 'Guardar ámbito'}</button>
      <button className="btn ghost" onClick={() => readScope(scopePair.coordinatorId, scopePair.clientId)}>Actualizar y revisar</button>
    </>}
  </section>
}
