import { useEffect, useRef, useState } from 'react'
import { HistoryGrantEditor, formatGrant, historyGrantFromDraft } from '../components/HistoryGrantEditor.jsx'

const KINDS = ['PLAN', 'EXECUTION', 'WEIGHT']
const reason = 'Retiro explícito desde mi espacio de consentimiento'
const operationId = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (!value) throw new Error('No se pudo crear una operación segura.')
  return value
}
const copyGrants = grants => (Array.isArray(grants) ? grants : []).map(({ kind, startUtc, endExclusiveUtc, includeWeight }) => ({ kind, ...(startUtc ? { startUtc } : {}), ...(endExclusiveUtc ? { endExclusiveUtc } : {}), ...(includeWeight === true ? { includeWeight: true } : {}) }))

// This owner-only workspace intentionally has no personal-training entitlement gate.  The API is
// still authoritative for every read/write, and absent producer metadata is described as absent.
export default function ClientConsent({ client, access, reportHttpError }) {
  const [state, setState] = useState({ kind: 'loading', relations: [], cursor: null })
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(null)
  const [historyDrafts, setHistoryDrafts] = useState({})
  const generation = useRef(0)
  const load = async (cursor = null, append = false) => {
    const mine = ++generation.current
    setState(current => ({ ...current, kind: 'loading' }))
    try {
      if (typeof client?.getClientRelations !== 'function') throw new Error('Falta la lectura de relaciones propias.')
      const read = await client.getClientRelations({ ...(cursor ? { cursor } : {}) })
      if (mine !== generation.current || !Array.isArray(read?.relations)) return
      setState(current => ({ kind: 'ready', relations: append ? [...current.relations, ...read.relations] : read.relations, cursor: read.nextCursor || null }))
    } catch (error) { if (mine === generation.current) { reportHttpError?.(error); setState({ kind: error?.status === 401 || error?.status === 403 ? 'denied' : 'failure', relations: [], cursor: null }) } }
  }
  useEffect(() => { load() }, [client])
  const mutate = async (method, relation, payload) => {
    if (!Number.isSafeInteger(relation?.version)) { setMessage('La relación no publicó una versión vigente; no se envió ningún cambio.'); return }
    const intent = { method, operationId: operationId(), expectedVersion: relation.version, payload }
    setPending(intent); setMessage('')
    try { await client[method](intent); setPending(null); setMessage('Cambio confirmado. Se relee la relación desde el servidor.'); await load() } catch (error) { reportHttpError?.(error); setMessage(error?.status === 409 ? 'Conflicto de versión; no se descartó ninguna selección.' : 'No se pudo confirmar el resultado. Reintenta exactamente la misma operación.'); }
  }
  const retry = async () => { if (!pending) return; try { await client.retry(pending.operationId); setPending(null); setMessage('Operación confirmada; releyendo relación.'); await load() } catch (error) { reportHttpError?.(error); setMessage('Resultado aún incierto; se conserva el mismo intento.') } }
  const accountActive = access?.account?.activity === 'ACTIVE'
  return <section className="narrow" data-client-consent="true">
    <h1>Consentimientos de entrenamiento</h1>
    <p className="muted">Este espacio sigue disponible para tu identidad activa aunque tu suscripción CLIENT haya vencido. Conservar datos no concede visibilidad al entrenador.</p>
    {!accountActive && <p role="alert">La identidad actual no está activa; el servidor decidirá si puede mostrar relaciones propias.</p>}
    {state.kind === 'loading' && <p aria-live="polite">Leyendo tus relaciones desde el servidor…</p>}
    {state.kind === 'denied' && <p role="alert">El servidor no autorizó la lectura de relaciones propias.</p>}
    {state.kind === 'failure' && <p role="alert">No se pudo leer el consentimiento. <button className="btn" onClick={() => load()}>Reintentar</button></p>}
    {state.kind === 'ready' && <>{state.relations.length === 0 ? <p>No hay relaciones que administrar.</p> : state.relations.map(relation => {
      const grants = copyGrants(relation.grants)
      const historyDraft = historyDrafts[relation.relationId] || { enabled: false, startDate: '', endDate: '', includeWeight: false }
      const trainer = relation.trainer?.displayName || relation.trainer?.id || null
      return <article className="card" key={relation.relationId}><h2>Relación {relation.relationId}</h2><p>{trainer ? `Entrenador: ${trainer}` : 'Identidad del entrenador pendiente de publicación por el servidor.'} · estado {relation.state}</p><p className="muted">Versión de relación {relation.version}. Las fechas de HISTORY se muestran en UTC; tu fecha Panamá solo se usa donde el servidor la solicita.</p><ul>{grants.length ? grants.map(grant => <li key={`${grant.kind}:${grant.startUtc || ''}`}><span>{formatGrant(grant)}</span> <button className="btn ghost" disabled={!!pending} onClick={() => mutate('revokeGrant', relation, { relationId: relation.relationId, kind: grant.kind, reason })}>Retirar {grant.kind}</button></li>) : <li>No hay grants activos publicados.</li>}</ul><div><button className="btn ghost" disabled={!!pending || relation.state !== 'ACTIVE'} onClick={() => mutate('revokeRelation', relation, { relationId: relation.relationId, reason })}>Retirar relación</button>{relation.state === 'REACTIVATION_PENDING' && <button className="btn" disabled={!!pending} onClick={() => mutate('acceptRelationReactivation', relation, { relationId: relation.relationId, reason: 'Aceptación explícita de reactivación' })}>Aceptar reactivación explícitamente</button>}</div><fieldset><legend>Cambiar grants explícitamente</legend>{KINDS.map(kind => <label key={kind}><input type="checkbox" checked={grants.some(grant => grant.kind === kind)} disabled={!!pending} onChange={event => {
        const next = event.target.checked ? [...grants, { kind }] : grants.filter(grant => grant.kind !== kind)
        // HISTORY requires a range. It therefore cannot be silently added by this quick control.
        if (kind === 'WEIGHT' && !event.target.checked && grants.some(grant => grant.kind === 'HISTORY' && grant.includeWeight)) { setMessage('Retira o cambia primero el rango HISTORY que incluye peso.'); return }
        mutate('replaceGrants', relation, { relationId: relation.relationId, grants: next })
      }} /> {formatGrant({ kind })}</label>)}</fieldset><HistoryGrantEditor legend="Añadir rango HISTORY" selectionLabel="Añadir HISTORY" draft={historyDraft} disabled={!!pending || relation.state !== 'ACTIVE'} onChange={draft => setHistoryDrafts(current => ({ ...current, [relation.relationId]: draft }))} /><button className="btn" disabled={!!pending || relation.state !== 'ACTIVE' || !historyDraft.enabled} onClick={() => { try { const added = historyGrantFromDraft(historyDraft); if (added.includeWeight && !grants.some(grant => grant.kind === 'WEIGHT')) { setMessage('El peso histórico requiere que WEIGHT esté seleccionado explícitamente; WEIGHT solo cubre peso actual y futuro.'); return } mutate('replaceGrants', relation, { relationId: relation.relationId, grants: [...grants, added] }) } catch (error) { setMessage(error.message) } }}>Guardar nuevo rango HISTORY</button></article>
    })}{state.cursor && <button className="btn ghost" onClick={() => load(state.cursor, true)}>Cargar más relaciones</button>}</>}
    {message && <p role="status">{message}</p>}{pending && <button className="btn" onClick={retry}>Reintentar la misma operación</button>}
  </section>
}
