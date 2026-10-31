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
const mint = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; };

test('HTTP invitation handlers bind session subject and expose only public-minimum preview', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-http-life-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret);
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'admin', name: 'Admin', admin: true, owner: true }, { id: 'trainer', name: 'Trainer' }, { id: 'client', name: 'Client' }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const request = async (method, pathname, uid, body) => { const response = await fetch(base + pathname, { method, headers: { Cookie: mint(uid), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: body && JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  for (const [n, accountId, roles] of [[1, 'trainer', ['TRAINER']], [2, 'client', ['CLIENT']]]) {
    assert.equal((await request('POST', '/api/admin/operations/roles', 'admin', { operationId: op(n), expectedVersion: 0, payload: { accountId, roles, reason: 'HTTP setup' } })).status, 200);
  }
  const invitation = await request('POST', '/api/trainer/invitations', 'trainer', { operationId: op(3), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Commercial alias', grants: [{ kind: 'PLAN' }] } });
  assert.equal(invitation.status, 200); assert.match(invitation.body.result.token, /^[A-Za-z0-9_-]{43}$/);
  const preview = await request('POST', '/api/invitations/preview', 'admin', { token: invitation.body.result.token });
  assert.equal(preview.status, 200); assert.equal('knownClientId' in preview.body, false); assert.equal('commercialName' in preview.body, false);
  const accepted = await request('POST', '/api/invitations/accept', 'client', { operationId: op(4), expectedVersion: invitation.body.versionTokens.find(token => token.kind === 'INVITATION').version, payload: { token: invitation.body.result.token, grants: [{ kind: 'PLAN' }] } });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.result.state, 'ACTIVE');
  const portfolio = await request('GET', '/api/trainer/portfolio', 'trainer');
  assert.equal(portfolio.status, 200); assert.deepEqual(portfolio.body.portfolio, []); // no commercial entitlement leaks into cards
});
