// @vitest-environment happy-dom
// Integration: mount the real App and traverse its Admin link. The controlled transport is only
// the server seam; this test must never mount ManagedOperations on its own.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const snapshot = { account: { id: 'admin-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT', 'COORDINATOR'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities: ['ACCESS_PERSONAL_TRAINING', 'MANAGE_OPERATIONAL_ROLES'], compatibility: { protectedTraining: 'supported' }, requestId: 'access-1', versionTokens: [] }
const commercialInterval = { id: 'interval-1', startUtc: '2027-01-01T05:00:00.000Z', endExclusiveUtc: '2027-02-01T05:00:00.000Z', kind: 'MONTHLY' }
const commercialReadback = (version, requestId) => ({ clients: [{ clientId: 'assigned-client', entitlement: { active: false, startUtc: version === 5 ? null : commercialInterval.startUtc, endExclusiveUtc: version === 5 ? null : commercialInterval.endExclusiveUtc, version } }], nextCursor: null, versionTokens: [{ kind: 'SUBSCRIPTION', key: JSON.stringify(['assigned-client']), version }], requestId })
const api = vi.fn(path => {
  if (path === '/api/access') return Promise.resolve(snapshot)
  if (path === '/api/admin/operations/users') return Promise.resolve({ users: [{ account: { id: 'listed-account', activity: 'ACTIVE' }, roles: ['CLIENT'], version: 2 }] })
  if (path === '/api/admin/users') return Promise.resolve({ users: [{ id: 'admin-id', name: 'Admin', admin: true, owner: true, workouts: 0 }], invite_only: false })
  if (path === '/api/admin/invites') return Promise.resolve({ invites: [] })
  if (path === '/api/audit') return Promise.resolve({ rows: [] })
  return Promise.resolve({})
})
const authority = vi.hoisted(() => ({
  getAccess: vi.fn(async () => ({ account: { id: 'admin-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT', 'COORDINATOR'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities: ['ACCESS_PERSONAL_TRAINING', 'MANAGE_OPERATIONAL_ROLES'], compatibility: { protectedTraining: 'supported' }, requestId: 'access-1', versionTokens: [] })),
  getAdminUsers: vi.fn(async () => ({ users: [{ account: { id: 'coord-id' }, roles: ['COORDINATOR'], version: 1 }, { account: { id: 'listed-account' }, roles: ['CLIENT'], version: 2 }] })),
  getAdminScopes: vi.fn(async () => ({ scopes: [{ coordinatorId: 'coord-id', clientId: 'listed-account', assigned: false, version: 0 }], nextCursor: null, requestId: 'scope-read-1' })),
  setCoordinatorScope: vi.fn(async () => ({ operationId: crypto.randomUUID() })),
  dispose: vi.fn(),
}))
vi.mock('./lib/api.js', async importOriginal => ({ ...(await importOriginal()), api, beacon: vi.fn() }))
vi.mock('./lib/authority-api.js', () => ({ createAuthorityApi: () => authority }))
vi.mock('./lib/sound.js', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(), setNativeBuzzer: vi.fn() }))
vi.mock('./views/Admin.jsx', async () => {
  const { useNavigate } = await import('react-router-dom')
  return { default: () => { const navigate = useNavigate(); return <div data-admin-page="true"><button onClick={() => navigate('/admin/operations')}>Abrir operación gestionada</button></div> } }
})
vi.mock('./views/AdminCoach.jsx', () => ({ default: () => null }))

const { default: App } = await import('./App.jsx')
const { DEF, useStore } = await import('./store/useStore.js')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, saved
beforeEach(() => {
  saved = useStore.getState()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'admin-id', name: 'Admin', admin: true }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
  window.location.hash = '#/admin'
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  window.scrollTo = vi.fn()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root?.unmount()); host?.remove(); useStore.setState(saved); api.mockClear() })

describe('managed operations App navigation integration', () => {
  it('preserves the legacy admin route in M0 and denies it to a non-admin', async () => {
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'admin-id', name: 'Admin', admin: true }, config: { managed_subscriptions: false }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/admin'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-admin-page="true"]')).not.toBeNull())

    act(() => root.unmount())
    root = createRoot(host)
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'viewer-id', name: 'Viewer', admin: false }, config: { managed_subscriptions: false }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/admin'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(window.location.hash).toBe('#/home'))
    expect(host.textContent).not.toContain('Administración de usuarios')
  })

  it('keeps the legacy admin route available without personal entitlement in M1', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'admin-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: [], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: [], compatibility: { protectedTraining: 'supported' }, requestId: 'admin-no-personal', versionTokens: [] })
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'admin-id', name: 'Admin', admin: true }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/admin'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-admin-page="true"]')).not.toBeNull())
  })

  it('blocks the legacy admin route for an ordinary non-personal M1 user', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'viewer-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: [], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: [], compatibility: { protectedTraining: 'supported' }, requestId: 'viewer-no-personal', versionTokens: [] })
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'viewer-id', name: 'Viewer', admin: false }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/admin'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-managed-access]')).not.toBeNull())
    expect(host.querySelector('[data-admin-page="true"]')).toBeNull()
    expect(host.textContent).not.toContain('Administración de usuarios')
  })

  it('shows every verified workspace link for a combined personal and backoffice account', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'combined-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT', 'TRAINER', 'COORDINATOR'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities: ['ACCESS_PERSONAL_TRAINING', 'CREATE_INVITATION', 'MANAGE_OPERATIONAL_ROLES', 'READ_COMMERCIAL_CLIENTS', 'EXPORT_OWN_DATA'], compatibility: { protectedTraining: 'supported' }, requestId: 'combined-access', versionTokens: [{ kind: 'EXPORT_SET', key: 'combined-id', version: 0 }] })
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'combined-id', name: 'Combined', admin: true }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/home'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-managed-navigation="true"]')).not.toBeNull())
    expect(host.textContent).toContain('Mi entrenamiento gestionado')
    expect(host.textContent).toContain('Espacio de entrenadores')
    expect(host.textContent).toContain('Administración operativa')
    expect(host.textContent).toContain('Operaciones comerciales')
    expect(host.textContent).toContain('Administración de usuarios')
    expect(host.textContent).toContain('Mis datos')
  })

  it('does not render workspaces whose verified capability is absent', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'client-only', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities: ['ACCESS_PERSONAL_TRAINING'], compatibility: { protectedTraining: 'supported' }, requestId: 'client-only-access', versionTokens: [] })
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'client-only', name: 'Client' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/home'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-managed-navigation="true"]')).not.toBeNull())
    expect(host.textContent).not.toContain('Espacio de entrenadores')
    expect(host.textContent).not.toContain('Administración operativa')
    expect(host.textContent).not.toContain('Operaciones comerciales')
    expect(host.textContent).not.toContain('Administración de usuarios')
    expect(host.textContent).not.toContain('Mis datos')
  })

  it('shows verified backoffice and owned-data links in non-personal mode', async () => {
    const operatorAccess = { account: { id: 'operator-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['TRAINER', 'COORDINATOR'], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: ['CREATE_INVITATION', 'MANAGE_OPERATIONAL_ROLES', 'READ_COMMERCIAL_CLIENTS', 'EXPORT_OWN_DATA'], compatibility: { protectedTraining: 'supported' }, requestId: 'operator-access', versionTokens: [{ kind: 'EXPORT_SET', key: 'operator-id', version: 0 }] }
    authority.getAccess.mockImplementation(async () => operatorAccess)
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'operator-id', name: 'Operator', admin: true }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/home'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-managed-navigation="true"]')).not.toBeNull())
    expect(host.textContent).toContain('Espacio de entrenadores')
    expect(host.textContent).toContain('Administración operativa')
    expect(host.textContent).toContain('Operaciones comerciales')
    expect(host.textContent).toContain('Administración de usuarios')
    expect(host.textContent).toContain('Mis datos')
    expect(host.textContent).not.toContain('Mi entrenamiento gestionado')
    authority.getAccess.mockImplementation(async () => snapshot)
  })

  it('keeps owned data available without CLIENT entitlement and blocks unauthenticated admin navigation', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'owned-data-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: [], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: ['EXPORT_OWN_DATA'], compatibility: { protectedTraining: 'supported' }, requestId: 'owned-data-access', versionTokens: [{ kind: 'EXPORT_SET', key: 'owned-data-id', version: 0 }] })
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'owned-data-id', name: 'Owner' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/account/data'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-owned-data-actions="true"]')).not.toBeNull())

    act(() => root.unmount())
    root = createRoot(host)
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: false, user: null, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/admin'
    await act(async () => { root.render(<App />); await Promise.resolve() })
    expect(host.textContent).not.toContain('Admin')
    expect(host.textContent).not.toContain('Administración de usuarios')
  })

  it('navigates from the mounted legacy admin page into the capability-authorized operations page', async () => {
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => { if (![...host.querySelectorAll('button')].some(button => button.textContent === 'Abrir operación gestionada')) throw new Error(host.textContent + ' access=' + authority.getAccess.mock.calls.length) })
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Abrir operación gestionada').click() })
    await vi.waitFor(() => expect(host.querySelector('[data-managed-operations="true"]')).not.toBeNull())
    expect(authority.getAccess).toHaveBeenCalled()
    await vi.waitFor(() => expect(host.textContent).toContain('listed-account'), { timeout: 3000 })
  })

  it('drives the mounted scope editor through its real App route and closed API seam', async () => {
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => { const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Abrir operación gestionada'); if (!button) throw new Error(host.textContent); button.click() })
    await vi.waitFor(() => expect(host.querySelector('[data-managed-operations="true"]')).not.toBeNull())
    await vi.waitFor(() => expect(host.querySelectorAll('select').length).toBe(3))
    const selects = host.querySelectorAll('select')
    await act(async () => { selects[1].value = 'coord-id'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); selects[2].value = 'listed-account'; selects[2].dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    await vi.waitFor(() => expect(authority.getAdminScopes).toHaveBeenCalledWith({ coordinatorId: 'coord-id', clientId: 'listed-account' }))
    const reason = host.querySelectorAll('textarea')[0]
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    await act(async () => { setter.call(reason, 'asignación aprobada'); reason.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'asignación aprobada', inputType: 'insertText' })); host.querySelector('[data-scope-assigned]').click(); await Promise.resolve() })
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Guardar ámbito').click(); await Promise.resolve() })
    expect(authority.setCoordinatorScope).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 0, payload: { coordinatorId: 'coord-id', clientId: 'listed-account', assigned: true, reason: 'asignación aprobada' } }))
  })

  it('mounts the trainer queue for a trainer without their own client entitlement', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'trainer-id', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['TRAINER'], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: ['CREATE_INVITATION'], compatibility: { protectedTraining: 'supported' }, requestId: 'trainer-access', versionTokens: [] })
    authority.getTrainerPortfolio = vi.fn(async () => ({ portfolio: [] }))
    authority.getTrainerRelations = vi.fn(async () => ({ relations: [] }))
    authority.getTrainerInvitations = vi.fn(async () => ({ invitations: [], nextCursor: null, versionTokens: [{ kind: 'INVITE_SET', key: 'trainer', version: 0 }] }))
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'trainer-id', name: 'Trainer' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/trainer'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-trainer-unit="true"]')).not.toBeNull(), { timeout: 3000 })
    await vi.waitFor(() => expect(host.textContent).toContain('Cartera vacía'), { timeout: 3000 })
  })

  it('mounts consent on its real managed fallback route after a CLIENT entitlement expires', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'expired-client', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT'], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: [], compatibility: { protectedTraining: 'supported' }, requestId: 'expired-access', versionTokens: [] })
    authority.getClientRelations = vi.fn(async () => ({ relations: [], nextCursor: null, versionTokens: [], requestId: 'relations-read' }))
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'expired-client', name: 'Expired' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/account/consent'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-client-consent="true"]')).not.toBeNull())
    expect(authority.getClientRelations).toHaveBeenCalled()
  })

  it('mounts the real paid CLIENT workspace through App and reads the server current-session seam', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'paid-client', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities: ['ACCESS_PERSONAL_TRAINING'], compatibility: { protectedTraining: 'supported' }, requestId: 'paid-access', versionTokens: [] })
    authority.getClientPlan = vi.fn(async () => ({ plan: null, goals: null, versionTokens: [{ kind: 'SESSION_SET', version: 0 }] }))
    authority.getCurrentSession = vi.fn(async () => ({ session: null, closeOnlySession: null, versionTokens: [{ kind: 'SESSION_SET', version: 0 }] }))
    authority.getClientExecutions = vi.fn(async () => ({ items: [], nextCursor: null }))
    authority.getClientBodyweight = vi.fn(async () => ({ entries: [], versionTokens: [{ kind: 'BODYWEIGHT_SET', version: 0 }] }))
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'paid-client', name: 'Paid' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/personal/training'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 30)) })
    await vi.waitFor(() => expect(host.querySelector('[data-client-training="ready"]')).not.toBeNull())
    await vi.waitFor(() => expect(authority.getCurrentSession).toHaveBeenCalled())
  })

  it('offers a visible managed navigation control into the paid personal workspace', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'paid-nav', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['CLIENT'], entitlement: { active: true, startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2027-01-01T00:00:00.000Z', version: 1 }, capabilities: ['ACCESS_PERSONAL_TRAINING'], compatibility: { protectedTraining: 'supported' }, requestId: 'paid-nav-access', versionTokens: [] })
    authority.getClientPlan = vi.fn(async () => ({ plan: null, goals: null, versionTokens: [{ kind: 'SESSION_SET', version: 0 }] }))
    authority.getCurrentSession = vi.fn(async () => ({ session: null, closeOnlySession: null, versionTokens: [{ kind: 'SESSION_SET', version: 0 }] }))
    authority.getClientExecutions = vi.fn(async () => ({ items: [], nextCursor: null }))
    authority.getClientBodyweight = vi.fn(async () => ({ entries: [], versionTokens: [{ kind: 'BODYWEIGHT_SET', version: 0 }] }))
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'paid-nav', name: 'Paid nav' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/home'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 30)) })
    await vi.waitFor(() => { const button = [...host.querySelectorAll('button')].find(item => item.textContent === 'Mi entrenamiento gestionado'); if (!button) throw new Error(host.textContent); button.click() })
    await vi.waitFor(() => expect(host.querySelector('[data-client-training="ready"]')).not.toBeNull())
  })

  it('mounts commercial operations for a COORDINATOR without CLIENT and sends the edited mounted form', async () => {
    authority.getAccess.mockResolvedValueOnce({ account: { id: 'coord-only', activity: 'ACTIVE' }, managedSubscriptions: true, roles: ['COORDINATOR'], entitlement: { active: false, startUtc: null, endExclusiveUtc: null, version: 0 }, capabilities: ['CONFIRM_SUBSCRIPTION', 'READ_COMMERCIAL_CLIENTS'], compatibility: { protectedTraining: 'supported' }, requestId: 'coord-access', versionTokens: [] })
    authority.getCommercialClients = vi.fn().mockResolvedValueOnce(commercialReadback(5, 'commercial-read-1')).mockResolvedValueOnce(commercialReadback(6, 'commercial-read-2'))
    authority.confirmCommercialOperation = vi.fn(async ({ operationId, payload }) => ({ operationId, entity: { type: 'subscription', id: payload.clientId, version: 6 }, versionTokens: [{ kind: 'SUBSCRIPTION', key: JSON.stringify([payload.clientId]), version: 6 }], result: { clientId: payload.clientId, interval: commercialInterval, entitlement: { active: false, startUtc: commercialInterval.startUtc, endExclusiveUtc: commercialInterval.endExclusiveUtc } }, requestId: 'commercial-receipt-1' }))
    authority.retry = vi.fn()
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), ready: true, user: { id: 'coord-only', name: 'Coord' }, config: { managed_subscriptions: true }, boot: vi.fn(), isGuest: () => false })
    window.location.hash = '#/commercial'
    await act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 20)) })
    await vi.waitFor(() => expect(host.querySelector('[data-commercial-unit="true"]')).not.toBeNull())
    await vi.waitFor(() => expect(host.querySelectorAll('select').length).toBe(2))
    const selects = host.querySelectorAll('select')
    await act(async () => { selects[0].value = 'assigned-client'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
    const [reference, reason] = host.querySelectorAll('input:not([type="checkbox"])')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(reference, 'registro editado'); reference.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'registro editado' })); setter.call(reason, 'confirmación editada'); reason.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'confirmación editada' })); host.querySelector('input[type="checkbox"]').click(); await Promise.resolve(); host.querySelector('form').requestSubmit(); await Promise.resolve() })
    expect(authority.confirmCommercialOperation).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 5, payload: { clientId: 'assigned-client', kind: 'MONTHLY', reference: 'registro editado', reason: 'confirmación editada' } }))
    await vi.waitFor(() => expect(host.textContent).toContain('Recibo confirmado'))
  })
})
