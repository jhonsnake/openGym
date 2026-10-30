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
  fs.writeFileSync(path.join(dataDir, 'secret'), secret); fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'admin', name: 'Admin', admin: true, owner: true }, { id: 'client', name: 'Client' }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MANAGED_SUBSCRIPTIONS: managed ? '1' : '0' } });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d); t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return async (method, url, uid, body) => { const response = await fetch(base + url, { method, headers: { Cookie: mint(uid), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: body && JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
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
test('managed mode fails closed while default mode leaves legacy personal data behavior unchanged', async t => {
  const normal = await server(t, false); assert.equal((await normal('GET', '/api/data', 'client')).status, 200);
  const managed = await server(t, true); const denied = await managed('GET', '/api/data', 'client'); assert.equal(denied.status, 403); assert.equal(denied.body.code, 'not-entitled');
});
