import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createAuthorityApi } from '../lib/authority-api.js'
import { createAccessGate } from '../lib/access-gate.js'
import OwnedDataActions from './OwnedDataActions.jsx'
import ClientConsent from '../views/ClientConsent.jsx'

const defaultCreateClient = () => createAuthorityApi()

// This boundary owns an authority client for exactly one authenticated account. It is deliberately
// outside the personal store: a local profile is never evidence of an operational role or right.
export function ManagedAccessBoundary({ account, onSignOut, children, backoffice, createClient = defaultCreateClient }) {
  const navigate = useNavigate()
  const location = useLocation()
  const current = useRef(null)
  const [state, setState] = useState({ status: 'unverified', reason: 'not-checked' })

  useEffect(() => {
    if (!account?.id) return
    const api = createClient()
    const gate = createAccessGate({ getAccess: api.getAccess })
    const mine = { api, gate, accountId: account.id, alive: true }
    current.current = mine
    const refresh = async reason => {
      await gate.refresh(reason)
      if (mine.alive && current.current === mine) setState(gate.getState())
    }
    const retry = () => { refresh('retry').catch(() => {}) }
    const onOnline = () => retry()
    const onVisible = () => { if (document.visibilityState === 'visible') retry() }
    const onFocus = () => retry()
    const onPageShow = event => { if (event.persisted) retry() }
    const onInvalidated = event => {
      if (event?.detail?.accountId !== mine.accountId) return
      mine.gate.invalidate(event.detail.reason || 'transport-invalidated')
      if (current.current === mine) setState(mine.gate.getState())
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('opengym-managed-access-invalidated', onInvalidated)
    document.addEventListener('visibilitychange', onVisible)
    refresh('authenticated-entry').catch(() => {})
    return () => {
      mine.alive = false
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('opengym-managed-access-invalidated', onInvalidated)
      document.removeEventListener('visibilitychange', onVisible)
      gate.resetAccount()
      api.dispose()
      if (current.current === mine) current.current = null
    }
  }, [account?.id, createClient])

  useEffect(() => {
    const end = state.access?.entitlement?.endExclusiveUtc
    if (!end) return
    let timer
    const checkExpiry = () => {
      const delay = Date.parse(end) - Date.now()
      if (!Number.isFinite(delay)) return
      if (delay <= 0) {
        const mine = current.current
        if (!mine) return
        mine.gate.invalidate('entitlement-expired')
        setState(mine.gate.getState())
        // The wall clock only says this snapshot reached its stated end.  Ask the server again
        // before keeping the personal shell closed (or allowing it to remain open); no cached
        // entitlement is extended by this timer.
        mine.gate.refresh('entitlement-expired').then(() => {
          if (current.current === mine) setState(mine.gate.getState())
        })
        return
      }
      // Browser timers clamp to a signed 32-bit delay. Recheck long subscriptions in bounded
      // hops; never let an overflow turn a valid entitlement into an immediate denial.
      timer = setTimeout(checkExpiry, Math.min(delay + 1, 0x7fffffff))
    }
    checkExpiry()
    return () => clearTimeout(timer)
  }, [state.access?.entitlement?.endExclusiveUtc])

  const retry = () => {
    const mine = current.current
    if (!mine) return
    mine.gate.refresh('retry').then(() => { if (current.current === mine) setState(mine.gate.getState()) })
  }
  const reportHttpError = error => {
    const mine = current.current
    if (!mine) return
    mine.gate.noteHttpError(error)
    setState(mine.gate.getState())
  }
  const canAdmin = !!state.access?.capabilities?.includes('MANAGE_OPERATIONAL_ROLES')
  const canTrainerBackoffice = !!state.access?.capabilities?.includes('CREATE_INVITATION')
  const canCoordinate = state.access?.roles?.includes('COORDINATOR') === true
  const canLegacyAdmin = account?.admin === true
  const canOwnedData = state.access?.capabilities?.includes('EXPORT_OWN_DATA') === true || state.access?.capabilities?.includes('REQUEST_OWN_DELETION') === true
  const managedNavigation = <nav className="narrow" aria-label="Espacios gestionados" data-managed-navigation="true">
    {state.status === 'allowed' && <button className="btn ghost" onClick={() => navigate('/personal/training')}>Mi entrenamiento gestionado</button>}
    {canTrainerBackoffice && <button className="btn ghost" onClick={() => navigate('/trainer')}>Espacio de entrenadores</button>}
    {canAdmin && <button className="btn ghost" onClick={() => navigate('/admin/operations')}>Administración operativa</button>}
    {canCoordinate && <button className="btn ghost" onClick={() => navigate('/commercial')}>Operaciones comerciales</button>}
    {canLegacyAdmin && <button className="btn ghost" onClick={() => navigate('/admin')}>Administración de usuarios</button>}
    {canOwnedData && <button className="btn ghost" onClick={() => navigate('/account/data')}>Mis datos</button>}
    <button className="btn ghost" onClick={() => navigate('/account/consent')}>Gestionar consentimientos</button>
  </nav>
  if (state.status === 'allowed') return <>
    {managedNavigation}
    {children({ api: current.current?.api, access: state.access, personalAllowed: true, reportHttpError })}
  </>
  if (state.access && (canAdmin || canTrainerBackoffice || canCoordinate || canLegacyAdmin) && typeof backoffice === 'function') return <>{managedNavigation}{backoffice({ api: current.current?.api, access: state.access, personalAllowed: false, reportHttpError })}</>
  if (state.status === 'unverified') return <section className="narrow" aria-live="polite"><h1>Comprobando acceso</h1><p className="muted">Verificando los permisos de esta cuenta.</p></section>

  if (location.pathname === '/account/consent') return <ClientConsent client={current.current?.api} access={state.access} reportHttpError={reportHttpError} />
  return <section className="narrow" aria-live="polite" data-managed-access={state.reason}>
    <h1>Acceso de entrenamiento no disponible</h1>
    <p className="muted">{state.reason === 'not-entitled' ? 'La suscripción de esta cuenta no está vigente.' : 'No se pudo confirmar el acceso funcional de esta cuenta.'}</p>
    {canAdmin && <button className="btn" onClick={() => navigate('/admin/operations')}>Administración operativa</button>}
    {canLegacyAdmin && <button className="btn" onClick={() => navigate('/admin')}>Administración de usuarios</button>}
    {canCoordinate && <button className="btn" onClick={() => navigate('/commercial')}>Operaciones comerciales</button>}
    <button className="btn ghost" onClick={() => navigate('/account/consent')}>Gestionar consentimientos</button>
    <div style={{ height: 10 }} />
    <button className="btn" onClick={retry}>Reintentar</button>
    <OwnedDataActions client={current.current?.api} access={state.access} reportHttpError={reportHttpError} />
    <div style={{ height: 10 }} />
    <button className="btn ghost" onClick={() => onSignOut?.()}>Cerrar sesión</button>
  </section>
}
