// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClientTraining from './ClientTraining.jsx'
import { clientTrainingDraftKey } from '../lib/client-training-draft.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const planId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const entryA = '33333333-3333-4333-8333-333333333333'
const entryB = '44444444-4444-4444-8444-444444444444'
const access = { account: { id: 'literal-owner', activity: 'ACTIVE' }, roles: ['CLIENT'], entitlement: { active: true }, capabilities: ['ACCESS_PERSONAL_TRAINING'], compatibility: { protectedTraining: 'supported' }, requestId: 'fresh' }
const snapshot = { planVersionId: planId, goalVersionId: null, exercises: [
  { entryId: entryA, exerciseId: '0001', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 8 } }, setOverrides: {} },
  { entryId: entryB, exerciseId: '0001', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 10 } }, setOverrides: {} },
] }
const base = () => ({
  getClientPlan: vi.fn(async () => ({ plan: { id: planId, exercises: snapshot.exercises }, goals: null, versionTokens: [{ kind: 'SESSION_SET', key: '["literal-owner"]', version: 7 }] })),
  getCurrentSession: vi.fn(async () => ({ session: null, closeOnlySession: null, versionTokens: [{ kind: 'SESSION_SET', key: '["literal-owner"]', version: 7 }] })),
  getClientExecutions: vi.fn(async () => ({ items: [], nextCursor: null })),
  getClientBodyweight: vi.fn(async () => ({ entries: [], versionTokens: [{ kind: 'BODYWEIGHT_SET', key: '["literal-owner"]', version: 4 }] })),
  startSession: vi.fn(async () => ({ result: { sessionId, state: 'OPEN', snapshot, serverStartedAtUtc: '2026-10-31T00:00:00.000Z' }, versionTokens: [{ kind: 'SESSION', key: '["' + sessionId + '"]', version: 3 }] })),
  finishSession: vi.fn(async () => ({ result: { executionId: '55555555-5555-4555-8555-555555555555' } })),
  postBodyweight: vi.fn(async () => ({ result: { bodyweightId: '66666666-6666-4666-8666-666666666666' } })),
  retry: vi.fn(),
})
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; localStorage.clear() })
const mount = async (client, value = access) => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<ClientTraining client={client} access={value} reportHttpError={vi.fn()} />); await Promise.resolve(); await Promise.resolve() }) }
const click = async text => { await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === text).click(); await Promise.resolve(); await Promise.resolve() }) }
const input = async (element, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; await act(async () => { setter.call(element, value); element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); await Promise.resolve() }) }
const select = async (element, value) => { await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() }) }
const openSession = () => ({ session: { sessionId, planVersionId: planId, goalVersionId: null, state: 'OPEN', snapshot }, closeOnlySession: null, versionTokens: [{ kind: 'SESSION_SET', key: '["literal-owner"]', version: 7 }, { kind: 'SESSION', key: '["' + sessionId + '"]', version: 3 }] })

describe('ClientTraining (leaf controlado)', () => {
  it('rejects blank selected actual load and RIR rather than sending zero, and preserves typed zero', async () => {
    const client = base()
    await mount(client)
    await click('Comenzar sesión')
    const first = host.querySelector(`[data-plan-entry-id="${entryA}"]`)
    const second = host.querySelector(`[data-plan-entry-id="${entryB}"]`)
    await click('Añadir set real')
    await input(first.querySelector('fieldset input[inputmode="numeric"]'), '8')
    await select(second.querySelector('select'), 'OMITTED')
    const selects = first.querySelectorAll('fieldset select')
    await select(selects[1], 'EXTERNAL')
    await click('Finalizar y verificar')
    expect(client.finishSession).not.toHaveBeenCalled()
    expect(host.textContent).toContain('carga real')
    await input(first.querySelector('input[inputmode="decimal"]'), '0')
    await select(selects[2], 'RIR')
    await click('Finalizar y verificar')
    expect(client.finishSession).not.toHaveBeenCalled()
    expect(host.textContent).toContain('RPE/RIR')
    const decimals = first.querySelectorAll('input[inputmode="decimal"]')
    await input(decimals[1], '0')
    await click('Finalizar y verificar')
    expect(client.finishSession).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ entries: expect.arrayContaining([expect.objectContaining({ sets: [expect.objectContaining({ load: { kind: 'EXTERNAL', kg: 0 }, effort: { kind: 'RIR', value: 0 } })] })]) }) }))
  })

  it('no lee ni muta entrenamiento sin autorización CLIENT vigente y online', async () => {
    const client = base()
    await mount(client, { ...access, roles: ['TRAINER'] })
    expect(host.textContent).toContain('Entrenamiento no disponible')
    expect(client.getClientPlan).not.toHaveBeenCalled()
    expect(client.startSession).not.toHaveBeenCalled()
  })

  it('usa entryId repetible, objetivos sólo lectura y construye DTO exacto con omitido', async () => {
    const client = base()
    client.getClientExecutions = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ executionId: '55555555-5555-4555-8555-555555555555', submittedAtUtc: '2026-10-31T00:01:00.000Z' }], nextCursor: null })
    await mount(client)
    await click('Comenzar sesión')
    expect(client.startSession).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 7, payload: { planVersionId: planId } }))
    const first = host.querySelector(`[data-plan-entry-id="${entryA}"]`)
    const second = host.querySelector(`[data-plan-entry-id="${entryB}"]`)
    expect(first.textContent).toContain('solo lectura')
    await click('Añadir set real')
    await input(first.querySelector('fieldset input[inputmode="numeric"]'), '8')
    await select(second.querySelector('select'), 'OMITTED')
    await click('Finalizar y verificar')
    expect(client.finishSession).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, payload: { sessionId, entries: [
      { planEntryId: entryA, exerciseId: '0001', disposition: 'PERFORMED', sets: [{ phase: 'work', completed: true, reps: 8 }] },
      { planEntryId: entryB, exerciseId: '0001', disposition: 'OMITTED', sets: [] },
    ] } }))
    expect(host.textContent).toContain('finalizada y verificada')
  })

  it('no asume token de peso y usa fecha Panamá literal del control', async () => {
    const client = base(); await mount(client)
    await input(host.querySelector('input[aria-label="Peso"]'), '72.5')
    await input(host.querySelector('input[aria-label="Fecha Panamá"]'), '2026-10-30')
    await click('Publicar peso')
    expect(client.postBodyweight).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4, payload: { weight: 72.5, unit: 'KG', reportedDatePanama: '2026-10-30' } }))
    expect(client.getClientBodyweight).toHaveBeenCalledTimes(2)
  })

  it('muestra la prescripción con ajuste por serie y los resultados reales devueltos, sin convertirlos en objetivos', async () => {
    const client = base()
    client.getClientPlan = vi.fn(async () => ({ plan: { id: planId, exercises: [{ ...snapshot.exercises[0], setOverrides: { 0: { reps: { min: 6, max: 10 }, load: { kind: 'EXTERNAL', kg: 42.5 }, effort: { kind: 'RPE', value: 8.5 } } } }] }, goals: { goals: [{ label: 'Fuerza', kind: 'PERFORMANCE', exerciseId: '0001', targetLoad: { kind: 'EXTERNAL', kg: 50 }, targetReps: 5, dueDatePanama: '2026-11-30' }] }, versionTokens: [{ kind: 'SESSION_SET', key: 'x', version: 7 }] }))
    client.getClientExecutions = vi.fn(async () => ({ items: [{ executionId: 'actual-1', submittedAtUtc: '2026-10-31T01:00:00.000Z', actual: { entries: [{ exerciseId: '0001', disposition: 'PERFORMED', sets: [{ phase: 'work', reps: 7, load: { kind: 'EXTERNAL', kg: 40.5 }, effort: { kind: 'RPE', value: 9 }, completed: false }] }] } }], nextCursor: null }))
    await mount(client)
    expect(host.textContent).toContain('Serie 1: 6–10 repeticiones · external 42.5 kg · RPE 8.5')
    expect(host.textContent).toContain('Fuerza')
    expect(host.textContent).toContain('fecha objetivo 2026-11-30')
    expect(host.textContent).toContain('Serie real 1: trabajo · 7 repeticiones · external 40.5 kg · RPE 9 · no completado')
    expect(host.textContent).not.toContain('met')
  })

  it('trata una sesión close-only como cierre explícito, nunca como recuperación de objetivos', async () => {
    const client = base()
    client.getCurrentSession = vi.fn(async () => ({ session: null, closeOnlySession: { sessionId, state: 'OPEN' }, versionTokens: [{ kind: 'SESSION_SET', key: '["literal-owner"]', version: 7 }, { kind: 'SESSION', key: '["' + sessionId + '"]', version: 3 }] }))
    client.abandonSession = vi.fn(async () => ({ result: { sessionId, state: 'CLOSED' } }))
    await mount(client)
    expect(host.textContent).toContain('sin acceso a la prescripción')
    expect(host.textContent).not.toContain('Plan actual')
    await click('Cerrar sesión sin ejecución')
    expect(client.abandonSession).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, payload: { sessionId } }))
    expect(client.finishSession).not.toHaveBeenCalled()
  })

  it('ofrece cierre explícito versionado, sin mutación automática, cuando la sesión vigente no tiene borrador local', async () => {
    const client = base(); const reportHttpError = vi.fn()
    client.getCurrentSession = vi.fn(async () => openSession())
    client.abandonSession = vi.fn(async () => ({ result: { sessionId, state: 'CLOSED' } }))
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<ClientTraining client={client} access={access} reportHttpError={reportHttpError} />); await Promise.resolve(); await Promise.resolve() })
    expect(client.abandonSession).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Registrar datos reales')
    await click('Recuperar borrador local')
    expect(host.textContent).toContain('No hay un borrador local compatible')
    const close = [...host.querySelectorAll('button')].find(button => button.textContent === 'Cerrar sesión sin ejecución')
    expect(Boolean(close)).toBe(true)
    if (!close) return
    await click('Cerrar sesión sin ejecución')
    expect(client.abandonSession).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, payload: { sessionId } }))
    expect(client.finishSession).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Sesión abierta cerrada sin registrar ejecución.')
    expect(reportHttpError).not.toHaveBeenCalled()
  })

  it('mantiene la sesión actual y el mismo cierre disponible cuando el borrador es incompatible o falla la red', async () => {
    const client = base(); const reportHttpError = vi.fn(); const network = new Error('offline')
    client.getCurrentSession = vi.fn(async () => openSession())
    client.abandonSession = vi.fn(async () => { throw network })
    localStorage.setItem(clientTrainingDraftKey({ accountUid: 'literal-owner', serverSessionId: sessionId, planVersionId: planId, goalVersionId: null }), 'not-json')
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<ClientTraining client={client} access={access} reportHttpError={reportHttpError} />); await Promise.resolve(); await Promise.resolve() })
    await click('Recuperar borrador local')
    expect(host.textContent).toContain('no coincide con la sesión autorizada')
    const close = [...host.querySelectorAll('button')].find(button => button.textContent === 'Cerrar sesión sin ejecución')
    expect(Boolean(close)).toBe(true)
    if (!close) return
    await click('Cerrar sesión sin ejecución')
    expect(client.abandonSession).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, payload: { sessionId } }))
    expect(client.finishSession).not.toHaveBeenCalled()
    expect(reportHttpError).toHaveBeenCalledWith(network)
    expect(host.textContent).toContain('No se pudo confirmar el cierre. Reintenta exactamente la misma operación.')
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Cerrar sesión sin ejecución')).toBe(true)
  })

  it('no acepta un recibo de cierre de otra sesión aunque el estado recibido sea CLOSED', async () => {
    const client = base()
    client.getCurrentSession = vi.fn(async () => openSession())
    client.abandonSession = vi.fn(async () => ({ result: { sessionId: '77777777-7777-4777-8777-777777777777', state: 'CLOSED' } }))
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root.render(<ClientTraining client={client} access={access} reportHttpError={vi.fn()} />); await Promise.resolve(); await Promise.resolve() })
    await click('Recuperar borrador local')
    await click('Cerrar sesión sin ejecución')
    expect(client.abandonSession).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, payload: { sessionId } }))
    expect(host.textContent).toContain('No se recibió un cierre verificable.')
    expect(host.textContent).toContain('Sesión abierta verificable')
    expect(host.textContent).not.toContain('Sesión abierta cerrada sin registrar ejecución.')
  })
})
