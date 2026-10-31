import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const apiDir = new URL('../', import.meta.url).pathname;
const secret = 't7-http-secret';
const operation = n => `123e4567-e89b-42d3-a456-42661417${String(n).padStart(4, '0')}`;
const cookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`; };
const schema = name => {
  const document = YAML.parse(fs.readFileSync(path.join(apiDir, 'openapi.yaml'), 'utf8')); document.$id = 'https://opengym.test/openapi.yaml';
  const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv); ajv.addSchema(document);
  return ajv.getSchema(`${document.$id}#/components/schemas/${name}`);
};

function start(dataDir) {
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MANAGED_SUBSCRIPTIONS: '1' } });
  let output = ''; const collect = chunk => { output += chunk; }; child.stdout.on('data', collect); child.stderr.on('data', collect);
  const base = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output || 'server did not bind')), 10000);
    const ready = () => { const match = /gym-api on :?(\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } };
    child.stdout.on('data', ready); child.stderr.on('data', ready);
    child.on('exit', code => reject(new Error(`server exited ${code}: ${output}`)));
  });
  return { child, base };
}

test('T7 HTTP wires owner export/deletion without a paid training gate or destructive legacy action', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-t7-http-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret);
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'admin', name: 'Admin', admin: true, owner: true }, { id: 'owner', name: 'Owner' }, { id: 'other', name: 'Other' }], creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-owner.json'), JSON.stringify({ unit: 'kg', routines: [{ id: 'mine', target: { reps: 8 } }], privateToken: 'never' }));
  const before = crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'state-owner.json'))).digest('hex');
  const running = start(dataDir); const base = await running.base;
  t.after(() => { running.child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const request = async (method, pathname, uid, body) => {
    const response = await fetch(base + pathname, { method, headers: { Cookie: cookie(uid), 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const exportRequest = { operationId: operation(1), expectedVersion: 0, payload: {} };
  const created = await request('POST', '/api/client/exports', 'owner', exportRequest);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(schema('ExportReceipt')(created.body), true);
  assert.equal(created.headers.get('cache-control'), 'private, no-store');
  assert.equal(created.body.result.state, 'READY');
  const jobId = created.body.result.jobId;
  const downloaded = await request('GET', `/api/client/exports/${jobId}`, 'owner');
  assert.equal(downloaded.status, 200, JSON.stringify(downloaded.body));
  assert.equal(downloaded.headers.get('content-disposition'), 'attachment; filename="opengym-owned-export.json"');
  assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(schema('OwnedExportDocument')(downloaded.body), true);
  assert.deepEqual(downloaded.body.legacyState.routines[0].target, { reps: 8 });
  const foreign = await request('GET', `/api/client/exports/${jobId}`, 'other');
  const unknown = await request('GET', `/api/client/exports/${crypto.randomUUID()}`, 'owner');
  assert.equal(foreign.status, 404); assert.equal(unknown.status, 404); assert.deepEqual(foreign.body, unknown.body);
  assert.equal(foreign.headers.get('cache-control'), 'private, no-store');
  assert.equal((await request('GET', '/api/client/exports/not-a-uuid', 'owner')).status, 400);
  assert.equal((await request('POST', '/api/client/exports', 'owner', { operationId: operation(3), expectedVersion: 1, payload: { unexpected: true } })).status, 400);
  const deletion = await request('POST', '/api/client/deletion-requests', 'owner', { operationId: operation(2), expectedVersion: 0, payload: {} });
  assert.equal(deletion.status, 200, JSON.stringify(deletion.body));
  assert.equal(schema('DeletionRequestReceipt')(deletion.body), true);
  assert.equal((await request('POST', '/api/account/delete', 'owner', { name: 'Owner' })).status, 503);
  assert.equal((await request('POST', '/api/admin/user/delete', 'admin', { id: 'owner' })).status, 503);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'state-owner.json'))).digest('hex'), before);
});
