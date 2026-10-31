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
const op = n => `123e4567-e89b-42d3-a456-426614176${String(n).padStart(3, '0')}`;
const mint = uid => {
  const payload = `${uid}:${Date.now() + 365 * 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
};

async function startServer(t, managed) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-managed-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: 'admin', name: 'Admin', admin: true, owner: true },
      { id: 'client', name: 'Client' },
      { id: 'coordinator', name: 'Coordinator' },
      { id: 'suspended', name: 'Suspended', disabled: true },
    ], creds: [], subs: [], invites: [],
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MANAGED_SUBSCRIPTIONS: managed ? '1' : '0' },
  });
  let log = '';
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const request = async ({ uid, pathname, body, managedClient = managed }) => {
    const response = await fetch(base + pathname, {
      method: 'POST',
      headers: {
        Cookie: mint(uid), 'Content-Type': 'application/json', Origin: 'http://localhost:8080',
        ...(managedClient ? { 'X-OpenGym-Contract-Version': '1' } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const live = async () => {
    const response = await fetch(base + '/api/admin/users', { headers: { Cookie: mint('admin') } });
    assert.equal(response.status, 200, log);
    return (await response.json()).users.find(user => user.id === 'client').live;
  };
  return { request, live, log: () => log };
}

test('M1 activity uses the same entitlement decision as personal training before mutating presence', async t => {
  const h = await startServer(t, true);
  const request = (uid, pathname, body, managedClient = true) => h.request({ uid, pathname, body, managedClient });
  const activity = (uid, body, managedClient = true) => request(uid, '/api/activity', body, managedClient);
  const mutate = (n, payload, expectedVersion = 0) => ({ operationId: op(n), expectedVersion, payload });

  const missingClient = await activity('client', { active: true, name: 'must not appear' }, false);
  assert.equal(missingClient.status, 403, h.log());
  assert.equal(missingClient.body.code, 'not-entitled');
  assert.equal(await h.live(), null, 'a raw legacy request without CLIENT cannot create presence');

  assert.equal((await request('admin', '/api/admin/operations/roles', mutate(1, { accountId: 'client', roles: ['CLIENT'], reason: 'fixture' }))).status, 200);
  assert.equal((await request('admin', '/api/admin/operations/roles', mutate(2, { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'fixture' }))).status, 200);
  assert.equal((await request('admin', '/api/admin/operations/scopes', mutate(3, { coordinatorId: 'coordinator', clientId: 'client', assigned: true, reason: 'fixture' }))).status, 200);
  assert.equal((await request('coordinator', '/api/admin/commercial/operations/confirm', mutate(4, { clientId: 'client', kind: 'CUSTOM', customStartPanama: '2000-01-01', customEndPanamaInclusive: '2000-01-02', reference: 'expired fixture', reason: 'fixture' }))).status, 200);

  const expired = await activity('client', { active: true, name: 'expired must not appear' });
  assert.equal(expired.status, 403, h.log());
  assert.equal(expired.body.code, 'not-entitled');
  assert.equal(await h.live(), null, 'an expired entitlement cannot create presence');

  assert.equal((await request('coordinator', '/api/admin/commercial/operations/confirm', mutate(5, { clientId: 'client', kind: 'MONTHLY', reference: 'active fixture', reason: 'fixture' }, 1))).status, 200);
  const oldClient = await activity('client', { active: true, name: 'old client must not appear' }, false);
  assert.equal(oldClient.status, 426, h.log());
  assert.equal(await h.live(), null, 'a raw old client is refused before writing presence');

  const allowed = await activity('client', { active: true, name: 'Allowed presence' });
  assert.equal(allowed.status, 200, h.log());
  assert.equal((await h.live()).name, 'Allowed presence');

  assert.equal((await request('admin', '/api/admin/operations/roles', mutate(6, { accountId: 'client', roles: [], reason: 'revoked fixture' }, 1))).status, 200);
  const revoked = await activity('client', { active: false, reason: 'closed' });
  assert.equal(revoked.status, 403, h.log());
  assert.equal(revoked.body.code, 'not-entitled');
  assert.equal((await h.live()).name, 'Allowed presence', 'a revoked role cannot clear existing presence');

  const suspended = await activity('suspended', { active: true, name: 'suspended must not appear' });
  assert.equal(suspended.status, 401, h.log());
  assert.equal((await h.live()).name, 'Allowed presence');
});

test('M0 preserves the legacy activity endpoint', async t => {
  const h = await startServer(t, false);
  const response = await h.request({ uid: 'client', pathname: '/api/activity', body: { active: true, name: 'M0 presence' }, managedClient: false });
  assert.equal(response.status, 200, h.log());
  assert.equal((await h.live()).name, 'M0 presence');
});
