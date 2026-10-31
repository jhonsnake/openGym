import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';

const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = path.join(apiDir, 'scripts', 'fixtures', 'commercial-race-worker.mjs');
const operation = n => `123e4567-e89b-42d3-a456-426614177${String(n).padStart(3, '0')}`;
const identities = new Set(['admin', 'coordinator', 'client']);
const clock = () => '2027-01-31T12:00:00.000Z';

function serviceFor(dataDir) {
  const store = createAuthorityStore({ dataDir });
  return {
    store,
    service: createAuthorityService({
      store,
      clock,
      identity: { get: uid => ({ uid, active: identities.has(uid), activity: identities.has(uid) ? 'ACTIVE' : 'UNKNOWN' }) },
      isAdmin: uid => uid === 'admin'
    })
  };
}

function waitFor(child, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker did not send ${type}`)), 10000);
    child.on('message', message => {
      if (message?.type !== type) return;
      clearTimeout(timer);
      resolve(message);
    });
    child.once('error', reject);
    child.once('exit', code => { if (code && type !== 'result') reject(new Error(`worker exited ${code}`)); });
  });
}

test('two DatabaseSync processes race one subscription version: one commits, the other gets 409, and withdrawn scope blocks replay', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-commercial-race-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const seeded = serviceFor(dataDir);
  seeded.service.setRoles({ actorId: 'admin', operationId: operation(1), expectedVersion: 0, payload: { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'race coordinator' } });
  seeded.service.setRoles({ actorId: 'admin', operationId: operation(2), expectedVersion: 0, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'race client' } });
  seeded.service.setScope({ actorId: 'admin', operationId: operation(3), expectedVersion: 0, payload: { coordinatorId: 'coordinator', clientId: 'client', assigned: true, reason: 'race scope' } });
  seeded.store.close();

  const firstBody = { operationId: operation(10), expectedVersion: 0, payload: { clientId: 'client', kind: 'MONTHLY', reference: 'first external receipt', reason: 'race first' } };
  const secondBody = { operationId: operation(11), expectedVersion: 0, payload: { clientId: 'client', kind: 'MONTHLY', reference: 'second external receipt', reason: 'race second' } };
  const first = fork(worker, { env: { ...process.env, AUTHORITY_RACE_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const second = fork(worker, { env: { ...process.env, AUTHORITY_RACE_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { first.kill('SIGKILL'); second.kill('SIGKILL'); });
  await Promise.all([waitFor(first, 'ready'), waitFor(second, 'ready')]);
  const firstResult = waitFor(first, 'result');
  const secondResult = waitFor(second, 'result');
  first.send({ type: 'mutate', body: firstBody, requestId: 'first-race-request' });
  second.send({ type: 'mutate', body: secondBody, requestId: 'second-race-request' });
  const results = await Promise.all([firstResult, secondResult]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);

  const readback = new DatabaseSync(path.join(dataDir, 'authority.sqlite'));
  try {
    assert.equal(readback.prepare('SELECT count(*) AS n FROM subscription_intervals').get().n, 1);
    assert.equal(readback.prepare('SELECT version FROM aggregate_versions WHERE kind=? AND aggregate_key=?').get('SUBSCRIPTION', '["client"]').version, 1);
    assert.equal(readback.prepare('SELECT count(*) AS n FROM commercial_operations').get().n, 1);
  } finally {
    readback.close();
  }

  const followup = serviceFor(dataDir);
  try {
    followup.service.setScope({ actorId: 'admin', operationId: operation(12), expectedVersion: 1, payload: { coordinatorId: 'coordinator', clientId: 'client', assigned: false, reason: 'withdraw scope before replay' } });
    const committedBody = results.find(result => result.status === 200).receipt.operationId === firstBody.operationId ? firstBody : secondBody;
    assert.throws(
      () => followup.service.confirmCommercialOperation({ actorId: 'coordinator', body: committedBody, requestId: 'withdrawn-replay' }),
      /forbidden/
    );
  } finally {
    followup.store.close();
  }
});
