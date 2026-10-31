import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = crypto.randomBytes(32).toString('hex');
const mint = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; };
async function server(t, managed = false) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-routes-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret); fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'admin', name: 'Admin', admin: true, owner: true }, { id: 'client', name: 'Client' }, { id: 'coordinator', name: 'Coordinator' }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MANAGED_SUBSCRIPTIONS: managed ? '1' : '0' } });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d); t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return async (method, url, uid, body, extraHeaders = {}) => {
    const headers = { Cookie: mint(uid), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(managed ? { 'X-OpenGym-Contract-Version': '1' } : {}), ...extraHeaders };
    for (const [key, value] of Object.entries(headers)) if (value === null) delete headers[key];
    const response = await fetch(base + url, { method, headers, body: body && JSON.stringify(body) }); return { status: response.status, body: await response.json() };
  };
}
test('operational APIs use the session identity, versioned mutations and no health history metadata', async t => {
  const req = await server(t);
  const initial = await req('GET', '/api/access', 'client');
  assert.equal(initial.status, 200); assert.deepEqual(initial.body.roles, []); assert.equal('scopes' in initial.body, false);
  const r = await req('POST', '/api/admin/operations/roles', 'admin', { operationId: '123e4567-e89b-42d3-a456-426614174000', expectedVersion: 0, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'onboard client' } });
  assert.equal(r.status, 200); assert.equal(r.body.versionTokens[0].version, 1);
  const extra = await req('POST', '/api/admin/operations/roles', 'admin', { operationId: '123e4567-e89b-42d3-a456-426614174001', expectedVersion: 1, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'onboard client' }, ignored: true });
  assert.equal(extra.status, 400);
  const users = await req('GET', '/api/admin/operations/users', 'admin'); assert.equal(users.status, 200); assert.equal(JSON.stringify(users.body).includes('health'), false);
});
test('managed mode advertises its public login boundary and does not let a legacy header bypass data protection', async t => {
  const normal = await server(t, false);
  const normalConfig = await normal('GET', '/api/config');
  assert.equal(normalConfig.status, 200);
  assert.equal('managed_subscriptions' in normalConfig.body, false, 'M0 response shape remains upstream');
  assert.equal(normalConfig.body.allow_guest, true);
  assert.equal((await normal('GET', '/api/data', 'client')).status, 200);

  const managed = await server(t, true);
  const managedConfig = await managed('GET', '/api/config');
  assert.equal(managedConfig.status, 200);
  assert.equal(managedConfig.body.managed_subscriptions, true);
  assert.equal(managedConfig.body.allow_guest, false);
  const denied = await managed('GET', '/api/data', 'client');
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not-entitled');
  for (const [method, pathname, body] of [
    ['GET', '/api/data/rev'],
    ['GET', '/api/nudge-check?date=2026-10-30'],
    ['POST', '/api/media/missing', { hashes: [] }],
    ['POST', '/api/media/sweep', {}],
    ['GET', '/api/push/status?endpoint=https%3A%2F%2Fexample.test%2Fpush'],
    ['POST', '/api/push/test', {}],
    ['POST', '/api/push/rest-timer/cancel', {}],
    ['GET', '/api/coach/status']
  ]) {
    const response = await managed(method, pathname, 'client', body);
    assert.equal(response.status, 403, `${method} ${pathname} must be guarded in M1`);
    assert.equal(response.body.code, 'not-entitled');
  }
  assert.equal((await managed('GET', '/api/push/public-key')).status, 200, 'public push key is not a protected personal action');
  const missingVersion = await managed('GET', '/api/data', 'client', undefined, { 'X-OpenGym-Contract-Version': null });
  assert.equal(missingVersion.status, 403, 'entitlement denial precedes version compatibility');
});

test('managed mode admits an entitled CLIENT through every legacy personal family, without granting admin health data', async t => {
  const req = await server(t, true);
  const mutate = (n, payload, expectedVersion = 0) => ({ operationId: `123e4567-e89b-42d3-a456-426614174${String(n).padStart(3, '0')}`, expectedVersion, payload });
  assert.equal((await req('POST', '/api/admin/operations/roles', 'admin', mutate(10, { accountId: 'client', roles: ['CLIENT'], reason: 'fixture' }))).status, 200);
  assert.equal((await req('POST', '/api/admin/operations/roles', 'admin', mutate(11, { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'fixture' }))).status, 200);
  assert.equal((await req('POST', '/api/admin/operations/scopes', 'admin', mutate(12, { coordinatorId: 'coordinator', clientId: 'client', assigned: true, reason: 'fixture' }))).status, 200);
  assert.equal((await req('POST', '/api/admin/commercial/operations/confirm', 'coordinator', mutate(13, { clientId: 'client', kind: 'MONTHLY', reference: 'paid fixture', reason: 'fixture' }))).status, 200);
  for (const version of [null, '0']) {
    const response = await req('GET', '/api/data', 'client', undefined, { 'X-OpenGym-Contract-Version': version });
    assert.equal(response.status, 426, 'missing/old contract version is refused only after entitlement');
    assert.equal(response.body.code, 'unsupported-client');
  }
  for (const [method, pathname, body, expected] of [
    ['GET', '/api/data', undefined, 200], ['PUT', '/api/data', { state: { routines: [], workouts: [] } }, 200], ['GET', '/api/data/rev', undefined, 200],
    ['GET', '/api/nudge-check?date=2026-10-30', undefined, 200], ['POST', '/api/media/missing', { hashes: [] }, 200], ['POST', '/api/media/sweep', {}, 200],
    ['GET', `/api/media/${'a'.repeat(64)}`, undefined, 404], ['PUT', `/api/media/${'a'.repeat(64)}`, {}, 415],
    ['GET', '/api/push/status?endpoint=https%3A%2F%2Fexample.test%2Fpush', undefined, 200], ['POST', '/api/push/test', {}, 200],
    ['POST', '/api/push/rest-timer', { seconds: 1 }, 200], ['POST', '/api/push/rest-timer/cancel', {}, 200], ['GET', '/api/coach/status', undefined, 503]
  ]) {
    const response = await req(method, pathname, 'client', body);
    assert.equal(response.status, expected, `${method} ${pathname}: ${JSON.stringify(response.body)}`);
  }
  const access = await req('GET', '/api/access', 'admin');
  assert.equal(access.status, 200);
  assert.equal(access.body.capabilities.includes('ACCESS_PERSONAL_TRAINING'), false, 'an operational role is not a personal CLIENT entitlement');
  assert.equal((await req('GET', '/api/health', 'admin')).status, 200, 'health remains public infrastructure, not an admin-as-health fallback');
});
