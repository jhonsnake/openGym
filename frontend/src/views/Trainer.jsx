import { useEffect, useRef, useState } from 'react'
import TrainerPrescriptions from './TrainerPrescriptions.jsx'
import { HistoryGrantEditor, historyGrantFromDraft } from '../components/HistoryGrantEditor.jsx'

const uuid = () => {
  const id = globalThis.crypto?.randomUUID?.()
  if (!id) throw new Error('No se pudo crear un identificador seguro de operación.')
  return id
}

const readError = error => error?.status === 401 || error?.status === 403 ? 'denied' : 'failure'
const displayDate = value => value ? new Date(value).toLocaleString() : 'sin fecha publicada'
const appendHistoryGrant = (grants, history, hasWeight) => {
  if (!history.enabled) return
  const grant = historyGrantFromDraft(history)
  if (grant.includeWeight && !hasWeight) throw new Error('El peso histórico requiere WEIGHT seleccionado explícitamente; WEIGHT sólo cubre peso corporal actual y futuro.')
  grants.push(grant)
}

export function parseTrainerData({ portfolio, relations, invitations }) {
  if (!portfolio || !Array.isArray(portfolio.portfolio)) throw new TypeError('invalid trainer portfolio readback')
  if (!relations || !Array.isArray(relations.relations)) throw new TypeError('invalid trainer relations readback')
  if (!invitations || !Array.isArray(invitations.invitations)) throw new TypeError('invalid trainer invitations readback')
  return { portfolio: portfolio.portfolio, relations: relations.relations, invitations: invitations.invitations, invitationCursor: invitations.nextCursor ?? null, invitationTokens: invitations.versionTokens || [] }
}

export function joinTrainerPortfolio(portfolio, relations) {
  const metadata = new Map((Array.isArray(relations) ? relations : []).filter(row => row?.state === 'ACTIVE' && typeof row.relationId === 'string').map(row => [row.relationId, row]))
  return (Array.isArray(portfolio) ? portfolio : []).map(row => {
    const relation = row?.state === 'ACTIVE' ? metadata.get(row.relationId) : null
    return relation && Array.isArray(relation.grants) ? { ...row, grants: relation.grants } : row
  })
}

export default function Trainer({ client, access, reportHttpError }) {
  const [read, setRead] = useState({ kind: 'loading', portfolio: [], relations: [], invitations: [], cursor: null, invitationTokens: [] })
  const [write, setWrite] = useState({ kind: 'idle', message: '', warning: '' })
  const [form, setForm] = useState({ knownClientId: '', commercialName: '', plan: true, execution: true, weight: false, history: { enabled: false, startDate: '', endDate: '', includeWeight: false } })
  const [identityChecked, setIdentityChecked] = useState({})
  const [reasons, setReasons] = useState({})
  const [receipt, setReceipt] = useState(null)
  const generation = useRef(0)
  const attempts = useRef(new Map())
  const mayTrain = access?.capabilities?.includes('ACCESS_PERSONAL_TRAINING') === true || access?.roles?.includes('TRAINER') === true

  const load = async (cursor = null, append = false) => {
    const current = ++generation.current
    setRead(previous => ({ ...previous, kind: 'loading' }))
    try {
      if (typeof client.getTrainerInvitations !== 'function') throw Object.assign(new Error('Integración pendiente: falta client.getTrainerInvitations({ cursor }).'), { code: 'integration-seam' })
      const [portfolio, relations, invitations] = await Promise.all([
        client.getTrainerPortfolio(), client.getTrainerRelations(), client.getTrainerInvitations({ cursor }),
      ])
      if (current !== generation.current) return
      const parsed = parseTrainerData({ portfolio, relations, invitations })
      setRead(previous => ({
        kind: 'ready',
        ...parsed,
        portfolio: joinTrainerPortfolio(parsed.portfolio, parsed.relations),
        invitations: append ? [...previous.invitations, ...parsed.invitations] : parsed.invitations,
        cursor: parsed.invitationCursor,
      }))
    } catch (error) {
      if (current !== generation.current) return
      reportHttpError?.(error)
      setRead({ kind: readError(error), portfolio: [], relations: [], invitations: [], cursor: null, invitationTokens: [] })
    }
  }
  useEffect(() => { generation.current += 1; load() }, [client])

  const mutate = async ({ key, method, expectedVersion, payload, intent, after = load }) => {
    const signature = JSON.stringify({ method, expectedVersion, payload })
    const previous = attempts.current.get(key)
    let operationId = previous?.signature === signature ? previous.operationId : undefined
    const warning = previous && previous.signature !== signature ? 'Cambiaste la intención. Confirma de nuevo: se usará una operación nueva.' : ''
    try { operationId ||= uuid() } catch (error) { setWrite({ kind: 'failure', message: error.message, warning }); return }
    attempts.current.set(key, { operationId, signature })
    setWrite({ kind: 'saving', message: '', warning })
    try {
      const response = await client[method]({ operationId, expectedVersion, payload })
      attempts.current.delete(key)
      if (method === 'createInvitation' || method === 'replaceInvitation') setReceipt(response?.result?.token ? { token: response.result.token, expiresAt: response.result.expiresAt } : response?.result?.tokenUnavailable ? { unavailable: true } : null)
      setWrite({ kind: 'success', message: 'Cambio confirmado por el servidor.', warning: '' })
      await after()
    } catch (error) {
      reportHttpError?.(error)
      setWrite({ kind: error?.status === 409 ? 'conflict' : error?.status === 401 || error?.status === 403 ? 'denied' : 'uncertain', message: error?.message || '', warning })
    }
  }

  const create = async event => {
    event.preventDefault()
    const grants = []
    if (form.plan) grants.push({ kind: 'PLAN' })
    if (form.execution) grants.push({ kind: 'EXECUTION' })
    if (form.weight) grants.push({ kind: 'WEIGHT' })
    try { appendHistoryGrant(grants, form.history, form.weight) } catch (error) { setWrite({ kind: 'failure', message: error.message, warning: '' }); return }
    if (!form.commercialName.trim() || grants.length === 0) return
    const payload = { commercialName: form.commercialName.trim(), grants }
    if (form.knownClientId) payload.knownClientId = form.knownClientId
    const token = read.invitationTokens.find(item => item.kind === 'INVITE_SET')
    if (!token) { setWrite({ kind: 'failure', message: 'La lectura no publicó la versión vigente de invitaciones.', warning: '' }); return }
    await mutate({ key: 'create-invitation', method: 'createInvitation', expectedVersion: token.version, payload, after: async () => load() })
  }

  if (!mayTrain) return <section className="narrow" data-trainer-unit="true"><h1>Entrenamiento del entrenador</h1><p>No tienes capacidad del servidor para acceder a esta vista.</p></section>
  const pending = read.relations.filter(item => item.state === 'PENDING_CONFIRMATION')
  const inactive = read.relations.filter(item => ['SUSPENDED', 'EXPIRED', 'ENDED', 'REACTIVATION_PENDING'].includes(item.state))
  const invitationQueue = read.invitations
  const submitRelation = (relation, method, reason = '') => mutate({ key: `relation:${relation.relationId}:${method}`, method, expectedVersion: relation.version, payload: { relationId: relation.relationId, ...(method === 'confirmRelation' ? {} : { reason }) } })
  const replace = invite => {
    const grants = [['plan', 'PLAN'], ['execution', 'EXECUTION'], ['weight', 'WEIGHT']].filter(([field]) => form[field]).map(([, kind]) => ({ kind }))
    try { appendHistoryGrant(grants, form.history, form.weight) } catch (error) { setWrite({ kind: 'failure', message: error.message, warning: '' }); return }
    if (!form.commercialName.trim() || !grants.length) return
    mutate({ key: `replace:${invite.invitationId}`, method: 'replaceInvitation', expectedVersion: invite.version, payload: { invitationId: invite.invitationId, commercialName: form.commercialName.trim(), grants, ...(invite.knownClientId ? { knownClientId: invite.knownClientId } : {}) } })
  }
  const relationActions = relation => {
    if (relation.state === 'PENDING_CONFIRMATION') return <>
      <label><input type="checkbox" checked={!!identityChecked[relation.relationId]} onChange={event => setIdentityChecked(current => ({ ...current, [relation.relationId]: event.target.checked }))} /> Confirmé explícitamente la identidad del cliente</label>
      <button className="btn" disabled={!identityChecked[relation.relationId] || write.kind === 'saving'} onClick={() => submitRelation(relation, 'confirmRelation')}>Confirmar relación</button>
    </>
    if (relation.state === 'ACTIVE') return <>
      <button className="btn" disabled={write.kind === 'saving'} onClick={() => submitRelation(relation, 'suspendRelation', reasons[relation.relationId] || '')}>Suspender</button>
      <button className="btn ghost" disabled={write.kind === 'saving'} onClick={() => submitRelation(relation, 'endRelation', reasons[relation.relationId] || '')}>Terminar</button>
    </>
    if (relation.state === 'SUSPENDED') return <button className="btn" disabled={write.kind === 'saving'} onClick={() => submitRelation(relation, 'requestRelationReactivation', reasons[relation.relationId] || '')}>Solicitar reactivación</button>
    return null
  }
  return <section className="narrow" data-trainer-unit="true">
    <h1>Entrenamiento del entrenador</h1>
    <p className="muted">Gestiona invitaciones, versiones inmutables y lecturas autorizadas de tu cartera vigente.</p>
    {read.kind === 'loading' && <p aria-live="polite">Cargando autoridad del entrenador…</p>}
    {read.kind === 'denied' && <p role="alert">El servidor denegó esta lectura.</p>}
    {read.kind === 'failure' && <p role="alert">No se pudo cargar la vista. <button onClick={() => load()}>Reintentar</button></p>}
    {read.kind === 'ready' && <>
      <h2>Cartera actual</h2>
      {read.portfolio.length === 0 ? <p>Cartera vacía: no se muestran relaciones expiradas o sin acceso vigente.</p> : <ul>{read.portfolio.map(row => <li key={row.relationId}>{row.clientId} · {row.state} · versión {row.version}</li>)}</ul>}
      <TrainerPrescriptions client={client} portfolio={read.portfolio} reportHttpError={reportHttpError} />
      <h2>Relaciones pendientes</h2>
      {pending.length === 0 ? <p>No hay relaciones pendientes de confirmación.</p> : pending.map(relation => <article key={relation.relationId}><p>{relation.clientAlias} · {relation.state} · versión {relation.version}</p>{relationActions(relation)}</article>)}
      <h2>Relaciones suspendidas, expiradas o terminadas</h2>
      {inactive.length === 0 ? <p>No hay relaciones en esta cola.</p> : inactive.map(relation => <article key={relation.relationId}><p>{relation.clientAlias} · {relation.state} · versión {relation.version}</p>{relation.state !== 'REACTIVATION_PENDING' && <label>Motivo <input value={reasons[relation.relationId] || ''} onChange={event => setReasons(current => ({ ...current, [relation.relationId]: event.target.value }))} /></label>}{relationActions(relation)}</article>)}
      <h2>Crear invitación</h2>
      <form onSubmit={create}>
        <label>Cliente existente (UID literal, opcional)<input value={form.knownClientId} onChange={event => setForm(current => ({ ...current, knownClientId: event.target.value }))} /></label>
        <label>Propósito / nombre contextual<input required value={form.commercialName} onChange={event => setForm(current => ({ ...current, commercialName: event.target.value }))} /></label>
        <fieldset><legend>Permisos solicitados (el cliente debe aceptar)</legend>{[['plan','PLAN (incluye metas)'],['execution','EXECUTION'],['weight','WEIGHT: peso corporal actual y futuro']].map(([field, label]) => <label key={field}><input type="checkbox" checked={form[field]} onChange={event => setForm(current => ({ ...current, [field]: event.target.checked }))} /> {label}{field === 'weight' ? ' (opcional)' : ''}</label>)}</fieldset>
        <HistoryGrantEditor legend="HISTORY (opcional)" draft={form.history} onChange={history => setForm(current => ({ ...current, history }))} disabled={write.kind === 'saving'} />
        <button className="btn" disabled={write.kind === 'saving'}>Crear invitación</button>
      </form>
      <h2>Cola de invitaciones</h2>
      {receipt?.token && <div role="status"><p>Enlace de un solo uso, disponible solo en este recibo fresco (vence {displayDate(receipt.expiresAt)}).</p><button className="btn" onClick={() => navigator.clipboard?.writeText(`${globalThis.location.origin}${globalThis.location.pathname}#invite=${receipt.token}`)}>Copiar enlace</button></div>}
      {receipt?.unavailable && <p role="alert">El token ya no está disponible para repetir esta operación. Usa “reemplazar invitación” desde un recibo fresco.</p>}
      {invitationQueue.length === 0 ? <p>No hay invitaciones.</p> : invitationQueue.map(invite => <article key={invite.invitationId}><p>{invite.commercialName} · {invite.state} · vence {displayDate(invite.expiresAt)} · versión {invite.version}</p>{invite.state === 'PENDING' && <><button className="btn ghost" onClick={() => mutate({ key: `revoke:${invite.invitationId}`, method: 'revokeInvitation', expectedVersion: invite.version, payload: { invitationId: invite.invitationId, reason: 'Revocación solicitada por el entrenador' } })}>Revocar</button><button className="btn ghost" disabled={!form.commercialName.trim()} onClick={() => replace(invite)}>Reemplazar (nuevo enlace)</button></>}</article>)}
      {read.cursor && <button className="btn ghost" onClick={() => load(read.cursor, true)}>Cargar más invitaciones</button>}
    </>}
    {write.warning && <p role="alert">{write.warning}</p>}{write.kind === 'conflict' && <p role="alert">Conflicto de versión. Relee y confirma explícitamente; no se sobrescribió nada.</p>}{write.kind === 'denied' && <p role="alert">El servidor denegó el cambio; se conservó el formulario.</p>}{write.kind === 'uncertain' && <p role="alert">Resultado incierto. Reintenta sin cambiar la intención para conservar la misma operación.</p>}{write.kind === 'failure' && <p role="alert">{write.message || 'No se pudo completar el cambio.'}</p>}{write.kind === 'success' && <p role="status">{write.message}</p>}
  </section>
}
