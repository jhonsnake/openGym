import { useEffect, useRef, useState } from 'react'

const KINDS = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM']
const emptyForm = { clientId: '', kind: 'MONTHLY', reference: '', reason: '', customStartPanama: '', customEndPanamaInclusive: '' }

const readError = error => error?.status === 401 || error?.status === 403 ? 'denied' : 'failure'
const isUuidV4 = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const secureUuidV4 = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (!isUuidV4(value)) throw new Error('No se pudo crear un identificador seguro de operación.')
  return value
}
const formatPanama = value => {
  if (!value) return 'sin fecha publicada'
  try { return new Intl.DateTimeFormat('es-PA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Panama' }).format(new Date(value)) + ' (America/Panama)' } catch { return value }
}
const formatDateLiteral = value => value ? `${value} (calendario America/Panama)` : 'sin fecha publicada'
const subscriptionKey = clientId => JSON.stringify([clientId])
const safeVersion = value => Number.isSafeInteger(value) && value >= 0
const nullableNonemptyString = value => value === null || (typeof value === 'string' && value.length > 0)

function readSubscriptionToken(tokens, clientId) {
  const matches = Array.isArray(tokens) ? tokens.filter(candidate => candidate?.kind === 'SUBSCRIPTION' && candidate.key === subscriptionKey(clientId)) : []
  const [token] = matches
  if (matches.length !== 1 || !safeVersion(token.version)) throw new TypeError('invalid commercial subscription version')
  return token.version
}

function receiptExpectation(response, intent) {
  const result = response?.result
  if (response?.operationId !== intent.operationId || !result || result.clientId !== intent.payload.clientId) throw new TypeError('commercial receipt does not identify the attempted client')
  const interval = result.interval
  const entitlement = result.entitlement
  if (!interval || typeof interval.startUtc !== 'string' || typeof interval.endExclusiveUtc !== 'string' || !entitlement || typeof entitlement.active !== 'boolean' || entitlement.startUtc !== interval.startUtc || entitlement.endExclusiveUtc !== interval.endExclusiveUtc) throw new TypeError('invalid commercial receipt interval')
  const version = readSubscriptionToken(response.versionTokens, intent.payload.clientId)
  if (version <= intent.expectedVersion) throw new TypeError('commercial receipt did not advance the subscription version')
  return { clientId: result.clientId, interval, active: entitlement.active, version }
}

export function parseCommercialReadback(value) {
  if (!value || !Array.isArray(value.clients) || (value.nextCursor !== null && typeof value.nextCursor !== 'string') || typeof value.requestId !== 'string' || !value.requestId || !Array.isArray(value.versionTokens)) throw new TypeError('invalid commercial clients readback')
  for (const row of value.clients) {
    if (!row || typeof row.clientId !== 'string' || !row.clientId || !row.entitlement || typeof row.entitlement.active !== 'boolean' || !safeVersion(row.entitlement.version) || !nullableNonemptyString(row.entitlement.startUtc) || !nullableNonemptyString(row.entitlement.endExclusiveUtc) || readSubscriptionToken(value.versionTokens, row.clientId) !== row.entitlement.version) throw new TypeError('invalid commercial client row')
  }
  return { clients: value.clients, nextCursor: value.nextCursor ?? null, versionTokens: value.versionTokens }
}

export default function Commercial({ client, access, reportHttpError }) {
  const mayCoordinate = access?.roles?.includes('COORDINATOR') === true
  const [read, setRead] = useState({ kind: mayCoordinate ? 'loading' : 'denied', clients: [], cursor: null })
  const [form, setForm] = useState(emptyForm)
  const [write, setWrite] = useState({ kind: 'idle', message: '' })
  const [confirmed, setConfirmed] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const generation = useRef(0)
  const scopeGeneration = useRef(0)
  const pending = useRef(null)

  const getClients = async cursor => {
    if (typeof client.getCommercialClients !== 'function') throw Object.assign(new Error('Integración pendiente: falta client.getCommercialClients({ cursor }).'), { code: 'integration-seam' })
    return parseCommercialReadback(cursor === null ? await client.getCommercialClients() : await client.getCommercialClients({ cursor }))
  }
  const load = async (cursor = null, append = false) => {
    const current = ++generation.current
    setRead(previous => ({ ...previous, kind: 'loading' }))
    try {
      const parsed = await getClients(cursor)
      if (current !== generation.current) return
      setRead(previous => ({ kind: 'ready', clients: append ? [...previous.clients, ...parsed.clients] : parsed.clients, cursor: parsed.nextCursor }))
    } catch (error) {
      if (current !== generation.current) return
      reportHttpError?.(error)
      setRead(previous => previous.clients.length ? { ...previous, kind: 'stale' } : { kind: readError(error), clients: [], cursor: null })
    }
  }

  useEffect(() => {
    generation.current += 1
    scopeGeneration.current += 1
    pending.current = null
    client.clearAttempts?.()
    setForm(emptyForm)
    setConfirmed(false)
    setReceipt(null)
    setWrite({ kind: 'idle', message: '' })
    setRead({ kind: mayCoordinate ? 'loading' : 'denied', clients: [], cursor: null })
    if (mayCoordinate) load()
  }, [client, mayCoordinate])

  const selected = read.clients.find(row => row.clientId === form.clientId)
  const setField = (name, value) => setForm(current => ({ ...current, [name]: value }))
  const buildPayload = () => {
    const payload = { clientId: form.clientId, kind: form.kind, reference: form.reference.trim(), reason: form.reason.trim() }
    if (form.kind === 'CUSTOM') {
      payload.customStartPanama = form.customStartPanama
      payload.customEndPanamaInclusive = form.customEndPanamaInclusive
    }
    return payload
  }
  const valid = selected && form.reference.trim().length >= 1 && form.reference.trim().length <= 160 && form.reason.trim().length >= 1 && form.reason.trim().length <= 2000
    && (form.kind !== 'CUSTOM' || (/^\d{4}-\d{2}-\d{2}$/.test(form.customStartPanama) && /^\d{4}-\d{2}-\d{2}$/.test(form.customEndPanamaInclusive)))
  const currentAttempt = (intent, scope) => scope === scopeGeneration.current && pending.current === intent
  const uncertain = (intent, scope, error, message = 'Resultado incierto. Reintenta la misma intención o cancélala antes de editar.') => {
    if (!currentAttempt(intent, scope)) return
    reportHttpError?.(error)
    setReceipt(null)
    setRead(previous => previous.clients.length ? { ...previous, kind: 'stale' } : { ...previous, kind: 'failure' })
    setWrite({ kind: 'uncertain', message })
  }
  const readTarget = async (expected, scope) => {
    let cursor = null
    let clients = []
    do {
      const parsed = await getClients(cursor)
      if (scope !== scopeGeneration.current) return null
      clients = [...clients, ...parsed.clients]
      const row = parsed.clients.find(candidate => candidate.clientId === expected.clientId)
      if (row) return { clients, cursor: parsed.nextCursor, row }
      cursor = parsed.nextCursor
    } while (cursor)
    throw new TypeError('commercial readback omitted the attempted client')
  }
  const finish = async (response, intent, scope) => {
    let expected
    try { expected = receiptExpectation(response, intent) }
    catch (error) { uncertain(intent, scope, error); return }
    try {
      const proof = await readTarget(expected, scope)
      if (!proof || !currentAttempt(intent, scope)) return
      const row = proof.row
      if (row.entitlement.startUtc !== expected.interval.startUtc || row.entitlement.endExclusiveUtc !== expected.interval.endExclusiveUtc || row.entitlement.active !== expected.active || row.entitlement.version !== expected.version) throw new TypeError('commercial readback does not match receipt')
      pending.current = null
      setRead({ kind: 'ready', clients: proof.clients, cursor: proof.cursor })
      setReceipt(response.result)
      setWrite({ kind: 'success', message: 'Operación confirmada por el servidor.' })
    } catch (error) { uncertain(intent, scope, error) }
  }
  const submit = async event => {
    event.preventDefault()
    if (!mayCoordinate || !valid || !confirmed || write.kind === 'saving' || pending.current) return
    const payload = buildPayload()
    let operationId
    try { operationId = secureUuidV4() } catch (error) { reportHttpError?.(error); setWrite({ kind: 'failure', message: error.message }); return }
    const intent = { operationId, expectedVersion: selected.entitlement.version, payload }
    pending.current = intent
    const scope = scopeGeneration.current
    setWrite({ kind: 'saving', message: '' })
    try { await finish(await client.confirmCommercialOperation(intent), intent, scope) }
    catch (error) {
      if (!currentAttempt(intent, scope)) return
      reportHttpError?.(error)
      if (error?.status === 409) { pending.current = null; await load(); if (scope === scopeGeneration.current) setWrite({ kind: 'conflict', message: 'Conflicto de versión. Se actualizó la autoridad; revisa y confirma de nuevo.' }) }
      else if (error?.status === 401 || error?.status === 403 || error?.status === 410) { pending.current = null; await load(); if (scope === scopeGeneration.current) setWrite({ kind: error?.status === 410 ? 'conflict' : 'denied', message: error?.status === 410 ? 'La autorización o la sesión expiró; revisa la autoridad actual.' : 'El servidor denegó esta operación; se conservó el formulario.' }) }
      else setWrite({ kind: 'uncertain', message: 'Resultado incierto. Reintenta la misma intención o cancélala antes de editar.' })
    }
  }
  const retry = async () => {
    const intent = pending.current
    if (!intent || typeof client.confirmCommercialOperation !== 'function') return
    const scope = scopeGeneration.current
    setWrite({ kind: 'saving', message: '' })
    try { await finish(await client.confirmCommercialOperation(intent), intent, scope) }
    catch (error) { uncertain(intent, scope, error, 'El resultado sigue incierto. Reintenta la misma operación o cancélala.') }
  }
  const cancel = () => { pending.current = null; setWrite({ kind: 'idle', message: '' }) }

  if (!mayCoordinate) return <section className="narrow" data-commercial-unit="true"><h1>Operaciones comerciales</h1><p>No tienes el rol COORDINATOR para acceder a esta vista.</p></section>
  const locked = !!pending.current || write.kind === 'saving'
  return <section className="narrow" data-commercial-unit="true">
    <h1>Operaciones comerciales</h1>
    <p className="muted">Backoffice del coordinador. El servidor determina los clientes asignados y la autoridad vigente.</p>
    {read.kind === 'loading' && <p aria-live="polite">Cargando clientes asignados…</p>}
    {read.kind === 'denied' && <p role="alert">El servidor denegó esta lectura.</p>}
    {read.kind === 'failure' && <p role="alert">No se pudo cargar la vista. <button onClick={() => load()}>Reintentar</button></p>}
    {read.kind === 'stale' && <p role="alert">La metadata visible puede estar desactualizada; la operación sigue sin confirmación.</p>}
    {(read.kind === 'ready' || read.kind === 'stale') && <>
      <h2>Clientes asignados</h2>
      {read.clients.length === 0 ? <p>No hay clientes asignados en este alcance.</p> : <ul>{read.clients.map(row => <li key={row.clientId}><button type="button" className="ghost" onClick={() => { setField('clientId', row.clientId); setConfirmed(false) }}>{row.clientId}</button> · {row.entitlement.active ? 'Activa ahora' : row.entitlement.startUtc && new Date(row.entitlement.startUtc) > new Date() ? 'Programada futura' : 'No activa'} · versión {row.entitlement.version}</li>)}</ul>}
      {read.cursor && <button className="btn ghost" type="button" onClick={() => load(read.cursor, true)}>Cargar más clientes</button>}
      <h2>Confirmar intervalo</h2>
      <form onSubmit={submit}>
        <label>Cliente seleccionado<select value={form.clientId} disabled={locked} onChange={event => { setField('clientId', event.target.value); setConfirmed(false) }}><option value="">Selecciona un cliente asignado</option>{read.clients.map(row => <option key={row.clientId} value={row.clientId}>{row.clientId}</option>)}</select></label>
        {selected && <p>Versión de autoridad: {selected.entitlement.version}. Estado actual: {selected.entitlement.active ? 'activa' : 'no activa'}.</p>}
        <label>Tipo<select value={form.kind} disabled={locked} onChange={event => { setField('kind', event.target.value); setConfirmed(false) }}>{KINDS.map(kind => <option key={kind}>{kind}</option>)}</select></label>
        <label>Referencia del registro externo<input value={form.reference} maxLength={160} minLength={1} disabled={locked} onChange={event => setField('reference', event.target.value)} /></label>
        <label>Razón<input value={form.reason} maxLength={2000} minLength={1} disabled={locked} onChange={event => setField('reason', event.target.value)} /></label>
        {form.kind === 'CUSTOM' && <fieldset><legend>Fechas inclusivas de calendario America/Panama</legend><label>Inicio<input type="date" value={form.customStartPanama} disabled={locked} onChange={event => setField('customStartPanama', event.target.value)} /></label><label>Fin inclusivo<input type="date" value={form.customEndPanamaInclusive} disabled={locked} onChange={event => setField('customEndPanamaInclusive', event.target.value)} /></label><p>El servidor devolverá el fin UTC exclusivo; no se calcula en el navegador.</p></fieldset>}
        <label><input type="checkbox" checked={confirmed} disabled={locked || !valid} onChange={event => setConfirmed(event.target.checked)} /> Confirmo explícitamente este cliente, tipo, referencia y razón.</label>
        <button className="btn" disabled={locked || !valid || !confirmed}>Confirmar operación</button>
      </form>
    </>}
    {receipt?.interval && <article role="status"><h2>Recibo confirmado</h2><p>Intervalo devuelto por el servidor: {formatPanama(receipt.interval.startUtc)} a {formatPanama(receipt.interval.endExclusiveUtc)} (fin UTC exclusivo).</p><p>Estado del recibo: {receipt.entitlement?.active ? 'Activa ahora' : receipt.entitlement?.startUtc && new Date(receipt.entitlement.startUtc) > new Date() ? 'Programada futura' : 'No activa actualmente'}.</p></article>}
    {write.kind === 'uncertain' && <div role="alert"><p>{write.message}</p><button type="button" className="btn" onClick={retry}>Reintentar misma operación</button><button type="button" className="btn ghost" onClick={cancel}>Cancelar intención (requiere nueva confirmación)</button></div>}
    {write.kind === 'conflict' && <p role="alert">{write.message}</p>}{write.kind === 'denied' && <p role="alert">{write.message}</p>}{write.kind === 'failure' && <p role="alert">{write.message}</p>}{write.kind === 'success' && <p role="status">{write.message}</p>}
  </section>
}
