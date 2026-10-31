import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';

const id = n => `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, '0')}`;
function setup() {
  const store = createAuthorityStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'authority-service-')) });
  const users = new Map([['admin', { active: true }], ['subject', { active: true }], ['coordinator', { active: true }], ['disabled', { active: false }]]);
  return { store, service: createAuthorityService({ store, identity: { get: uid => ({ uid, activity: users.get(uid)?.active ? 'ACTIVE' : users.has(uid) ? 'DISABLED' : 'UNKNOWN', active: !!users.get(uid)?.active }) }, isAdmin: uid => uid === 'admin' }) };
}
function seedRelation(store, { grantKinds = ['PLAN'], entitled = true } = {}) {
  const at = new Date().toISOString(); const far = '2099-01-01T00:00:00.000Z'; const relationId = id(10);
  store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('tr','admin','TRAINER','admin',?,1,'x')").run(at);
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('cl','subject','CLIENT','admin',?,1,'x')").run(at);
    tx.db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','admin','n','h','ACCEPTED',?, ?,1)").run(far, at);
    tx.db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,version) VALUES (?, 'admin','subject','i','ACTIVE',?,1)").run(relationId, at);
    tx.db.prepare("INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES ('w',?,?,?,'x',1)").run(relationId, at, at);
    for (const [index, kind] of grantKinds.entries()) tx.db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,granted_by,eligible_from_utc,version) VALUES (?,?,?,'ACTIVE',?,'subject',?,1)").run(`g${index}`, relationId, kind, at, at);
    if (entitled) tx.db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES ('s','subject',?, ?,1,'MONTHLY','r','x','admin',?,1)").run(at, far, at);
  });
  return relationId;
}
test('active existing admin assigns roles transactionally and replays only under current authority', () => {
  const { store, service } = setup();
  const args = { actorId: 'admin', operationId: id(1), expectedVersion: 0, payload: { accountId: 'subject', roles: ['CLIENT'], reason: 'necessary setup' }, requestId: 'r' };
  const first = service.setRoles(args);
  assert.equal(first.versionTokens[0].version, 1);
  assert.equal(service.setRoles(args).replayed, true);
  assert.throws(() => service.setRoles({ ...args, actorId: 'disabled' }), /forbidden/);
  assert.equal(store.db.prepare('SELECT count(*) n FROM mutation_results').get().n, 1);
});
test('roles and scopes forbid self assignment and scope has a real coordinator policy', () => {
  const { service } = setup();
  assert.throws(() => service.setRoles({ actorId: 'admin', operationId: id(2), expectedVersion: 0, payload: { accountId: 'admin', roles: ['CLIENT'], reason: 'self' } }), /self/);
  assert.throws(() => service.setScope({ actorId: 'admin', operationId: id(3), expectedVersion: 0, payload: { coordinatorId: 'coordinator', clientId: 'subject', assigned: true, reason: 'assign' } }), /coordinator/);
  service.setRoles({ actorId: 'admin', operationId: id(4), expectedVersion: 0, payload: { accountId: 'coordinator', roles: ['COORDINATOR'], reason: 'make operational' } });
  assert.equal(service.setScope({ actorId: 'admin', operationId: id(5), expectedVersion: 0, payload: { coordinatorId: 'coordinator', clientId: 'subject', assigned: true, reason: 'portfolio' } }).result.assigned, true);
});

test('relational capabilities bind trainer, client, window and explicit current grant', () => {
  const { store, service } = setup(); const at = new Date().toISOString(); const far = '2099-01-01T00:00:00.000Z';
  store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('tr','admin','TRAINER','admin',?,1,'x')").run(at);
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('cl','subject','CLIENT','admin',?,1,'x')").run(at);
    tx.db.prepare("INSERT INTO invitations(id,trainer_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES ('i','admin','n','h','ACCEPTED',?, ?,1)").run(far, at);
    tx.db.prepare("INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,version) VALUES (?, 'admin','subject','i','ACTIVE',?,1)").run(id(10), at);
    tx.db.prepare("INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES ('w',?,?,?,'x',1)").run(id(10), at, at);
    tx.db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,granted_by,eligible_from_utc,version) VALUES ('g',?,'PLAN','ACTIVE',?,'subject',?,1)").run(id(10), at, at);
    tx.db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES ('s','subject',?, ?,1,'MONTHLY','r','x','admin',?,1)").run(at, far, at);
  });
  assert.doesNotThrow(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId: id(10), grantKind: 'PLAN' })));
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'other', capability: 'PUBLISH_PLAN', relationId: id(10), grantKind: 'PLAN' })), /forbidden/);
  assert.doesNotThrow(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId: id(10) })));
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'admin', capability: 'READ_OWN_EXECUTIONS' })), /forbidden/);
  assert.doesNotThrow(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'subject', subjectId: 'subject', capability: 'EXPORT_OWN_DATA' })));
});

test('replay binds aggregate tuple and audit records minimal before and after', () => {
  const { store, service } = setup(); const args = { actorId: 'admin', operationId: id(20), expectedVersion: 0, payload: { accountId: 'subject', roles: ['CLIENT'], reason: 'setup' } };
  service.setRoles(args);
  assert.throws(() => service.mutateAuthority({ actorId: 'admin', capability: 'MANAGE_OPERATIONAL_ROLES', subjectId: 'subject', aggregateKind: 'SCOPE', aggregateKey: ['x', 'y'], operationId: id(20), expectedVersion: 0, payload: args.payload }, () => ({})), /conflict/);
  const audit = store.db.prepare('SELECT before_json,after_json FROM authority_audit').get();
  assert.deepEqual(JSON.parse(audit.before_json), { roles: [] }); assert.deepEqual(JSON.parse(audit.after_json), { roles: ['CLIENT'] });
});

test('fixed grants reject contradictory kinds and closed publish payloads use PLAN', () => {
  const { store, service } = setup(); const relationId = seedRelation(store, { grantKinds: ['PLAN', 'WEIGHT'] });
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId, grantKind: 'WEIGHT' })), /forbidden/);
  assert.doesNotThrow(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId })));
  assert.throws(() => service.mutateAuthority({ actorId: 'admin', capability: 'PUBLISH_PLAN', subjectId: 'subject', aggregateKind: 'PLAN_SET', aggregateKey: [relationId], operationId: id(29), expectedVersion: 0, payload: { relationId, grantKind: 'WEIGHT', exercises: [] }, authorityContext: { relationId } }, () => ({ result: {} })), /forbidden/);
  assert.doesNotThrow(() => service.mutateAuthority({ actorId: 'admin', capability: 'PUBLISH_PLAN', subjectId: 'subject', aggregateKind: 'PLAN_SET', aggregateKey: [relationId], operationId: id(30), expectedVersion: 0, payload: { relationId, exercises: [] }, authorityContext: { relationId } }, () => ({ result: { published: true } })));
});

test('trainer functional capabilities require the subject CLIENT role while own export remains allowed', () => {
  const { store, service } = setup(); const relationId = seedRelation(store, { grantKinds: ['PLAN', 'EXECUTION'] });
  store.transaction({}, tx => tx.db.prepare("UPDATE operational_roles SET removed_at_utc=? WHERE account_id='subject' AND role='CLIENT'").run(new Date().toISOString()));
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId })), /forbidden/);
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'READ_TRAINER_EXECUTIONS', relationId })), /forbidden/);
  assert.doesNotThrow(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'subject', subjectId: 'subject', capability: 'EXPORT_OWN_DATA' })));
});

test('an explicit indefinite client grant is revocable and never becomes an administrator bypass', () => {
  const { store, service } = setup(); const relationId = seedRelation(store, { grantKinds: ['PLAN', 'EXECUTION'], entitled: false }); const at = new Date().toISOString();
  store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO indefinite_client_entitlements(id,client_id,granted_by,granted_at_utc,reason,version) VALUES ('indefinite','subject','admin',?,'owner grant',1)").run(at);
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('co','subject','COORDINATOR','admin',?,1,'x')").run(at);
    tx.db.prepare("INSERT INTO coordinator_scopes(id,coordinator_id,client_id,assigned_by,assigned_at_utc,version,reason) VALUES ('scope','subject','subject','admin',?,1,'x')").run(at);
  });
  const snapshot = service.accessSnapshot('subject', { managedSubscriptions: true, requestId: 'indefinite' });
  assert.deepEqual(snapshot.entitlement, { active: true, startUtc: null, endExclusiveUtc: null, version: 0 });
  assert.ok(snapshot.capabilities.includes('ACCESS_PERSONAL_TRAINING'));
  assert.doesNotThrow(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId })));
  assert.equal(service.trainerPortfolio('admin').length, 1);
  assert.deepEqual(service.commercialClients('subject').map(client => client.entitlement), [{ active: true, startUtc: null, endExclusiveUtc: null, version: 0 }]);
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'admin', capability: 'ACCESS_PERSONAL_TRAINING' })), /forbidden/);
  store.transaction({}, tx => tx.db.prepare("UPDATE indefinite_client_entitlements SET revoked_at_utc=?,revoked_by='admin' WHERE id='indefinite'").run(at));
  assert.equal(service.accessSnapshot('subject', { managedSubscriptions: true, requestId: 'revoked' }).entitlement.active, false);
  assert.throws(() => store.transaction({}, tx => service.requireCapabilityTx(tx, { actorId: 'admin', subjectId: 'subject', capability: 'PUBLISH_PLAN', relationId })), /forbidden/);
});

test('indefinite entitlement still requires an active identity and CLIENT role, while finite intervals stay finite', () => {
  const { store, service } = setup(); const at = new Date().toISOString();
  store.transaction({}, tx => {
    tx.db.prepare("INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES ('cl','subject','CLIENT','admin',?,1,'x')").run(at);
    tx.db.prepare("INSERT INTO indefinite_client_entitlements(id,client_id,granted_by,granted_at_utc,reason,version) VALUES ('indefinite','subject','admin',?,'owner grant',1)").run(at);
    tx.db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES ('finite','admin','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',1,'MONTHLY','r','x','admin',?,1)").run(at);
  });
  assert.equal(service.accessSnapshot('admin', { managedSubscriptions: true, requestId: 'finite' }).entitlement.endExclusiveUtc, '2099-01-01T00:00:00.000Z');
  store.transaction({}, tx => tx.db.prepare("UPDATE operational_roles SET removed_at_utc=? WHERE account_id='subject' AND role='CLIENT'").run(at));
  assert.equal(service.accessSnapshot('subject', { managedSubscriptions: true, requestId: 'role-removed' }).capabilities.includes('ACCESS_PERSONAL_TRAINING'), false);
});

test('mutateAuthority accepts only server authority context for expired consent withdrawal', () => {
  const { store, service } = setup(); const relationId = seedRelation(store, { grantKinds: [], entitled: false });
  const base = { actorId: 'subject', capability: 'CHANGE_GRANT', subjectId: 'subject', aggregateKind: 'RELATION', aggregateKey: [relationId], operationId: id(31), expectedVersion: 0, payload: { relationId, withdrawalOnly: true } };
  assert.throws(() => service.mutateAuthority({ ...base, operationId: id(32) }, () => ({ result: {} })), /forbidden/);
  assert.doesNotThrow(() => service.mutateAuthority({ ...base, operationId: id(33), authorityContext: { relationId, withdrawalOnly: true } }, () => ({ result: {} })));
  assert.throws(() => service.mutateAuthority({ ...base, operationId: id(34), authorityContext: { relationId, withdrawalOnly: false, unexpected: true } }, () => ({ result: {} })), /unknown/);
});
