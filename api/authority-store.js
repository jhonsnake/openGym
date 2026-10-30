import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { canonicalAggregateKey } from './authority-contract.js';

export const AUTHORITY_SCHEMA_VERSION = 1;
const SCHEMA_VERSION = AUTHORITY_SCHEMA_VERSION;
const sql = String.raw`
CREATE TABLE schema_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version>=0));
CREATE TABLE authority_meta (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version>=1), authority_version INTEGER NOT NULL CHECK(authority_version>=0), updated_at_utc TEXT NOT NULL);
CREATE TABLE operational_roles (id TEXT PRIMARY KEY, account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 128), role TEXT NOT NULL CHECK(role IN ('CLIENT','TRAINER','COORDINATOR')), assigned_by TEXT NOT NULL, assigned_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), removed_at_utc TEXT, removed_by TEXT, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 280));
CREATE UNIQUE INDEX operational_roles_active_unique ON operational_roles(account_id, role) WHERE removed_at_utc IS NULL;
CREATE TABLE coordinator_scopes (id TEXT PRIMARY KEY, coordinator_id TEXT NOT NULL CHECK(length(coordinator_id) BETWEEN 1 AND 128), client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 128), assigned_by TEXT NOT NULL, assigned_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), removed_at_utc TEXT, removed_by TEXT, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 280));
CREATE UNIQUE INDEX coordinator_scopes_active_unique ON coordinator_scopes(coordinator_id, client_id) WHERE removed_at_utc IS NULL;
CREATE TABLE invitations (id TEXT PRIMARY KEY, trainer_id TEXT NOT NULL, known_client_id TEXT, commercial_name TEXT NOT NULL CHECK(length(commercial_name) BETWEEN 1 AND 120), token_sha256 TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('PENDING','ACCEPTED','REJECTED','REVOKED','EXPIRED')), expires_at_utc TEXT NOT NULL, created_at_utc TEXT NOT NULL, consumed_at_utc TEXT, revoked_at_utc TEXT, version INTEGER NOT NULL CHECK(version>=1));
CREATE UNIQUE INDEX invitations_pending_token ON invitations(token_sha256) WHERE state='PENDING';
CREATE TABLE invitation_grants (id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL REFERENCES invitations(id), kind TEXT NOT NULL CHECK(kind IN ('PLAN','EXECUTION','HISTORY','WEIGHT')), start_utc TEXT, end_exclusive_utc TEXT, include_weight INTEGER NOT NULL DEFAULT 0 CHECK(include_weight IN (0,1)), CHECK((kind='HISTORY' AND start_utc IS NOT NULL AND end_exclusive_utc IS NOT NULL AND start_utc < end_exclusive_utc) OR kind!='HISTORY'));
CREATE TABLE enrollment_sessions (id TEXT PRIMARY KEY, invitation_id TEXT NOT NULL REFERENCES invitations(id), uid TEXT NOT NULL CHECK(length(uid) BETWEEN 1 AND 128), challenge_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('CHALLENGE_ISSUED','IDENTITY_CREATED','PENDING_OPERATIONAL_ROLE','ABORTED','COMPLETED')), created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL, expires_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), UNIQUE(invitation_id,uid));
CREATE UNIQUE INDEX enrollment_sessions_active_challenge_unique ON enrollment_sessions(challenge_hash) WHERE state='CHALLENGE_ISSUED';
CREATE TABLE relations (id TEXT PRIMARY KEY, trainer_id TEXT NOT NULL, client_id TEXT NOT NULL, invitation_id TEXT NOT NULL UNIQUE REFERENCES invitations(id), state TEXT NOT NULL CHECK(state IN ('PENDING_CONFIRMATION','ACTIVE','SUSPENDED','REACTIVATION_PENDING','ENDED')), accepted_at_utc TEXT NOT NULL, confirmed_at_utc TEXT, ended_at_utc TEXT, reason TEXT, version INTEGER NOT NULL CHECK(version>=1));
CREATE UNIQUE INDEX relations_one_active_client ON relations(client_id) WHERE state='ACTIVE';
CREATE TABLE relation_access_windows (id TEXT PRIMARY KEY, relation_id TEXT NOT NULL REFERENCES relations(id), eligible_from_utc TEXT NOT NULL, enabled_from_utc TEXT NOT NULL, ended_at_utc TEXT, reason TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), CHECK(eligible_from_utc<=enabled_from_utc));
CREATE UNIQUE INDEX relation_windows_one_active ON relation_access_windows(relation_id) WHERE ended_at_utc IS NULL;
CREATE TABLE relation_grants (id TEXT PRIMARY KEY, relation_id TEXT NOT NULL REFERENCES relations(id), kind TEXT NOT NULL CHECK(kind IN ('PLAN','EXECUTION','HISTORY','WEIGHT')), state TEXT NOT NULL CHECK(state IN ('ACTIVE','REVOKED','EXPIRED')), window_start_utc TEXT, window_end_exclusive_utc TEXT, granted_by TEXT NOT NULL, revoked_at_utc TEXT, version INTEGER NOT NULL CHECK(version>=1), CHECK(window_start_utc IS NULL OR window_end_exclusive_utc IS NULL OR window_start_utc<window_end_exclusive_utc));
CREATE UNIQUE INDEX relation_grants_active_unique ON relation_grants(relation_id,kind,coalesce(window_start_utc,''),coalesce(window_end_exclusive_utc,'')) WHERE state='ACTIVE';
CREATE TABLE subscription_intervals (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, start_utc TEXT NOT NULL, end_exclusive_utc TEXT NOT NULL, anchor_day INTEGER NOT NULL CHECK(anchor_day BETWEEN 1 AND 31), kind TEXT NOT NULL CHECK(kind IN ('MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL','CUSTOM')), reference TEXT NOT NULL CHECK(length(reference) BETWEEN 1 AND 160), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 280), created_by TEXT NOT NULL, created_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), CHECK(start_utc<end_exclusive_utc));
CREATE TABLE commercial_operations (operation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, client_id TEXT NOT NULL, payload_hash TEXT NOT NULL, expected_subscription_version INTEGER NOT NULL CHECK(expected_subscription_version>=0), result_interval_id TEXT NOT NULL REFERENCES subscription_intervals(id), created_at_utc TEXT NOT NULL);
CREATE TABLE goal_versions (id TEXT PRIMARY KEY, relation_id TEXT NOT NULL REFERENCES relations(id), version_number INTEGER NOT NULL CHECK(version_number>=1), payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, created_by TEXT NOT NULL, created_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), UNIQUE(relation_id,version_number));
CREATE TABLE plan_versions (id TEXT PRIMARY KEY, relation_id TEXT NOT NULL REFERENCES relations(id), version_number INTEGER NOT NULL CHECK(version_number>=1), goal_version_id TEXT REFERENCES goal_versions(id), payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, created_by TEXT NOT NULL, published_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1), UNIQUE(relation_id,version_number));
CREATE TABLE client_sessions (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, relation_id TEXT NOT NULL REFERENCES relations(id), plan_version_id TEXT NOT NULL REFERENCES plan_versions(id), goal_version_id TEXT REFERENCES goal_versions(id), access_window_id TEXT NOT NULL REFERENCES relation_access_windows(id), server_started_at_utc TEXT NOT NULL, snapshot_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('OPEN','FINISHED')), finished_at_utc TEXT, version INTEGER NOT NULL CHECK(version>=1));
CREATE UNIQUE INDEX client_sessions_one_open ON client_sessions(client_id) WHERE state='OPEN';
CREATE TABLE session_executions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE REFERENCES client_sessions(id), client_id TEXT NOT NULL, payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, submitted_at_utc TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1));
CREATE TABLE export_jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('REQUESTED','READY','EXPIRED','FAILED')), path TEXT, created_at_utc TEXT NOT NULL, expires_at_utc TEXT, version INTEGER NOT NULL CHECK(version>=1));
CREATE TABLE deletion_requests (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, requested_at_utc TEXT NOT NULL, state TEXT NOT NULL CHECK(state='REQUESTED'), version INTEGER NOT NULL CHECK(version>=1));
CREATE UNIQUE INDEX deletion_requests_one_open ON deletion_requests(account_id) WHERE state='REQUESTED';
CREATE TABLE authority_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, subject_id TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT, reference TEXT, occurred_at_utc TEXT NOT NULL, request_id TEXT NOT NULL);
CREATE TABLE aggregate_versions (kind TEXT NOT NULL, aggregate_key TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=0), PRIMARY KEY(kind,aggregate_key));
CREATE TABLE mutation_results (operation_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, capability TEXT NOT NULL, subject_id TEXT, aggregate_kind TEXT NOT NULL, aggregate_key TEXT NOT NULL, payload_sha256 TEXT NOT NULL, result_entity_type TEXT NOT NULL, result_entity_id TEXT NOT NULL, result_version INTEGER NOT NULL CHECK(result_version>=1), result_metadata_json TEXT NOT NULL, committed_at_utc TEXT NOT NULL);
CREATE TABLE bodyweight_entries (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, weight REAL NOT NULL CHECK(weight>0 AND weight<=500), unit TEXT NOT NULL CHECK(unit IN ('KG','LB')), reported_date_panama TEXT NOT NULL, received_at_utc TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL CHECK(version>=1));
CREATE TABLE history_shares (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, relation_id TEXT NOT NULL REFERENCES relations(id), grant_id TEXT NOT NULL REFERENCES relation_grants(id), from_utc TEXT NOT NULL, to_exclusive_utc TEXT NOT NULL, source_personal_rev TEXT, source_personal_wid TEXT, source_sqlite_version INTEGER, projection_json TEXT NOT NULL, projection_sha256 TEXT NOT NULL, published_at_utc TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL CHECK(version>=1), CHECK(from_utc<to_exclusive_utc));
`;
const now = () => new Date().toISOString();
export function createAuthorityStore({ dataDir, filename = 'authority.sqlite' } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, filename);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  db.exec('BEGIN IMMEDIATE');
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
    if (!exists) {
      db.exec(sql);
      db.prepare('INSERT INTO schema_meta(id, version) VALUES (1, ?)').run(SCHEMA_VERSION);
      db.prepare('INSERT INTO authority_meta(id,schema_version,authority_version,updated_at_utc) VALUES (1,?,?,?)').run(SCHEMA_VERSION, 0, now());
    } else {
      const row = db.prepare('SELECT version FROM schema_meta WHERE id=1').get();
      if (!row || row.version > SCHEMA_VERSION) throw new Error('authority schema is newer than this server');
      if (row.version !== SCHEMA_VERSION) throw new Error('unsupported authority schema migration');
      const meta = db.prepare('SELECT schema_version FROM authority_meta WHERE id=1').get();
      if (!meta || meta.schema_version > SCHEMA_VERSION) throw new Error('authority schema is newer than this server');
      if (meta.schema_version !== SCHEMA_VERSION) throw new Error('unsupported authority schema migration');
    }
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} db.close(); throw error; }
  const getAggregateVersion = (kind, key) => db.prepare('SELECT version FROM aggregate_versions WHERE kind=? AND aggregate_key=?').get(kind, key)?.version ?? 0;
  const transaction = (context, work) => {
    db.exec('BEGIN IMMEDIATE');
    let active = true;
    let semanticChange = false;
    const assertActive = () => { if (!active) throw new Error('authority transaction is no longer active'); };
    const guardedStatement = statement => new Proxy(statement, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (...args) => { assertActive(); return value.apply(target, args); } : value;
    }});
    const guardedDb = new Proxy(db, { get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === 'prepare') return (...args) => { assertActive(); return guardedStatement(value.apply(target, args)); };
      if (property === 'exec') return (...args) => { assertActive(); return value.apply(target, args); };
      return value;
    }});
    const tx = {
      db: guardedDb,
      context,
      getAggregateVersion: (kind, parts) => { assertActive(); return getAggregateVersion(kind, Array.isArray(parts) ? canonicalAggregateKey(parts) : parts); },
      bumpAggregate(kind, parts) { assertActive(); const key = Array.isArray(parts) ? canonicalAggregateKey(parts) : parts; const next = getAggregateVersion(kind, key) + 1; db.prepare('INSERT INTO aggregate_versions(kind,aggregate_key,version) VALUES (?,?,?) ON CONFLICT(kind,aggregate_key) DO UPDATE SET version=excluded.version').run(kind, key, next); semanticChange = true; return { kind, key, version: next }; },
      audit({ id = cryptoRandomId(), actorId, subjectId = null, entityType, entityId, before = null, after = null, reason = null, reference = null, requestId = context.requestId || '' }) { assertActive(); db.prepare('INSERT INTO authority_audit(id,actor_id,subject_id,entity_type,entity_id,before_json,after_json,reason,reference,occurred_at_utc,request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,actorId,subjectId,entityType,entityId,before && JSON.stringify(before),after && JSON.stringify(after),reason,reference,now(),requestId); },
      mutation(operationId) { assertActive(); return db.prepare('SELECT * FROM mutation_results WHERE operation_id=?').get(operationId); },
      recordMutation(row) { assertActive(); db.prepare('INSERT INTO mutation_results(operation_id,actor_id,capability,subject_id,aggregate_kind,aggregate_key,payload_sha256,result_entity_type,result_entity_id,result_version,result_metadata_json,committed_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(row.operationId,row.actorId,row.capability,row.subjectId,row.aggregateKind,row.aggregateKey,row.payloadSha256,row.resultEntityType,row.resultEntityId,row.resultVersion,JSON.stringify(row.resultMetadata ?? {}),now()); }
    };
    try {
      if (work.constructor?.name === 'AsyncFunction') throw new TypeError('authority transaction callbacks must be synchronous');
      const result = work(tx);
      if (result && typeof result.then === 'function') throw new TypeError('authority transaction callbacks must not return thenables');
      if (semanticChange) db.prepare('UPDATE authority_meta SET authority_version=authority_version+1,updated_at_utc=? WHERE id=1').run(now());
      db.exec('COMMIT');
      active = false;
      return result;
    } catch (error) {
      active = false;
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  };
  return { db, file, version: () => SCHEMA_VERSION, transaction, getAggregateVersion, snapshot: destination => backup(db, destination), close: () => db.close() };
}
function cryptoRandomId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
