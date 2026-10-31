/* T10 clinical acceptance uses the owned loopback server; no route fulfilment or component mount. */
import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'

const runtimePath = process.env.OPENGYM_E2E_RUNTIME
const runtime = runtimePath ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : { webOrigin: 'http://localhost:1', secret: '', ids: {}, clinical: null }
const timeout = 30_000
const planned = Object.freeze({
  exerciseId: '0025', sets: 2,
  commonTarget: { reps: { min: 8, max: 10 }, load: { kind: 'EXTERNAL', kg: 22.5 }, effort: { kind: 'RPE', value: 8.5 } },
  setOverride: { reps: { exact: 6 }, load: { kind: 'ASSISTANCE', kg: 12.5 }, effort: { kind: 'RIR', value: 2.5 } },
})
const goal = Object.freeze({ label: 'clinical-performance', dueDatePanama: '2026-12-31', exerciseId: '0025', targetLoad: { kind: 'EXTERNAL', kg: 37.5 }, targetReps: 9 })
const actual = Object.freeze([{ reps: 11, load: { kind: 'EXTERNAL', kg: 20.5 }, effort: { kind: 'RPE', value: 9 } }, { reps: 5, load: { kind: 'ASSISTANCE', kg: 5 }, effort: { kind: 'RIR', value: 3 } }])

const safeCause = error => String(error?.message || error || 'unknown failure')
  .replace(/https?:\/\/[^\s'"\])}]+/g, '[redacted-url]')
  .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
  .replace(/\s+/g, ' ').slice(0, 600)
const fail = (stage, error) => {
  try {
    if (runtime.diagnosticFile && /^[A-Z][A-Z0-9_]+$/.test(stage) && !fs.existsSync(runtime.diagnosticFile)) {
      fs.writeFileSync(runtime.diagnosticFile, JSON.stringify({ failureStage: stage, failure: { cause: error ? safeCause(error) : null } }), { mode: 0o600 })
    }
  } catch {}
  throw new Error(`T10_STAGE_${stage}${error ? `: ${safeCause(error)}` : ''}`)
}
const cookieFor = uid => {
  const payload = `${uid}:${Date.now() + 60 * 60 * 1000}:0`
  return `gymsid=${payload}.${crypto.createHmac('sha256', runtime.secret).update(payload).digest('base64url')}`
}
async function signedContext(browser, uid) {
  const context = await browser.newContext()
  await context.addCookies([{ name: 'gymsid', value: cookieFor(uid).slice('gymsid='.length), url: runtime.webOrigin, httpOnly: true, sameSite: 'Lax' }])
  return context
}
async function read(context, path) {
  const personalRead = new Set(['/api/client/plan/current', '/api/client/sessions/current', '/api/client/executions', '/api/client/bodyweight']).has(path.split('?')[0])
  const response = await context.request.get(runtime.webOrigin + path, { headers: { 'Sec-Fetch-Site': 'same-origin', ...(personalRead ? { 'X-OpenGym-Contract-Version': '1' } : {}) } })
  let value = null
  try { value = await response.json() } catch {}
  return { status: response.status(), value }
}
async function at(name, action) {
  return test.step(name, async () => {
    try { return await action() } catch (error) { fail(name, error) }
  })
}
const exact = (condition, stage) => { if (!condition) fail(stage) }
async function responseBeforeClick(page, path, button, stage) {
  const received = page.waitForResponse(response => {
    try { return new URL(response.url()).pathname === path && response.request().method() === 'POST' } catch { return false }
  }, { timeout })
  await at(`${stage}_CLICK`, () => button.click())
  const response = await at(`${stage}_RESPONSE`, () => received)
  exact(response.status() === 200, `${stage}_STATUS`)
}
function exerciseWithoutGeneratedId(entry) {
  const { entryId, ...value } = entry || {}
  return value
}

test('M1 clinical authoring, actuals, projections, and independent consent revocation', async ({ browser }) => {
  test.setTimeout(600_000)
  if (!runtimePath || !runtime.clinical?.relationId) fail('RUNTIME_REQUIRED')

  const trainer = await signedContext(browser, runtime.ids['clinical-trainer'])
  const trainerPage = await trainer.newPage()
  trainerPage.setDefaultTimeout(timeout)
  await at('TRAINER_NAVIGATION', () => trainerPage.goto('/#/trainer'))
  await at('TRAINER_HEADING', () => expect(trainerPage.getByRole('heading', { name: 'Entrenamiento del entrenador' })).toBeVisible({ timeout }))
  const prescriptions = trainerPage.locator('[data-trainer-prescriptions="true"]')
  await at('TRAINER_PRESCRIPTIONS_READY', () => expect(prescriptions).toBeVisible({ timeout }))
  await at('TRAINER_SELECT_AUTHORIZED_CLIENT', () => prescriptions.getByLabel('Cliente de cartera').selectOption(runtime.clinical.relationId))
  const planForm = prescriptions.locator('form[data-plan-editor]')
  await at('PLAN_FORM_READY', () => expect(planForm).toBeVisible({ timeout }))
  const exercise = planForm.getByRole('group', { name: 'Ejercicio 1' })
  await at('PLAN_CATALOGUE_SEARCH', () => exercise.getByLabel('Buscar ejercicio 1', { exact: true }).fill('barbell bench press'))
  await at('PLAN_CATALOGUE_EXERCISE', () => exercise.getByLabel('Ejercicio 1', { exact: true }).selectOption(planned.exerciseId))
  await at('PLAN_SETS', () => exercise.getByLabel('Series').fill('2'))
  const common = exercise.locator('[data-target-editor="Objetivo común"]')
  await at('PLAN_RANGE_FORM', () => common.getByLabel('Objetivo común repeticiones').selectOption('range'))
  await at('PLAN_RANGE_VALUES', async () => { await common.getByLabel('Mínimo').fill('8'); await common.getByLabel('Máximo').fill('10') })
  await at('PLAN_LOAD_SELECTED_BLANK_REJECTS', async () => {
    await common.getByLabel('Carga').selectOption('EXTERNAL')
    await planForm.getByRole('button', { name: 'Publicar nueva versión de plan' }).click()
    await expect(prescriptions.getByText('Ejercicio 1: carga inválida.')).toBeVisible({ timeout })
  })
  await at('PLAN_COMMON_LOAD_EFFORT', async () => { await common.getByLabel('kg').fill('22.5'); await common.getByLabel('Esfuerzo').selectOption('RPE'); await common.getByRole('spinbutton', { name: 'RPE', exact: true }).fill('8.5') })
  await at('PLAN_ADD_SECOND_OVERRIDE', () => exercise.getByRole('button', { name: 'Ajustar serie 2' }).click())
  const override = exercise.getByRole('group', { name: 'Serie 2' })
  await at('PLAN_OVERRIDE_VALUES', async () => {
    await override.getByLabel('Serie 2 repeticiones').selectOption('exact')
    await override.getByRole('spinbutton', { name: 'Exactas', exact: true }).fill('6')
    await override.getByLabel('Carga').selectOption('ASSISTANCE')
    await override.getByLabel('kg').fill('12.5')
    await override.getByLabel('Esfuerzo').selectOption('RIR')
    await override.getByRole('spinbutton', { name: 'RIR', exact: true }).fill('2.5')
  })
  await responseBeforeClick(trainerPage, '/api/trainer/plans/publish', planForm.getByRole('button', { name: 'Publicar nueva versión de plan' }), 'PLAN_PUBLISH')
  await at('PLAN_RELOAD', () => trainerPage.reload())
  await at('PLAN_RESELECT_AUTHORIZED_CLIENT', () => prescriptions.getByLabel('Cliente de cartera').selectOption(runtime.clinical.relationId))
  await at('PLAN_DOM_READBACK', async () => {
    await expect(prescriptions.getByText('8–10 repeticiones')).toBeVisible({ timeout })
    await expect(prescriptions.getByText('Carga 22.5 kg')).toBeVisible({ timeout })
    await expect(prescriptions.getByText('Asistencia 12.5 kg')).toBeVisible({ timeout })
  })
  const planRead = await at('PLAN_AUTHORIZED_READBACK', () => read(trainer, `/api/trainer/plans/current?relationId=${encodeURIComponent(runtime.clinical.relationId)}`))
  const publishedEntry = planRead.value?.plan?.exercises?.[0]
  exact(planRead.status === 200, 'PLAN_READ_STATUS')
  await at('PLAN_CANONICAL_PAYLOAD', () => expect(exerciseWithoutGeneratedId(publishedEntry)).toEqual({ exerciseId: planned.exerciseId, mode: 'reps', sets: planned.sets, commonTarget: planned.commonTarget, setOverrides: { '1': planned.setOverride } }))

  const goalForm = prescriptions.getByRole('heading', { name: 'Nueva versión de meta' }).locator('..')
  await at('GOAL_PERFORMANCE_VALUES', async () => {
    await goalForm.getByLabel('Etiqueta').fill(goal.label)
    await goalForm.getByLabel('Fecha objetivo (opcional)').fill(goal.dueDatePanama)
    await goalForm.getByLabel('Tipo').selectOption('PERFORMANCE')
    await goalForm.getByLabel('Buscar ejercicio meta', { exact: true }).fill('barbell bench press')
    await goalForm.getByLabel('Ejercicio meta', { exact: true }).selectOption(goal.exerciseId)
    await goalForm.getByLabel('Carga').selectOption('EXTERNAL')
    await goalForm.getByLabel('kg').fill('37.5')
    await goalForm.getByLabel('Repeticiones').fill('9')
  })
  await responseBeforeClick(trainerPage, '/api/trainer/goals/publish', goalForm.getByRole('button', { name: 'Publicar meta independiente' }), 'GOAL_PUBLISH')
  await at('GOAL_RELOAD', () => trainerPage.reload())
  await at('GOAL_RESELECT_AUTHORIZED_CLIENT', () => prescriptions.getByLabel('Cliente de cartera').selectOption(runtime.clinical.relationId))
  const goalsRead = await at('GOAL_AUTHORIZED_READBACK', () => read(trainer, `/api/trainer/goals/current?relationId=${encodeURIComponent(runtime.clinical.relationId)}`))
  exact(goalsRead.status === 200, 'GOAL_READ_STATUS')
  await at('GOAL_CANONICAL_PAYLOAD', () => expect(goalsRead.value?.goals?.goals).toEqual([{ label: goal.label, kind: 'PERFORMANCE', dueDatePanama: goal.dueDatePanama, exerciseId: goal.exerciseId, targetLoad: goal.targetLoad, targetReps: goal.targetReps }]))

  const client = await signedContext(browser, runtime.ids['clinical-client'])
  const clientPage = await client.newPage()
  clientPage.setDefaultTimeout(timeout)
  await at('CLIENT_NAVIGATION', () => clientPage.goto('/#/personal/training'))
  await at('CLIENT_ASSIGNED_PLAN', async () => { await expect(clientPage.locator('[data-client-training="ready"]')).toBeVisible({ timeout }); await expect(clientPage.getByText('8–10 repeticiones')).toBeVisible({ timeout }) })
  await responseBeforeClick(clientPage, '/api/client/sessions/start', clientPage.getByRole('button', { name: 'Comenzar sesión' }), 'SESSION_START')
  const actualEditor = clientPage.getByRole('heading', { name: 'Registrar datos reales' }).locator('..')
  await at('ACTUAL_SET_ONE', async () => {
    await actualEditor.getByRole('button', { name: 'Añadir set real' }).click()
    const realSets = actualEditor.locator('article[data-plan-entry-id] fieldset')
    await expect(realSets).toHaveCount(1, { timeout })
    const set = realSets.nth(0)
    await set.getByLabel('Repeticiones').fill('11'); await set.getByLabel('Carga').selectOption('EXTERNAL'); await set.getByLabel('kg').fill('20.5'); await set.getByLabel('Esfuerzo').selectOption('RPE'); await set.getByRole('textbox', { name: 'RPE', exact: true }).fill('9')
  })
  await at('ACTUAL_SET_TWO', async () => {
    await actualEditor.getByRole('button', { name: 'Añadir set real' }).click()
    const realSets = actualEditor.locator('article[data-plan-entry-id] fieldset')
    await expect(realSets).toHaveCount(2, { timeout })
    const set = realSets.nth(1)
    await set.getByLabel('Repeticiones').fill('5'); await set.getByLabel('Carga').selectOption('ASSISTANCE'); await set.getByLabel('kg').fill('5'); await set.getByLabel('Esfuerzo').selectOption('RIR'); await set.getByRole('textbox', { name: 'RIR', exact: true }).fill('3')
  })
  await responseBeforeClick(clientPage, '/api/client/sessions/finish', actualEditor.getByRole('button', { name: 'Finalizar y verificar' }), 'SESSION_FINISH')
  await at('CLIENT_ACTUAL_DOM_READBACK', () => expect(clientPage.getByText('11 repeticiones')).toBeVisible({ timeout }))
  const ownExecutions = await at('CLIENT_EXECUTION_READBACK', () => read(client, '/api/client/executions'))
  const persisted = ownExecutions.value?.items?.[0]?.actual?.entries?.[0]?.sets
  exact(ownExecutions.status === 200, 'EXECUTION_READ_STATUS')
  await at('ACTUAL_DISTINCT_FROM_SNAPSHOT', () => expect(persisted?.map(({ reps, load, effort }) => ({ reps, load, effort }))).toEqual(actual))
  await at('CLIENT_WEIGHT_TYPED', async () => { await clientPage.getByRole('textbox', { name: 'Peso', exact: true }).fill('68.4'); await clientPage.getByLabel('Fecha Panamá').fill('2026-10-30') })
  await responseBeforeClick(clientPage, '/api/client/bodyweight', clientPage.getByRole('button', { name: 'Publicar peso' }), 'WEIGHT_PUBLISH')

  await at('TRAINER_EXECUTION_RELOAD', () => trainerPage.goto('/#/trainer'))
  await at('TRAINER_EXECUTION_SELECT', () => prescriptions.getByLabel('Cliente de cartera').selectOption(runtime.clinical.relationId))
  await at('TRAINER_EXECUTION_VALUES', async () => { await prescriptions.getByRole('button', { name: 'Ver ejecuciones reales' }).click(); await expect(prescriptions.getByText('11 repeticiones')).toBeVisible({ timeout }); await expect(prescriptions.getByText('Carga 20.5 kg')).toBeVisible({ timeout }) })
  const relations = await at('CLIENT_RELATION_READBACK', () => read(client, '/api/client/relations'))
  const historyConsent = relations.value?.relations?.find(row => row.relationId === runtime.clinical.relationId)?.grants?.find(grant => grant.kind === 'HISTORY')
  exact(relations.status === 200 && historyConsent?.includeWeight === true, 'HISTORY_CONSENT_READBACK')
  const trainerRelations = await at('TRAINER_RELATION_READBACK', () => read(trainer, '/api/trainer/relations'))
  const historyGrant = trainerRelations.value?.relations?.find(row => row.relationId === runtime.clinical.relationId)?.grants?.find(grant => grant.kind === 'HISTORY' && grant.state === 'ACTIVE')
  exact(trainerRelations.status === 200 && typeof historyGrant?.grantId === 'string' && historyGrant.startUtc === historyConsent.startUtc && historyGrant.endExclusiveUtc === historyConsent.endExclusiveUtc, 'HISTORY_GRANT_READBACK')
  await at('TRAINER_HISTORY_VALUES', async () => { await prescriptions.getByLabel('Rango de historial').selectOption(historyGrant.grantId); await prescriptions.getByRole('button', { name: 'Leer historial seleccionado' }).click(); await expect(prescriptions.getByText('Peso compartido')).toBeVisible({ timeout }); await expect(prescriptions.getByText('2026-10-30: 67.3 KG')).toBeVisible({ timeout }); await expect(prescriptions.getByText('7 repeticiones')).toBeVisible({ timeout }); await expect(prescriptions.getByText('lado L')).toBeVisible({ timeout }); await expect(prescriptions.getByText('Carga reportada desconocida 21 KG')).toBeVisible({ timeout }) })
  await at('TRAINER_WEIGHT_VALUES', async () => { await prescriptions.getByRole('button', { name: 'Leer peso con consentimiento WEIGHT' }).click(); await expect(prescriptions.getByText('2026-10-30: 68.4 KG', { exact: true })).toBeVisible({ timeout }) })

  const unrelated = await signedContext(browser, runtime.ids['clinical-unrelated'])
  const foreign = await at('UNRELATED_TRAINER_DENIED', () => read(unrelated, `/api/trainer/executions?relationId=${encodeURIComponent(runtime.clinical.relationId)}`))
  exact(foreign.status === 404 || foreign.status === 403, 'UNRELATED_TRAINER_NOT_DENIED')

  await at('CONSENT_NAVIGATION', () => clientPage.goto('/#/account/consent'))
  const consent = clientPage.locator('[data-client-consent="true"]')
  await at('CONSENT_READY', () => expect(consent).toBeVisible({ timeout }))
  await responseBeforeClick(clientPage, '/api/client/relations/grants/revoke', consent.getByRole('button', { name: 'Retirar WEIGHT' }), 'CONSENT_REVOKE_WEIGHT')
  const noWeight = await at('WEIGHT_FORBIDDEN_AFTER_REVOKE', () => read(trainer, `/api/trainer/bodyweight?relationId=${encodeURIComponent(runtime.clinical.relationId)}`))
  exact(noWeight.status === 403 || noWeight.status === 404, 'WEIGHT_STILL_VISIBLE')
  await responseBeforeClick(clientPage, '/api/client/relations/grants/revoke', consent.getByRole('button', { name: 'Retirar HISTORY' }), 'CONSENT_REVOKE_HISTORY')
  const noHistory = await at('HISTORY_FORBIDDEN_AFTER_REVOKE', () => read(trainer, `/api/trainer/history?relationId=${encodeURIComponent(runtime.clinical.relationId)}&grantId=${encodeURIComponent(historyGrant.grantId)}`))
  exact(noHistory.status === 403 || noHistory.status === 404, 'HISTORY_STILL_VISIBLE')
  await responseBeforeClick(clientPage, '/api/client/relations/grants/revoke', consent.getByRole('button', { name: 'Retirar PLAN' }), 'CONSENT_REVOKE_PLAN')
  const noPlan = await at('PLAN_FORBIDDEN_AFTER_REVOKE', () => read(trainer, `/api/trainer/plans/current?relationId=${encodeURIComponent(runtime.clinical.relationId)}`))
  const retainedExecution = await at('EXECUTION_RETAINS_AFTER_PLAN_REVOKE', () => read(trainer, `/api/trainer/executions?relationId=${encodeURIComponent(runtime.clinical.relationId)}`))
  exact((noPlan.status === 403 || noPlan.status === 404) && retainedExecution.status === 200 && Array.isArray(retainedExecution.value?.items) && retainedExecution.value.items.length > 0, 'INDEPENDENT_CONSENT_CATEGORIES')
  await at('TRAINER_AUTHORING_HIDDEN_AFTER_PLAN_REVOKE', async () => {
    await trainerPage.reload()
    await prescriptions.getByLabel('Cliente de cartera').selectOption(runtime.clinical.relationId)
    await prescriptions.getByRole('button', { name: 'Ver ejecuciones reales' }).click()
    await expect(prescriptions.getByText('11 repeticiones')).toBeVisible({ timeout })
    await expect(prescriptions.getByRole('button', { name: 'Publicar nueva versión de plan' })).toHaveCount(0, { timeout })
  })
  await trainer.close(); await client.close(); await unrelated.close()
})
