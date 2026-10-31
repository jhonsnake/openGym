import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import { createAuthorityStore } from '../authority-store.js';
import { createAuthorityService } from '../authority-service.js';
import { createTrainingAuthority } from '../authority-training.js';
import { createAuthorityExport } from '../authority-export.js';

const stamp = '2027-01-15T12:00:00.000Z';
const op = n => `123e4567-e89b-42d3-a456-426614178${String(n).padStart(3, '0')}`;

function serviceFixture() {
  const users = new Map(['admin', 'trainer', 'client'].map(uid => [uid, { active: true }]));
  const store = createAuthorityStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'authority-openapi-runtime-')) });
  const service = createAuthorityService({
    store,
    clock: () => stamp,
    identity: { get: uid => ({ uid, active: users.get(uid)?.active === true, activity: users.get(uid)?.active ? 'ACTIVE' : 'UNKNOWN' }) },
    isAdmin: uid => uid === 'admin'
  });
  service.setRoles({ actorId: 'admin', body: { operationId: op(1), expectedVersion: 0, payload: { accountId: 'trainer', roles: ['TRAINER'], reason: 'fixture' } } });
  service.setRoles({ actorId: 'admin', body: { operationId: op(2), expectedVersion: 0, payload: { accountId: 'client', roles: ['CLIENT'], reason: 'fixture' } } });
  return { store, service };
}

function schema(name) {
  const document = YAML.parse(fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
  document.$id = 'https://opengym.test/openapi.yaml';
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(document);
  return ajv.getSchema(`${document.$id}#/components/schemas/${name}`);
}

test('parsed OpenAPI validates fresh/replay receipts and rejects unknown or missing fields', () => {
  const { store, service } = serviceFixture();
  const invitation = service.createInvitation({ actorId: 'trainer', requestId: 'fresh', body: { operationId: op(3), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  const replay = service.createInvitation({ actorId: 'trainer', requestId: 'replay', body: { operationId: op(3), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  const validateInvitation = schema('InvitationReceipt');
  assert.equal(validateInvitation(invitation), true, JSON.stringify(validateInvitation.errors));
  assert.equal(validateInvitation(replay), true, JSON.stringify(validateInvitation.errors));
  assert.equal(validateInvitation({ ...invitation, unknown: true }), false);
  assert.equal(validateInvitation({ ...invitation, result: { token: invitation.result.token } }), false);
  store.close();
});

test('parsed OpenAPI validates actual preview and technical-page shapes', () => {
  const { store, service } = serviceFixture();
  const invitation = service.createInvitation({ actorId: 'trainer', body: { operationId: op(4), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }] } } });
  const preview = service.previewInvitation({ token: invitation.result.token });
  assert.equal(schema('InvitationPreview')(preview), true);
  const invitationPage = service.trainerInvitations('trainer', { limit: 25, offset: 0 });
  const page = { invitations: invitationPage.invitations, nextCursor: null, versionTokens: invitationPage.versionTokens, requestId: 'fixture' };
  assert.equal(schema('TrainerInvitationsReadback')(page), true);
  assert.equal(schema('TrainerInvitationsReadback')({ ...page, pagination: {} }), false);
  store.close();
});

test('T6 OpenAPI closes current-session recovery and access version tokens', () => {
  const snapshot = { planVersionId: op(40), planVersionNumber: 1, goalVersionId: null, relationId: op(41), accessWindowId: op(42), exercises: [] };
  const tokens = [{ kind: 'SESSION', key: `[${JSON.stringify(op(43))}]`, version: 1 }, { kind: 'SESSION_SET', key: '["client"]', version: 1 }];
  const body = { session: { sessionId: op(43), planVersionId: snapshot.planVersionId, goalVersionId: null, serverStartedAtUtc: stamp, state: 'OPEN', snapshot }, closeOnlySession: null, versionTokens: tokens };
  const validate = schema('TrainingCurrentSessionReadback');
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  assert.equal(validate({ session: null, closeOnlySession: { sessionId: op(43), state: 'OPEN' }, versionTokens: tokens }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ session: null, closeOnlySession: null, versionTokens: [tokens[1]] }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...body, session: { ...body.session, state: 'CLOSED' } }), false);
  assert.equal(validate({ ...body, session: { ...body.session, unknown: true } }), false);
  assert.equal(validate({ session: null, closeOnlySession: { sessionId: op(43), state: 'OPEN', snapshot }, versionTokens: tokens }), false, 'close-only variants never carry a snapshot');
  assert.equal(validate({ session: body.session, versionTokens: tokens }), false, 'the discriminant is required');
  assert.equal(validate({ ...body, versionTokens: [tokens[1], tokens[0]] }), false, 'wrong token kinds/order are rejected');
  assert.equal(validate({ ...body, versionTokens: [{ ...tokens[0], key: '["not-a-session-id"]' }, tokens[1]] }), false, 'malformed SESSION aggregate keys are rejected');
  const { store, service } = serviceFixture();
  const access = service.accessSnapshot('client');
  assert.deepEqual(access.versionTokens.map(token => token.kind), ['ROLES', 'SUBSCRIPTION', 'EXPORT_SET', 'DELETION_REQUEST_SET']);
  assert.equal(schema('AccessSnapshot')(access), true, JSON.stringify(schema('AccessSnapshot').errors));
  store.close();
});

test('T7/T8 producer readbacks are closed: invitation proposal, trainer plan/goals, and own bodyweight token', () => {
  const { store, service } = serviceFixture();
  const invitation = service.createInvitation({ actorId: 'trainer', body: { operationId: op(50), expectedVersion: 0, payload: { knownClientId: 'client', commercialName: 'Alias', grants: [{ kind: 'PLAN' }, { kind: 'HISTORY', startUtc: '2027-01-01T00:00:00.000Z', endExclusiveUtc: '2027-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }] } } });
  const preview = service.previewInvitation({ token: invitation.result.token });
  assert.equal(preview.invitationVersion, 1);
  assert.deepEqual(preview.proposedGrants, [{ kind: 'HISTORY', startUtc: '2027-01-01T00:00:00.000Z', endExclusiveUtc: '2027-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'PLAN' }, { kind: 'WEIGHT' }]);
  assert.equal(schema('InvitationPreview')(preview), true, JSON.stringify(schema('InvitationPreview').errors));
  assert.equal(schema('InvitationPreview')({ ...preview, knownClientId: 'client' }), false);
  assert.equal(schema('InvitationPreview')({ ...preview, proposedGrants: [{ kind: 'GOALS' }] }), false);

  store.db.prepare("INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES ('sub-client','client','2027-01-01T00:00:00.000Z','2027-02-01T00:00:00.000Z',1,'MONTHLY','fixture','fixture','admin',?,1)").run(stamp);
  const training = createTrainingAuthority({ store, service, identity: { get: () => ({ active: true }) }, readStateStrict: () => null, clock: () => stamp });
  assert.equal(typeof training.trainerCurrentPlan, 'function');
  assert.equal(typeof training.trainerCurrentGoals, 'function');
  const nullTrainerPlan = { plan: null, versionTokens: [{ kind: 'PLAN_SET', key: `[${JSON.stringify(op(51))}]`, version: 0 }] };
  const nullTrainerGoals = { goals: null, versionTokens: [{ kind: 'GOAL_SET', key: `[${JSON.stringify(op(51))}]`, version: 0 }] };
  assert.equal(schema('TrainerCurrentPlanReadback')(nullTrainerPlan), true);
  assert.equal(schema('TrainerCurrentGoalsReadback')(nullTrainerGoals), true);
  assert.equal(schema('TrainerCurrentPlanReadback')({ ...nullTrainerPlan, health: {} }), false);
  const trainerRelations = { relations: [{ relationId: op(52), clientAlias: 'Alias', state: 'ACTIVE', version: 1, grants: [{ grantId: op(53), kind: 'HISTORY', state: 'ACTIVE', startUtc: '2027-01-01T00:00:00.000Z', endExclusiveUtc: '2027-02-01T00:00:00.000Z', includeWeight: true, eligibleFromUtc: stamp }] }], nextCursor: null, versionTokens: [{ kind: 'RELATION', key: `[${JSON.stringify(op(52))}]`, version: 1 }], requestId: 'fixture' };
  assert.equal(schema('TrainerRelationsReadback')(trainerRelations), true, JSON.stringify(schema('TrainerRelationsReadback').errors));
  assert.equal(schema('TrainerRelationsReadback')({ ...trainerRelations, relations: [{ ...trainerRelations.relations[0], grants: [{ ...trainerRelations.relations[0].grants[0], projectionJson: '{}' }] }] }), false, 'relation metadata never projects clinical snapshots');
  const clientRelations = { relations: [{ relationId: op(54), trainer: { id: 'trainer' }, state: 'PENDING_CONFIRMATION', acceptedAt: stamp, confirmedAt: null, endedAt: null, grants: [], pendingProposals: [{ kind: 'HISTORY', startUtc: '2027-01-01T00:00:00.000Z', endExclusiveUtc: '2027-02-01T00:00:00.000Z', includeWeight: true }, { kind: 'WEIGHT' }], version: 1 }], nextCursor: null, versionTokens: [{ kind: 'RELATION', key: `[${JSON.stringify(op(54))}]`, version: 1 }], requestId: 'fixture' };
  assert.equal(schema('ClientRelationsReadback')(clientRelations), true, JSON.stringify(schema('ClientRelationsReadback').errors));
  assert.equal(schema('ClientRelationsReadback')({ ...clientRelations, relations: [{ ...clientRelations.relations[0], trainer: { id: 'trainer', privateIdentityLookup: true } }] }), false, 'client relation trainer identity is a literal closed DTO');
  const ownWeight = training.ownBodyweight('client');
  assert.deepEqual(ownWeight.versionTokens, [{ kind: 'BODYWEIGHT_SET', key: '["client"]', version: 0 }]);
  store.close();
});

test('T7 OpenAPI accepts the allowlisted owned export and rejects private nested canaries', async () => {
  const { store, service } = serviceFixture();
  const identity = { get: uid => ({ uid, active: uid === 'client', activity: uid === 'client' ? 'ACTIVE' : 'UNKNOWN' }) };
  const exporter = createAuthorityExport({ store, authority: service, identity, readLegacyData: async () => ({ unit: 'kg', routines: [{ id: 'mine', target: { reps: 8 } }] }), clock: () => stamp });
  const receipt = exporter.requestExport({ actorId: 'client', requestId: 'export-fixture', body: { operationId: op(80), expectedVersion: 0, payload: {} } });
  const document = await exporter.downloadExport({ actorId: 'client', jobId: receipt.result.jobId });
  const validate = schema('OwnedExportDocument');
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...document, sqlite: { ...document.sqlite, audit: [] } }), false);
  assert.equal(validate({ ...document, legacyState: { ...document.legacyState, routines: [{ passwordHash: 'canary' }] } }), false);
  store.close();
});
