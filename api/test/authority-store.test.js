import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';

function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'authority-store-')); }

test('migrates the complete authority schema with FK/check enforcement and zero versions', () => {
  const dir = fixture();
  const store = createAuthorityStore({ dataDir: dir });
  assert.equal(store.version(), 1);
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
  assert.equal(meta.schema_version, 1); assert.equal(meta.authority_version, 0); assert.match(meta.updated_at_utc, /Z$/);
  store.transaction({}, tx => tx.bumpAggregate('ROLES', ['u']));
  assert.equal(store.db.prepare('SELECT authority_version FROM authority_meta').get().authority_version, 1);
  assert.throws(() => store.transaction({}, tx => { tx.bumpAggregate('ROLES', ['u']); throw new Error('no'); }));
  assert.equal(store.db.prepare('SELECT authority_version FROM authority_meta').get().authority_version, 1);
  store.db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','t','n','h','PENDING','2027-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1)").run();
  store.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('e','i','u','challenge','CHALLENGE_ISSUED','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',1)").run();
  assert.throws(() => store.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('e2','i','u','other','CHALLENGE_ISSUED','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',1)").run());
  assert.throws(() => store.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES ('e3','i','u2','challenge','CHALLENGE_ISSUED','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z',1)").run());
  store.close();
  const future = createAuthorityStore({ dataDir: dir }); future.db.prepare('UPDATE authority_meta SET schema_version=2').run(); future.close();
  assert.throws(() => createAuthorityStore({ dataDir: dir }), /newer/i);
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
