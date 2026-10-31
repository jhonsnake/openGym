import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AUTHORITY_SCHEMA_VERSION, createAuthorityStore } from '../authority-store.js';

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'authority-store-')); }

test('migrates the complete authority schema with FK/check enforcement and zero versions', () => {
  const dir = fixture();
  const store = createAuthorityStore({ dataDir: dir });
  assert.equal(store.version(), AUTHORITY_SCHEMA_VERSION);
  assert.equal(store.getAggregateVersion('ROLES', '["uid"]'), 0);
  assert.throws(() => store.db.exec("INSERT INTO operational_roles(account_id, role, assigned_by, assigned_at_utc, version) VALUES ('u','NOPE','a','2026-01-01T00:00:00.000Z',1)"));
  assert.throws(() => store.db.exec("INSERT INTO coordinator_scopes(coordinator_id, client_id, assigned_by, assigned_at_utc, version) VALUES ('x','y','z','2026-01-01T00:00:00.000Z',1)"));
  store.close();
});

test('transaction rolls domain, audit and aggregate version back together', () => {
  const store = createAuthorityStore({ dataDir: fixture() });
  assert.throws(() => store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO operational_roles(account_id, role, assigned_by, assigned_at_utc, version) VALUES (?, ?, ?, ?, 1)").run('subject', 'CLIENT', 'actor', '2026-01-01T00:00:00.000Z');
    tx.bumpAggregate('ROLES', ['subject']);
    tx.audit({ actorId: 'actor', subjectId: 'subject', entityType: 'role', entityId: 'subject', after: { roles: ['CLIENT'] }, requestId: 'r' });
    throw new Error('failpoint');
  }));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM operational_roles').get().n, 0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM authority_audit').get().n, 0);
  assert.equal(store.getAggregateVersion('ROLES', '["subject"]'), 0);
  store.close();
});

test('backs up the sqlite snapshot without WAL sidecars', async () => {
  const dir = fixture(); const store = createAuthorityStore({ dataDir: dir });
  const target = path.join(dir, 'snapshot.sqlite');
  await store.snapshot(target);
  assert.ok(fs.statSync(target).size > 0);
  assert.equal(fs.existsSync(target + '-wal'), false);
  assert.equal(fs.existsSync(target + '-shm'), false);
  store.close();
});

test('two real sqlite connections serialize one fresh aggregate version and reject the stale writer', () => {
  const dir = fixture();
  const first = createAuthorityStore({ dataDir: dir });
  const second = createAuthorityStore({ dataDir: dir });
  const key = '["client"]';
  const observed = [first.getAggregateVersion('SUBSCRIPTION', key), second.getAggregateVersion('SUBSCRIPTION', key)];
  assert.deepEqual(observed, [0, 0]);
  first.transaction({}, tx => tx.bumpAggregate('SUBSCRIPTION', ['client']));
  assert.throws(() => second.transaction({}, tx => {
    if (tx.getAggregateVersion('SUBSCRIPTION', ['client']) !== observed[1]) throw new Error('conflict');
    tx.bumpAggregate('SUBSCRIPTION', ['client']);
  }), /conflict/);
  assert.equal(first.getAggregateVersion('SUBSCRIPTION', key), 1);
  first.close(); second.close();
});

test('authority meta, enrollment and invitation constraints are durable and future schemas fail closed', () => {
  const dir = fixture(); const store = createAuthorityStore({ dataDir: dir });
  const meta = store.db.prepare('SELECT schema_version,authority_version,updated_at_utc FROM authority_meta').get();
  assert.equal(meta.schema_version, AUTHORITY_SCHEMA_VERSION); assert.equal(meta.authority_version, 0); assert.match(meta.updated_at_utc, /Z$/);
  store.transaction({}, tx => tx.bumpAggregate('ROLES', ['u']));
  assert.equal(store.db.prepare('SELECT authority_version FROM authority_meta').get().authority_version, 1);
  assert.throws(() => store.transaction({}, tx => { tx.bumpAggregate('ROLES', ['u']); throw new Error('no'); }));
  assert.equal(store.db.prepare('SELECT authority_version FROM authority_meta').get().authority_version, 1);
  store.db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','t','n','h','PENDING','2027-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1)").run();
  store.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,initiator_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('e','i','u','challenge','owner','CHALLENGE_ISSUED','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',1)").run();
  assert.throws(() => store.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,initiator_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('e2','i','u','other','owner','CHALLENGE_ISSUED','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',1)").run());
  assert.throws(() => store.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,initiator_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('e3','i','u2','challenge','owner','CHALLENGE_ISSUED','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',1)").run());
  store.close();
  const future = createAuthorityStore({ dataDir: dir }); future.db.prepare('UPDATE authority_meta SET schema_version=?').run(AUTHORITY_SCHEMA_VERSION + 1); future.close();
  assert.throws(() => createAuthorityStore({ dataDir: dir }), /newer/i);
});

test('v2 to v4 retains nonempty sessions, executions and pending grants with FK and WAL intact', () => {
  const dir = fixture(); const seeded = createAuthorityStore({ dataDir: dir }); seeded.close();
  const db = new DatabaseSync(path.join(dir, 'authority.sqlite'));
  db.exec('PRAGMA foreign_keys=OFF;');
  const stamp = '2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','trainer','Client','token','ACCEPTED','2099-01-01T00:00:00.000Z',?,1)").run(stamp);
  db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES ('r','trainer','client','i','ACTIVE',?,?,1)").run(stamp, stamp);
  db.prepare("INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES ('w','r',?,?, 'test',1)").run(stamp, stamp);
  db.prepare("INSERT INTO goal_versions(id,relation_id,version_number,payload_json,payload_sha256,created_by,created_at_utc,version) VALUES ('g','r',1,'{}','h','trainer',?,1)").run(stamp);
  db.prepare("INSERT INTO plan_versions(id,relation_id,version_number,goal_version_id,payload_json,payload_sha256,created_by,published_at_utc,version) VALUES ('p','r',1,'g','{}','h','trainer',?,1)").run(stamp);
  db.prepare("INSERT INTO relation_pending_grants(id,relation_id,kind,consented_at_utc,version) VALUES ('pg','r','PLAN',?,1)").run(stamp);
  db.exec("DROP INDEX client_sessions_one_open; ALTER TABLE session_executions RENAME TO session_executions_v3; ALTER TABLE client_sessions RENAME TO client_sessions_v3; CREATE TABLE client_sessions (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, relation_id TEXT NOT NULL REFERENCES relations(id), plan_version_id TEXT NOT NULL REFERENCES plan_versions(id), goal_version_id TEXT REFERENCES goal_versions(id), access_window_id TEXT NOT NULL REFERENCES relation_access_windows(id), server_started_at_utc TEXT NOT NULL, snapshot_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('OPEN','FINISHED')), finished_at_utc TEXT, version INTEGER NOT NULL CHECK(version>=1)); CREATE TABLE session_executions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES client_sessions(id), client_id TEXT NOT NULL, payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, submitted_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1)); DROP TABLE client_sessions_v3; DROP TABLE session_executions_v3;");
  db.prepare("INSERT INTO client_sessions(id,client_id,relation_id,plan_version_id,goal_version_id,access_window_id,server_started_at_utc,snapshot_json,state,finished_at_utc,version) VALUES ('s','client','r','p','g','w',?,'{}','FINISHED',?,1)").run(stamp, stamp);
  db.prepare("INSERT INTO session_executions(id,session_id,client_id,payload_json,payload_sha256,operation_id,submitted_at_utc,version) VALUES ('e','s','client','{}','h','op',?,1)").run(stamp);
  db.prepare('UPDATE schema_meta SET version=2 WHERE id=1').run(); db.prepare('UPDATE authority_meta SET schema_version=2 WHERE id=1').run();
  db.close();
  const migrated = createAuthorityStore({ dataDir: dir });
  assert.equal(migrated.version(), 5);
  assert.equal(migrated.db.prepare("SELECT state FROM client_sessions WHERE id='s'").get().state, 'FINISHED');
  assert.equal(migrated.db.prepare('SELECT count(*) AS n FROM session_executions').get().n, 1);
  assert.equal(migrated.db.prepare('SELECT count(*) AS n FROM relation_pending_grants').get().n, 1);
  assert.deepEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(migrated.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  migrated.close();
});

test('v3 to v4 preserves every nonempty HISTORY share and its foreign keys', () => {
  const dir = fixture(); const seeded = createAuthorityStore({ dataDir: dir }); const db = seeded.db;
  const stamp = '2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','trainer','Client','history-token','ACCEPTED','2099-01-01T00:00:00.000Z',?,1)").run(stamp);
  db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES ('r','trainer','client','i','ACTIVE',?,?,1)").run(stamp, stamp);
  db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,window_end_exclusive_utc,granted_by,version) VALUES ('g','r','HISTORY','ACTIVE','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z','client',1)").run();
  db.prepare("INSERT INTO history_shares(id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,projection_json,projection_sha256,published_at_utc,operation_id,version) VALUES ('h','client','r','g','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z','[]','sha',?,'operation',1)").run(stamp);
  db.exec(`PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
ALTER TABLE history_shares RENAME TO history_shares_v4;
CREATE TABLE history_shares (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, relation_id TEXT NOT NULL REFERENCES relations(id), grant_id TEXT NOT NULL REFERENCES relation_grants(id), from_utc TEXT NOT NULL, to_exclusive_utc TEXT NOT NULL, source_personal_rev TEXT, source_personal_wid TEXT, source_sqlite_version INTEGER, projection_json TEXT NOT NULL, projection_sha256 TEXT NOT NULL, published_at_utc TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL CHECK(version>=1), CHECK(from_utc<to_exclusive_utc));
INSERT INTO history_shares SELECT id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,source_personal_rev,source_personal_wid,source_sqlite_version,projection_json,projection_sha256,published_at_utc,operation_id,version FROM history_shares_v4;
DROP TABLE history_shares_v4;
UPDATE schema_meta SET version=3 WHERE id=1;
UPDATE authority_meta SET schema_version=3 WHERE id=1;
COMMIT;
PRAGMA foreign_keys=ON;`);
  seeded.close();
  const migrated = createAuthorityStore({ dataDir: dir });
  assert.equal(migrated.version(), 5);
  const share = migrated.db.prepare("SELECT id,relation_id,grant_id,operation_id,projection_json FROM history_shares WHERE id='h'").get();
  assert.equal(share.id, 'h'); assert.equal(share.relation_id, 'r'); assert.equal(share.grant_id, 'g'); assert.equal(share.operation_id, 'operation'); assert.equal(share.projection_json, '[]');
  assert.deepEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
  migrated.close();
});

test('v4 to v5 preserves nonempty authority rows and assigns a server migration eligibility boundary', () => {
  const dir = fixture(); const seeded = createAuthorityStore({ dataDir: dir }); const db = seeded.db;
  const stamp = '2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','trainer','Client','migration-token','ACCEPTED','2099-01-01T00:00:00.000Z',?,1)").run(stamp);
  db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES ('r','trainer','client','i','ACTIVE',?,?,1)").run(stamp, stamp);
  db.prepare("INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES ('w','r',?,?, 'test',1)").run(stamp, stamp);
  const insertGrant = db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,window_end_exclusive_utc,granted_by,revoked_at_utc,version) VALUES (?,?,?,?,?,?,?,?,1)");
  insertGrant.run('g-active-weight','r','WEIGHT','ACTIVE',null,null,'client',null);
  insertGrant.run('g-active-history-a','r','HISTORY','ACTIVE','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z','client',null);
  insertGrant.run('g-active-history-b','r','HISTORY','ACTIVE','2025-02-01T00:00:00.000Z','2025-03-01T00:00:00.000Z','client',null);
  insertGrant.run('g-revoked','r','EXECUTION','REVOKED',null,null,'client','2026-01-02T00:00:00.000Z');
  db.prepare("INSERT INTO goal_versions(id,relation_id,version_number,payload_json,payload_sha256,created_by,created_at_utc,version) VALUES ('goal','r',1,'{}','goal-hash','trainer',?,1)").run(stamp);
  db.prepare("INSERT INTO plan_versions(id,relation_id,version_number,goal_version_id,payload_json,payload_sha256,created_by,published_at_utc,version) VALUES ('plan','r',1,'goal','{}','plan-hash','trainer',?,1)").run(stamp);
  db.prepare("INSERT INTO client_sessions(id,client_id,relation_id,plan_version_id,goal_version_id,access_window_id,server_started_at_utc,snapshot_json,state,finished_at_utc,version) VALUES ('session','client','r','plan','goal','w',?,'{}','FINISHED',?,1)").run(stamp, stamp);
  db.prepare("INSERT INTO session_executions(id,session_id,client_id,payload_json,payload_sha256,operation_id,submitted_at_utc,version) VALUES ('execution','session','client','{}','execution-hash','execution-operation',?,1)").run(stamp);
  db.prepare("INSERT INTO bodyweight_entries(id,client_id,weight,unit,reported_date_panama,received_at_utc,operation_id,version) VALUES ('weight','client',80,'KG','2026-01-01',?,'weight-operation',1)").run(stamp);
  db.prepare("INSERT INTO history_shares(id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,projection_json,projection_sha256,published_at_utc,operation_id,version) VALUES ('share-a','client','r','g-active-history-a','2025-01-01T00:00:00.000Z','2025-02-01T00:00:00.000Z','{}','share-hash',?,'share-operation-a',1)").run(stamp);
  db.prepare("INSERT INTO history_shares(id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,projection_json,projection_sha256,published_at_utc,operation_id,version) VALUES ('share-b','client','r','g-active-history-b','2025-02-01T00:00:00.000Z','2025-03-01T00:00:00.000Z','{}','share-hash',?,'share-operation-b',1)").run(stamp);
  db.prepare("INSERT INTO mutation_results(operation_id,actor_id,capability,aggregate_kind,aggregate_key,payload_sha256,result_entity_type,result_entity_id,result_version,result_metadata_json,committed_at_utc) VALUES ('receipt','client','CHANGE_GRANT','RELATION','[\"r\"]','payload-hash','relation','r',1,'{}',?)").run(stamp);
  seeded.close();
  const legacy = new DatabaseSync(path.join(dir, 'authority.sqlite'));
  const columns = legacy.prepare('PRAGMA table_info(relation_grants)').all().map(row => row.name);
  if (columns.includes('eligible_from_utc')) legacy.exec('ALTER TABLE relation_grants DROP COLUMN eligible_from_utc;');
  legacy.exec('PRAGMA foreign_keys=OFF; UPDATE schema_meta SET version=4 WHERE id=1; UPDATE authority_meta SET schema_version=4 WHERE id=1; PRAGMA foreign_keys=ON;'); legacy.close();
  const migrated = createAuthorityStore({ dataDir: dir });
  assert.equal(migrated.version(), 5);
  const grants = migrated.db.prepare('SELECT id,state,eligible_from_utc FROM relation_grants ORDER BY id').all();
  assert.deepEqual(grants.map(row => [row.id, row.state]), [['g-active-history-a', 'ACTIVE'], ['g-active-history-b', 'ACTIVE'], ['g-active-weight', 'ACTIVE'], ['g-revoked', 'REVOKED']]);
  assert.equal(new Set(grants.map(row => row.eligible_from_utc)).size, 1);
  assert.match(grants[0].eligible_from_utc, /Z$/);
  assert.equal(migrated.db.prepare('SELECT count(*) AS n FROM history_shares').get().n, 2);
  assert.equal(migrated.db.prepare('SELECT count(*) AS n FROM session_executions').get().n, 1);
  assert.equal(migrated.db.prepare('SELECT count(*) AS n FROM bodyweight_entries').get().n, 1);
  assert.equal(migrated.db.prepare("SELECT operation_id FROM mutation_results WHERE operation_id='receipt'").get().operation_id, 'receipt');
  assert.deepEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(migrated.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  migrated.close();
});

test('transaction rejects async callbacks and cannot commit delayed writes', async () => {
  const store = createAuthorityStore({ dataDir: fixture() });
  assert.throws(() => store.transaction({}, async tx => tx.bumpAggregate('ROLES', ['u'])), /synchronous/i);
  let delayed;
  assert.throws(() => store.transaction({}, tx => { delayed = Promise.resolve().then(() => tx.bumpAggregate('ROLES', ['u'])); return delayed; }), /thenable/i);
  await assert.rejects(delayed, /no longer active/i);
  assert.equal(store.getAggregateVersion('ROLES', '["u"]'), 0);
  store.close();
});
