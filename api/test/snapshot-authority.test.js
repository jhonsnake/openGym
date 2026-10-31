import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AUTHORITY_SCHEMA_VERSION, createAuthorityStore } from '../authority-store.js';

const helper = path.resolve('scripts/snapshot-authority.mjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-snapshot-test-'));
}

function hashFile(file) {
  return fs.readFileSync(file).toString('base64');
}

function makeAuthorityFixture(root) {
  const source = path.join(root, 'source');
  fs.mkdirSync(source, { mode: 0o700 });
  const store = createAuthorityStore({ dataDir: source });
  store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('role-1','synthetic-client','CLIENT','synthetic-admin','2026-01-01T00:00:00.000Z',1,'synthetic')").run();
    tx.db.prepare("INSERT INTO invitations(id,trainer_id,known_client_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('invite-1','synthetic-trainer','synthetic-client','Synthetic','token-hash','PENDING','2026-02-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO invitation_grants(id,invitation_id,kind,start_utc,end_exclusive_utc,include_weight) VALUES ('invite-grant-1','invite-1','HISTORY','2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,initiator_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('enrollment-1','invite-1','synthetic-client','challenge-hash','initiator-hash','PENDING_OPERATIONAL_ROLE','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-02-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES ('relation-1','synthetic-trainer','synthetic-client','invite-1','ACTIVE','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES ('window-1','relation-1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','synthetic',1)").run();
    tx.db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,granted_by,version) VALUES ('grant-1','relation-1','HISTORY','ACTIVE','synthetic-trainer',1)").run();
    tx.db.prepare("INSERT INTO relation_pending_grants(id,relation_id,kind,include_weight,consented_at_utc,version) VALUES ('pending-grant-1','relation-1','HISTORY',1,'2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO goal_versions(id,relation_id,version_number,payload_json,payload_sha256,created_by,created_at_utc,version) VALUES ('goal-1','relation-1',1,'{}','goal-hash','synthetic-trainer','2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO plan_versions(id,relation_id,version_number,goal_version_id,payload_json,payload_sha256,created_by,published_at_utc,version) VALUES ('plan-1','relation-1',1,'goal-1','{}','plan-hash','synthetic-trainer','2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO client_sessions(id,client_id,relation_id,plan_version_id,goal_version_id,access_window_id,server_started_at_utc,snapshot_json,state,version) VALUES ('session-1','synthetic-client','relation-1','plan-1','goal-1','window-1','2026-01-01T00:00:00.000Z','{}','FINISHED',1)").run();
    tx.db.prepare("INSERT INTO session_executions(id,session_id,client_id,payload_json,payload_sha256,operation_id,submitted_at_utc,version) VALUES ('execution-1','session-1','synthetic-client','{}','execution-hash','operation-1','2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO export_jobs(id,account_id,state,created_at_utc,version) VALUES ('export-1','synthetic-client','REQUESTED','2026-01-01T00:00:00.000Z',1)").run();
    tx.db.prepare("INSERT INTO deletion_requests(id,account_id,requested_at_utc,state,version) VALUES ('deletion-1','synthetic-client','2026-01-01T00:00:00.000Z','REQUESTED',1)").run();
    tx.db.prepare("INSERT INTO authority_audit(id,actor_id,entity_type,entity_id,occurred_at_utc,request_id) VALUES ('audit-1','synthetic-trainer','RELATION','relation-1','2026-01-01T00:00:00.000Z','request-1')").run();
    tx.bumpAggregate('relation', ['relation-1']);
    tx.db.prepare("INSERT INTO mutation_results(operation_id,actor_id,capability,aggregate_kind,aggregate_key,payload_sha256,result_entity_type,result_entity_id,result_version,result_metadata_json,committed_at_utc) VALUES ('mutation-1','synthetic-trainer','relation.write','relation','relation-1','mutation-hash','RELATION','relation-1',1,'{}','2026-01-01T00:00:00.000Z')").run();
    tx.db.prepare("INSERT INTO bodyweight_entries(id,client_id,weight,unit,reported_date_panama,received_at_utc,operation_id,version) VALUES ('weight-1','synthetic-client',80,'KG','2026-01-01','2026-01-01T00:00:00.000Z','weight-op-1',1)").run();
    tx.db.prepare("INSERT INTO history_shares(id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,projection_json,projection_sha256,published_at_utc,operation_id,version) VALUES ('share-1','synthetic-client','relation-1','grant-1','2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z','{}','share-hash','2026-01-01T00:00:00.000Z','share-op-1',1)").run();
  });
  store.close();
  fs.writeFileSync(path.join(source, 'authority.sqlite-wal'), '');
  fs.writeFileSync(path.join(source, 'authority.sqlite-shm'), '');
  return source;
}

function runHelper(source, destination, extra = []) {
  return spawnSync(process.execPath, [helper, '--source', source, '--destination', destination, ...extra], {
    encoding: 'utf8',
  });
}

function inspectSnapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('PRAGMA integrity_check').get().integrity_check;
  } finally {
    db.close();
  }
}

test('includes committed live-WAL authority changes without changing the open production files', () => {
  const root = temporaryDirectory();
  const source = path.join(root, 'source');
  let store;
  try {
    fs.mkdirSync(source, { mode: 0o700 });
    store = createAuthorityStore({ dataDir: source });
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0;');
    store.transaction({}, tx => {
      tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('live-role','live-client','CLIENT','live-admin','2026-01-02T00:00:00.000Z',1,'live')").run();
      tx.bumpAggregate('role', ['live-client']);
    });
    const sourceFiles = ['authority.sqlite', 'authority.sqlite-wal', 'authority.sqlite-shm'];
    const before = Object.fromEntries(sourceFiles.map(name => [name, hashFile(path.join(source, name))]));
    const destinationDirectory = path.join(root, 'destination');
    fs.mkdirSync(destinationDirectory, { mode: 0o700 });
    const destination = path.join(destinationDirectory, 'live.sqlite');
    fs.chmodSync(source, 0o555);
    fs.chmodSync(path.join(source, 'authority.sqlite'), 0o444);

    const result = runHelper(source, destination);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(`${destination}-wal`), false);
    assert.equal(fs.existsSync(`${destination}-shm`), false);
    assert.deepEqual(Object.fromEntries(sourceFiles.map(name => [name, hashFile(path.join(source, name))])), before);
    const metadata = JSON.parse(result.stdout);
      assert.equal(metadata.schema.authority_version, 1);
    assert.equal(metadata.entity_counts.operational_roles, 1);
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(snapshot.prepare("SELECT count(*) AS count FROM operational_roles WHERE account_id='live-client'").get().count, 1);
      assert.equal(snapshot.prepare("SELECT version FROM aggregate_versions WHERE kind='role' AND aggregate_key='[\"live-client\"]'").get().version, 1);
      assert.equal(snapshot.prepare('SELECT authority_version FROM authority_meta WHERE id=1').get().authority_version, 1);
    } finally {
      snapshot.close();
    }
  } finally {
    try { fs.chmodSync(source, 0o700); } catch {}
    try { store?.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recovers a copied WAL without SHM without changing the crash-like source', () => {
  const root = temporaryDirectory();
  const writerDirectory = path.join(root, 'writer');
  const source = path.join(root, 'source');
  let store;
  try {
    fs.mkdirSync(writerDirectory, { mode: 0o700 });
    store = createAuthorityStore({ dataDir: writerDirectory });
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0;');
    store.transaction({}, tx => {
      tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('crash-role','crash-client','CLIENT','crash-admin','2026-01-03T00:00:00.000Z',1,'crash')").run();
      tx.bumpAggregate('role', ['crash-client']);
    });
    fs.mkdirSync(source, { mode: 0o700 });
    fs.copyFileSync(path.join(writerDirectory, 'authority.sqlite'), path.join(source, 'authority.sqlite'));
    fs.copyFileSync(path.join(writerDirectory, 'authority.sqlite-wal'), path.join(source, 'authority.sqlite-wal'));
    store.close();
    store = undefined;
    assert.equal(fs.existsSync(path.join(source, 'authority.sqlite-shm')), false);
    const before = Object.fromEntries(['authority.sqlite', 'authority.sqlite-wal'].map(name => [name, hashFile(path.join(source, name))]));
    const destinationDirectory = path.join(root, 'destination');
    fs.mkdirSync(destinationDirectory, { mode: 0o700 });
    const destination = path.join(destinationDirectory, 'crash.sqlite');
    fs.chmodSync(source, 0o555);
    fs.chmodSync(path.join(source, 'authority.sqlite'), 0o444);

    const result = runHelper(source, destination);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(`${destination}-wal`), false);
    assert.equal(fs.existsSync(`${destination}-shm`), false);
    assert.deepEqual(Object.fromEntries(['authority.sqlite', 'authority.sqlite-wal'].map(name => [name, hashFile(path.join(source, name))])), before);
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(snapshot.prepare("SELECT count(*) AS count FROM operational_roles WHERE account_id='crash-client'").get().count, 1);
      assert.equal(snapshot.prepare('SELECT authority_version FROM authority_meta WHERE id=1').get().authority_version, 1);
    } finally {
      snapshot.close();
    }
  } finally {
    try { fs.chmodSync(source, 0o700); } catch {}
    try { store?.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('creates a stable standalone authority snapshot without changing a read-only source or sidecars', () => {
  const root = temporaryDirectory();
  try {
    const source = makeAuthorityFixture(root);
    const destinationDirectory = path.join(root, 'destination');
    fs.mkdirSync(destinationDirectory, { mode: 0o700 });
    const first = path.join(destinationDirectory, 'first.sqlite');
    const second = path.join(destinationDirectory, 'second.sqlite');
    const sourceFiles = ['authority.sqlite', 'authority.sqlite-wal', 'authority.sqlite-shm'];
    const before = Object.fromEntries(sourceFiles.map(name => [name, hashFile(path.join(source, name))]));
    fs.chmodSync(source, 0o555);
    fs.chmodSync(path.join(source, 'authority.sqlite'), 0o444);

    const firstResult = runHelper(source, first);
    const secondResult = runHelper(source, second);

    assert.equal(firstResult.status, 0, firstResult.stderr);
    assert.equal(secondResult.status, 0, secondResult.stderr);
    const metadata = JSON.parse(firstResult.stdout);
    assert.deepEqual(JSON.parse(secondResult.stdout), metadata);
    assert.deepEqual(metadata, {
      format: 'opengym-authority-snapshot/v1',
      schema: { supported_version: AUTHORITY_SCHEMA_VERSION, version: AUTHORITY_SCHEMA_VERSION, authority_version: 1 },
      entity_counts: {
        operational_roles: 1,
        coordinator_scopes: 0,
        invitations: 1,
        invitation_grants: 1,
        enrollment_sessions: 1,
        relations: 1,
        relation_access_windows: 1,
        relation_grants: 1,
        relation_pending_grants: 1,
        subscription_intervals: 0,
        indefinite_client_entitlements: 0,
        commercial_operations: 0,
        goal_versions: 1,
        plan_versions: 1,
        client_sessions: 1,
        session_executions: 1,
        export_jobs: 1,
        deletion_requests: 1,
        authority_audit: 1,
        aggregate_versions: 1,
        mutation_results: 1,
        bodyweight_entries: 1,
        history_shares: 1,
      },
    });
    assert.equal(fs.existsSync(`${first}-wal`), false);
    assert.equal(fs.existsSync(`${first}-shm`), false);
    assert.equal(inspectSnapshot(first), 'ok');
    assert.equal(inspectSnapshot(second), 'ok');
    assert.deepEqual(Object.fromEntries(sourceFiles.map(name => [name, hashFile(path.join(source, name))])), before);
    assert.equal(firstResult.stdout.includes('synthetic-client'), false);
  } finally {
    fs.chmodSync(path.join(root, 'source'), 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for a future schema and removes only its attempted output', () => {
  const root = temporaryDirectory();
  try {
    const source = makeAuthorityFixture(root);
    const db = new DatabaseSync(path.join(source, 'authority.sqlite'));
    db.prepare('UPDATE schema_meta SET version=? WHERE id=1').run(AUTHORITY_SCHEMA_VERSION + 1);
    db.prepare('UPDATE authority_meta SET schema_version=? WHERE id=1').run(AUTHORITY_SCHEMA_VERSION + 1);
    db.close();
    const destination = path.join(root, 'future.sqlite');

    const result = runHelper(source, destination);

    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(destination), false);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('synthetic-client'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for an integrity-invalid source without exposing database contents', () => {
  const root = temporaryDirectory();
  try {
    const source = makeAuthorityFixture(root);
    const sourceFile = path.join(source, 'authority.sqlite');
    fs.writeFileSync(sourceFile, 'not a SQLite database');
    const before = hashFile(sourceFile);
    const destination = path.join(root, 'invalid.sqlite');

    const result = runHelper(source, destination);

    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(fs.existsSync(destination), false);
    assert.equal(hashFile(sourceFile), before);
    assert.equal(result.stderr.includes('not a SQLite database'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for a missing required entity table without changing source or destination', () => {
  const root = temporaryDirectory();
  try {
    const source = makeAuthorityFixture(root);
    const sourceFile = path.join(source, 'authority.sqlite');
    const before = hashFile(sourceFile);
    const db = new DatabaseSync(sourceFile);
    db.exec('DROP TABLE relation_pending_grants');
    db.close();
    const changed = hashFile(sourceFile);
    const destination = path.join(root, 'missing.sqlite');
    fs.writeFileSync(destination, 'preserve-this-output');

    const result = runHelper(source, destination);

    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'preserve-this-output');
    assert.equal(hashFile(sourceFile), changed);
    assert.notEqual(changed, before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preserves an existing destination and rejects invalid or symlink paths', () => {
  const root = temporaryDirectory();
  try {
    const source = makeAuthorityFixture(root);
    const existing = path.join(root, 'existing.sqlite');
    fs.writeFileSync(existing, 'preserve-this-output');
    const existingResult = runHelper(source, existing);
    assert.notEqual(existingResult.status, 0);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'preserve-this-output');

    const destination = path.join(root, 'symlink.sqlite');
    fs.symlinkSync(existing, destination);
    const symlinkResult = runHelper(source, destination);
    assert.notEqual(symlinkResult.status, 0);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'preserve-this-output');

    const sourceLink = path.join(root, 'source-link');
    fs.symlinkSync(source, sourceLink);
    const sourceLinkResult = runHelper(sourceLink, path.join(root, 'from-link.sqlite'));
    assert.notEqual(sourceLinkResult.status, 0);

    const sourceWal = path.join(source, 'authority.sqlite-wal');
    fs.unlinkSync(sourceWal);
    fs.symlinkSync(existing, sourceWal);
    const sourceWalLinkResult = runHelper(source, path.join(root, 'from-wal-link.sqlite'));
    assert.notEqual(sourceWalLinkResult.status, 0);

    const invalidResult = spawnSync(process.execPath, [helper, '--source', source], { encoding: 'utf8' });
    assert.notEqual(invalidResult.status, 0);
    const samePathResult = runHelper(source, path.join(source, 'authority.sqlite'));
    assert.notEqual(samePathResult.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
