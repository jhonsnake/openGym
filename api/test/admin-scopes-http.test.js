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
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
const operation = n => `123e4567-e89b-42d3-a456-42661417${String(n).padStart(4, '0')}`;

test('admin scope readback supports filters while preserving HTTP pagination and authorization', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-scopes-http-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret);
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [
    { id: 'admin', name: 'Admin', admin: true, owner: true },
    { id: 'coordinator', name: 'Coordinator' },
    { id: 'client-a', name: 'Client A' },
    { id: 'client-b', name: 'Client B' }
  ], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const request = async (method, pathname, uid, body) => {
    const response = await fetch(base + pathname, {
      method,
      headers: { Cookie: mint(uid), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  const role = (n, accountId, roles) => request('POST', '/api/admin/operations/roles', 'admin', {
    operationId: operation(n), expectedVersion: 0, payload: { accountId, roles, reason: 'HTTP scope fixture' }
  });
  assert.equal((await role(1, 'coordinator', ['COORDINATOR'])).status, 200);
  assert.equal((await role(2, 'client-a', ['CLIENT'])).status, 200);
  assert.equal((await role(3, 'client-b', ['CLIENT'])).status, 200);
  const assign = await request('POST', '/api/admin/operations/scopes', 'admin', {
    operationId: operation(4), expectedVersion: 0,
    payload: { coordinatorId: 'coordinator', clientId: 'client-a', assigned: true, reason: 'HTTP scope fixture' }
  });
  assert.equal(assign.status, 200, JSON.stringify(assign.body));
  const assignB = await request('POST', '/api/admin/operations/scopes', 'admin', {
    operationId: operation(5), expectedVersion: 0,
    payload: { coordinatorId: 'coordinator', clientId: 'client-b', assigned: true, reason: 'HTTP scope fixture' }
  });
  assert.equal(assignB.status, 200, JSON.stringify(assignB.body));

  for (const pathname of [
    '/api/admin/operations/scopes?coordinatorId=coordinator',
    '/api/admin/operations/scopes?coordinatorId=coordinator&clientId=client-a',
    '/api/admin/operations/scopes?clientId=client-b'
  ]) {
    const response = await request('GET', pathname, 'admin');
    assert.equal(response.status, 200, `${pathname}: ${JSON.stringify(response.body)}`);
    assert.ok(response.body.requestId);
    assert.equal('clinical' in response.body, false);
    assert.equal('history' in response.body, false);
  }
  const byCoordinator = await request('GET', '/api/admin/operations/scopes?coordinatorId=coordinator', 'admin');
  assert.deepEqual(byCoordinator.body.scopes.map(({ coordinatorId, clientId }) => ({ coordinatorId, clientId })), [
    { coordinatorId: 'coordinator', clientId: 'client-a' },
    { coordinatorId: 'coordinator', clientId: 'client-b' }
  ]);
  const both = await request('GET', '/api/admin/operations/scopes?coordinatorId=coordinator&clientId=client-a', 'admin');
  assert.deepEqual(both.body.scopes.map(({ coordinatorId, clientId }) => ({ coordinatorId, clientId })), [{ coordinatorId: 'coordinator', clientId: 'client-a' }]);
  const byClient = await request('GET', '/api/admin/operations/scopes?clientId=client-b', 'admin');
  assert.deepEqual(byClient.body.scopes.map(({ coordinatorId, clientId }) => ({ coordinatorId, clientId })), [{ coordinatorId: 'coordinator', clientId: 'client-b' }]);
  assert.equal((await request('GET', '/api/admin/operations/scopes', 'admin')).status, 200);
  assert.equal((await request('GET', '/api/admin/operations/scopes', 'coordinator')).status, 403);
  assert.equal((await request('GET', '/api/admin/operations/scopes?unexpected=x', 'admin')).status, 400);
  assert.equal((await request('GET', '/api/admin/operations/scopes?cursor=bad', 'admin')).status, 400);
  assert.equal((await request('GET', '/api/admin/operations/scopes?limit=101', 'admin')).status, 400);
});
