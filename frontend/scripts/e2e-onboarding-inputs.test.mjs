const { test } = await (process.env.VITEST === 'true' ? import('vitest') : import('node:test'))
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validateHarnessInputs } from './e2e-onboarding-inputs.mjs'

const valid = {
  image: 'johngym-api:pending-candidate',
  imageTag: 'johngym-api:pending-candidate',
  imageId: `sha256:${'a'.repeat(64)}`,
  artifactRoot: '/home/jhonsnake/.hermes/cache/scratch/fresh-t9-run',
}

test('accepts an explicitly matching tag and canonical image id', () => {
  assert.deepEqual(validateHarnessInputs(valid), valid)
})

test('rejects missing candidate inputs before any lookup can occur', () => {
  for (const key of ['image', 'imageTag', 'imageId']) {
    const input = { ...valid, [key]: undefined }
    assert.throws(() => validateHarnessInputs(input), /required/)
  }
})

test('rejects a tag mismatch instead of treating inspect output as the oracle', () => {
  assert.throws(() => validateHarnessInputs({ ...valid, image: 'johngym-api:mutated' }), /must equal/)
})

test('rejects malformed ids without trimming or repairing them', () => {
  for (const imageId of [`sha256:${'a'.repeat(63)}`, `sha256:${'a'.repeat(64)} `, `SHA256:${'a'.repeat(64)}`, `sha256:${'g'.repeat(64)}`]) {
    assert.throws(() => validateHarnessInputs({ ...valid, imageId }), /sha256:64 lowercase hexadecimal/)
  }
})

test('requires a fresh explicit private artifact root', () => {
  assert.throws(() => validateHarnessInputs({ ...valid, artifactRoot: '' }), /OPENGYM_E2E_ARTIFACT_ROOT/)
  assert.throws(() => validateHarnessInputs({ ...valid, artifactRoot: '/tmp' }), /private artifact root/)
})

test('T9 source waits for acceptance and uses the registered browser context for readback', () => {
  const source = fs.readFileSync(new URL('../e2e/t9-onboarding.spec.js', import.meta.url), 'utf8')
  assert.match(source, /const acceptanceResponse = clientPage\.waitForResponse\(/)
  assert.match(source, /clientPage\.getByRole\('button', \{ name: 'Aceptar las propuestas seleccionadas' \}\)\.click\(\)/)
  const awaitedClick = source.match(/await (?:at\('INVITATION_ACCEPT_CLICK',|clientPage\.getByRole\('button', \{ name: 'Aceptar las propuestas seleccionadas' \}\)\.click\(\))/)
  assert.ok(awaitedClick, 'acceptance click must be awaited directly or through its diagnostic step')
  assert.ok(source.indexOf('const acceptanceResponse = clientPage.waitForResponse(') < awaitedClick.index, 'response waiter must precede the click')
  assert.match(source, /const acceptance = await (?:acceptanceResponse|at\('INVITATION_ACCEPT_RESPONSE', null, \(\) => acceptanceResponse\))/)
  assert.match(source, /expect\(clientPage\.locator\('\[data-invitation-flow="true"\]'\)\)\.toHaveCount\(0/)
  assert.match(source, /await (?:at\('INVITATION_SETTLED_FLOW',|expect\(clientPage\.locator\('\[data-invitation-flow="true"\]'\)\))/)
  assert.match(source, /browserApi\(client, '\/api\/me'\)/)
  assert.match(source, /browserApi\(client, '\/api\/client\/relations'\)/)
  assert.doesNotMatch(source, /fetch\(runtime\.apiOrigin \+ '\/api\/me'/)
})

test('T9 diagnostics observe optional workflow inputs without auto-waiting', () => {
  const source = fs.readFileSync(new URL('../e2e/t9-onboarding.spec.js', import.meta.url), 'utf8')
  assert.match(source, /const checkedInput = label => page\.getByLabel\(label\)\.evaluateAll\(/)
  assert.match(source, /nodes\.length === 1 \? Boolean\(nodes\[0\]\.checked\) : null/)
  assert.doesNotMatch(source, /getByLabel\([^\n]+\)\.isChecked\(\)/)
  assert.match(source, /activeDiagnostic\?\.write\(stage, details\)\.catch\(\(\) => \{\}\)/)
})

test('runner verifies the image id resolved by the running container', () => {
  const source = fs.readFileSync(new URL('./e2e-onboarding.mjs', import.meta.url), 'utf8')
  assert.match(source, /OPENGYM_E2E_API_IMAGE_TAG/)
  assert.match(source, /OPENGYM_E2E_API_IMAGE_ID/)
  assert.match(source, /containerImageId = await shell\(\['inspect', container, '--format', '\{\{\.Image\}\}'\]\)/)
  assert.match(source, /containerImageId !== expectedImageId/)
})

test('clinical acceptance is discoverable as two M1 projects and has separate evidence names', () => {
  const config = fs.readFileSync(new URL('../playwright.config.js', import.meta.url), 'utf8')
  const runner = fs.readFileSync(new URL('./e2e-onboarding.mjs', import.meta.url), 'utf8')
  assert.match(config, /m1-clinical-desktop/)
  assert.match(config, /m1-clinical-mobile/)
  assert.match(config, /t10-clinical\\\.spec\\\.js/)
  assert.match(runner, /m1-clinical-desktop/)
  assert.match(runner, /m1-clinical-mobile/)
  assert.match(runner, /clinical-browser-acceptance-report\.md/)
  assert.match(runner, /clinical-browser-acceptance-output\.json/)
  assert.match(runner, /clinical-browser-acceptance-tests\.log/)
})
