// @vitest-environment happy-dom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrainerPrescriptions, { parseGoal } from './TrainerPrescriptions.jsx'

vi.mock('../lib/exercises.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, EXIDX: { ...actual.EXIDX, 'cx-other-client': { id: 'cx-other-client', n: 'Ejercicio privado de otro cliente' } } }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const relationId = '11111111-1111-4111-8111-111111111111'
let host, root
const historyGrantA = { grantId: 'history-a', kind: 'HISTORY', state: 'ACTIVE', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: '2026-02-01T00:00:00.000Z' }
const weightGrantA = { grantId: 'weight-a', kind: 'WEIGHT', state: 'ACTIVE' }
const planGrantA = { grantId: 'plan-a', kind: 'PLAN', state: 'ACTIVE' }
const executionGrantA = { grantId: 'execution-a', kind: 'EXECUTION', state: 'ACTIVE' }
const relationB = '22222222-2222-4222-8222-222222222222'
const portfolio = grantsA => [
  { relationId, clientId: 'client-a', state: 'ACTIVE', grants: grantsA },
  { relationId: relationB, clientId: 'client-b', state: 'ACTIVE', grants: [{ grantId: 'history-b', kind: 'HISTORY', state: 'ACTIVE', startUtc: '2026-03-01T00:00:00.000Z', endExclusiveUtc: '2026-04-01T00:00:00.000Z' }, { grantId: 'weight-b', kind: 'WEIGHT', state: 'ACTIVE' }] },
]
const deferred = () => {
  let resolve, reject
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
const mount = async (client, rows = portfolio([planGrantA, executionGrantA, historyGrantA, weightGrantA]), reportHttpError = vi.fn()) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<TrainerPrescriptions client={client} portfolio={rows} reportHttpError={reportHttpError} />); await Promise.resolve(); await Promise.resolve() })
}
const mountStrict = async (client, rows = portfolio([planGrantA, executionGrantA, historyGrantA, weightGrantA]), reportHttpError = vi.fn()) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<StrictMode><TrainerPrescriptions client={client} portfolio={rows} reportHttpError={reportHttpError} /></StrictMode>); await Promise.resolve(); await Promise.resolve() })
}
const select = async (label, value) => {
  await act(async () => { const input = [...host.querySelectorAll('select')].find(element => element.getAttribute('aria-label') === label || [...element.options].some(option => option.value === value)); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
}
const click = async text => {
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === text).click(); await Promise.resolve(); await Promise.resolve() })
}
const input = async (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(element, value); element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })); await Promise.resolve() })
}
const selectValue = async (element, value) => { await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() }) }
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
const readerClient = extra => ({
  getTrainerCurrentPlan: vi.fn(async () => ({ plan: null, versionTokens: [{ kind: 'PLAN_SET', version: 0 }] })),
  getTrainerCurrentGoals: vi.fn(async () => ({ goals: null, versionTokens: [{ kind: 'GOAL_SET', version: 0 }] })),
  publishPlan: vi.fn(), publishGoals: vi.fn(), retry: vi.fn(),
  ...extra,
})
describe('TrainerPrescriptions', () => {
  it('publishes a valid PLAN readback and shows the form after StrictMode replay and real cartera selection', async () => {
    const plan = deferred(); const goals = deferred()
    const client = readerClient({ getTrainerCurrentPlan: vi.fn(() => plan.promise), getTrainerCurrentGoals: vi.fn(() => goals.promise) })
    await mountStrict(client)
    await select('Cliente de cartera', relationId)
    await act(async () => {
      plan.resolve({ plan: { id: 'plan-a', versionNumber: 1, relationId, exercises: [{ entryId: 'server-entry', exerciseId: '0001', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 8 } }, setOverrides: {} }] }, versionTokens: [{ kind: 'PLAN_SET', version: 7 }] })
      goals.resolve({ goals: null, versionTokens: [{ kind: 'GOAL_SET', version: 9 }] })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(host.querySelector('form[data-plan-editor]')).not.toBeNull()
    expect(host.textContent).toContain('Nueva versión de plan')
  })

  it('does not publish a late PLAN readback after the selected relation changes or the component unmounts', async () => {
    const oldPlan = deferred(); const oldGoals = deferred(); const newPlan = deferred(); const newGoals = deferred()
    const client = readerClient({
      getTrainerCurrentPlan: vi.fn().mockReturnValueOnce(oldPlan.promise).mockReturnValueOnce(newPlan.promise),
      getTrainerCurrentGoals: vi.fn().mockReturnValueOnce(oldGoals.promise).mockReturnValueOnce(newGoals.promise),
    })
    const rows = [portfolio([planGrantA, executionGrantA, historyGrantA, weightGrantA])[0], { relationId: relationB, clientId: 'client-b', state: 'ACTIVE', grants: [planGrantA] }]
    await mountStrict(client, rows)
    await select('Cliente de cartera', relationId)
    await select('Cliente de cartera', relationB)
    await act(async () => {
      oldPlan.resolve({ plan: { id: 'stale-plan', relationId, exercises: [{ exerciseId: '0001', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 99 } }, setOverrides: {} }] }, versionTokens: [{ kind: 'PLAN_SET', version: 1 }] })
      oldGoals.resolve({ goals: null, versionTokens: [{ kind: 'GOAL_SET', version: 1 }] })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(host.textContent).not.toContain('99')
    act(() => root.unmount())
    await act(async () => {
      newPlan.resolve({ plan: { id: 'unmounted-plan', relationId: relationB, exercises: [{ exerciseId: '0001', mode: 'reps', sets: 1, commonTarget: { reps: { exact: 77 } }, setOverrides: {} }] }, versionTokens: [{ kind: 'PLAN_SET', version: 2 }] })
      newGoals.resolve({ goals: null, versionTokens: [{ kind: 'GOAL_SET', version: 2 }] })
      await Promise.resolve(); await Promise.resolve()
    })
    expect(host.textContent).not.toContain('77')
  })

  it('rejects blank selected target load and RIR instead of publishing implicit zeros, while preserving typed zero and fractions', async () => {
    const publishPlan = vi.fn(async () => ({ result: { planVersionId: 'new-plan' } }))
    await mount(readerClient({ publishPlan }))
    await select('Cliente de cartera', relationId)
    await flush()
    const common = host.querySelector('[data-target-editor="Objetivo común"]')
    await selectValue(common.querySelectorAll('select')[1], 'EXTERNAL')
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(publishPlan).not.toHaveBeenCalled()
    expect(host.textContent).toContain('carga inválida')
    await input(common.querySelectorAll('input')[1], '0')
    await selectValue(common.querySelectorAll('select')[2], 'RIR')
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(publishPlan).not.toHaveBeenCalled()
    expect(host.textContent).toContain('esfuerzo inválido')
    await input(common.querySelectorAll('input')[2], '0')
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve() })
    expect(publishPlan).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ exercises: [expect.objectContaining({ commonTarget: expect.objectContaining({ load: { kind: 'EXTERNAL', kg: 0 }, effort: { kind: 'RIR', value: 0 } }) })] }) }))
  })

  it('rejects blank selected override load and RIR instead of inheriting zero', async () => {
    const publishPlan = vi.fn(async () => ({ result: { planVersionId: 'new-plan' } }))
    await mount(readerClient({ publishPlan }))
    await select('Cliente de cartera', relationId)
    await flush(); await click('Ajustar serie 1')
    const override = host.querySelector('[data-target-editor="Serie 1"]')
    await selectValue(override.querySelectorAll('select')[1], 'ASSISTANCE')
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(publishPlan).not.toHaveBeenCalled()
    expect(host.textContent).toContain('serie 1: carga inválida')
    await input(override.querySelectorAll('input')[1], '0')
    await selectValue(override.querySelectorAll('select')[2], 'RIR')
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(publishPlan).not.toHaveBeenCalled()
    expect(host.textContent).toContain('serie 1: esfuerzo inválido')
  })

  it('rejects a blank selected performance-goal load and permits an explicit fractional load', async () => {
    const publishGoals = vi.fn(async () => ({ result: { goalVersionId: 'new-goal' } }))
    await mount(readerClient({ publishGoals }))
    await select('Cliente de cartera', relationId)
    await flush()
    await selectValue([...host.querySelectorAll('select')].find(element => element.value === 'CONSISTENCY'), 'PERFORMANCE')
    await input([...host.querySelectorAll('label')].find(element => element.textContent.includes('Etiqueta')).querySelector('input'), 'Prueba')
    await input([...host.querySelectorAll('label')].find(element => element.textContent.trim().startsWith('Repeticiones')).querySelector('input'), '5')
    await click('Publicar meta independiente')
    expect(publishGoals).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Carga de rendimiento inválida')
    expect(parseGoal({ label: 'Prueba', kind: 'PERFORMANCE', exerciseId: '0001', targetLoadKind: 'EXTERNAL', targetLoadKg: '42.5', targetReps: '5' })).toEqual({ label: 'Prueba', kind: 'PERFORMANCE', exerciseId: '0001', targetLoad: { kind: 'EXTERNAL', kg: 42.5 }, targetReps: 5 })
  })

  it('does not offer or name trainer-local custom exercise metadata for another client', async () => {
    const client = readerClient({ getTrainerHistory: vi.fn(async () => ({ items: [{ kind: 'WORKOUT', sourceKind: 'LEGACY_WORKOUT', sourceRecordId: 'custom-history', reportedDate: '2026-10-03', exercises: [{ exerciseId: 'cx-other-client', sets: [] }] }] })) })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush()
    const search = host.querySelector('input[aria-label="Buscar ejercicio 1"]')
    await input(search, 'Ejercicio privado de otro cliente')
    expect([...host.querySelectorAll('option')].some(option => option.value === 'cx-other-client')).toBe(false)
    await select('Rango de historial', 'history-a')
    await click('Leer historial seleccionado')
    expect(host.textContent).toContain('cx-other-client')
    expect(host.textContent).not.toContain('Ejercicio privado de otro cliente')
  })

  it('renders the closed HISTORY union exactly as produced without unit conversion or invented completion', async () => {
    const client = readerClient({ getTrainerHistory: vi.fn(async () => ({ items: [
      { kind: 'WORKOUT', sourceKind: 'SQLITE_EXECUTION', sourceRecordId: 'sqlite-history', reportedAtUtc: '2026-10-03T11:12:13.000Z', reportedAtProvenance: 'SERVER_RECORDED', exercises: [{ exerciseId: '0001', sets: [{ phase: 'work', seconds: 30, load: { kind: 'ASSISTANCE', kg: 12.5 } }] }] },
      { kind: 'WORKOUT', sourceKind: 'LEGACY_WORKOUT', sourceRecordId: 'legacy-history', reportedDate: '2026-10-02', reportedDatePrecision: 'DAY', reportedDateProvenance: 'OWNER_REPORTED', unit: 'LB', exercises: [{ exerciseId: '0001', sets: [{ phase: 'work', minutes: 2, side: 'L', load: { kind: 'REPORTED_UNKNOWN', value: 40, unit: 'LB' } }] }] },
    ] })) })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush(); await select('Rango de historial', 'history-a'); await click('Leer historial seleccionado')
    expect(host.textContent).toContain('2026-10-03T11:12:13.000Z')
    expect(host.textContent).toContain('30 s')
    expect(host.textContent).toContain('Asistencia 12.5 kg')
    expect(host.textContent).toContain('2026-10-02')
    expect(host.textContent).toContain('2 min')
    expect(host.textContent).toContain('lado L')
    expect(host.textContent).toContain('Carga reportada desconocida 40 LB')
    expect(host.textContent).not.toContain('undefined kg')
    expect(host.textContent).not.toContain('completado')
  })

  it('keeps independently granted activity available without PLAN and skips PLAN reads', async () => {
    const plan403 = Object.assign(new Error('forbidden'), { status: 403 })
    const grants = [executionGrantA, historyGrantA, weightGrantA]
    const client = readerClient({ getTrainerCurrentPlan: vi.fn(async () => { throw plan403 }), getTrainerCurrentGoals: vi.fn(async () => { throw plan403 }), getTrainerExecutions: vi.fn(async () => ({ items: [] })), getTrainerHistory: vi.fn(async () => ({ items: [] })), getTrainerBodyweight: vi.fn(async () => ({ items: [] })) })
    await mount(client, portfolio(grants))
    await select('Cliente de cartera', relationId)
    await flush()
    expect(client.getTrainerCurrentPlan).not.toHaveBeenCalled()
    expect(client.getTrainerCurrentGoals).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Nueva versión de plan')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Ver ejecuciones reales')?.disabled).toBe(false)
    await click('Ver ejecuciones reales')
    await select('Rango de historial', 'history-a'); await click('Leer historial seleccionado'); await click('Leer peso con consentimiento WEIGHT')
    expect(client.getTrainerExecutions).toHaveBeenCalledWith({ relationId })
    expect(client.getTrainerHistory).toHaveBeenCalledWith({ relationId, grantId: 'history-a' })
    expect(client.getTrainerBodyweight).toHaveBeenCalledWith({ relationId })
  })

  it('keeps independently granted activity usable when PLAN reads are denied', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { status: 403 })
    const client = readerClient({ getTrainerCurrentPlan: vi.fn(async () => { throw forbidden }), getTrainerCurrentGoals: vi.fn(async () => { throw forbidden }), getTrainerExecutions: vi.fn(async () => ({ items: [] })), getTrainerHistory: vi.fn(async () => ({ items: [] })), getTrainerBodyweight: vi.fn(async () => ({ items: [] })) })
    await mount(client, portfolio([planGrantA, executionGrantA, historyGrantA, weightGrantA]))
    await select('Cliente de cartera', relationId)
    await flush()
    expect(client.getTrainerCurrentPlan).toHaveBeenCalledWith({ relationId })
    expect(client.getTrainerCurrentGoals).toHaveBeenCalledWith({ relationId })
    expect(host.textContent).not.toContain('Nueva versión de plan')
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Ver ejecuciones reales')?.disabled).toBe(false)
    await click('Ver ejecuciones reales'); await select('Rango de historial', 'history-a'); await click('Leer historial seleccionado'); await click('Leer peso con consentimiento WEIGHT')
    expect(client.getTrainerExecutions).toHaveBeenCalledWith({ relationId })
    expect(client.getTrainerHistory).toHaveBeenCalledWith({ relationId, grantId: 'history-a' })
    expect(client.getTrainerBodyweight).toHaveBeenCalledWith({ relationId })
  })

  it('keeps ungranted activity controls disabled without suppressing the independently granted category', async () => {
    const client = readerClient({ getTrainerHistory: vi.fn(async () => ({ items: [] })) })
    await mount(client, portfolio([historyGrantA]))
    await select('Cliente de cartera', relationId)
    await flush()
    expect(client.getTrainerCurrentPlan).not.toHaveBeenCalled()
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Ver ejecuciones reales')?.disabled).toBe(true)
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Leer peso con consentimiento WEIGHT')?.disabled).toBe(true)
    await select('Rango de historial', 'history-a'); await click('Leer historial seleccionado')
    expect(client.getTrainerHistory).toHaveBeenCalledWith({ relationId, grantId: 'history-a' })
  })

  it('loads the selected owned relation and publishes a separate immutable plan draft', async () => {
    const client = {
      getTrainerCurrentPlan: vi.fn(async () => ({ plan: { id: 'old-plan', versionNumber: 1, relationId, exercises: [{ entryId: 'server-entry', exerciseId: '0001', mode: 'reps', sets: 2, commonTarget: { reps: { exact: 8 } }, setOverrides: {} }] }, versionTokens: [{ kind: 'PLAN_SET', version: 0 }] })),
      getTrainerCurrentGoals: vi.fn(async () => ({ goals: null, versionTokens: [{ kind: 'GOAL_SET', version: 0 }] })),
      publishPlan: vi.fn(async () => ({ result: { planVersionId: 'new-plan' } })),
      publishGoals: vi.fn(), retry: vi.fn(),
    }
    await mount(client)
    await select('Cliente de cartera', relationId)
    expect(client.getTrainerCurrentPlan).toHaveBeenCalledWith({ relationId })
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(client.publishPlan).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 0, payload: { relationId, exercises: [{ exerciseId: '0001', mode: 'reps', sets: 2, commonTarget: { reps: { exact: 8 } }, setOverrides: {} }] } }))
  })

  it('edits exact/ranged reps, fractional load, RPE and a removable per-series override as the canonical plan DTO', async () => {
    const client = readerClient({ publishPlan: vi.fn(async () => ({ result: { planVersionId: 'new-plan' } })) })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush()
    const common = host.querySelector('[data-target-editor="Objetivo común"]')
    await selectValue(common.querySelector('select'), 'range')
    await flush()
    await input(common.querySelectorAll('input')[0], '6')
    await input(common.querySelectorAll('input')[1], '10')
    await selectValue(common.querySelectorAll('select')[1], 'EXTERNAL')
    await flush()
    await input(common.querySelectorAll('input')[2], '42.5')
    await selectValue(common.querySelectorAll('select')[2], 'RPE')
    await flush()
    await input(common.querySelectorAll('input')[3], '8.5')
    await click('Ajustar serie 1')
    await flush()
    await act(async () => { host.querySelector('form[data-plan-editor]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(client.publishPlan).toHaveBeenCalledWith(expect.objectContaining({ payload: { relationId, exercises: [{
      exerciseId: '0001', mode: 'reps', sets: 1,
      commonTarget: { reps: { min: 6, max: 10 }, load: { kind: 'EXTERNAL', kg: 42.5 }, effort: { kind: 'RPE', value: 8.5 } },
      setOverrides: { 0: { reps: { min: 6, max: 10 }, load: { kind: 'EXTERNAL', kg: 42.5 }, effort: { kind: 'RPE', value: 8.5 } } },
    }] } }))
    await click('Quitar ajuste de serie')
    expect(host.textContent).not.toContain('Serie 1Exactas')
  })

  it('renders returned execution, history and weight measurements as actual typed rows', async () => {
    const client = readerClient({
      getTrainerExecutions: vi.fn(async () => ({ items: [{ executionId: 'e1', submittedAtUtc: '2026-10-30T10:00:00.000Z', actual: { entries: [{ exerciseId: '0001', disposition: 'PERFORMED', sets: [{ phase: 'work', reps: 7, load: { kind: 'EXTERNAL', kg: 42.5 }, effort: { kind: 'RPE', value: 8.5 }, completed: true }] }] } }] })),
      getTrainerHistory: vi.fn(async () => ({ items: [{ kind: 'WORKOUT', sourceKind: 'LEGACY_WORKOUT', sourceRecordId: 'h1', reportedDate: '2026-10-01', exercises: [{ exerciseId: '0001', sets: [{ phase: 'work', reps: 6, completed: true }] }] }] })),
      getTrainerBodyweight: vi.fn(async () => ({ items: [{ sourceRecordId: 'w1', reportedDatePanama: '2026-10-02', weight: 80.2, unit: 'KG' }] })),
    })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush(); await click('Ver ejecuciones reales'); await select('Rango de historial', 'history-a'); await click('Leer historial seleccionado'); await click('Leer peso con consentimiento WEIGHT')
    expect(host.textContent).toContain('42.5 kg')
    expect(host.textContent).toContain('2026-10-01')
    expect(host.textContent).toContain('2026-10-02: 80.2 KG')
  })

  it('descarta HISTORY y WEIGHT de A cuando el entrenador selecciona B antes de sus respuestas', async () => {
    const history = deferred(); const weights = deferred()
    const client = readerClient({ getTrainerHistory: vi.fn(() => history.promise), getTrainerBodyweight: vi.fn(() => weights.promise) })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush()
    await select('Rango de historial', 'history-a')
    await click('Leer historial seleccionado')
    await click('Leer peso con consentimiento WEIGHT')
    await select('Cliente de cartera', relationB)
    await act(async () => { history.resolve({ items: [{ sourceRecordId: 'history-from-a' }] }); weights.resolve({ items: [{ sourceRecordId: 'weight-from-a' }] }); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).not.toContain('1 registros históricos autorizados.')
    expect(host.textContent).not.toContain('1 medidas de peso autorizadas.')
  })

  it('descarta respuestas HISTORY y WEIGHT cuando el grant activo de la misma relación cambia', async () => {
    const history = deferred(); const weights = deferred()
    const client = readerClient({ getTrainerHistory: vi.fn(() => history.promise), getTrainerBodyweight: vi.fn(() => weights.promise) })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush()
    await select('Rango de historial', 'history-a')
    await click('Leer historial seleccionado')
    await click('Leer peso con consentimiento WEIGHT')
    await act(async () => { root.render(<TrainerPrescriptions client={client} portfolio={portfolio([])} reportHttpError={vi.fn()} />); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { history.resolve({ items: [{ sourceRecordId: 'history-revoked' }] }); weights.resolve({ items: [{ sourceRecordId: 'weight-revoked' }] }); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).not.toContain('1 registros históricos autorizados.')
    expect(host.textContent).not.toContain('1 medidas de peso autorizadas.')
  })

  it('limpia HISTORY y WEIGHT ya mostrados cuando se revocan los grants de la relación actual', async () => {
    const client = readerClient({
      getTrainerHistory: vi.fn(async () => ({ items: [{ sourceRecordId: 'history-authorized' }] })),
      getTrainerBodyweight: vi.fn(async () => ({ items: [{ sourceRecordId: 'weight-authorized' }] })),
    })
    await mount(client)
    await select('Cliente de cartera', relationId)
    await flush()
    await select('Rango de historial', 'history-a')
    await click('Leer historial seleccionado')
    await click('Leer peso con consentimiento WEIGHT')
    expect(host.textContent).toContain('1 registros históricos autorizados.')
    expect(host.textContent).toContain('1 medidas de peso autorizadas.')
    await act(async () => { root.render(<TrainerPrescriptions client={client} portfolio={portfolio([])} reportHttpError={vi.fn()} />); await Promise.resolve(); await Promise.resolve() })
    expect(host.textContent).not.toContain('1 registros históricos autorizados.')
    expect(host.textContent).not.toContain('1 medidas de peso autorizadas.')
  })

  it('silencia errores HISTORY y WEIGHT que llegan tras invalidar la relación', async () => {
    const history = deferred(); const weights = deferred(); const reportHttpError = vi.fn()
    const client = readerClient({ getTrainerHistory: vi.fn(() => history.promise), getTrainerBodyweight: vi.fn(() => weights.promise) })
    await mount(client, portfolio([historyGrantA, weightGrantA]), reportHttpError)
    await select('Cliente de cartera', relationId)
    await flush()
    await select('Rango de historial', 'history-a')
    await click('Leer historial seleccionado')
    await click('Leer peso con consentimiento WEIGHT')
    await select('Cliente de cartera', relationB)
    await act(async () => { history.reject(new Error('history-a-denied')); weights.reject(new Error('weight-a-denied')); await Promise.resolve(); await Promise.resolve() })
    expect(reportHttpError).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('historial seleccionado no está disponible')
    expect(host.textContent).not.toContain('peso no está disponible con el consentimiento vigente')
  })
})
