import { useEffect, useRef, useState } from 'react'
import { createAuthorityApi, isUuidV4 } from '../lib/authority-api.js'
import { clearInvitation, currentInvitation, subscribeInvitation, updateInvitation } from '../lib/invitation-receiver.js'
import { formatGrant, hasExactGrantSubset } from './HistoryGrantEditor.jsx'

const KINDS = new Set(['PLAN', 'EXECUTION', 'HISTORY', 'WEIGHT'])
const allowed = new Set(['kind', 'startUtc', 'endExclusiveUtc', 'includeWeight'])
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
const copy = value => JSON.parse(JSON.stringify(value))
const proposalKey = proposal => JSON.stringify(proposal)

export function validInvitationPreview(value) {
  if (!plain(value) || !plain(value.trainer) || typeof value.trainer.id !== 'string' || !value.trainer.id || typeof value.purpose !== 'string' || !iso(value.expiresAt) || !Number.isSafeInteger(value.invitationVersion) || value.invitationVersion < 0 || !Array.isArray(value.categories) || !Array.isArray(value.proposedGrants)) return false
  if (value.categories.some(kind => !KINDS.has(kind))) return false
  const seen = new Set()
  if (value.proposedGrants.some(proposal => proposal?.includeWeight === true) && !value.proposedGrants.some(proposal => proposal?.kind === 'WEIGHT')) return false
  return value.proposedGrants.every(proposal => {
    if (!plain(proposal) || !KINDS.has(proposal.kind) || Object.keys(proposal).some(key => !allowed.has(key))) return false
    if (proposal.kind === 'HISTORY' && (!iso(proposal.startUtc) || !iso(proposal.endExclusiveUtc) || Date.parse(proposal.startUtc) >= Date.parse(proposal.endExclusiveUtc))) return false
    if (proposal.kind !== 'HISTORY' && (proposal.startUtc !== undefined || proposal.endExclusiveUtc !== undefined)) return false
    if (proposal.includeWeight !== undefined && proposal.includeWeight !== true) return false
    const key = proposalKey(proposal)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function useInvitation() {
  const [value, setValue] = useState(() => currentInvitation())
  useEffect(() => subscribeInvitation(() => setValue(currentInvitation())), [])
  return value
}

export function InvitationConsent({ preview, compact = false, locked = false }) {
  const invitation = useInvitation()
  if (!invitation || !preview) return null
  const selected = new Set(invitation.selected || [])
  const choose = (key, checked) => updateInvitation({ selected: checked ? [...selected, key] : [...selected].filter(value => value !== key) })
  return <>
    <p>{preview.purpose} · vence {new Date(preview.expiresAt).toLocaleString()}</p>
    <p>Entrenador de la invitación: {preview.trainer.id}</p>
    {!compact && <p className="muted">Selecciona únicamente las propuestas que aceptas. Crear o usar una cuenta no confirma una relación, un rol CLIENT ni una suscripción.</p>}
    {preview.proposedGrants.map((proposal, index) => {
      const key = proposalKey(proposal)
      return <label key={key}><input type="checkbox" disabled={locked} checked={selected.has(key)} onChange={event => choose(key, event.target.checked)} /> {formatGrant(proposal)}</label>
    })}
    <label><input type="checkbox" disabled={locked} checked={invitation.consent === true} onChange={event => updateInvitation({ consent: event.target.checked })} /> Confirmo explícitamente las propuestas seleccionadas.</label>
  </>
}

const secureId = () => {
  const id = globalThis.crypto?.randomUUID?.()
  if (!isUuidV4(id)) throw new Error('No se pudo crear un identificador seguro de operación.')
  return id
}
const selectedProposals = (invitation, preview) => {
  const allowedKeys = new Set(invitation.selected || [])
  return preview.proposedGrants.filter(proposal => allowedKeys.has(proposalKey(proposal))).map(copy)
}
const hasValidSelectedGrantPrerequisites = grants => !grants.some(proposal => proposal.kind === 'HISTORY' && proposal.includeWeight === true) || grants.some(proposal => proposal.kind === 'WEIGHT')

export function verifyAcceptedInvitationReadback({ receipt, relations, selectedGrants }) {
  const relationId = receipt?.result?.relationId
  const state = receipt?.result?.state
  const version = receipt?.entity?.version
  if (receipt?.entity?.type !== 'relation' || typeof relationId !== 'string' || !relationId || receipt.entity.id !== relationId || !Number.isSafeInteger(version) || version < 1 || !['ACTIVE', 'PENDING_CONFIRMATION'].includes(state)) throw new Error('El recibo de aceptación no publicó una relación verificable.')
  if (!Array.isArray(relations?.relations)) throw new Error('No se pudo comprobar la relación actual.')
  const relation = relations.relations.find(item => item?.relationId === relationId)
  if (!relation || relation.state !== state || relation.version !== version) throw new Error('La relación aceptada aún no aparece con su estado y versión exactos.')
  // The current producer exposes active grants in `grants`. Pending selections must instead be
  // published as `pendingProposals`; without it, the client cannot prove the selected subset.
  const published = state === 'PENDING_CONFIRMATION' ? relation.pendingProposals : relation.grants
  if (!Array.isArray(published)) throw new Error(state === 'PENDING_CONFIRMATION' ? 'La lectura pendiente no publicó pendingProposals para comprobar tu selección exacta.' : 'La relación activa no publicó sus grants para comprobar tu selección exacta.')
  if (!hasExactGrantSubset(published, selectedGrants)) throw new Error('La relación leída no contiene exactamente las propuestas seleccionadas.')
  return relation
}

// This lives outside ManagedAccessBoundary so a pending, expired, or no-CLIENT account can still
// make the only invitation decision it is authorized to make.  It never uses personal training
// transport and it does not infer a confirmed share from the mutation receipt.
export default function InvitationFlow({ onSignOut }) {
  const invitation = useInvitation()
  const [preview, setPreview] = useState(() => invitation?.preview || null)
  const [state, setState] = useState(() => invitation ? (invitation.preview ? 'ready' : 'loading') : 'none')
  const client = useRef(null)
  const pending = useRef(null)
  useEffect(() => {
    if (!invitation) return
    if (!client.current) client.current = createAuthorityApi()
    if (invitation.preview && validInvitationPreview(invitation.preview)) { setPreview(invitation.preview); setState('ready'); return }
    let alive = true
    client.current.previewInvitation(invitation.token).then(value => {
      if (!alive || !validInvitationPreview(value)) return alive && setState('invalid')
      updateInvitation({ preview: copy(value) }); setPreview(value); setState('ready')
    }).catch(() => alive && setState('invalid'))
    return () => { alive = false }
  }, [invitation?.token])
  useEffect(() => () => {
    client.current?.dispose()
    client.current = null
  }, [])
  if (!invitation) return null
  const grants = preview ? selectedProposals(invitation, preview) : []
  const validGrantSelection = hasValidSelectedGrantPrerequisites(grants)
  const canDecide = state === 'ready' && invitation.consent === true && grants.length > 0 && validGrantSelection && !pending.current
  const verifyAcceptance = async attempt => {
    const relations = await client.current.getClientRelations()
    verifyAcceptedInvitationReadback({ receipt: attempt.receipt, relations, selectedGrants: attempt.payload.grants })
  }
  const terminal = async (method, payload) => {
    const operationId = pending.current?.operationId || secureId()
    pending.current = { operationId, method, payload, expectedVersion: preview.invitationVersion }
    setState('saving')
    try {
      const receipt = await client.current[method]({ operationId, expectedVersion: preview.invitationVersion, payload })
      if (method === 'acceptInvitation') {
        pending.current = { ...pending.current, receipt, phase: 'readback' }
        await verifyAcceptance(pending.current)
      }
      pending.current = null
      clearInvitation()
    } catch (error) {
      if (pending.current?.phase === 'readback') { setState('uncertain'); return }
      if (error?.status === 401 || error?.status === 403 || error?.status === 404 || error?.status === 410) {
        pending.current = null
        setState('wrong-account')
      } else setState('uncertain')
    }
  }
  const retry = () => {
    const attempt = pending.current
    if (!attempt) return
    setState('saving')
    const resume = attempt.phase === 'readback' ? Promise.resolve(attempt.receipt) : client.current.retry(attempt.operationId)
    resume.then(async () => {
      if (attempt.method === 'acceptInvitation') {
        pending.current = { ...attempt, receipt: attempt.phase === 'readback' ? attempt.receipt : await resume, phase: 'readback' }
        await verifyAcceptance(pending.current)
      }
      pending.current = null; clearInvitation()
    }).catch(() => setState('uncertain'))
  }
  return <section className="narrow" data-invitation-flow="true" aria-live="polite">
    <h1>Invitación de entrenamiento</h1>
    {state === 'loading' && <p>Cargando los detalles de la invitación…</p>}
    {state === 'invalid' && <p role="alert">Esta invitación no está disponible.</p>}
    {preview && (state === 'ready' || state === 'saving' || state === 'uncertain' || state === 'wrong-account') && <InvitationConsent preview={preview} locked={!!pending.current} />}
    {state === 'ready' && !validGrantSelection && <p role="alert">Para aceptar HISTORY con peso corporal histórico, selecciona también la propuesta independiente WEIGHT.</p>}
    {state === 'ready' && <><p className="muted">Una cuenta creada mediante la invitación queda pendiente de rol operativo y confirmación del entrenador. La renovación es independiente.</p><button className="btn" disabled={!canDecide} onClick={() => terminal('acceptInvitation', { token: invitation.token, grants })}>Aceptar las propuestas seleccionadas</button><button className="btn ghost" disabled={!!pending.current} onClick={() => terminal('rejectInvitation', { token: invitation.token })}>Rechazar invitación</button></>}
    {state === 'saving' && <p>Enviando la decisión…</p>}
    {state === 'uncertain' && <div role="alert"><p>El resultado es incierto. No se creó una nueva operación.</p><button className="btn" onClick={retry}>Reintentar la misma operación</button></div>}
    {state === 'wrong-account' && <div role="alert"><p>Esta cuenta no puede completar la invitación. Inicia sesión o cambia a la cuenta correcta y vuelve a intentarlo.</p><button className="btn ghost" onClick={() => onSignOut?.()}>Cambiar de cuenta</button></div>}
    {(state === 'invalid' || state === 'ready' || state === 'wrong-account') && <button className="btn ghost" onClick={() => clearInvitation()}>Cancelar invitación</button>}
  </section>
}
