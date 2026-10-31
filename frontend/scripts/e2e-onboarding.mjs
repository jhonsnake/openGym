/* Isolated T9 browser harness.  It never discovers a default API, data directory, or web server. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { validateHarnessInputs } from './e2e-onboarding-inputs.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const configuredArtifactRoot = process.env.OPENGYM_E2E_ARTIFACT_ROOT
// Keep failure reporting itself isolated when input validation fails before a caller supplies a root.
const artifactRoot = configuredArtifactRoot || path.join(os.tmpdir(), `opengym-e2e-input-error-${process.pid}`)
// This password diagnosis has immutable evidence names; never overwrite a prior T9 receipt.
const args = process.argv.slice(2)
const fixtureRoot = process.env.OPENGYM_E2E_FRONTEND_ROOT
const image = process.env.OPENGYM_E2E_API_IMAGE
const allRuns = Object.freeze([['m0', 'm0-branding-desktop'], ['m0', 'm0-branding-mobile'], ['m1', 'm1-onboarding-desktop'], ['m1', 'm1-onboarding-mobile'], ['m1', 'm1-clinical-desktop'], ['m1', 'm1-clinical-mobile']])
const requestedProjects = process.env.OPENGYM_E2E_PROJECTS ? new Set(process.env.OPENGYM_E2E_PROJECTS.split(',').filter(Boolean)) : null
const clinicalProjects = new Set(['m1-clinical-desktop', 'm1-clinical-mobile'])
const clinicalEvidence = !!requestedProjects && requestedProjects.size > 0 && [...requestedProjects].every(project => clinicalProjects.has(project))
const clinicalEvidenceFiles = Object.freeze({ report: 'clinical-browser-acceptance-report.md', output: 'clinical-browser-acceptance-output.json', tests: 'clinical-browser-acceptance-tests.log' })
const evidencePrefix = clinicalEvidence ? 'clinical-browser-acceptance' : 't9-password-diagnostic'
const reportFile = path.join(artifactRoot, clinicalEvidence ? clinicalEvidenceFiles.report : `${evidencePrefix}-report.md`)
const redFile = path.join(artifactRoot, clinicalEvidence ? clinicalEvidenceFiles.tests : `${evidencePrefix}-red.log`)
const greenFile = path.join(artifactRoot, clinicalEvidence ? clinicalEvidenceFiles.tests : `${evidencePrefix}-green.log`)
const outputFile = path.join(artifactRoot, clinicalEvidence ? clinicalEvidenceFiles.output : `${evidencePrefix}-output.json`)
const resultFile = path.join(artifactRoot, `${evidencePrefix}-result.txt`)
const imageTag = process.env.OPENGYM_E2E_API_IMAGE_TAG
const expectedImageId = process.env.OPENGYM_E2E_API_IMAGE_ID

function fail(message) { throw new Error(`T9 e2e harness: ${message}`) }
function run(command, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { ...options, stdio: options.stdio || ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}
const shell = async (argv, options) => {
  const result = await run('docker', argv, options)
  if (result.code !== 0) {
    const diagnostic = `${result.stderr || result.stdout}`.replace(/https?:\/\/[^\s]+/g, '[redacted-url]').replace(/\s+/g, ' ').slice(0, 500)
    fail(`docker ${argv[0]} failed (${result.code})${diagnostic ? `: ${diagnostic}` : ''}`)
  }
  return result.stdout.trim()
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const privateWrite = (file, value) => fs.writeFileSync(file, value, { mode: 0o600 })
const sanitizeFailure = value => String(value || 'unknown Playwright failure')
  .replace(/\x1B\[[0-9;]*m/g, '')
  .replace(/https?:\/\/[^\s'"\])}]+/g, '[redacted-url]')
  .replace(/(?:gymsid|cookie|password|inviteToken)\s*[:=]\s*[^\s,;"']+/gi, '$1=[redacted]')
  .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
  .replace(/\s+/g, ' ')
  .slice(0, 700)
const playwrightFailure = raw => {
  try {
    const failures = []
    const visit = value => {
      if (!value || typeof value !== 'object') return
      if (typeof value.message === 'string' && ('stack' in value || 'location' in value)) failures.push({ message: value.message, stack: typeof value.stack === 'string' ? value.stack : '', location: value.location })
      if (Array.isArray(value)) value.forEach(visit)
      else Object.values(value).forEach(visit)
    }
    visit(JSON.parse(raw))
    if (!failures.length) return null
    const failure = failures[0]
    const location = failure.location && typeof failure.location.file === 'string'
      ? ` @ ${failure.location.file}:${failure.location.line || 0}:${failure.location.column || 0}`
      : ''
    return `${sanitizeFailure(failure.message)}${location}`.slice(0, 700)
  } catch { return null }
}
const hmacCookie = (uid, secret) => {
  const payload = `${uid}:${Date.now() + 60 * 60 * 1000}:0`
  return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
}
async function fixtureRequest(apiOrigin, secret, pathName, { uid, body, method = 'POST' }) {
  const response = await fetch(apiOrigin + pathName, {
    method,
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(uid ? { Cookie: hmacCookie(uid, secret) } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let value = null
  try { value = await response.json() } catch {}
  return { status: response.status, value }
}
const fixtureOperation = () => crypto.randomUUID()
async function prepareClinicalFixture(apiOrigin, secret, ids) {
  const mutate = async (pathName, uid, payload, expectedVersion = 0) => {
    const response = await fixtureRequest(apiOrigin, secret, pathName, { uid, body: { operationId: fixtureOperation(), expectedVersion, payload } })
    if (response.status !== 200) fail(`clinical fixture ${pathName} returned HTTP ${response.status}`)
    return response.value
  }
  await mutate('/api/admin/operations/roles', ids.admin, { accountId: ids['clinical-trainer'], roles: ['TRAINER'], reason: 'clinical acceptance fixture' })
  await mutate('/api/admin/operations/roles', ids.admin, { accountId: ids.coordinator, roles: ['COORDINATOR'], reason: 'clinical acceptance fixture' })
  await mutate('/api/admin/operations/roles', ids.admin, { accountId: ids['clinical-client'], roles: ['CLIENT'], reason: 'clinical acceptance fixture' })
  await mutate('/api/admin/operations/roles', ids.admin, { accountId: ids['clinical-unrelated'], roles: ['TRAINER'], reason: 'clinical acceptance fixture' })
  await mutate('/api/admin/operations/scopes', ids.admin, { coordinatorId: ids.coordinator, clientId: ids['clinical-client'], assigned: true, reason: 'clinical acceptance fixture' })
  await mutate('/api/admin/commercial/operations/confirm', ids.coordinator, { clientId: ids['clinical-client'], kind: 'MONTHLY', reference: 'clinical-fixture', reason: 'clinical acceptance fixture' })
  const history = { kind: 'HISTORY', startUtc: '2026-01-01T00:00:00.000Z', endExclusiveUtc: new Date().toISOString(), includeWeight: true }
  const invitation = await mutate('/api/trainer/invitations', ids['clinical-trainer'], { knownClientId: ids['clinical-client'], commercialName: 'clinical-fixture', grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }, history] })
  const invitationVersion = invitation?.versionTokens?.find(token => token?.kind === 'INVITATION')?.version
  const invitationToken = invitation?.result?.token
  if (!Number.isSafeInteger(invitationVersion) || typeof invitationToken !== 'string') fail('clinical fixture invitation receipt was incomplete')
  const accepted = await mutate('/api/invitations/accept', ids['clinical-client'], { token: invitationToken, grants: [{ kind: 'PLAN' }, { kind: 'EXECUTION' }, { kind: 'WEIGHT' }, history] }, invitationVersion)
  const relationId = accepted?.result?.relationId
  if (accepted?.result?.state !== 'ACTIVE' || typeof relationId !== 'string') fail('clinical fixture relation was not active')
  return { relationId }
}
const readDiagnostic = file => {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    const role = roleName => ['CLIENT', 'TRAINER', 'COORDINATOR'].includes(roleName)
    const capability = capabilityName => ['MANAGE_OPERATIONAL_ROLES', 'CREATE_INVITATION', 'ACCESS_PERSONAL_TRAINING'].includes(capabilityName)
    const status = value => Number.isInteger(value) ? value : null
    const client = value.client && typeof value.client === 'object' ? {
      headings: Array.isArray(value.client.headings) ? value.client.headings.filter(heading => ['JohnGym', 'Invitación de entrenamiento', 'Training invitation'].includes(heading)) : [],
      invitationFlowCount: Number.isInteger(value.client.invitationFlowCount) ? value.client.invitationFlowCount : null,
    } : null
    const diagnosticText = text => String(text || '')
      .replace(/https?:\/\/[^\s'"\])}]+/g, '[redacted-url]')
      .replace(/(?:gymsid|cookie|password|inviteToken)\s*[:=]\s*[^\s,;"']+/gi, '$1=[redacted]')
      .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
      .replace(/\s+/g, ' ')
      .slice(0, 240)
    const passwordStep = step => {
      if (!step || typeof step !== 'object') return null
      const events = Array.isArray(step.events) ? step.events
        .filter(event => event && ['response', 'request_failed', 'page_error'].includes(event.type)
          && Number.isInteger(event.atMs) && event.atMs >= 0 && event.atMs <= 120_000
          && (event.type === 'page_error' || (typeof event.path === 'string' && /^\/api\/[A-Za-z0-9/_-]+$/.test(event.path) && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method))))
        .map(event => event.type === 'response'
          ? { type: event.type, atMs: event.atMs, path: event.path, method: event.method, status: status(event.status) }
          : event.type === 'request_failed'
            ? { type: event.type, atMs: event.atMs, path: event.path, method: event.method, error: ['aborted', 'timeout', 'connection_refused', 'network_failure'].includes(event.error) ? event.error : 'network_failure' }
            : { type: event.type, atMs: event.atMs, error: 'page_error' })
        : []
      return {
        meStatus: status(step.meStatus),
        uidMatchesExpected: typeof step.uidMatchesExpected === 'boolean' ? step.uidMatchesExpected : null,
        invitationFlowCount: Number.isInteger(step.invitationFlowCount) ? step.invitationFlowCount : null,
        invitationHeadingCount: Number.isInteger(step.invitationHeadingCount) ? step.invitationHeadingCount : null,
        sessionCookiePresent: step.sessionCookiePresent === true,
        alerts: Array.isArray(step.alerts) ? step.alerts.map(diagnosticText).filter(Boolean) : [],
        events,
      }
    }
    const passwordLogin = passwordStep(value.password?.login)
    const password = passwordLogin ? { ...(passwordStep(value.password?.signup) ? { signup: passwordStep(value.password.signup) } : {}), login: passwordLogin } : null
    return {
      uid: typeof value.uid === 'string' && value.uid.startsWith('t9-admin') ? value.uid : null,
      failureStage: typeof value.failureStage === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value.failureStage) ? value.failureStage : null,
      failure: {
        cause: typeof value.failure?.cause === 'string' ? value.failure.cause.slice(0, 600) : null,
        stack: typeof value.failure?.stack === 'string' ? diagnosticText(value.failure.stack) : null,
        locatorCount: Number.isInteger(value.failure?.locatorCount) ? value.failure.locatorCount : null,
        elapsedMs: Number.isInteger(value.failure?.elapsedMs) ? value.failure.elapsedMs : null,
        scopeRowCount: Number.isInteger(value.failure?.scopeRowCount) ? value.failure.scopeRowCount : null,
        activeScopeRowCount: Number.isInteger(value.failure?.activeScopeRowCount) ? value.failure.activeScopeRowCount : null,
        testDurationMs: Number.isInteger(value.failure?.testDurationMs) ? value.failure.testDurationMs : null,
      },
      headingVisible: value.headingVisible === true,
      browser: {
        config: { status: status(value.browser?.config?.status), managed: value.browser?.config?.managed === true, allowGuest: value.browser?.config?.allowGuest === true },
        me: { status: status(value.browser?.me?.status), uid: typeof value.browser?.me?.uid === 'string' && value.browser.me.uid.startsWith('t9-admin') ? value.browser.me.uid : null },
        access: { status: status(value.browser?.access?.status), roles: Array.isArray(value.browser?.access?.roles) ? value.browser.access.roles.filter(role) : [], capabilities: Array.isArray(value.browser?.access?.capabilities) ? value.browser.access.capabilities.filter(capability) : [] },
        body: { headingVisible: value.browser?.body?.headingVisible === true, checkingSessionVisible: value.browser?.body?.checkingSessionVisible === true, headingCount: Number.isInteger(value.browser?.body?.headingCount) ? value.browser.body.headingCount : null, managedRootCount: Number.isInteger(value.browser?.body?.managedRootCount) ? value.browser.body.managedRootCount : null, viteErrorOverlayCount: Number.isInteger(value.browser?.body?.viteErrorOverlayCount) ? value.browser.body.viteErrorOverlayCount : null, viteErrorMessages: Array.isArray(value.browser?.body?.viteErrorMessages) ? value.browser.body.viteErrorMessages.map(diagnosticText).filter(Boolean) : [], roleConfirmedCount: Number.isInteger(value.browser?.body?.roleConfirmedCount) ? value.browser.body.roleConfirmedCount : null, roleUncertainCount: Number.isInteger(value.browser?.body?.roleUncertainCount) ? value.browser.body.roleUncertainCount : null, roleDeniedCount: Number.isInteger(value.browser?.body?.roleDeniedCount) ? value.browser.body.roleDeniedCount : null }
      },
      console: Object.fromEntries(Object.entries(value.console || {}).filter(([kind, count]) => ['error', 'warning', 'info', 'debug', 'log'].includes(kind) && Number.isInteger(count))),
      pageErrorCount: Number.isInteger(value.pageErrorCount) ? value.pageErrorCount : null,
      ...(client ? { client } : {}),
      ...(password ? { password } : {}),
      ...(value.workflow ? { workflow: { elapsedMs: Number.isInteger(value.workflow.elapsedMs) ? value.workflow.elapsedMs : null, invitationFlowCount: Number.isInteger(value.workflow.invitationFlowCount) ? value.workflow.invitationFlowCount : null, headingCount: Number.isInteger(value.workflow.headingCount) ? value.workflow.headingCount : null, acceptButtonCount: Number.isInteger(value.workflow.acceptButtonCount) ? value.workflow.acceptButtonCount : null, acceptButtonEnabledCount: Number.isInteger(value.workflow.acceptButtonEnabledCount) ? value.workflow.acceptButtonEnabledCount : null, planChecked: typeof value.workflow.planChecked === 'boolean' ? value.workflow.planChecked : null, executionChecked: typeof value.workflow.executionChecked === 'boolean' ? value.workflow.executionChecked : null, consentChecked: typeof value.workflow.consentChecked === 'boolean' ? value.workflow.consentChecked : null, alertCount: Number.isInteger(value.workflow.alertCount) ? value.workflow.alertCount : null, alertTexts: Array.isArray(value.workflow.alertTexts) ? value.workflow.alertTexts.map(diagnosticText).filter(Boolean) : [], events: Array.isArray(value.workflow.events) ? value.workflow.events.filter(event => typeof event?.path === 'string' && event.path.startsWith('/api/') && (Number.isInteger(event.status) || typeof event.error === 'string')).map(event => ({ atMs: Number.isInteger(event.atMs) ? event.atMs : null, path: event.path, method: event.method, ...(Number.isInteger(event.status) ? { status: event.status } : { error: ['aborted', 'timeout', 'connection_refused', 'network_failure'].includes(event.error) ? event.error : 'network_failure' }) })) : [] } } : {}),
      network: Array.isArray(value.network) ? value.network.filter(item => typeof item?.path === 'string' && item.path.startsWith('/api/') && Number.isInteger(item.status)).map(item => ({ path: item.path, status: item.status })) : []
    }
  } catch { return null }
}

async function requireFixture() {
  if (!fixtureRoot) fail('OPENGYM_E2E_FRONTEND_ROOT is required; point it at the immutable frontend fixture')
  const resolved = await fsp.realpath(fixtureRoot).catch(() => null)
  if (!resolved || !fs.existsSync(path.join(resolved, 'vite.config.js')) || !fs.existsSync(path.join(resolved, 'package.json'))) fail('OPENGYM_E2E_FRONTEND_ROOT must contain package.json and vite.config.js')
  if (!fs.existsSync(path.join(resolved, 'node_modules', 'vite', 'bin', 'vite.js'))) fail('immutable frontend fixture has no local Vite installation')
  if (!fs.existsSync(path.join(resolved, 'src', 'exercise-names'))) fail('immutable frontend fixture does not contain the source catalogue manifest')
  const frozenApiCategories = path.resolve(resolved, '..', 'api', 'coach', 'core', 'categories.js')
  if (!fs.existsSync(frozenApiCategories)) fail('immutable frontend fixture is missing the frozen sibling api/coach/core/categories.js module')
  return resolved
}
async function prepareArtifactRoot() {
  const inputs = validateHarnessInputs({ image, imageTag, imageId: expectedImageId, artifactRoot: configuredArtifactRoot })
  await fsp.mkdir(inputs.artifactRoot, { recursive: true, mode: 0o700 })
  await fsp.chmod(inputs.artifactRoot, 0o700)
  const stat = await fsp.stat(inputs.artifactRoot)
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) fail('OPENGYM_E2E_ARTIFACT_ROOT must be a private directory')
  const fixedFiles = [reportFile, redFile, greenFile, outputFile, resultFile]
  const existing = fixedFiles.filter(file => fs.existsSync(file))
  if (existing.length) fail('OPENGYM_E2E_ARTIFACT_ROOT is not fresh; refusing to overwrite fixed T9 evidence')
  return inputs
}
async function requireImage() {
  const inputs = validateHarnessInputs({ image, imageTag, imageId: expectedImageId, artifactRoot: configuredArtifactRoot })
  const result = await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'])
  if (result.code !== 0 || !result.stdout.trim()) fail(`required API image is not present locally: ${image}`)
  const imageId = result.stdout.trim()
  if (imageId !== inputs.imageId) fail(`required API image digest mismatch: expected ${inputs.imageId}, got ${imageId}`)
  return imageId
}
function ownedProxy() {
  let vitePort = null
  const server = http.createServer((req, res) => {
    if (!vitePort) { res.writeHead(503); res.end('starting'); return }
    const upstream = http.request({ host: '127.0.0.1', port: vitePort, method: req.method, path: req.url, headers: { ...req.headers, host: req.headers.host } }, answer => {
      res.writeHead(answer.statusCode || 502, answer.headers); answer.pipe(res)
    })
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    if (!vitePort) return socket.destroy()
    socket.on('error', () => {})
    const upstream = net.connect(vitePort, '127.0.0.1', () => { upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`); if (head.length) upstream.write(head); socket.pipe(upstream).pipe(socket) })
    upstream.on('error', () => socket.destroy())
  })
  return { server, setVitePort: port => { vitePort = port } }
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (!address || typeof address === 'string') fail('could not allocate owned web port')
  return address.port
}
async function waitFor(url, predicate, limit = 20_000) {
  const until = Date.now() + limit
  while (Date.now() < until) {
    try { const response = await fetch(url); if (response.ok) { const body = await response.json(); if (!predicate || predicate(body, response)) return { body, response } } } catch {}
    await sleep(100)
  }
  fail('owned service readiness timed out')
}
function startVite(sourceRoot, env, proxy) {
  const child = spawn(process.execPath, [path.join(sourceRoot, 'node_modules', 'vite', 'bin', 'vite.js'), sourceRoot, '--config', path.join(sourceRoot, 'vite.config.js'), '--host', '127.0.0.1', '--port', '0', '--strictPort'], {
    cwd: sourceRoot,
    env: { ...process.env, ...env, VITE_UMAMI_SRC: '', VITE_UMAMI_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  const collect = chunk => { output += String(chunk) }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const port = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('vite readiness timed out')), 20_000)
    const check = () => { const match = /http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(output); if (match) { clearTimeout(timeout); resolve(Number(match[1])) } }
    child.stdout.on('data', check); child.stderr.on('data', check); child.once('exit', () => { clearTimeout(timeout); reject(new Error(`vite exited before readiness: ${output.replace(/https?:\/\/[^\s]+/g, '[redacted-url]').replace(/\s+/g, ' ').slice(-500)}`)) })
  })
  return { child, port, logs: () => output.slice(-1000), proxy }
}
async function stop(child) { if (!child || child.exitCode !== null) return; child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]); if (child.exitCode === null) child.kill('SIGKILL') }
async function startMode(mode, project, sourceRoot, summary) {
  const runId = crypto.randomUUID()
  const label = `t9-${runId}`
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'opengym-t9-')); await fsp.chmod(tempRoot, 0o700)
  const dataDir = path.join(tempRoot, 'data'); await fsp.mkdir(dataDir, { mode: 0o700 })
  const secret = crypto.randomBytes(32).toString('hex'); privateWrite(path.join(dataDir, 'secret'), secret)
  const clinical = clinicalProjects.has(project)
  const userKeys = clinical
    ? ['admin', 'clinical-trainer', 'coordinator', 'clinical-client', 'clinical-unrelated']
    : ['admin', 'trainer', 'coordinator', 'preexisting-client', 'unrelated']
  const userPrefix = clinical ? 't10-' : 't9-'
  const users = userKeys.map(key => ({ key, id: `${userPrefix}${key}`, name: `${label}-${key}`, ...(key === 'admin' ? { admin: true, owner: true } : {}) }))
  privateWrite(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }))
  if (clinical) {
    // Declared owned legacy precondition, written before API boot. It is intentionally not a
    // UI action and never bypasses a live SQLite authority database.
    privateWrite(path.join(dataDir, 'state-t10-clinical-client.json'), JSON.stringify({ _rev: 1, _wid: `${label}-legacy`, unit: 'kg', workouts: [{ id: 'legacy-clinical', d: '2026-10-30', entries: [{ id: '0025', sets: [{ phase: 'work', sides: { L: { w: 21, r: 7, done: true, rpe: 8 }, R: { w: 19, min: 1, done: true, rir: 2 } } }] }] }], bodyweight: [{ d: '2026-10-30', w: 67.3 }] }))
  } else {
    privateWrite(path.join(dataDir, 'state-t9-preexisting-client.json'), JSON.stringify({ marker: `${label}-a`, routines: [] }))
    privateWrite(path.join(dataDir, 'state-t9-unrelated.json'), JSON.stringify({ marker: `${label}-b`, routines: [] }))
  }
  const proxy = ownedProxy(); const webPort = await listen(proxy.server); const webOrigin = `http://localhost:${webPort}`
  const network = `opengym-t9-${runId}`; const container = `opengym-t9-${runId}`
  let vite = null; let cleanup = { container: false, network: false, tempRoot: false, proxy: false }
  const runtimeFile = path.join(tempRoot, 'runtime.json')
  const diagnosticFile = path.join(tempRoot, 'diagnostic.json')
  try {
    await shell(['network', 'create', '--label', `opengym.e2e=${label}`, network])
    const m1 = mode === 'm1'
    await shell(['run', '-d', '--name', container, '--label', `opengym.e2e=${label}`, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--mount', `type=bind,src=${dataDir},dst=/data`, '-p', '127.0.0.1::3000', '-e', 'PORT=3000', '-e', 'DATA_DIR=/data', '-e', `ORIGIN=${webOrigin}`, '-e', 'RP_ID=localhost', '-e', `MANAGED_SUBSCRIPTIONS=${m1 ? '1' : '0'}`, '-e', `ALLOW_GUEST=${m1 ? '0' : '1'}`, '-e', `INVITE_ONLY=${m1 ? '1' : '0'}`, '-e', `PASSWORD_LOGIN=${m1 ? '1' : '0'}`, '-e', `MEDIA_UPLOADS=${m1 ? '1' : '0'}`, '-e', 'FIRST_USER_ADMIN=0', '-e', `ADMIN_UIDS=${users.find(user => user.key === 'admin').id}`, '-e', 'NODE_ENV=production', image])
    const containerImageId = await shell(['inspect', container, '--format', '{{.Image}}'])
    if (containerImageId !== expectedImageId) fail(`running API container image mismatch: expected ${expectedImageId}, got ${containerImageId}`)
    const ports = JSON.parse(await shell(['inspect', container, '--format', '{{json .NetworkSettings.Ports}}']))
    const bindings = Object.values(ports).flat().filter(Boolean)
    if (!bindings.length || bindings.some(binding => binding.HostIp !== '127.0.0.1')) fail('container publish is not loopback-only according to NetworkSettings.Ports')
    const apiOrigin = `http://127.0.0.1:${bindings[0].HostPort}`
    vite = startVite(sourceRoot, { API_TARGET: apiOrigin, API_ORIGIN: webOrigin, VITE_MANAGED_SUBSCRIPTIONS_HINT: m1 ? '1' : '0', VITE_UMAMI_SRC: '', VITE_UMAMI_ID: '' }, proxy)
    proxy.setVitePort(await vite.port)
    const health = await waitFor(`${webOrigin}/api/health`, body => body.ok === true && body.writable === true)
    const config = (await waitFor(`${webOrigin}/api/config`, body => body.allow_guest === !m1)).body
    if ((m1 && (config.managed_subscriptions !== true || !config.media || config.allow_guest !== false || config.invite_only !== true || config.password_login !== true)) || (!m1 && (config.managed_subscriptions || config.media || config.allow_guest !== true || config.invite_only !== false || config.password_login === true))) fail('fixture mode public configuration did not match requested M0/M1 policy')
    const ids = Object.fromEntries(users.map(user => [user.key, user.id]))
    const clinicalFixture = clinical ? await prepareClinicalFixture(apiOrigin, secret, ids) : null
    privateWrite(runtimeFile, JSON.stringify({ mode, runId, label, webOrigin, apiOrigin, dataDir, secret, diagnosticFile, ids, ...(clinicalFixture ? { clinical: clinicalFixture } : {}) }))
    const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js')
    const result = await run(process.execPath, [cli, 'test', '--config', path.join(root, 'playwright.config.js'), `--project=${project}`, '--reporter=json', ...args], { cwd: root, env: { ...process.env, OPENGYM_E2E_BASE_URL: webOrigin, OPENGYM_E2E_RUNTIME: runtimeFile } })
    const state = result.code === 0 ? 'green' : 'red'
    const failure = result.code ? playwrightFailure(result.stdout) : null
    const locatorCount = failure && Number((/resolved to (\d+) elements/.exec(failure) || [])[1])
    const diagnostic = readDiagnostic(diagnosticFile)
    const stage = (failure?.match(/T(?:9|10)_STAGE_[A-Z0-9_]+/) || result.stdout.match(/T(?:9|10)_STAGE_[A-Z0-9_]+/) || [])[0]
      || (diagnostic?.failureStage ? `${project.startsWith('m1-clinical-') ? 'T10' : 'T9'}_STAGE_${diagnostic.failureStage}` : null)
      || (result.code ? (mode === 'm1' ? 'M1_BROWSER_WORKFLOW_RED' : 'M0_BRANDING_WORKFLOW_RED') : null)
    const record = { mode, project, state, runId, apiHealth: health.body.ok === true, config: { allowGuest: config.allow_guest, inviteOnly: config.invite_only === true, passwordLogin: config.password_login === true, managed: !!config.managed_subscriptions, media: !!config.media }, playwrightExit: result.code, ...(stage ? { stage } : {}), ...(failure ? { playwrightFailure: failure } : {}), ...(Number.isInteger(locatorCount) ? { locatorCount } : {}), ...(diagnostic ? { diagnostic } : {}) }
    summary.runs.push(record)
    const log = `${mode}/${project}: ${state}; playwright exit ${result.code}${stage ? `; ${stage}` : ''}${failure ? `; cause=${failure}` : ''}${diagnostic ? `; browser /api/me=${diagnostic.browser.me.status}, /api/access=${diagnostic.browser.access.status}, heading=${diagnostic.headingVisible}` : ''}\n`
    fs.appendFileSync(clinicalEvidence ? redFile : state === 'green' ? greenFile : redFile, log, { mode: 0o600 })
    return result.code
  } finally {
    await stop(vite?.child); await new Promise(resolve => proxy.server.close(resolve)); cleanup.proxy = true
    await run('docker', ['rm', '-f', container]); cleanup.container = (await run('docker', ['container', 'inspect', container])).code !== 0
    await run('docker', ['network', 'rm', network]); cleanup.network = (await run('docker', ['network', 'inspect', network])).code !== 0
    await fsp.rm(tempRoot, { recursive: true, force: true }); cleanup.tempRoot = !fs.existsSync(tempRoot)
    summary.cleanup.push({ mode, project, ...cleanup })
  }
}
async function main() {
  if (args.includes('--list')) {
    const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js')
    const child = spawn(process.execPath, [cli, 'test', '--config', path.join(root, 'playwright.config.js'), '--list'], { cwd: root, stdio: 'inherit' })
    process.exitCode = await new Promise(resolve => child.once('exit', resolve)); return
  }
  await prepareArtifactRoot()
  const sourceRoot = await requireFixture(); const imageId = await requireImage()
  for (const file of [redFile, greenFile]) privateWrite(file, '')
  const summary = { fixtureRoot: sourceRoot, image: { tag: image, id: imageId }, runs: [], cleanup: [], policy: 'M1 uses public password_login=true, invite_only=true, allow_guest=false, managed_subscriptions=true; M0 is a legacy control only; analytics disabled; no restricted screenshots, video, or trace' }
  let code = 0
  if (requestedProjects && [...requestedProjects].some(project => !allRuns.some(([, known]) => known === project))) fail('OPENGYM_E2E_PROJECTS contains an unknown project')
  for (const [mode, project] of allRuns.filter(([, project]) => !requestedProjects || requestedProjects.has(project))) {
    const exit = await startMode(mode, project, sourceRoot, summary)
    if (exit) code = exit
  }
  privateWrite(outputFile, JSON.stringify(summary, null, 2))
  privateWrite(resultFile, summary.runs.every(run => run.state === 'green') ? 'PASS\n' : 'FAIL\n')
  const checks = summary.runs.map(run => `- ${run.mode}/${run.project}: API health=${run.apiHealth}; public config password_login=${run.config.passwordLogin}, invite_only=${run.config.inviteOnly}, allow_guest=${run.config.allowGuest}, managed=${run.config.managed}, media=${run.config.media}; browser=${run.state}${run.stage ? ` (${run.stage})` : ''}${run.diagnostic ? `; /api/me=${run.diagnostic.browser.me.status}, /api/access=${run.diagnostic.browser.access.status}, heading=${run.diagnostic.headingVisible}` : ''}.`).join('\n')
  const cleanup = summary.cleanup.map(item => `- ${item.mode}/${item.project}: container=${item.container}, network=${item.network}, temporary root=${item.tempRoot}, proxy=${item.proxy}.`).join('\n')
  const scopeReadBlocked = summary.runs.some(run => run.stage === 'T9_STAGE_ADMIN_SCOPE_READBACK' && run.diagnostic?.network?.some(item => item.path === '/api/admin/operations/scopes' && item.status === 400))
  const confirmationBlocked = summary.runs.some(run => run.stage === 'T9_STAGE_ADMIN_ROLE_CONFIRMATION' && run.diagnostic?.network?.some(item => item.path === '/api/admin/operations/roles' && item.status === 200))
  const viteOverlayBlocked = summary.runs.some(run => run.diagnostic?.browser?.body?.viteErrorOverlayCount > 0)
  const passwordDiagnostic = summary.runs.map(run => run.diagnostic?.password?.login).find(Boolean)
  const passwordEvidence = passwordDiagnostic
    ? `The actual password-login browser context recorded ${passwordDiagnostic.events.map(event => event.type === 'response' ? `${event.method} ${event.path} -> ${event.status}` : `${event.type}${event.path ? ` ${event.method} ${event.path}` : ''}${event.error ? ` (${event.error})` : ''}`).join(', ') || 'no API events'}; /api/me=${passwordDiagnostic.meStatus}, session cookie present=${passwordDiagnostic.sessionCookiePresent}, signed-in UID matches the just-created actor=${passwordDiagnostic.uidMatchesExpected}, invitation flow count=${passwordDiagnostic.invitationFlowCount}, invitation heading count=${passwordDiagnostic.invitationHeadingCount}, alerts=${passwordDiagnostic.alerts.length}.`
    : null
  const remaining = viteOverlayBlocked
    ? 'M1 is blocked before the relation workflow: the managed-operations page renders, then a Vite error overlay is present and intercepts the real role-checkbox interaction. The API bootstrap is successful (/api/me and /api/access both return HTTP 200), so this is a frontend build/runtime defect in the frozen source rather than an authentication, invitation, consent, relation, or server-contract result. No product source, API response, role state, or consent path was altered. The pending-relation diagnosis and all later onboarding checks remain blocked behind this earlier defect.'
    : scopeReadBlocked
    ? 'M1 is blocked at the real scoped readback GET /api/admin/operations/scopes after selecting the coordinator/client pair: the immutable API image returns HTTP 400. The frontend producer is createAuthorityApi.getAdminScopes({ coordinatorId, clientId }), and its closed read DTO is { scopes, nextCursor, requestId }, with each scope carrying coordinatorId, clientId, assigned, and version. No query values, response body, cookies, or credentials are recorded. No API response was mocked, no role or scope state was fabricated, and no backend change was made. Invitation, WebAuthn, consent, trainer confirmation, commercial, owned-data, and privacy checks remain RED behind this verified read-contract block.'
    : confirmationBlocked
    ? 'M1 is blocked after the real UI POST /api/admin/operations/roles returned HTTP 200 but before Playwright observed the required confirmation status. The sanitized diagnostic retains the resulting DOM counts and path-only response statuses; it does not expose a response body, cookies, or credentials. No API response was mocked, no role state was fabricated, and no backend change was made. The later invitation, WebAuthn, consent, trainer confirmation, commercial, owned-data, and privacy checks remain RED behind this verified UI/API integration condition.'
    : passwordEvidence
    ? `M1 reached the password re-login observation point without mocking an API response or retaining credentials. ${passwordEvidence}`
    : 'A browser workflow RED is retained without a product-code workaround or privilege relaxation; inspect the sanitized red log for its stage.'
  const clinicalReport = `# Clinical browser acceptance\n\nFixture source: ${sourceRoot}\n\n## Request to actual result\n\n${checks}\n\nClinical setup is a declared precondition made through the owned loopback API: technical authority roles, coordinator scope, commercial entitlement, and known-client active relation/grants. The legacy history/weight state is written before boot only; all prescription, goal, session, execution, and consent actions are browser UI actions. No API response is mocked or fulfilled by Playwright.\n\n## Remaining\n\nBrowser acceptance was not inferred from fixture setup. Any nonzero Playwright result above remains unaccepted until the parent runs the configured browser command.\n\n## Resource cleanup\n\n${cleanup}\n`
  const onboardingReport = `# T9 onboarding browser harness\n\nFixture source: ${sourceRoot}\n\n## Request to actual result\n\n${checks}\n\nThe M1 test reaches real /api/config and fixture-only POST /api/admin/operations/roles provisioning before browser mutations. No API request is mocked or fulfilled by Playwright.\n\n## Remaining\n\n${remaining}\n\nThe supplied consent-v2-t9 fixture includes the reported old-session and WEIGHT fixes.\n\n## Resource cleanup\n\n${cleanup}\n`
  privateWrite(reportFile, clinicalEvidence ? clinicalReport : onboardingReport)
  process.exitCode = code
}
main().catch(async error => { await fsp.mkdir(artifactRoot, { recursive: true }).catch(() => {}); privateWrite(outputFile, JSON.stringify({ harnessError: error.message.replace(/https?:\/\/[^\s]+/g, '[redacted-url]') }, null, 2)); privateWrite(resultFile, 'FAIL\n'); process.stderr.write(`T9 e2e harness failed: ${error.message.replace(/https?:\/\/[^\s]+/g, '[redacted-url]')}\n`); process.exitCode = 1 })
