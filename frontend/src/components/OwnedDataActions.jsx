import { useRef, useState } from 'react'
import { isUuidV4 } from '../lib/authority-api.js'

const operationId = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (!isUuidV4(value)) throw new Error('No se pudo crear un identificador seguro de operación.')
  return value
}
const token = (access, kind) => access?.versionTokens?.find(item => item.kind === kind && Number.isSafeInteger(item.version) && item.version >= 0) || null
export function saveOwnedExport(value, save = null) {
  if (!value || value.schema !== 'opengym.owned-export.v1') throw new TypeError('invalid owned export document')
  const json = JSON.stringify(value, null, 2)
  if (save) return save(json, 'opengym-owned-export.json')
  const blob = new Blob([json], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href; link.download = 'opengym-owned-export.json'; link.rel = 'noopener'
  link.click()
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

export default function OwnedDataActions({ client, access, reportHttpError }) {
  const [state, setState] = useState('idle')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pending = useRef(null)
  const canExport = access?.capabilities?.includes('EXPORT_OWN_DATA')
  const canDelete = access?.capabilities?.includes('REQUEST_OWN_DELETION')
  const exportNow = async () => {
    const expected = token(access, 'EXPORT_SET')
    if (!expected || !canExport || pending.current) return
    const intent = { type: 'export', operationId: operationId(), expectedVersion: expected.version, payload: {} }
    pending.current = intent; setState('saving'); setMessage('')
    try {
      const receipt = await client.requestOwnedExport(intent)
      const jobId = receipt?.result?.jobId
      if (!isUuidV4(jobId)) throw new Error('El servidor no devolvió una exportación válida.')
      // The document is fetched only after the job receipt and is checked immediately before the
      // browser save; no health preview, database target, or cached account document is rendered.
      const document = await client.getOwnedExport(jobId)
      saveOwnedExport(document)
      pending.current = null; setState('exported'); setMessage('Se preparó la descarga JSON de tus datos propios.')
    } catch (error) {
      reportHttpError?.(error)
      if (error?.status === 401 || error?.status === 403) { pending.current = null; setState('denied'); setMessage('El servidor no autorizó esta acción.'); return }
      setState('uncertain'); setMessage('No se pudo confirmar el resultado. Reintenta la misma operación.')
    }
  }
  const requestDeletion = async () => {
    const expected = token(access, 'DELETION_REQUEST_SET')
    if (!expected || !canDelete || !confirmDelete || pending.current) return
    const intent = { type: 'deletion', operationId: operationId(), expectedVersion: expected.version, payload: {} }
    pending.current = intent; setState('saving'); setMessage('')
    try {
      const receipt = await client.requestDeletion(intent)
      if (!isUuidV4(receipt?.result?.deletionRequestId) || receipt?.result?.state !== 'REQUESTED') throw new Error('El servidor no confirmó una solicitud de eliminación válida.')
      pending.current = null; setState('requested'); setMessage('Solicitud registrada. No se eliminó ningún dato desde esta pantalla.')
    } catch (error) {
      reportHttpError?.(error)
      if (error?.status === 401 || error?.status === 403) { pending.current = null; setState('denied'); setMessage('El servidor no autorizó esta acción.'); return }
      setState('uncertain'); setMessage('No se pudo confirmar el resultado. Reintenta la misma operación.')
    }
  }
  const retry = async () => {
    if (!pending.current) return
    setState('saving')
    try {
      const receipt = await client.retry(pending.current.operationId)
      if (pending.current.type === 'deletion') {
        if (!isUuidV4(receipt?.result?.deletionRequestId) || receipt?.result?.state !== 'REQUESTED') throw new Error('invalid deletion readback')
        pending.current = null; setState('requested'); setMessage('Solicitud registrada. No se eliminó ningún dato desde esta pantalla.')
      } else {
        const jobId = receipt?.result?.jobId
        if (!isUuidV4(jobId)) throw new Error('invalid export readback')
        saveOwnedExport(await client.getOwnedExport(jobId))
        pending.current = null; setState('exported'); setMessage('Se preparó la descarga JSON de tus datos propios.')
      }
    } catch (error) { reportHttpError?.(error); setState('uncertain') }
  }
  if (!canExport && !canDelete) return null
  const busy = state === 'saving' || !!pending.current
  return <section className="card small" data-owned-data-actions="true">
    <h2>Tus datos</h2>
    {canExport && <button className="btn" disabled={busy} onClick={exportNow}>Descargar mis datos JSON</button>}
    {canDelete && <><label><input type="checkbox" checked={confirmDelete} disabled={busy} onChange={event => setConfirmDelete(event.target.checked)} /> Entiendo que esto solicita una eliminación; no borra datos ahora.</label><button className="btn ghost" disabled={busy || !confirmDelete} onClick={requestDeletion}>Solicitar eliminación</button></>}
    {state === 'uncertain' && <button className="btn" onClick={retry}>Reintentar la misma operación</button>}
    {message && <p role={state === 'denied' ? 'alert' : 'status'}>{message}</p>}
  </section>
}
