import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';
import { createAuthorityExport } from '../authority-export.js';

const op = () => crypto.randomUUID();
const at = '2026-10-31T12:00:00.000Z';

function setup({ legacy = () => ({}), users = new Map([['owner', true], ['other', true], ['disabled', false]]) } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-export-'));
  const store = createAuthorityStore({ dataDir });
  const identity = { get: uid => ({ uid, activity: users.get(uid) ? 'ACTIVE' : users.has(uid) ? 'DISABLED' : 'UNKNOWN', active: users.get(uid) === true }) };
  const authority = createAuthorityService({ store, identity, clock: () => at });
  const api = createAuthorityExport({ store, authority, identity, readLegacyData: legacy, clock: () => at });
  return { dataDir, store, identity, authority, api };
}

function command(actorId, expectedVersion = 0, operationId = op()) {
  return { actorId, body: { operationId, expectedVersion, payload: {} }, requestId: 'request-test' };
}

test('requestExport is synchronous, strictly validates its closed envelope, and replays metadata only', () => {
  let reads = 0;
  const { store, api } = setup({ legacy: () => { reads += 1; return {}; } });
  const first = api.requestExport(command('owner'));
  assert.equal(typeof first.then, 'undefined');
  assert.equal(first.result.state, 'READY');
  assert.match(first.result.jobId, /^[0-9a-f]{8}-[0-9a-f]{4}-4/i);
  assert.equal(reads, 0);
  const replay = api.requestExport(command('owner', 999, first.operationId));
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(store.db.prepare('SELECT path,state FROM export_jobs WHERE id=?').get(first.result.jobId).path, null);
  const audit = JSON.parse(store.db.prepare('SELECT after_json FROM authority_audit WHERE entity_type=?').get('export-job').after_json);
  assert.deepEqual(audit, first.result);
  for (const body of [
    { operationId: op(), expectedVersion: 1, payload: { x: 1 } },
    { operationId: op(), expectedVersion: 1, payload: {}, extra: true },
    { operationId: first.operationId, expectedVersion: 1, payload: { replayCanary: true } },
    { operationId: op(), expectedVersion: 1, payload: Object.assign(Object.create(null), {}) }
  ]) assert.throws(() => api.requestExport({ actorId: 'owner', body }), /unknown|plain object/);
});

test('requestDeletion records only one REQUESTED request and cannot destroy data', () => {
  const { store, api } = setup();
  const first = api.requestDeletion(command('owner'));
  assert.deepEqual(first.result.state, 'REQUESTED');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM deletion_requests WHERE account_id=?').get('owner').n, 1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM export_jobs').get().n, 0);
  assert.deepEqual(api.requestDeletion(command('owner', 9, first.operationId)).result, first.result);
  assert.throws(() => api.requestDeletion(command('owner', 1)), /conflict/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM deletion_requests WHERE account_id=?').get('owner').n, 1);
  const audit = JSON.parse(store.db.prepare('SELECT after_json FROM authority_audit WHERE entity_type=?').get('deletion-request').after_json);
  assert.deepEqual(audit, first.result);
});

test('download keeps unknown and foreign jobs opaque and never calls legacy data before authorization', async () => {
  let reads = 0;
  const { api } = setup({ legacy: async () => { reads += 1; return { unit: 'kg', workouts: [], routines: [] }; } });
  const job = api.requestExport(command('owner')).result.jobId;
  await assert.rejects(api.downloadExport({ actorId: 'other', jobId: job }), error => error.code === 'not-found');
  await assert.rejects(api.downloadExport({ actorId: 'owner', jobId: crypto.randomUUID() }), error => error.code === 'not-found');
  await assert.rejects(api.downloadExport({ actorId: 'disabled', jobId: job }), error => error.code === 'forbidden');
  assert.equal(reads, 0);
  const document = await api.downloadExport({ actorId: 'owner', jobId: job });
  assert.equal(reads, 1);
  assert.equal(document.generatedAtUtc, at);
});

test('download exports all selected own actuals and metadata but filters unapproved legacy roots, nested canaries, media bytes, plans and audits', async () => {
  const legacy = {
    _rev: 7, unit: 'kg', routines: [{ id: 'mine', target: { reps: 8 }, privateToken: 'nope' }], workouts: [{ id: 'w1', d: '2026-10-01', entries: [], media: [{ kind: 'image', hash: 'abc', mime: 'image/jpeg', size: 1, data: 'pixels', url: 'https://bad' }] }],
    measurements: [{ d: '2026-10-01', chest: 99 }], customEx: [{ id: 'mine-custom', name: 'Mine', authToken: 'nope' }],
    unknownRoot: 'nope', credentials: { token: 'nope' }, coach: { consent: { agreedAt: at }, profile: { goal: 'strength' }, apiKey: 'nope' }
  };
  const { store, api } = setup({ legacy: async uid => { assert.equal(uid, 'owner'); return legacy; } });
  store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('invite-owner','trainer','Owner','hash-owner','ACCEPTED','2099-01-01T00:00:00.000Z',?,1)").run(at);
    tx.db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,version) VALUES ('relation-owner','trainer','owner','invite-owner','ENDED',?,1)").run(at);
    tx.db.prepare("INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,ended_at_utc,reason,version) VALUES ('window-owner','relation-owner',?,?,?,'ended',1)").run(at, at, at);
    tx.db.prepare("INSERT INTO plan_versions(id,relation_id,version_number,payload_json,payload_sha256,created_by,published_at_utc,version) VALUES ('plan-owner','relation-owner',1,'{\"exercises\":[]}','hash','trainer',?,1)").run(at);
    tx.db.prepare("INSERT INTO client_sessions(id,client_id,relation_id,plan_version_id,access_window_id,server_started_at_utc,snapshot_json,state,version) VALUES ('session-owner','owner','relation-owner','plan-owner','window-owner',?,'{\"prescriptionTarget\":\"do-not-export\"}','FINISHED',1)").run(at);
    tx.db.prepare("INSERT INTO session_executions(id,session_id,client_id,payload_json,payload_sha256,operation_id,submitted_at_utc,version) VALUES ('execution-owner','session-owner','owner','{\"sessionId\":\"session-owner\",\"entries\":[{\"exerciseId\":\"mine-custom\",\"disposition\":\"ADDED\",\"sets\":[{\"phase\":\"work\",\"completed\":true,\"reps\":5}]}]}','hash',?, ?,1)").run(op(), at);
    tx.db.prepare("INSERT INTO bodyweight_entries(id,client_id,weight,unit,reported_date_panama,received_at_utc,operation_id,version) VALUES ('bw-owner','owner',80,'KG','2026-10-30',?, ?,1)").run(at, op());
    tx.db.prepare("INSERT INTO bodyweight_entries(id,client_id,weight,unit,reported_date_panama,received_at_utc,operation_id,version) VALUES ('bw-other','other',70,'KG','2026-10-30',?, ?,1)").run(at, op());
    tx.db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES ('sub-owner','owner','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',1,'MONTHLY','receipt-owner','own commercial record','admin',?,1)").run(at);
  });
  const job = api.requestExport(command('owner')).result.jobId;
  const document = await api.downloadExport({ actorId: 'owner', jobId: job });
  assert.deepEqual(document.legacyState.routines[0].target, { reps: 8 });
  assert.equal(document.legacyState.routines[0].privateToken, undefined);
  assert.equal(document.legacyState.unknownRoot, undefined);
  assert.equal(document.legacyState.credentials, undefined);
  assert.equal(document.legacyState.coach.apiKey, undefined);
  assert.equal(document.legacyState.workouts[0].media[0].hash, 'abc');
  assert.equal(document.legacyState.workouts[0].media[0].data, undefined);
  assert.equal(document.legacyState.workouts[0].media[0].url, undefined);
  assert.equal(document.sqlite.bodyweightEntries.length, 1);
  assert.equal(document.sqlite.bodyweightEntries[0].sourceRecordId, 'bw-owner');
  assert.equal(document.sqlite.sessionExecutionActuals[0].sourceRecordId, 'execution-owner');
  assert.equal(JSON.stringify(document.sqlite.sessionExecutionActuals).includes('prescriptionTarget'), false);
  assert.equal(document.commercial.subscriptionIntervals[0].id, 'sub-owner');
  assert.equal(JSON.stringify(document).includes('snapshot_json'), false);
  assert.equal(JSON.stringify(document).includes('authority_audit'), false);
});

test('an optimistic export set token prevents two SQLite connections from both creating a job', () => {
  const one = setup();
  const twoStore = createAuthorityStore({ dataDir: one.dataDir });
  const twoAuthority = createAuthorityService({ store: twoStore, identity: one.identity, clock: () => at });
  const two = createAuthorityExport({ store: twoStore, authority: twoAuthority, identity: one.identity, readLegacyData: () => ({}), clock: () => at });
  const first = one.api.requestExport(command('owner', 0));
  assert.equal(first.versionTokens.find(token => token.kind === 'EXPORT_SET').version, 1);
  assert.throws(() => two.requestExport(command('owner', 0)), /conflict/);
  assert.equal(twoStore.db.prepare('SELECT count(*) AS n FROM export_jobs WHERE account_id=?').get('owner').n, 1);
});
