import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { boundPort, softPasskey } from './helpers.mjs';

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:8080';
const secret = crypto.randomBytes(32).toString('hex');
const operation = n => `123e4567-e89b-42d3-a456-426614176${String(n).padStart(3, '0')}`;

function cookie(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

function authorityRows(dataDir, query, ...args) {
  const db = new DatabaseSync(path.join(dataDir, 'authority.sqlite'));
  try { return db.prepare(query).all(...args); } finally { db.close(); }
}

function dbJson(dataDir) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
}

async function boot(dataDir, env = {}, jar = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: apiDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: '0', DATA_DIR: dataDir, ORIGIN: origin, RP_ID: 'localhost',
      MANAGED_SUBSCRIPTIONS: '1', TRUST_PROXY: '1', NODE_ENV: 'test',
      FIRST_USER_ADMIN: '', ADMIN_UIDS: '', AUDIT_LOG: '1', ...env
    }
  });
  let log = '';
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const request = async (method, pathname, { body, uid, headers = {}, browserJar = jar } = {}) => {
    const response = await fetch(base + pathname, {
      method,
      headers: {
        'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
        ...(uid ? { Cookie: cookie(uid) } : {}),
        ...(browserJar.enrollmentCookie ? { Cookie: [uid ? cookie(uid) : '', browserJar.enrollmentCookie].filter(Boolean).join('; ') } : {}),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const allCookies = response.headers.getSetCookie();
    const enrollment = allCookies.find(value => value.startsWith('og-enroll='));
    if (enrollment) browserJar.enrollmentCookie = enrollment.split(';')[0];
    const setCookie = allCookies.find(value => value.startsWith('gymsid=') && !value.startsWith('gymsid=;'));
    return { status: response.status, body: await response.json(), cookie: setCookie?.split(';')[0] ?? null };
  };
  return {
    child,
    base,
    log: () => log,
    request,
    browser: browserJar => (method, pathname, options = {}) => request(method, pathname, { ...options, browserJar }),
    stopped: () => new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    stop() { if (!child.killed) child.kill('SIGKILL'); }
  };
}

async function managedServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-managed-registration-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: 'admin', name: 'Admin', admin: true, owner: true },
      { id: 'trainer', name: 'Trainer' },
      { id: 'known-client', name: 'Known client' }
    ], creds: [], subs: [], invites: []
  }));
  const processes = [];
  const jar = {};
  const start = async overrides => {
    const server = await boot(dataDir, { ...env, ...overrides }, jar);
    processes.push(server);
    return server;
  };
  t.after(() => {
    for (const server of processes) server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, start };
}

async function provisionTrainer(server) {
  const role = await server.request('POST', '/api/admin/operations/roles', {
    uid: 'admin', body: {
      operationId: operation(1), expectedVersion: 0,
      payload: { accountId: 'trainer', roles: ['TRAINER'], reason: 'test trainer' }
    }
  });
  assert.equal(role.status, 200);
}

async function createInvitation(server, n, payload = { commercialName: 'Prospect', grants: [{ kind: 'PLAN' }] }, expectedVersion = 0) {
  const response = await server.request('POST', '/api/trainer/invitations', {
    uid: 'trainer', body: { operationId: operation(n), expectedVersion, payload }
  });
  assert.equal(response.status, 200);
  return { ...response.body.result, version: response.body.versionTokens.find(token => token.kind === 'INVITATION').version };
}

async function options(server, token, name = 'New client') {
  const response = await server.request('POST', '/api/register/options', { body: { name, inviteToken: token } });
  assert.equal(response.status, 200);
  return response.body;
}

async function verify(server, ceremony, key) {
  return server.request('POST', '/api/register/verify', {
    body: { cid: ceremony.cid, credential: key.attestation(ceremony.options.challenge) }
  });
}

test('managed unknown invite reserves one UID durably, creates no entitlement, and requires a separate accept then trainer confirmation', async t => {
  const fixture = await managedServer(t);
  const server = await fixture.start();
  await provisionTrainer(server);
  const invite = await createInvitation(server, 10);
  const key = softPasskey(origin);
  const first = await options(server, invite.token);
  const firstReservation = authorityRows(fixture.dataDir, 'SELECT uid, challenge_hash, state FROM enrollment_sessions');
  assert.equal(firstReservation.length, 1);
  assert.equal(firstReservation[0].state, 'CHALLENGE_ISSUED');
  assert.equal(firstReservation[0].challenge_hash.length, 64);

  const second = await options(server, invite.token);
  const secondReservation = authorityRows(fixture.dataDir, 'SELECT uid, challenge_hash FROM enrollment_sessions');
  assert.equal(secondReservation.length, 1, 'one invitation cannot reserve a replacement identity');
  assert.equal(secondReservation[0].uid, firstReservation[0].uid);
  assert.notEqual(secondReservation[0].challenge_hash, firstReservation[0].challenge_hash);
  assert.equal((await verify(server, first, key)).status, 403, 'a superseded options challenge cannot add a credential');

  const registered = await verify(server, second, key);
  assert.equal(registered.status, 200);
  const created = dbJson(fixture.dataDir);
  assert.equal(created.users.filter(user => user.id === secondReservation[0].uid).length, 1);
  assert.equal(created.creds.filter(credential => credential.userId === secondReservation[0].uid).length, 1);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT state FROM invitations').at(0).state, 'PENDING');
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM operational_roles').length, 1);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM subscription_intervals').length, 0);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM relations').length, 0);

  const loggedIn = await server.request('POST', '/api/login/options', { body: {} });
  const login = await server.request('POST', '/api/login/verify', {
    body: { cid: loggedIn.body.cid, credential: key.assertion(loggedIn.body.options.challenge) }
  });
  assert.equal(login.status, 200);
  const uid = secondReservation[0].uid;
  const accepted = await server.request('POST', '/api/invitations/accept', {
    uid,
    body: { operationId: operation(11), expectedVersion: invite.version, payload: { token: invite.token, grants: [{ kind: 'PLAN' }] } }
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.result.state, 'PENDING_CONFIRMATION');
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM relation_access_windows').length, 0);
  const confirmed = await server.request('POST', '/api/trainer/relations/confirm', {
    uid: 'trainer', body: { operationId: operation(12), expectedVersion: accepted.body.versionTokens.find(token => token.kind === 'RELATION').version, payload: { relationId: accepted.body.result.relationId } }
  });
  assert.equal(confirmed.status, 200);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT state FROM relations').at(0).state, 'ACTIVE');
});

test('managed enrollment handle binds rotation to one HTTP cookie jar and is never a session credential', async t => {
  const fixture = await managedServer(t);
  const server = await fixture.start();
  await provisionTrainer(server);
  const invite = await createInvitation(server, 70);
  const firstJar = {};
  const secondJar = {};
  const first = server.browser(firstJar);
  const second = server.browser(secondJar);
  const ceremony = await first('POST', '/api/register/options', { body: { name: 'First browser', inviteToken: invite.token } });
  assert.equal(ceremony.status, 200);
  const before = authorityRows(fixture.dataDir, 'SELECT uid,challenge_hash FROM enrollment_sessions').at(0);
  assert.ok(firstJar.enrollmentCookie);
  const hijack = await second('POST', '/api/register/options', { body: { name: 'Second browser', inviteToken: invite.token } });
  assert.equal(hijack.status, 403);
  assert.deepEqual({ ...authorityRows(fixture.dataDir, 'SELECT uid,challenge_hash FROM enrollment_sessions').at(0) }, { ...before });
  const rotated = await first('POST', '/api/register/options', { body: { name: 'First browser', inviteToken: invite.token } });
  assert.equal(rotated.status, 200);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT uid FROM enrollment_sessions').at(0).uid, before.uid);
  const fake = await second('POST', '/api/register/verify', { body: { cid: ceremony.body.cid, credential: softPasskey(origin).attestation(ceremony.body.options.challenge) }, headers: { Cookie: 'og-enroll=fake.handle' } });
  assert.equal(fake.status, 403);
  const handle = firstJar.enrollmentCookie.slice('og-enroll='.length);
  const authAsHandle = await server.request('GET', '/api/access', { headers: { Authorization: `Bearer ${handle}` } });
  assert.equal(authAsHandle.status, 401);
});

test('known-target and revoked managed invitations deny registration uniformly without replacing an account', async t => {
  const fixture = await managedServer(t);
  const server = await fixture.start();
  await provisionTrainer(server);
  const known = await createInvitation(server, 20, { knownClientId: 'known-client', commercialName: 'Known', grants: [{ kind: 'PLAN' }] });
  const rejectedKnown = await server.request('POST', '/api/register/options', { body: { name: 'Replacement', inviteToken: known.token } });
  const rejectedUnknown = await server.request('POST', '/api/register/options', { body: { name: 'Replacement', inviteToken: crypto.randomBytes(32).toString('base64url') } });
  assert.equal(rejectedKnown.status, rejectedUnknown.status);
  assert.deepEqual(rejectedKnown.body, rejectedUnknown.body);
  assert.equal(dbJson(fixture.dataDir).users.some(user => user.name === 'Replacement'), false);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM enrollment_sessions').length, 0);

  const invite = await createInvitation(server, 21, undefined, 1);
  const ceremony = await options(server, invite.token);
  const revoke = await server.request('POST', '/api/trainer/invitations/revoke', {
    uid: 'trainer', body: { operationId: operation(22), expectedVersion: invite.version, payload: { invitationId: invite.inviteId, reason: 'withdrawn in test' } }
  });
  assert.equal(revoke.status, 200);
  const denied = await verify(server, ceremony, softPasskey(origin));
  assert.equal(denied.status, 403);
  assert.equal(dbJson(fixture.dataDir).users.some(user => user.name === 'New client'), false);

  const expiring = await createInvitation(server, 23, undefined, 2);
  const expiringCeremony = await options(server, expiring.token);
  const authority = new DatabaseSync(path.join(fixture.dataDir, 'authority.sqlite'));
  try {
    authority.prepare('UPDATE invitations SET expires_at_utc=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expiring.inviteId);
  } finally {
    authority.close();
  }
  assert.equal((await verify(server, expiringCeremony, softPasskey(origin))).status, 403);
});

for (const phase of ['before-db.json-write', 'after-db.json-write']) {
  test(`managed WebAuthn ${phase} restarts against the same DATA_DIR without replacing credentials`, async t => {
    const fixture = await managedServer(t, { AUTHORITY_ENROLLMENT_FAILPOINT: phase });
    const failing = await fixture.start();
    await provisionTrainer(failing);
    const invite = await createInvitation(failing, phase === 'before-db.json-write' ? 30 : 40);
    const key = softPasskey(origin);
    const ceremony = await options(failing, invite.token);
    const before = authorityRows(fixture.dataDir, 'SELECT uid FROM enrollment_sessions').at(0).uid;
    const exited = failing.stopped();
    assert.equal((await verify(failing, ceremony, key)).status, 500);
    assert.equal((await exited).code, 86);

    const restarted = await fixture.start({ AUTHORITY_ENROLLMENT_FAILPOINT: '' });
    const retry = await options(restarted, invite.token);
    const after = authorityRows(fixture.dataDir, 'SELECT uid FROM enrollment_sessions').at(0).uid;
    assert.equal(after, before);
    assert.ok([400, 403].includes((await verify(restarted, ceremony, softPasskey(origin))).status), 'old options cannot authorize a replacement credential');
    const users = dbJson(fixture.dataDir).users.filter(user => user.id === before);
    if (phase === 'before-db.json-write') {
      assert.equal(users.length, 0);
      assert.equal((await verify(restarted, retry, key)).status, 200);
    } else {
      assert.equal(users.length, 1);
      assert.equal((await verify(restarted, retry, softPasskey(origin))).status, 403);
      const loginOptions = await restarted.request('POST', '/api/login/options', { body: {} });
      assert.equal((await restarted.request('POST', '/api/login/verify', { body: { cid: loginOptions.body.cid, credential: key.assertion(loginOptions.body.options.challenge) } })).status, 200);
    }
    assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM subscription_intervals').length, 0);
    assert.equal(authorityRows(fixture.dataDir, 'SELECT state FROM invitations').at(0).state, 'PENDING');
  });
}

test('managed password registration is enabled only with PASSWORD_LOGIN and keeps the same recovery boundary', async t => {
  const disabled = await managedServer(t, { PASSWORD_LOGIN: '' });
  const disabledServer = await disabled.start();
  assert.equal((await disabledServer.request('POST', '/api/register/password', { body: { name: 'New', password: 'correct horse battery staple' } })).status, 404);

  const fixture = await managedServer(t, { PASSWORD_LOGIN: '1' });
  const server = await fixture.start();
  await provisionTrainer(server);
  const invite = await createInvitation(server, 50);
  const invalid = await server.request('POST', '/api/register/password', { body: { name: 'New password client', password: 'correct horse battery staple' } });
  assert.equal(invalid.status, 403);
  const created = await server.request('POST', '/api/register/password', { body: { name: 'New password client', password: 'correct horse battery staple', inviteToken: invite.token } });
  assert.equal(created.status, 200);
  const uid = created.body.user.id;
  assert.equal(authorityRows(fixture.dataDir, 'SELECT state FROM enrollment_sessions WHERE uid=?', uid).at(0).state, 'PENDING_OPERATIONAL_ROLE');
  assert.equal(authorityRows(fixture.dataDir, 'SELECT state FROM invitations').at(0).state, 'PENDING');
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM operational_roles').length, 1);
  assert.equal(authorityRows(fixture.dataDir, 'SELECT * FROM subscription_intervals').length, 0);
  const retry = await server.request('POST', '/api/register/password', { body: { name: 'Replacement', password: 'correct horse battery staple', inviteToken: invite.token } });
  assert.equal(retry.status, 403);
  assert.equal(dbJson(fixture.dataDir).users.filter(user => user.id === uid).length, 1);

  const recovery = await managedServer(t, { PASSWORD_LOGIN: '1', AUTHORITY_ENROLLMENT_FAILPOINT: 'after-db.json-write' });
  const failing = await recovery.start();
  await provisionTrainer(failing);
  const recoveryInvite = await createInvitation(failing, 60);
  const stopped = failing.stopped();
  const crashed = await failing.request('POST', '/api/register/password', {
    body: { name: 'Restarted password client', password: 'correct horse battery staple', inviteToken: recoveryInvite.token }
  });
  assert.equal(crashed.status, 500);
  assert.equal((await stopped).code, 86);
  const restarted = await recovery.start({ AUTHORITY_ENROLLMENT_FAILPOINT: '' });
  const replacement = await restarted.request('POST', '/api/register/password', {
    body: { name: 'Replacement after restart', password: 'correct horse battery staple', inviteToken: recoveryInvite.token }
  });
  assert.equal(replacement.status, 403, 'post-write registration retry is safe and requires sign-in');
  const login = await restarted.request('POST', '/api/login/password', {
    body: { name: 'Restarted password client', password: 'correct horse battery staple' }
  });
  assert.equal(login.status, 200);
  assert.equal(authorityRows(recovery.dataDir, 'SELECT state FROM enrollment_sessions').at(0).state, 'PENDING_OPERATIONAL_ROLE');
});
