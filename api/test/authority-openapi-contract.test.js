/*
 * The API package intentionally has no JavaScript YAML dependency.  This test is a
 * small indentation-aware OpenAPI reader for the parts it owns (paths, operations,
 * component names and their immediate fields), rather than a pathname-only regex.
 * PyYAML is used by the independent validation command in the handoff report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = fs.readFileSync(process.env.OPENAPI_SPEC_PATH || path.join(API, 'openapi.yaml'), 'utf8');
const lines = spec.split('\n');

function blockAt(header, indent) {
  const start = lines.findIndex(line => line.startsWith(`${' '.repeat(indent)}${header}:`));
  assert.notEqual(start, -1, `missing ${header}`);
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i !== start && lines[i].trim() && lines[i].search(/\S/) <= indent) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function pathBlock(route) {
  const start = lines.findIndex(line => line === `  ${route}:`);
  assert.notEqual(start, -1, `missing ${route}`);
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i !== start && lines[i].startsWith('  /')) break;
    if (i !== start && lines[i] === 'components:') break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function operationBlock(route, method) {
  const block = pathBlock(route);
  const marker = `    ${method}:`;
  const start = block.indexOf(marker);
  assert.notEqual(start, -1, `missing ${method.toUpperCase()} ${route}`);
  return block.slice(start);
}

const mutations = {
  'POST /api/admin/operations/roles': 'RolesMutation',
  'POST /api/admin/operations/scopes': 'ScopeMutation',
  'POST /api/trainer/invitations': 'InvitationCreateMutation',
  'POST /api/trainer/invitations/replace': 'InvitationReplaceMutation',
  'POST /api/invitations/accept': 'InvitationAcceptMutation',
  'POST /api/invitations/reject': 'InvitationRejectMutation',
  'POST /api/trainer/invitations/revoke': 'InvitationRevokeMutation',
  'POST /api/trainer/relations/confirm': 'RelationConfirmMutation',
  'POST /api/client/relations/revoke': 'RelationChangeMutation',
  'POST /api/trainer/relations/suspend': 'RelationChangeMutation',
  'POST /api/trainer/relations/end': 'RelationChangeMutation',
  'POST /api/trainer/relations/reactivate-request': 'RelationChangeMutation',
  'POST /api/client/relations/reactivate-accept': 'RelationChangeMutation',
  'POST /api/admin/relations/suspend': 'RelationChangeMutation',
  'POST /api/admin/relations/end': 'RelationChangeMutation',
  'POST /api/admin/relations/reactivate-request': 'RelationChangeMutation',
  'POST /api/client/relations/grants/replace': 'GrantReplaceMutation',
  'POST /api/client/relations/grants/revoke': 'GrantRevokeMutation',
  'POST /api/admin/commercial/operations/confirm': 'CommercialConfirmMutation'
};

test('authority mutations use required closed envelopes and typed committed readbacks', () => {
  const envelope = blockAt('MutationEnvelope', 4);
  assert.match(envelope, /additionalProperties: false/);
  assert.match(envelope, /required: \[operationId, expectedVersion, payload\]/);
  for (const [key, schema] of Object.entries(mutations)) {
    const [method, route] = key.split(' ');
    const op = operationBlock(route, method.toLowerCase());
    assert.match(op, /requestBody:[\s\S]{0,220}required: true/);
    assert.match(op, new RegExp(`components/schemas/${schema}`));
    assert.match(op, /'200':[\s\S]*components\/schemas\/(?:MutationReceipt|InvitationReceipt)/);
    for (const status of ['401', '403']) assert.match(op, new RegExp(`'${status}':`), `${key} lacks typed ${status}`);
    assert.match(op, /'(?:404|409|410|422)':/, `${key} lacks its applicable domain error family`);
  }
});

test('domain primitives and business payloads are closed and use the approved identifier rules', () => {
  const existing = blockAt('ExistingAccountId', 4);
  assert.match(existing, /minLength: 1/);
  assert.match(existing, /maxLength: 128/);
  assert.doesNotMatch(existing, /format: uuid/);
  assert.match(blockAt('UUIDv4', 4), /pattern:.*-4/);
  assert.match(blockAt('SafeVersion', 4), /minimum: 0/);
  assert.match(blockAt('Reason', 4), /maxLength: 280/);
  assert.match(blockAt('GrantInput', 4), /discriminator: \{ propertyName: kind \}/);
  for (const schema of ['RolesPayload', 'ScopePayload', 'InvitationCreatePayload', 'InvitationAcceptPayload', 'RelationChangePayload', 'GrantReplacePayload', 'GrantRevokePayload', 'CommercialPayload']) {
    assert.match(blockAt(schema, 4), /additionalProperties: false/, `${schema} must be closed`);
  }
});

test('public preview is explicitly public, has token body only, and never places tokens in a URL', () => {
  const preview = operationBlock('/api/invitations/preview', 'post');
  assert.match(preview, /security: \[\]/);
  assert.match(preview, /requestBody:[\s\S]*required: true/);
  assert.match(preview, /components\/schemas\/InvitePreviewInput/);
  assert.doesNotMatch(preview, /in: query/);
  for (const route of Object.keys(mutations).map(key => key.split(' ')[1]).concat('/api/invitations/preview')) {
    assert.doesNotMatch(route, /[?&]token|\{token\}/);
  }
});

test('success DTOs carry request identity and version metadata, and scoped reads are paginated', () => {
  for (const schema of ['MutationReceipt', 'AccessSnapshot', 'InvitationReceipt', 'PortfolioReadback', 'TrainerRelationsReadback', 'CommercialClientsReadback']) {
    const body = blockAt(schema, 4);
    assert.match(body, /requestId|MutationReceipt/);
  }
  assert.match(blockAt('MutationReceipt', 4), /versionTokens/);
  for (const [route, method] of [['/api/trainer/portfolio', 'get'], ['/api/trainer/relations', 'get'], ['/api/admin/commercial/clients', 'get']]) {
    const op = operationBlock(route, method);
    assert.match(op, /components\/parameters\/PageLimit/);
    assert.match(op, /components\/parameters\/PageCursor/);
  }
  const limit = blockAt('PageLimit', 4);
  assert.match(limit, /minimum: 1/);
  assert.match(limit, /maximum: 100/);
  assert.match(limit, /default: 25/);
  assert.match(blockAt('PageCursor', 4), /in: query/);
});

test('authority error families are declared on the new contract surface', () => {
  for (const response of ['AuthorityUnauthenticated', 'AuthorityForbidden', 'AuthorityNotFound', 'AuthorityConflict', 'AuthorityUnprocessable', 'AuthorityUnsupportedClient', 'InvitationInvalid', 'InvitationExpired']) {
    const body = blockAt(response, 4);
    assert.match(body, /components\/schemas\/AuthorityError/);
  }
  assert.match(blockAt('AuthorityError', 4), /unauthenticated/);
  assert.match(blockAt('AuthorityError', 4), /invite-expired/);
  assert.match(blockAt('AuthorityError', 4), /unsupported-client/);
});

test('T6 session recovery is a closed GET producer', () => {
  const op = operationBlock('/api/client/sessions/current', 'get');
  assert.match(op, /components\/schemas\/TrainingCurrentSessionReadback/);
  const body = blockAt('TrainingCurrentSessionReadback', 4);
  assert.match(body, /additionalProperties: false/);
  assert.match(body, /TrainingOpenSession/);
  assert.match(body, /TrainingCloseOnlySession/);
  assert.match(body, /TrainingOpenSessionTokens/);
});
