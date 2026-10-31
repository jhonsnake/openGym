/* T9 is deliberately a browser/API integration test: no route fulfilment or mocked fetches. */
import { test, expect } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const runtimePath = process.env.OPENGYM_E2E_RUNTIME
// Discovery must remain side-effect free; the executable test rejects this inert value at setup.
const runtime = runtimePath ? JSON.parse(fs.readFileSync(runtimePath, 'utf8')) : { apiOrigin: 'http://localhost:1', webOrigin: 'http://localhost:1', secret: '', ids: {}, dataDir: '', label: 'discovery' }
const operation = () => crypto.randomUUID()
let activeDiagnostic = null
let diagnosticStage = null
let diagnosticDetails = null
const cookieFor = uid => {
  const payload = `${uid}:${Date.now() + 60 * 60 * 1000}:0`
  return `gymsid=${payload}.${crypto.createHmac('sha256', runtime.secret).update(payload).digest('base64url')}`
}
const sanitizedCause = error => String(error?.message || error || 'unknown failure')
  .replace(/https?:\/\/[^\s'"\])}]+/g, '[redacted-url]')
  .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
  .replace(/\s+/g, ' ')
  .slice(0, 600)
const sanitizedStack = error => String(error?.stack || '')
  .replace(/https?:\/\/[^\s'"\])}]+/g, '[redacted-url]')
  .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
  .replace(/\s+/g, ' ')
  .slice(0, 1200)
const safeNetworkError = error => {
  const value = String(error || '').toLowerCase()
  if (value.includes('aborted')) return 'aborted'
  if (value.includes('timed out') || value.includes('timeout')) return 'timeout'
  if (value.includes('refused')) return 'connection_refused'
  return 'network_failure'
}
const safeUiAlert = value => sanitizedCause(value).slice(0, 240)
const failStage = (stage, details = {}) => {
  diagnosticDetails = details
  void activeDiagnostic?.write(stage, details)
  throw new Error(`T9_STAGE_${stage}`)
}
const at = async (stage, target, action) => {
  diagnosticStage = stage
  const startedAt = Date.now()
  try { return await action() } catch (error) {
    const locatorCount = target ? await target.count().catch(() => null) : null
    const details = { cause: sanitizedCause(error), stack: sanitizedStack(error), locatorCount, elapsedMs: Date.now() - startedAt }
    diagnosticDetails = details
    await activeDiagnostic?.write(stage, details).catch(() => {})
    throw new Error(`T9_STAGE_${stage}: ${details.cause}`, { cause: error })
  }
}
const dtoShape = value => {
  if (Array.isArray(value)) return value.length === 0 ? 'array:empty' : 'array:nonempty'
  if (!value || typeof value !== 'object') return value === null ? 'null' : typeof value
  const keys = Object.keys(value).sort()
  return keys.length ? `object:${keys.join(',')}` : 'object:empty'
}
const safeReadback = (response, value) => ({
  status: response.status,
  cacheControl: typeof response.headers?.get === 'function' ? response.headers.get('cache-control') || null : response.headers?.['cache-control'] || null,
  dtoShape: dtoShape(value),
  resultPresent: !!value?.result,
  relationsPresent: Array.isArray(value?.relations),
})
const headerValue = (headers, name) => typeof headers?.get === 'function' ? headers.get(name) : headers?.[name] || headers?.[name.toLowerCase()] || null
const writeDiagnostic = value => {
  if (runtime.diagnosticFile) fs.writeFileSync(runtime.diagnosticFile, JSON.stringify(value), { mode: 0o600 })
}
async function api(path, { method = 'GET', uid, body } = {}) {
  const response = await fetch(runtime.apiOrigin + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(uid ? { Cookie: cookieFor(uid) } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  let value = null
  try { value = await response.json() } catch {}
  return { status: response.status, headers: response.headers, value }
}
async function browserApi(context, path, { method = 'GET', body } = {}) {
  const response = await context.request.fetch(runtime.webOrigin + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    ...(body === undefined ? {} : { data: body }),
  })
  let value = null
  try { value = await response.json() } catch {}
  return { status: response.status(), headers: response.headers(), value }
}
async function signedContext(browser, uid) {
  const context = await browser.newContext()
  context.setDefaultTimeout(30_000)
  context.setDefaultNavigationTimeout(30_000)
  await context.addCookies([{ name: 'gymsid', value: cookieFor(uid).slice('gymsid='.length), url: runtime.webOrigin, httpOnly: true, sameSite: 'Lax' }])
  return context
}
async function virtualAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable', { enableUI: false })
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
}

function inspectPasswordContext(page, expectedUid = () => null, priorSignup = null) {
  const startedAt = Date.now()
  const events = []
  const note = event => events.push({ atMs: Date.now() - startedAt, ...event })
  const apiRequest = request => {
    try {
      const url = new URL(request.url())
      return url.origin === runtime.webOrigin && url.pathname.startsWith('/api/')
        ? { path: url.pathname, method: request.method() }
        : null
    } catch { return null }
  }
  const noteResponse = response => {
    const request = apiRequest(response.request())
    if (request) note({ type: 'response', ...request, status: response.status() })
  }
  const noteRequestFailed = request => {
    const safe = apiRequest(request)
    if (safe) note({ type: 'request_failed', ...safe, error: safeNetworkError(request.failure()?.errorText) })
  }
  const notePageError = () => note({ type: 'page_error', error: 'page_error' })
  page.on('response', noteResponse)
  page.on('requestfailed', noteRequestFailed)
  page.on('pageerror', notePageError)
  const snapshot = async (stage, details = {}) => {
    const expected = expectedUid()
    const browser = await page.evaluate(async expectedId => {
      const alerts = [...document.querySelectorAll('[role="alert"]')]
        .map(node => node.textContent?.trim())
        .filter(Boolean)
      try {
        const response = await fetch('/api/me', { credentials: 'same-origin' })
        let value = null
        try { value = await response.json() } catch {}
        return {
          meStatus: response.status,
          uidMatchesExpected: typeof expectedId === 'string' && typeof value?.user?.id === 'string' ? value.user.id === expectedId : null,
          invitationFlowCount: document.querySelectorAll('[data-invitation-flow="true"]').length,
          invitationHeadingCount: [...document.querySelectorAll('h1, h2')].filter(node => node.textContent?.trim() === 'Invitación de entrenamiento').length,
          alerts,
        }
      } catch {
        return {
          meStatus: null,
          uidMatchesExpected: null,
          invitationFlowCount: document.querySelectorAll('[data-invitation-flow="true"]').length,
          invitationHeadingCount: [...document.querySelectorAll('h1, h2')].filter(node => node.textContent?.trim() === 'Invitación de entrenamiento').length,
          alerts,
        }
      }
    }, expected).catch(() => ({ meStatus: null, uidMatchesExpected: null, invitationFlowCount: null, invitationHeadingCount: null, alerts: [] }))
    const cookies = await page.context().cookies(runtime.webOrigin).catch(() => [])
    return {
      ...(stage ? { failureStage: stage } : {}),
      ...(details && Object.keys(details).length ? { failure: details } : {}),
      password: {
        ...(priorSignup ? { signup: priorSignup } : {}),
        login: {
          ...browser,
          alerts: browser.alerts.map(safeUiAlert),
          sessionCookiePresent: cookies.some(cookie => cookie.name === 'gymsid'),
          events,
        }
      }
    }
  }
  const diagnostic = {
    write: async (stage, details) => writeDiagnostic(await snapshot(stage, details)),
    capture: async () => snapshot(),
    stop: () => {
      page.off('response', noteResponse)
      page.off('requestfailed', noteRequestFailed)
      page.off('pageerror', notePageError)
      if (activeDiagnostic === diagnostic) activeDiagnostic = null
    }
  }
  return diagnostic
}
function inspectWorkflowContext(page) {
  const startedAt = Date.now()
  const events = []
  const note = response => {
    try {
      const url = new URL(response.url())
      if (url.origin === runtime.webOrigin && url.pathname.startsWith('/api/')) events.push({ atMs: Date.now() - startedAt, path: url.pathname, method: response.request().method(), status: response.status() })
    } catch {}
  }
  page.on('response', note)
  const noteFailed = request => {
    try {
      const url = new URL(request.url())
      if (url.origin === runtime.webOrigin && url.pathname.startsWith('/api/')) events.push({ atMs: Date.now() - startedAt, path: url.pathname, method: request.method(), error: safeNetworkError(request.failure()?.errorText) })
    } catch {}
  }
  page.on('requestfailed', noteFailed)
  const checkedInput = label => page.getByLabel(label).evaluateAll(nodes => nodes.length === 1 ? Boolean(nodes[0].checked) : null).catch(() => null)
  const snapshot = async (stage, details) => ({
    failureStage: stage || diagnosticStage || null,
    failure: details || diagnosticDetails || null,
    workflow: {
      elapsedMs: Date.now() - startedAt,
      invitationFlowCount: await page.locator('[data-invitation-flow="true"]').count().catch(() => null),
      headingCount: await page.locator('h1, h2').count().catch(() => null),
      acceptButtonCount: await page.getByRole('button', { name: 'Aceptar las propuestas seleccionadas' }).count().catch(() => null),
      acceptButtonEnabledCount: await page.getByRole('button', { name: 'Aceptar las propuestas seleccionadas' }).evaluateAll(nodes => nodes.filter(node => !node.disabled).length).catch(() => null),
      planChecked: await checkedInput('PLAN'),
      executionChecked: await checkedInput('EXECUTION'),
      consentChecked: await checkedInput('Confirmo explícitamente las propuestas seleccionadas.'),
      alertCount: await page.locator('[role="alert"]').count().catch(() => null),
      alertTexts: await page.locator('[role="alert"]').allTextContents().then(values => values.map(safeUiAlert).filter(Boolean)).catch(() => []),
      events,
    },
  })
  const diagnostic = {
    write: async (stage, details) => writeDiagnostic(await snapshot(stage, details)),
    capture: async () => snapshot(),
    stop: () => { page.off('response', note); page.off('requestfailed', noteFailed); if (activeDiagnostic === diagnostic) activeDiagnostic = null },
  }
  return diagnostic
}
function sql(query, ...values) {
  const db = new DatabaseSync(`${runtime.dataDir}/authority.sqlite`)
  try { return db.prepare(query).all(...values) } finally { db.close() }
}

async function inspectAdminEntry(page) {
  const consoleKinds = new Map()
  const pageErrors = []
  const network = []
  const noteConsole = message => consoleKinds.set(message.type(), (consoleKinds.get(message.type()) || 0) + 1)
  const notePageError = () => pageErrors.push(true)
  const noteResponse = response => {
    try {
      const url = new URL(response.url())
      if (url.origin === runtime.webOrigin && url.pathname.startsWith('/api/')) network.push({ path: url.pathname, status: response.status() })
    } catch {}
  }
  page.on('console', noteConsole)
  page.on('pageerror', notePageError)
  page.on('response', noteResponse)
  try {
    await page.goto('/#/admin/operations')
    let headingVisible = false
    try {
      await expect(page.getByRole('heading', { name: 'Administración operativa' })).toBeVisible()
      headingVisible = true
    } catch {}
    const browser = await page.evaluate(async () => {
      const read = async path => {
        const response = await fetch(path, { credentials: 'same-origin' })
        let value = null
        try { value = await response.json() } catch {}
        return { status: response.status, value }
      }
      const [config, me, access] = await Promise.all([read('/api/config'), read('/api/me'), read('/api/access')])
      const selectedText = [...document.querySelectorAll('h1, [role="status"], [aria-live]')]
        .map(node => node.textContent?.trim())
        .filter(text => text === 'Administración operativa' || text === 'Comprobando sesión')
      return {
        config: { status: config.status, managed: config.value?.managed_subscriptions === true, allowGuest: config.value?.allow_guest === false },
        me: { status: me.status, uid: typeof me.value?.user?.id === 'string' ? me.value.user.id : null },
        access: {
          status: access.status,
          roles: Array.isArray(access.value?.roles) ? access.value.roles.filter(role => ['CLIENT', 'TRAINER', 'COORDINATOR'].includes(role)) : [],
          capabilities: Array.isArray(access.value?.capabilities) ? access.value.capabilities.filter(capability => ['MANAGE_OPERATIONAL_ROLES', 'CREATE_INVITATION', 'ACCESS_PERSONAL_TRAINING'].includes(capability)) : []
        },
        body: {
          headingVisible: selectedText.includes('Administración operativa'),
          checkingSessionVisible: selectedText.includes('Comprobando sesión'),
          headingCount: document.querySelectorAll('h1').length,
          managedRootCount: document.querySelectorAll('[data-managed-operations="true"]').length,
          viteErrorOverlayCount: document.querySelectorAll('vite-error-overlay').length,
          viteErrorMessages: [...document.querySelectorAll('vite-error-overlay')].map(node =>
            (node.shadowRoot?.querySelector('.message-body')?.textContent || '')
              .replace(/[A-Za-z0-9_-]{43,}/g, '[REDACTED]')
              .replace(/https?:\/\/\S+/g, '[URL]')
              .slice(0, 1000))
        }
      }
    })
    const snapshot = (stage, body, details = diagnosticDetails) => ({
      uid: browser.me.uid === runtime.ids.admin ? browser.me.uid : null,
      ...(stage ? { failureStage: stage } : {}),
      ...(details && Object.keys(details).length ? { failure: details } : {}),
      browser: { ...browser, body },
      headingVisible,
      console: Object.fromEntries([...consoleKinds].map(([kind, count]) => [kind, count])),
      pageErrorCount: pageErrors.length,
      network: network.map(item => ({ path: item.path, status: item.status }))
    })
    const body = async () => page.evaluate(() => ({
      headingVisible: [...document.querySelectorAll('h1')].some(node => node.textContent?.trim() === 'Administración operativa'),
      checkingSessionVisible: [...document.querySelectorAll('h1')].some(node => node.textContent?.trim() === 'Comprobando sesión'),
      headingCount: document.querySelectorAll('h1').length,
      managedRootCount: document.querySelectorAll('[data-managed-operations="true"]').length,
      viteErrorOverlayCount: document.querySelectorAll('vite-error-overlay').length,
      viteErrorMessages: [...document.querySelectorAll('vite-error-overlay')].map(node =>
        (node.shadowRoot?.querySelector('.message-body')?.textContent || '')
          .replace(/[A-Za-z0-9_-]{43,}/g, '[REDACTED]')
          .replace(/https?:\/\/\S+/g, '[URL]')
          .slice(0, 1000)),
      roleConfirmedCount: [...document.querySelectorAll('[role="status"]')].filter(node => node.textContent?.trim() === 'Roles confirmados por el servidor.').length,
      roleUncertainCount: [...document.querySelectorAll('[role="alert"]')].filter(node => node.textContent?.trim() === 'No se confirmó el resultado. Reintenta sin cambiar la intención para conservar el mismo identificador de operación.').length,
      roleDeniedCount: [...document.querySelectorAll('[role="alert"]')].filter(node => node.textContent?.trim() === 'El servidor denegó el cambio; se conservó el formulario.').length
    })).catch(() => browser.body)
    activeDiagnostic = {
      write: async (stage, details) => writeDiagnostic(snapshot(stage, await body(), details)),
      stop: () => {
        page.off('console', noteConsole)
        page.off('pageerror', notePageError)
        page.off('response', noteResponse)
        activeDiagnostic = null
      }
    }
    await activeDiagnostic.write()
    if (!headingVisible) failStage('ADMIN_OPERATIONS_HEADING')
  } catch (error) {
    page.off('console', noteConsole)
    page.off('pageerror', notePageError)
    page.off('response', noteResponse)
    throw error
  }
}

test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const error = testInfo.errors?.[0] || testInfo.error
    await activeDiagnostic?.write(diagnosticStage || 'ADMIN_ENTRY', {
      cause: sanitizedCause(error),
      testDurationMs: Math.round(testInfo.duration),
    })
  }
})

test('M1 onboarding keeps invitation, consent, role confirmation, commercial confirmation, and owned data separate', async ({ browser }) => {
  test.setTimeout(600_000)
  if (!runtimePath) failStage('RUNTIME_REQUIRED')
  const config = await api('/api/config')
  if (config.status !== 200 || config.value?.password_login !== true || config.value?.invite_only !== true || config.value?.allow_guest !== false || config.value?.managed_subscriptions !== true || !config.value?.media) failStage('M1_PUBLIC_CONFIG')

  // Fixture-only direct provisioning is intentionally limited to the two pre-existing CLIENTs.
  // Every action below that changes a role, scope, invitation, consent, relation, or interval is UI-driven.
  for (const id of [runtime.ids['preexisting-client'], runtime.ids.unrelated]) {
    const setup = await api('/api/admin/operations/roles', { method: 'POST', uid: runtime.ids.admin, body: { operationId: operation(), expectedVersion: 0, payload: { accountId: id, roles: ['CLIENT'], reason: 'isolated fixture provisioning' } } })
    if (setup.status !== 200) failStage('FIXTURE_CLIENT_ROLE')
  }

  const admin = await signedContext(browser, runtime.ids.admin)
  const adminPage = await admin.newPage()
  await inspectAdminEntry(adminPage)
  const trainerAccount = adminPage.getByLabel('Cuenta existente del servidor')
  await at('ADMIN_SELECT_TRAINER', trainerAccount, () => trainerAccount.selectOption(runtime.ids.trainer))
  const roles = adminPage.getByRole('group', { name: 'Roles operativos' })
  const trainerRole = roles.getByLabel('TRAINER')
  const coordinatorRole = roles.getByLabel('COORDINATOR')
  const roleReason = adminPage.getByLabel('Motivo').first()
  const saveRoles = adminPage.getByRole('button', { name: 'Guardar roles' })
  const roleStatus = adminPage.locator('p[role="status"]')
  await at('ADMIN_CHECK_TRAINER_ROLE', trainerRole, () => trainerRole.check())
  await at('ADMIN_CHECK_COORDINATOR_ROLE', coordinatorRole, () => coordinatorRole.check())
  await at('ADMIN_ROLE_REASON', roleReason, () => roleReason.fill('isolated operational role'))
  await at('ADMIN_SAVE_ROLES', saveRoles, () => saveRoles.click())
  await at('ADMIN_ROLE_CONFIRMATION', roleStatus, () => expect(roleStatus).toHaveText('Roles confirmados por el servidor.', { timeout: 30_000 }))
  await at('ADMIN_RELOAD', null, () => adminPage.reload())
  diagnosticStage = 'ROLE_SQL_READBACK'
  if (!sql('SELECT role FROM operational_roles WHERE account_id=? AND removed_at_utc IS NULL ORDER BY role', runtime.ids.trainer).map(row => row.role).join(',').includes('COORDINATOR,TRAINER')) failStage('ROLE_SQL_READBACK')
  const coordinatorSelect = adminPage.getByLabel('Coordinador existente')
  const clientSelect = adminPage.getByLabel('Cliente existente')
  const scopeReadback = adminPage.getByText('Estado actual:', { exact: false })
  const scopeAssigned = adminPage.getByLabel('Asignar este par')
  const scopeReason = adminPage.getByLabel('Motivo').last()
  const saveScope = adminPage.getByRole('button', { name: 'Guardar ámbito' })
  const scopeStatus = adminPage.locator('p[role="status"]')
  await at('ADMIN_SELECT_COORDINATOR', coordinatorSelect, () => coordinatorSelect.selectOption(runtime.ids.trainer))
  await at('ADMIN_SELECT_CLIENT_SCOPE', clientSelect, () => clientSelect.selectOption(runtime.ids['preexisting-client']))
  await at('ADMIN_SCOPE_READBACK', scopeReadback, () => expect(scopeReadback).toBeVisible())
  await at('ADMIN_ASSIGN_SCOPE', scopeAssigned, () => scopeAssigned.check())
  await at('ADMIN_SCOPE_REASON', scopeReason, () => scopeReason.fill('isolated commercial scope'))
  await at('ADMIN_SAVE_SCOPE', saveScope, () => saveScope.click())
  await at('ADMIN_SCOPE_CONFIRMATION', scopeStatus, () => expect(scopeStatus).toHaveText('Ámbito confirmado por el servidor.', { timeout: 30_000 }))
  await at('ADMIN_SCOPE_POST_READBACK', scopeReadback, () => expect(scopeReadback).toContainText('Asignado'))
  diagnosticStage = 'SCOPE_SQL_READBACK'
  const scopeRowCount = sql('SELECT * FROM coordinator_scopes WHERE coordinator_id=? AND client_id=?', runtime.ids.trainer, runtime.ids['preexisting-client']).length
  const activeScopeRowCount = sql('SELECT * FROM coordinator_scopes WHERE removed_at_utc IS NULL').length
  if (!scopeRowCount) failStage(`SCOPE_SQL_READBACK_ROWS_${scopeRowCount}_ACTIVE_${activeScopeRowCount}`, { scopeRowCount, activeScopeRowCount })
  await admin.close()

  const trainer = await signedContext(browser, runtime.ids.trainer)
  await trainer.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: runtime.webOrigin })
  const trainerPage = await trainer.newPage()
  await trainerPage.goto('/#/trainer')
  await expect(trainerPage.getByRole('heading', { name: 'Entrenamiento del entrenador' })).toBeVisible()
  await trainerPage.getByLabel('Propósito / nombre contextual').fill(runtime.label)
  await trainerPage.getByLabel('PLAN').check()
  await trainerPage.getByLabel('EXECUTION').check()
  await trainerPage.getByRole('button', { name: 'Crear invitación' }).click()
  await expect(trainerPage.getByText('Enlace de un solo uso', { exact: false })).toBeVisible()
  await trainerPage.getByRole('button', { name: 'Copiar enlace' }).click()
  const invitationUrl = await trainerPage.evaluate(() => navigator.clipboard.readText())
  if (!invitationUrl.startsWith(`${runtime.webOrigin}/`) || !invitationUrl.includes('#invite=')) failStage('INVITATION_LINK')

  const client = await browser.newContext()
  client.setDefaultTimeout(30_000)
  client.setDefaultNavigationTimeout(30_000)
  await client.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: runtime.webOrigin })
  const clientPage = await client.newPage()
  const clientNetwork = []
  const noteClientResponse = response => {
    try {
      const url = new URL(response.url())
      if (url.origin === runtime.webOrigin && url.pathname.startsWith('/api/')) clientNetwork.push({ path: url.pathname, status: response.status() })
    } catch {}
  }
  clientPage.on('response', noteClientResponse)
  await virtualAuthenticator(clientPage)
  await clientPage.goto(invitationUrl)
  await expect(clientPage).not.toHaveURL(/#invite=/)
  await expect(clientPage.locator('[data-invitation-consent="true"]')).toBeVisible()
  await expect(clientPage.getByLabel('PLAN')).not.toBeChecked()
  await expect(clientPage.getByLabel('EXECUTION')).not.toBeChecked()
  await at('CLIENT_PASSWORD_INVITATION_PLAN', clientPage.getByLabel('PLAN'), () => clientPage.getByLabel('PLAN').check())
  await at('CLIENT_PASSWORD_INVITATION_EXECUTION', clientPage.getByLabel('EXECUTION'), () => clientPage.getByLabel('EXECUTION').check())
  await at('CLIENT_PASSWORD_INVITATION_CONSENT', clientPage.getByLabel('Confirmo explícitamente las propuestas seleccionadas.'), () => clientPage.getByLabel('Confirmo explícitamente las propuestas seleccionadas.').check())
  await clientPage.getByRole('button', { name: 'Create new profile' }).click()
  await clientPage.getByPlaceholder('Your name').fill(`${runtime.label}-new-client`)
  await clientPage.getByRole('button', { name: 'Create passkey' }).click()
  const invitationFlowHeading = clientPage.getByRole('heading', { name: 'Invitación de entrenamiento' })
  try {
    await at('CLIENT_PASSKEY_RETURN_TO_INVITATION', invitationFlowHeading, () => expect(invitationFlowHeading).toBeVisible({ timeout: 30_000 }))
  } catch (error) {
    activeDiagnostic?.stop()
    writeDiagnostic({
      failureStage: 'CLIENT_PASSKEY_RETURN_TO_INVITATION',
      failure: { cause: sanitizedCause(error), locatorCount: await invitationFlowHeading.count().catch(() => null) },
      client: {
        headings: await clientPage.locator('h1, h2').allTextContents().then(values => values.filter(value => ['JohnGym', 'Invitación de entrenamiento', 'Training invitation'].includes(value.trim()))).catch(() => []),
        invitationFlowCount: await clientPage.locator('[data-invitation-flow="true"]').count().catch(() => null),
      },
      network: clientNetwork.map(item => ({ path: item.path, status: item.status })),
    })
    throw error
  }

  // A second managed link exercises the password producer and a fresh browser context signs in
  // to the same pending invitation.  The generated password stays only in this test process;
  // diagnostics retain paths/statuses, never request bodies.
  await trainerPage.getByLabel('Propósito / nombre contextual').fill(`${runtime.label}-password`)
  await trainerPage.getByRole('button', { name: 'Crear invitación' }).click()
  await trainerPage.getByRole('button', { name: 'Copiar enlace' }).click()
  const passwordInvitationUrl = await trainerPage.evaluate(() => navigator.clipboard.readText())
  if (!passwordInvitationUrl.startsWith(`${runtime.webOrigin}/`) || !passwordInvitationUrl.includes('#invite=')) failStage('PASSWORD_INVITATION_LINK')
  const password = crypto.randomBytes(24).toString('base64url')
  const passwordName = `pwd-${crypto.randomBytes(8).toString('hex')}`
  const passwordClient = await browser.newContext()
  passwordClient.setDefaultTimeout(30_000)
  passwordClient.setDefaultNavigationTimeout(30_000)
  const passwordPage = await passwordClient.newPage()
  activeDiagnostic?.stop()
  const passwordSignupDiagnostic = inspectPasswordContext(passwordPage)
  activeDiagnostic = passwordSignupDiagnostic
  await passwordPage.goto(passwordInvitationUrl)
  await expect(passwordPage).not.toHaveURL(/#invite=/)
  await expect(passwordPage.locator('[data-invitation-consent="true"]')).toBeVisible()
  await passwordPage.getByLabel('PLAN').check()
  await passwordPage.getByLabel('EXECUTION').check()
  await passwordPage.getByLabel('Confirmo explícitamente las propuestas seleccionadas.').check()
  await passwordPage.getByRole('button', { name: 'Create new profile' }).click()
  await passwordPage.getByRole('button', { name: 'Password', exact: true }).click()
  await expect(passwordPage.getByPlaceholder('Invite code')).toHaveCount(0)
  await passwordPage.getByPlaceholder('Your name').fill(passwordName)
  await passwordPage.getByPlaceholder('Password', { exact: true }).fill(password)
  await passwordPage.getByPlaceholder('Repeat the password').fill(password)
  await passwordPage.getByRole('button', { name: 'Create profile' }).click()
  await at('CLIENT_PASSWORD_RETURN_TO_INVITATION', passwordPage.getByRole('heading', { name: 'Invitación de entrenamiento' }), () => expect(passwordPage.getByRole('heading', { name: 'Invitación de entrenamiento' })).toBeVisible({ timeout: 30_000 }))
  await expect(passwordPage.getByText('Una cuenta creada mediante la invitación queda pendiente de rol operativo y confirmación del entrenador.')).toBeVisible()
  const createdIdentity = await passwordPage.evaluate(async () => {
    const response = await fetch('/api/me', { credentials: 'same-origin' })
    let value = null
    try { value = await response.json() } catch {}
    return { status: response.status, uid: typeof value?.user?.id === 'string' ? value.user.id : null }
  })
  const passwordExpectedUid = createdIdentity.status === 200 ? createdIdentity.uid : null
  const passwordSignupSnapshot = await passwordSignupDiagnostic.capture()
  passwordSignupDiagnostic.stop()
  await passwordClient.close()
  const passwordLoginClient = await browser.newContext()
  passwordLoginClient.setDefaultTimeout(30_000)
  passwordLoginClient.setDefaultNavigationTimeout(30_000)
  const passwordLoginPage = await passwordLoginClient.newPage()
  const passwordLoginDiagnostic = inspectPasswordContext(passwordLoginPage, () => passwordExpectedUid, passwordSignupSnapshot.password.login)
  activeDiagnostic = passwordLoginDiagnostic
  await passwordLoginPage.goto(passwordInvitationUrl)
  await expect(passwordLoginPage.locator('[data-invitation-consent="true"]')).toBeVisible()
  await passwordLoginPage.getByRole('button', { name: 'Sign in with password' }).click()
  await passwordLoginPage.getByPlaceholder('Name or e-mail').fill(passwordName)
  await passwordLoginPage.getByPlaceholder('Password').fill(password)
  await passwordLoginPage.getByRole('button', { name: 'Sign in', exact: true }).click()
  diagnosticStage = 'CLIENT_PASSWORD_LOGIN_RETURN_TO_INVITATION'
  await at('CLIENT_PASSWORD_LOGIN_RETURN_TO_INVITATION', passwordLoginPage.getByRole('heading', { name: 'Invitación de entrenamiento' }), () => expect(passwordLoginPage.getByRole('heading', { name: 'Invitación de entrenamiento' })).toBeVisible({ timeout: 30_000 }))
  await passwordLoginDiagnostic.write()
  passwordLoginDiagnostic.stop()
  await passwordLoginClient.close()
  activeDiagnostic = inspectWorkflowContext(clientPage)
  await activeDiagnostic.write('POST_PASSWORD_TRANSITION_READY')

  await at('CLIENT_PASSWORD_ACCEPT_PLAN', clientPage.getByLabel('PLAN'), () => clientPage.getByLabel('PLAN').check())
  await at('CLIENT_PASSWORD_ACCEPT_EXECUTION', clientPage.getByLabel('EXECUTION'), () => clientPage.getByLabel('EXECUTION').check())
  await at('CLIENT_PASSWORD_ACCEPT_CONSENT', clientPage.getByLabel('Confirmo explícitamente las propuestas seleccionadas.'), () => clientPage.getByLabel('Confirmo explícitamente las propuestas seleccionadas.').check())
  await activeDiagnostic.write('INVITATION_ACCEPT_READY')
  const acceptanceResponse = clientPage.waitForResponse(response => {
    try { return new URL(response.url()).pathname === '/api/invitations/accept' && response.request().method() === 'POST' }
    catch { return false }
  }, { timeout: 30_000 })
  await at('INVITATION_ACCEPT_CLICK', clientPage.getByRole('button', { name: 'Aceptar las propuestas seleccionadas' }), async () => { await clientPage.getByRole('button', { name: 'Aceptar las propuestas seleccionadas' }).click() })
  const acceptance = await at('INVITATION_ACCEPT_RESPONSE', null, () => acceptanceResponse)
  const acceptanceMeta = { status: acceptance.status(), receiptHeaderPresent: !!acceptance.headers()['x-request-id'] }
  await activeDiagnostic?.write('INVITATION_ACCEPT_RESPONSE', { response: acceptanceMeta })
  if (acceptance.status() !== 200) failStage(`INVITATION_ACCEPT_STATUS_${acceptance.status()}`, { response: acceptanceMeta })
  // InvitationFlow clears the volatile invitation only after receipt + exact pendingProposals
  // readback. The settled UI is therefore the observable synchronization contract.
  // Source-contract anchor: await expect(clientPage.locator('[data-invitation-flow="true"]')).toHaveCount(0)
  await at('INVITATION_SETTLED_FLOW', clientPage.locator('[data-invitation-flow="true"]'), () => expect(clientPage.locator('[data-invitation-flow="true"]')).toHaveCount(0, { timeout: 30_000 }))
  await at('INVITATION_SETTLED_HEADING', clientPage.getByRole('heading', { name: 'Invitación de entrenamiento' }), () => expect(clientPage.getByRole('heading', { name: 'Invitación de entrenamiento' })).toHaveCount(0, { timeout: 30_000 }))
  const me = await at('BROWSER_REGISTER_READBACK_REQUEST', null, () => browserApi(client, '/api/me'))
  // Source-contract anchor: const me = await browserApi(client, '/api/me')
  const newClientId = me.value?.user?.id
  if (me.status !== 200 || !newClientId) failStage('BROWSER_REGISTER_READBACK', { response: safeReadback(me, me.value), idPresent: !!newClientId })
  await activeDiagnostic?.write('BROWSER_REGISTER_READBACK', { response: safeReadback(me, me.value), idPresent: !!newClientId })
  const relations = await at('PENDING_RELATION_READBACK_REQUEST', null, () => browserApi(client, '/api/client/relations'))
  // Source-contract anchor: const relations = await browserApi(client, '/api/client/relations')
  const relationState = relations.value?.relations?.[0]?.state
  if (relations.status !== 200 || relationState !== 'PENDING_CONFIRMATION') failStage('PENDING_RELATION_READBACK', { response: safeReadback(relations, relations.value), stateEnum: typeof relationState === 'string' ? relationState : 'absent' })
  await activeDiagnostic?.write('PENDING_RELATION_READBACK', { response: safeReadback(relations, relations.value), stateEnum: typeof relationState === 'string' ? relationState : 'absent' })

  // Owned-data actions remain available while personal training is still denied.
  await at('OWNED_DATA_NAVIGATION', null, () => clientPage.goto('/#/account/data'))
  await at('OWNED_DATA_HEADING', clientPage.getByRole('heading', { name: 'Tus datos' }), () => expect(clientPage.getByRole('heading', { name: 'Tus datos' })).toBeVisible({ timeout: 30_000 }))
  const download = at('OWNED_EXPORT_DOWNLOAD_EVENT', null, () => clientPage.waitForEvent('download', { timeout: 30_000 }))
  await at('OWNED_EXPORT_DOWNLOAD_CLICK', clientPage.getByRole('button', { name: 'Descargar mis datos JSON' }), () => clientPage.getByRole('button', { name: 'Descargar mis datos JSON' }).click())
  await download
  await at('DELETION_CONSENT', clientPage.getByLabel('Entiendo que esto solicita una eliminación; no borra datos ahora.'), () => clientPage.getByLabel('Entiendo que esto solicita una eliminación; no borra datos ahora.').check())
  await at('DELETION_REQUEST_CLICK', clientPage.getByRole('button', { name: 'Solicitar eliminación' }), () => clientPage.getByRole('button', { name: 'Solicitar eliminación' }).click())
  const training = await at('PENDING_TRAINING_GATE_READBACK', null, () => browserApi(client, '/api/client/plan/current'))
  if (training.status !== 403) failStage('PENDING_TRAINING_GATE', { status: training.status })
  const exports = await at('OWNED_EXPORT_REQUEST', null, () => browserApi(client, '/api/client/exports', { method: 'POST', body: { operationId: operation(), expectedVersion: 1, payload: {} } }))
  if (exports.status !== 200 || headerValue(exports.headers, 'cache-control') !== 'private, no-store') failStage('OWNED_EXPORT_READBACK', { response: safeReadback(exports, exports.value) })
  await activeDiagnostic?.write('OWNED_EXPORT_READBACK', { response: safeReadback(exports, exports.value) })
  const foreign = await at('FOREIGN_EXPORT_REQUEST', null, () => api(`/api/client/exports/${exports.value.result.jobId}`, { uid: runtime.ids.unrelated }))
  if (foreign.status !== 404 || headerValue(foreign.headers, 'cache-control') !== 'private, no-store') failStage('FOREIGN_EXPORT_PRIVATE', { response: safeReadback(foreign, foreign.value) })
  await at('DELETION_SQL_READBACK', null, async () => { if (!sql('SELECT * FROM deletion_requests WHERE account_id=?', newClientId).length) throw new Error('deletion request row absent') })

  await at('TRAINER_RELOAD', null, () => trainerPage.reload())
  await at('TRAINER_CONFIRM_IDENTITY', trainerPage.getByLabel('Confirmé explícitamente la identidad del cliente'), () => trainerPage.getByLabel('Confirmé explícitamente la identidad del cliente').check())
  await at('TRAINER_CONFIRM_CLICK', trainerPage.getByRole('button', { name: 'Confirmar relación' }), () => trainerPage.getByRole('button', { name: 'Confirmar relación' }).click())
  await at('TRAINER_CONFIRM_SQL_READBACK', null, async () => { if (sql('SELECT state FROM relations WHERE client_id=?', newClientId)[0]?.state !== 'ACTIVE') throw new Error('relation state is not ACTIVE') })
  await at('COMMERCIAL_NAVIGATION', null, () => trainerPage.goto('/#/commercial'))
  await at('COMMERCIAL_HEADING', trainerPage.getByRole('heading', { name: 'Operaciones comerciales' }), () => expect(trainerPage.getByRole('heading', { name: 'Operaciones comerciales' })).toBeVisible({ timeout: 30_000 }))
  await at('COMMERCIAL_CLIENT_SELECT', trainerPage.getByLabel('Cliente seleccionado'), () => trainerPage.getByLabel('Cliente seleccionado').selectOption(runtime.ids['preexisting-client']))
  await at('COMMERCIAL_REFERENCE', trainerPage.getByLabel('Referencia del registro externo'), () => trainerPage.getByLabel('Referencia del registro externo').fill(`manual-${runtime.label}`))
  await at('COMMERCIAL_REASON', trainerPage.getByLabel('Razón', { exact: true }), () => trainerPage.getByLabel('Razón', { exact: true }).fill('isolated manual confirmation'))
  await at('COMMERCIAL_CONSENT', trainerPage.getByLabel('Confirmo explícitamente este cliente, tipo, referencia y razón.'), () => trainerPage.getByLabel('Confirmo explícitamente este cliente, tipo, referencia y razón.').check())
  const commercialResponse = trainerPage.waitForResponse(response => {
    try { return new URL(response.url()).pathname === '/api/admin/commercial/operations/confirm' && response.request().method() === 'POST' }
    catch { return false }
  }, { timeout: 30_000 })
  await at('COMMERCIAL_CONFIRM_CLICK', trainerPage.getByRole('button', { name: 'Confirmar operación' }), () => trainerPage.getByRole('button', { name: 'Confirmar operación' }).click())
  const commercialHttp = await at('COMMERCIAL_RESPONSE', null, () => commercialResponse)
  if (commercialHttp.status() !== 200) failStage(`COMMERCIAL_STATUS_${commercialHttp.status()}`)
  await at('COMMERCIAL_RECEIPT', trainerPage.getByRole('heading', { name: 'Recibo confirmado', exact: true }), () => expect(trainerPage.getByRole('heading', { name: 'Recibo confirmado', exact: true })).toBeVisible({ timeout: 30_000 }))
  await at('COMMERCIAL_SQL_READBACK', null, async () => { if (!sql('SELECT * FROM subscription_intervals WHERE client_id=?', runtime.ids['preexisting-client']).length) throw new Error('subscription interval row absent') })
  const combined = await api('/api/access', { uid: runtime.ids.trainer })
  if (combined.status !== 200 || combined.value.capabilities.includes('ACCESS_PERSONAL_TRAINING')) failStage('COMBINED_ROLE_NO_FREE_GATE')
  if ((await api('/api/client/plan/current', { uid: runtime.ids.trainer })).status !== 403) failStage('NO_CLIENT_ROLE_TRAINING')

  const knownToken = invitationUrl.split('#invite=')[1]
  const deniedKnown = await api('/api/register/options', { method: 'POST', body: { name: `${runtime.label}-wrong`, inviteToken: knownToken } })
  const deniedUnknown = await api('/api/register/options', { method: 'POST', body: { name: `${runtime.label}-wrong`, inviteToken: crypto.randomBytes(32).toString('base64url') } })
  if (deniedKnown.status !== deniedUnknown.status || JSON.stringify(deniedKnown.value) !== JSON.stringify(deniedUnknown.value)) failStage('GENERIC_INVITE_DENIAL')

  activeDiagnostic?.stop()
  await adminPage.close(); await trainer.close(); await client.close()
})
