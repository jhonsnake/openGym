import crypto from 'node:crypto';
import { CAPABILITIES, canonicalAggregateKey, hashPayload, parseAuthorityPayload, validateMutationEnvelope, uuid } from './authority-contract.js';
import { panamaDateAtServerClock, panamaDayStartUtc, periodEndExclusiveUtc } from './subscription-calendar.js';

const now = () => new Date().toISOString();
const fail = message => { const error = new Error(message); error.code = message; throw error; };
const id = () => crypto.randomUUID();
const activeRole = (db, uid, role) => !!db.prepare('SELECT 1 FROM operational_roles WHERE account_id=? AND role=? AND removed_at_utc IS NULL').get(uid, role);
const entitled = (db, uid, at) => !!db.prepare('SELECT 1 FROM subscription_intervals WHERE client_id=? AND start_utc<=? AND end_exclusive_utc>?').get(uid, at, at);
const currentWindow = (db, relationId, at) => !!db.prepare("SELECT 1 FROM relation_access_windows WHERE relation_id=? AND enabled_from_utc<=? AND (ended_at_utc IS NULL OR ended_at_utc>?)").get(relationId, at, at);
// A grant's range filters the data a later projector may expose. It is not an
// expiry for present consent: a client may consent today to history from last year.
const currentGrant = (db, relationId, kind, at) => !!db.prepare("SELECT 1 FROM relation_grants WHERE relation_id=? AND kind=? AND state='ACTIVE' AND eligible_from_utc IS NOT NULL AND eligible_from_utc<=?").get(relationId, kind, at);
const fixedGrantByCapability = Object.freeze({ PUBLISH_PLAN: 'PLAN', READ_TRAINER_EXECUTIONS: 'EXECUTION', READ_TRAINER_HISTORY: 'HISTORY', READ_TRAINER_BODYWEIGHT: 'WEIGHT' });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const invitationToken = () => crypto.randomBytes(32).toString('base64url');
const grantMatches = (proposal, selected) => proposal.kind === selected.kind
  && (proposal.start_utc ?? null) === (selected.startUtc ?? null)
  && (proposal.end_exclusive_utc ?? null) === (selected.endExclusiveUtc ?? null)
  && (proposal.include_weight ? true : false) === (selected.includeWeight ? true : false);
const consentShape = grants => grants.map(grant => ({
  kind: grant.kind,
  ...(grant.startUtc ?? grant.window_start_utc ?? grant.start_utc ? { startUtc: grant.startUtc ?? grant.window_start_utc ?? grant.start_utc } : {}),
  ...(grant.endExclusiveUtc ?? grant.window_end_exclusive_utc ?? grant.end_exclusive_utc ? { endExclusiveUtc: grant.endExclusiveUtc ?? grant.window_end_exclusive_utc ?? grant.end_exclusive_utc } : {}),
  ...(grant.includeWeight ?? grant.include_weight ? { includeWeight: true } : {})
}));
function freezeAuthorityContext(value) {
  if (value === undefined) return Object.freeze({});
  if (!plain(value)) throw new TypeError('authorityContext must be a plain object');
  const allowed = new Set(['relationId', 'withdrawalOnly', 'grantKind', 'requiredGrantKind']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`unknown authority context field: ${key}`);
  if (value.relationId !== undefined) uuid(value.relationId, 'authorityContext.relationId');
  if (value.withdrawalOnly !== undefined && typeof value.withdrawalOnly !== 'boolean') throw new TypeError('authorityContext.withdrawalOnly must be boolean');
  if (value.grantKind !== undefined && value.requiredGrantKind !== undefined && value.grantKind !== value.requiredGrantKind) fail('conflict');
  const grantKind = value.grantKind ?? value.requiredGrantKind;
  if (grantKind !== undefined && !['PLAN', 'EXECUTION', 'HISTORY', 'WEIGHT'].includes(grantKind)) throw new TypeError('invalid authority context grant kind');
  return Object.freeze({
    ...(value.relationId === undefined ? {} : { relationId: value.relationId }),
    ...(value.withdrawalOnly === undefined ? {} : { withdrawalOnly: value.withdrawalOnly }),
    ...(grantKind === undefined ? {} : { grantKind })
  });
}
function replaceRoles(tx, { accountId, roles, reason, actorId, stamp }) {
  const existing = tx.db.prepare('SELECT role FROM operational_roles WHERE account_id=? AND removed_at_utc IS NULL').all(accountId);
  const removingTrainer = existing.some(row => row.role === 'TRAINER') && !roles.includes('TRAINER');
  if (removingTrainer && tx.db.prepare("SELECT 1 FROM relations WHERE trainer_id=? AND state IN ('ACTIVE','SUSPENDED','PENDING_CONFIRMATION','REACTIVATION_PENDING')").get(accountId)) fail('unsafe-active-relationships');
  tx.db.prepare('UPDATE operational_roles SET removed_at_utc=?, removed_by=? WHERE account_id=? AND removed_at_utc IS NULL').run(stamp, actorId, accountId);
  const insert = tx.db.prepare('INSERT INTO operational_roles(id,account_id,role,assigned_by,assigned_at_utc,version,reason) VALUES (?,?,?,?,?,?,?)');
  for (const role of roles) insert.run(id(), accountId, role, actorId, stamp, 1, reason);
}

export function createAuthorityService({ store, identity, historyPublisher, isAdmin = () => false, isOwner = () => false, clock = now } = {}) {
  if (!store || !identity) throw new TypeError('store and identity are required');
  function requireActive(actorId) { if (!identity.get(actorId)?.active) fail('forbidden'); }
  function requireCapabilityTx(tx, { actorId, subjectId = actorId, capability, relationId, grantKind, withdrawalOnly = false } = {}) {
    requireActive(actorId);
    const db = tx.db; const at = clock();
    const own = actorId === subjectId;
    const admin = isAdmin(actorId);
    const relation = relationId ? db.prepare('SELECT * FROM relations WHERE id=?').get(relationId) : null;
    const activeRelation = relation?.state === 'ACTIVE';
    const relationMatchesSubject = !relationId || (relation && relation.client_id === subjectId);
    const activeWindow = relationId ? currentWindow(db, relationId, at) : false;
    const fixedGrantKind = fixedGrantByCapability[capability];
    if (fixedGrantKind && grantKind !== undefined && grantKind !== fixedGrantKind) fail('forbidden');
    const effectiveGrantKind = fixedGrantKind || grantKind;
    const hasGrant = relationId && effectiveGrantKind ? currentGrant(db, relationId, effectiveGrantKind, at) : false;
    const clientEntitled = subjectId && entitled(db, subjectId, at);
    const sensitiveCrossRead = new Set(['PUBLISH_PLAN', 'READ_TRAINER_EXECUTIONS', 'READ_TRAINER_HISTORY', 'READ_TRAINER_BODYWEIGHT', 'READ_CLIENT_PLAN']);
    if (sensitiveCrossRead.has(capability) && actorId !== subjectId && !identity.get(subjectId)?.active) fail('forbidden');
    const policies = {
      ACCESS_PERSONAL_TRAINING: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      MANAGE_OPERATIONAL_ROLES: admin,
      MANAGE_COORDINATOR_SCOPE: admin,
      CREATE_INVITATION: activeRole(db, actorId, 'TRAINER'),
      PREVIEW_INVITATION: true,
      ACCEPT_INVITATION: own,
      // Fresh transition checks remain in applyTx.  This deliberately only
      // establishes current ownership so a terminal receipt can be replayed.
      CONFIRM_RELATION: activeRole(db, actorId, 'TRAINER') && relation?.trainer_id === actorId,
      CHANGE_RELATION: own ? relation?.client_id === actorId : admin || (activeRole(db, actorId, 'TRAINER') && relation?.trainer_id === actorId),
      // A client may retry its own completed withdrawal after it ended the relation.
      // Fresh grant changes still require an active relation in their apply function.
      CHANGE_GRANT: own && relation?.client_id === actorId && (withdrawalOnly || (activeRelation && entitled(db, actorId, at))),
      PUBLISH_PLAN: activeRole(db, actorId, 'TRAINER') && activeRole(db, subjectId, 'CLIENT') && relationMatchesSubject && relation?.trainer_id === actorId && activeRelation && activeWindow && clientEntitled && hasGrant,
      READ_CLIENT_PLAN: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      READ_OWN_EXECUTIONS: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      START_SESSION: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      FINISH_SESSION: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      READ_TRAINER_EXECUTIONS: activeRole(db, actorId, 'TRAINER') && activeRole(db, subjectId, 'CLIENT') && relationMatchesSubject && relation?.trainer_id === actorId && activeRelation && activeWindow && clientEntitled && hasGrant,
      READ_TRAINER_HISTORY: activeRole(db, actorId, 'TRAINER') && activeRole(db, subjectId, 'CLIENT') && relationMatchesSubject && relation?.trainer_id === actorId && activeRelation && activeWindow && clientEntitled && hasGrant,
      READ_TRAINER_BODYWEIGHT: activeRole(db, actorId, 'TRAINER') && activeRole(db, subjectId, 'CLIENT') && relationMatchesSubject && relation?.trainer_id === actorId && activeRelation && activeWindow && clientEntitled && hasGrant,
      CONFIRM_SUBSCRIPTION: activeRole(db, actorId, 'COORDINATOR') && actorId !== subjectId && identity.get(subjectId)?.active && activeRole(db, subjectId, 'CLIENT') && !!db.prepare('SELECT 1 FROM coordinator_scopes WHERE coordinator_id=? AND client_id=? AND removed_at_utc IS NULL').get(actorId, subjectId),
      READ_COMMERCIAL_CLIENTS: activeRole(db, actorId, 'COORDINATOR') && actorId !== subjectId && identity.get(subjectId)?.active && activeRole(db, subjectId, 'CLIENT') && !!db.prepare('SELECT 1 FROM coordinator_scopes WHERE coordinator_id=? AND client_id=? AND removed_at_utc IS NULL').get(actorId, subjectId),
      EXPORT_OWN_DATA: own,
      REQUEST_OWN_DELETION: own
    };
    if (!CAPABILITIES.includes(capability) || !policies[capability]) fail('forbidden');
    return { relation, clientEntitled, activeWindow };
  }
  function mutateAuthority({ actorId, capability, subjectId, aggregateKind, aggregateKey, operationId, expectedVersion, payload, requestId, authorityContext }, applyTx) {
    const context = freezeAuthorityContext(authorityContext);
    const payloadRelationId = payload && typeof payload === 'object' ? payload.relationId : undefined;
    if (payloadRelationId !== undefined && context.relationId !== payloadRelationId) fail('forbidden');
    const fixedGrantKind = fixedGrantByCapability[capability];
    if (fixedGrantKind && payload && typeof payload === 'object' && payload.grantKind !== undefined && payload.grantKind !== fixedGrantKind) fail('forbidden');
    return store.transaction({ actorId, requestId }, tx => {
      requireCapabilityTx(tx, { actorId, subjectId, capability, relationId: context.relationId, grantKind: context.grantKind, withdrawalOnly: context.withdrawalOnly === true });
      const payloadSha256 = hashPayload(payload); const key = Array.isArray(aggregateKey) ? canonicalAggregateKey(aggregateKey) : aggregateKey;
      const replay = tx.mutation(operationId);
      if (replay) {
        if (replay.actor_id !== actorId || replay.subject_id !== (subjectId ?? null) || replay.capability !== capability || replay.aggregate_kind !== aggregateKind || replay.aggregate_key !== key || replay.payload_sha256 !== payloadSha256) fail('conflict');
        const stored = JSON.parse(replay.result_metadata_json);
        const references = stored.references ?? [{ kind: replay.aggregate_kind, key: replay.aggregate_key }];
        const versionTokens = references.map(reference => ({ ...reference, version: tx.getAggregateVersion(reference.kind, reference.key) }));
        return { operationId, replayed: true, entity: replayEntity(tx, replay, versionTokens), versionTokens, result: stored.result ?? stored, requestId };
      }
      if (tx.getAggregateVersion(aggregateKind, key) !== expectedVersion) fail('conflict');
      const applied = applyTx(tx);
      const token = tx.bumpAggregate(aggregateKind, key);
      const entity = applied.entity || { type: aggregateKind.toLowerCase(), id: subjectId, version: token.version };
      const versionTokens = [token, ...(applied.versionTokens ?? [])];
      const references = versionTokens.map(({ kind, key: referenceKey }) => ({ kind, key: referenceKey }));
      tx.recordMutation({ operationId, actorId, capability, subjectId, aggregateKind, aggregateKey: key, payloadSha256, resultEntityType: entity.type, resultEntityId: entity.id, resultVersion: entity.version || token.version, resultMetadata: { result: applied.result, references } });
      tx.audit({ actorId, subjectId: applied.auditSubjectId ?? subjectId, entityType: entity.type, entityId: entity.id, before: applied.before ?? null, after: applied.after ?? applied.result, reason: applied.reason ?? payload.reason ?? null, reference: applied.reference ?? null, requestId });
      return { operationId, entity: { ...entity, version: entity.version || token.version }, versionTokens, result: applied.result, requestId };
    });
  }
  function preflightAuthority({ actorId, capability, subjectId, aggregateKind, aggregateKey, operationId, expectedVersion, payload, requestId, authorityContext }, inspectTx = () => undefined) {
    const context = freezeAuthorityContext(authorityContext);
    const payloadRelationId = payload && typeof payload === 'object' ? payload.relationId : undefined;
    if (payloadRelationId !== undefined && context.relationId !== payloadRelationId) fail('forbidden');
    const fixedGrantKind = fixedGrantByCapability[capability];
    if (fixedGrantKind && payload && typeof payload === 'object' && payload.grantKind !== undefined && payload.grantKind !== fixedGrantKind) fail('forbidden');
    return store.transaction({ actorId, requestId }, tx => {
      requireCapabilityTx(tx, { actorId, subjectId, capability, relationId: context.relationId, grantKind: context.grantKind, withdrawalOnly: context.withdrawalOnly === true });
      const payloadSha256 = hashPayload(payload); const key = Array.isArray(aggregateKey) ? canonicalAggregateKey(aggregateKey) : aggregateKey;
      const replay = tx.mutation(operationId);
      if (replay) {
        if (replay.actor_id !== actorId || replay.subject_id !== (subjectId ?? null) || replay.capability !== capability || replay.aggregate_kind !== aggregateKind || replay.aggregate_key !== key || replay.payload_sha256 !== payloadSha256) fail('conflict');
        return { replayed: true };
      }
      if (tx.getAggregateVersion(aggregateKind, key) !== expectedVersion) fail('conflict');
      return { replayed: false, value: inspectTx(tx) };
    });
  }
  // `entity.version` is the committed entity version. It is current only for
  // mutable invitation/relation entities; immutable commit references remain
  // historical. `versionTokens` are always current optimistic-lock tokens.
  function replayEntity(tx, replay, versionTokens) {
    const mutableKind = replay.result_entity_type === 'invitation' ? 'INVITATION'
      : replay.result_entity_type === 'relation' ? 'RELATION' : null;
    const token = mutableKind && versionTokens.find(candidate => candidate.kind === mutableKind && candidate.key === canonicalAggregateKey([replay.result_entity_id]));
    return { type: replay.result_entity_type, id: replay.result_entity_id, version: token ? token.version : replay.result_version };
  }
  function readPage(page) {
    if (!page) return null;
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100 || !Number.isInteger(page.offset) || page.offset < 0) fail('validation-error');
    return page;
  }
  function pagedRows(tx, sql, values, page) {
    const rows = tx.db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...values, page.limit + 1, page.offset);
    return { items: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
  }
  // Identity activity lives outside SQLite.  Read enough SQL-bounded batches to produce a
  // logical page; never fetch the full scoped collection and slice it after JS filtering.
  function pagedFilteredRows(tx, sql, values, page, include) {
    const items = []; let offset = page.offset; let hasMore = false;
    while (items.length <= page.limit) {
      const rows = tx.db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...values, page.limit + 1, offset);
      if (!rows.length) break;
      for (const row of rows) {
        offset += 1;
        if (!include(row)) continue;
        items.push(row);
        if (items.length > page.limit) { hasMore = true; break; }
      }
      if (hasMore || rows.length <= page.limit) break;
    }
    const emitted = items.slice(0, page.limit);
    // Leave the look-ahead row for the next cursor; it is part of the next SQL page.
    const nextOffset = hasMore ? offset - 1 : offset;
    return { items: emitted, hasMore, nextOffset };
  }
  function setRoles({ actorId, operationId, expectedVersion, payload, requestId, body }) {
    ({ operationId, expectedVersion, payload } = validateMutationEnvelope(body ?? { operationId, expectedVersion, payload }, 'roles')); if (actorId === payload.accountId) fail('self-assignment-forbidden'); requireActive(payload.accountId);
    return mutateAuthority({ actorId, capability: 'MANAGE_OPERATIONAL_ROLES', subjectId: payload.accountId, aggregateKind: 'ROLES', aggregateKey: [payload.accountId], operationId, expectedVersion, payload, requestId }, tx => {
      const before = { roles: tx.db.prepare('SELECT role FROM operational_roles WHERE account_id=? AND removed_at_utc IS NULL ORDER BY role').all(payload.accountId).map(row => row.role) };
      replaceRoles(tx, { accountId: payload.accountId, roles: payload.roles, reason: payload.reason, actorId, stamp: clock() });
      const after = { roles: payload.roles };
      return { entity: { type: 'roles', id: payload.accountId }, result: { accountId: payload.accountId, roles: payload.roles }, before, after };
    });
  }
  function setScope({ actorId, operationId, expectedVersion, payload, requestId, body }) {
    ({ operationId, expectedVersion, payload } = validateMutationEnvelope(body ?? { operationId, expectedVersion, payload }, 'scope')); if (actorId === payload.coordinatorId || actorId === payload.clientId || payload.coordinatorId === payload.clientId) fail('self-assignment-forbidden'); requireActive(payload.coordinatorId); requireActive(payload.clientId);
    return mutateAuthority({ actorId, capability: 'MANAGE_COORDINATOR_SCOPE', subjectId: payload.clientId, aggregateKind: 'SCOPE', aggregateKey: [payload.coordinatorId, payload.clientId], operationId, expectedVersion, payload, requestId }, tx => {
      if (payload.assigned && !activeRole(tx.db, payload.coordinatorId, 'COORDINATOR')) fail('coordinator-role-required');
      const before = { assigned: !!tx.db.prepare('SELECT 1 FROM coordinator_scopes WHERE coordinator_id=? AND client_id=? AND removed_at_utc IS NULL').get(payload.coordinatorId, payload.clientId) };
      const stamp = clock(); tx.db.prepare('UPDATE coordinator_scopes SET removed_at_utc=?,removed_by=? WHERE coordinator_id=? AND client_id=? AND removed_at_utc IS NULL').run(stamp, actorId, payload.coordinatorId, payload.clientId);
      if (payload.assigned) tx.db.prepare('INSERT INTO coordinator_scopes(id,coordinator_id,client_id,assigned_by,assigned_at_utc,version,reason) VALUES (?,?,?,?,?,?,?)').run(id(), payload.coordinatorId, payload.clientId, actorId, stamp, 1, payload.reason);
      const after = { assigned: payload.assigned };
      return { entity: { type: 'scope', id: `${payload.coordinatorId}:${payload.clientId}` }, result: { coordinatorId: payload.coordinatorId, clientId: payload.clientId, assigned: payload.assigned }, before, after };
    });
  }
  function createInvitation({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'invitation');
    const token = invitationToken();
    const receipt = mutateAuthority({ actorId, capability: 'CREATE_INVITATION', subjectId: actorId, aggregateKind: 'INVITE_SET', aggregateKey: [actorId], operationId, expectedVersion, payload, requestId }, tx => {
      const stamp = clock(); const inviteId = id(); const expiresAt = new Date(Date.parse(stamp) + 7 * 24 * 60 * 60 * 1000).toISOString();
      tx.db.prepare('INSERT INTO invitations(id,trainer_id,known_client_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES (?,?,?,?,?,\'PENDING\',?,?,1)').run(inviteId, actorId, payload.knownClientId ?? null, payload.commercialName, tokenHash(token), expiresAt, stamp);
      const insert = tx.db.prepare('INSERT INTO invitation_grants(id,invitation_id,kind,start_utc,end_exclusive_utc,include_weight) VALUES (?,?,?,?,?,?)');
      for (const grant of payload.grants) insert.run(id(), inviteId, grant.kind, grant.startUtc ?? null, grant.endExclusiveUtc ?? null, grant.includeWeight ? 1 : 0);
      const invitationVersion = tx.bumpAggregate('INVITATION', [inviteId]);
      return { entity: { type: 'invitation', id: inviteId, version: invitationVersion.version }, versionTokens: [invitationVersion], result: { inviteId, expiresAt }, after: { state: 'PENDING', expiresAt }, auditSubjectId: payload.knownClientId ?? actorId };
    });
    if (receipt.replayed) return { ...receipt, result: { ...receipt.result, tokenUnavailable: true } };
    return { ...receipt, result: { ...receipt.result, token } };
  }
  function replaceInvitation({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'invitationReplace');
    const token = invitationToken();
    return store.transaction({ actorId, requestId }, tx => {
      requireCapabilityTx(tx, { actorId, capability: 'CREATE_INVITATION' });
      const old = tx.db.prepare('SELECT * FROM invitations WHERE id=?').get(payload.invitationId);
      if (!old || old.trainer_id !== actorId) fail('not-found');
      if (payload.knownClientId !== undefined && payload.knownClientId !== old.known_client_id) fail('forbidden');
      const key = canonicalAggregateKey([old.id]); const replay = tx.mutation(operationId); const payloadSha256 = hashPayload(payload);
      if (replay) {
        if (replay.actor_id !== actorId || replay.capability !== 'CREATE_INVITATION' || replay.aggregate_kind !== 'INVITATION' || replay.aggregate_key !== key || replay.payload_sha256 !== payloadSha256) fail('conflict');
        const stored = JSON.parse(replay.result_metadata_json);
        const versionTokens = (stored.references ?? [{ kind: 'INVITATION', key }]).map(reference => ({ ...reference, version: tx.getAggregateVersion(reference.kind, reference.key) }));
        return { operationId, replayed: true, entity: replayEntity(tx, replay, versionTokens), versionTokens, result: { ...(stored.result ?? stored), tokenUnavailable: true }, requestId };
      }
      if (old.state !== 'PENDING' || tx.getAggregateVersion('INVITATION', key) !== expectedVersion) fail('conflict');
      const stamp = clock(); const inviteId = id(); const expiresAt = new Date(Date.parse(stamp) + 7 * 24 * 60 * 60 * 1000).toISOString();
      tx.db.prepare("UPDATE invitations SET state='REVOKED',revoked_at_utc=?,version=version+1 WHERE id=?").run(stamp, old.id);
      tx.db.prepare("INSERT INTO invitations(id,trainer_id,known_client_id,commercial_name,token_sha256,state,expires_at_utc,created_at_utc,version) VALUES (?,?,?,?,?,'PENDING',?,?,1)").run(inviteId, actorId, old.known_client_id, payload.commercialName, tokenHash(token), expiresAt, stamp);
      const insert = tx.db.prepare('INSERT INTO invitation_grants(id,invitation_id,kind,start_utc,end_exclusive_utc,include_weight) VALUES (?,?,?,?,?,?)');
      for (const grant of payload.grants) insert.run(id(), inviteId, grant.kind, grant.startUtc ?? null, grant.endExclusiveUtc ?? null, grant.includeWeight ? 1 : 0);
      const oldToken = tx.bumpAggregate('INVITATION', key);
      const newToken = tx.bumpAggregate('INVITATION', [inviteId]);
      const inviteSet = tx.bumpAggregate('INVITE_SET', [actorId]);
      const result = { replacedInvitationId: old.id, inviteId, expiresAt };
      const references = [oldToken, newToken, inviteSet].map(({ kind, key: referenceKey }) => ({ kind, key: referenceKey }));
      tx.recordMutation({ operationId, actorId, capability: 'CREATE_INVITATION', subjectId: old.known_client_id ?? actorId, aggregateKind: 'INVITATION', aggregateKey: key, payloadSha256, resultEntityType: 'invitation', resultEntityId: inviteId, resultVersion: newToken.version, resultMetadata: { result, references } });
      tx.audit({ actorId, subjectId: old.known_client_id ?? actorId, entityType: 'invitation', entityId: inviteId, before: { state: old.state, invitationId: old.id }, after: { state: 'PENDING', invitationId: inviteId, grants: consentShape(payload.grants) }, requestId });
      return { operationId, entity: { type: 'invitation', id: inviteId, version: newToken.version }, versionTokens: [oldToken, newToken, inviteSet], result: { ...result, token }, requestId };
    });
  }
  function invitationByToken(tx, token) {
    return tx.db.prepare('SELECT * FROM invitations WHERE token_sha256=?').get(tokenHash(token));
  }
  function invitationForToken(tx, token, { publicPreview = false } = {}) {
    const invite = invitationByToken(tx, token);
    if (!invite || invite.state === 'REVOKED' || invite.state === 'REJECTED' || invite.state === 'ACCEPTED') fail('invite-invalid');
    if (invite.expires_at_utc <= clock()) fail(publicPreview ? 'invite-expired' : 'invite-invalid');
    return invite;
  }
  function previewInvitation({ token }) {
    const parsed = parseAuthorityPayload('invitationToken', { token });
    return store.transaction({ actorId: 'public-preview' }, tx => {
      const invite = invitationForToken(tx, parsed.token, { publicPreview: true });
      const proposedGrants = consentShape(tx.db.prepare('SELECT kind,start_utc,end_exclusive_utc,include_weight FROM invitation_grants WHERE invitation_id=? ORDER BY kind,start_utc,end_exclusive_utc,id').all(invite.id));
      return { trainer: { id: invite.trainer_id }, purpose: 'training-follow-up', categories: proposedGrants.map(row => row.kind), expiresAt: invite.expires_at_utc, invitationVersion: tx.getAggregateVersion('INVITATION', [invite.id]), proposedGrants };
    });
  }
  function acceptInvitation({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'acceptInvitation');
    const preflight = store.transaction({ actorId, requestId }, tx => {
      requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'ACCEPT_INVITATION' });
      const invite = invitationByToken(tx, payload.token);
      if (!invite || (invite.known_client_id && invite.known_client_id !== actorId)) fail('invite-invalid');
      const key = canonicalAggregateKey([invite.id]); const replay = tx.mutation(operationId); const payloadSha256 = hashPayload(payload);
      if (replay) {
        if (replay.actor_id !== actorId || replay.subject_id !== actorId || replay.capability !== 'ACCEPT_INVITATION' || replay.aggregate_kind !== 'INVITATION' || replay.aggregate_key !== key || replay.payload_sha256 !== payloadSha256) fail('conflict');
        const stored = JSON.parse(replay.result_metadata_json);
        const versionTokens = (stored.references ?? [{ kind: 'INVITATION', key }]).map(reference => ({ ...reference, version: tx.getAggregateVersion(reference.kind, reference.key) }));
        return { operationId, replayed: true, entity: replayEntity(tx, replay, versionTokens), versionTokens, result: stored.result ?? stored, requestId };
      }
      invitationForToken(tx, payload.token);
      const proposals = tx.db.prepare('SELECT * FROM invitation_grants WHERE invitation_id=?').all(invite.id);
      if (payload.grants.some(selected => !proposals.some(proposal => grantMatches(proposal, selected)))) fail('forbidden');
      if (tx.getAggregateVersion('INVITATION', key) !== expectedVersion) fail('conflict');
      return null;
    });
    if (preflight) return preflight;
    const snapshot = historyPublisher?.prepare(actorId, payload.grants.some(grant => grant.kind === 'HISTORY'));
    return store.transaction({ actorId, requestId }, tx => {
      requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'ACCEPT_INVITATION' });
      const invite = invitationByToken(tx, payload.token);
      // Token failures and a foreign known target remain indistinguishable.
      if (!invite || (invite.known_client_id && invite.known_client_id !== actorId)) fail('invite-invalid');
      const key = canonicalAggregateKey([invite.id]); const replay = tx.mutation(operationId); const payloadSha256 = hashPayload(payload);
      if (replay) {
        if (replay.actor_id !== actorId || replay.subject_id !== actorId || replay.capability !== 'ACCEPT_INVITATION' || replay.aggregate_kind !== 'INVITATION' || replay.aggregate_key !== key || replay.payload_sha256 !== payloadSha256) fail('conflict');
        const stored = JSON.parse(replay.result_metadata_json);
        const versionTokens = (stored.references ?? [{ kind: 'INVITATION', key }]).map(reference => ({ ...reference, version: tx.getAggregateVersion(reference.kind, reference.key) }));
        return { operationId, replayed: true, entity: replayEntity(tx, replay, versionTokens), versionTokens, result: stored.result ?? stored, requestId };
      }
      invitationForToken(tx, payload.token);
      const proposals = tx.db.prepare('SELECT * FROM invitation_grants WHERE invitation_id=?').all(invite.id);
      if (payload.grants.some(selected => !proposals.some(proposal => grantMatches(proposal, selected)))) fail('forbidden');
      if (tx.getAggregateVersion('INVITATION', key) !== expectedVersion) fail('conflict');
      const stamp = clock(); const relationId = id();
      // An unbound invitation can be accepted by an already-known account. Only the UID
      // that was durably enrolled through this invitation needs trainer confirmation.
      const enrolledHere = !!tx.db.prepare('SELECT 1 FROM enrollment_sessions WHERE invitation_id=? AND uid=?').get(invite.id, actorId);
      const known = !enrolledHere;
      try {
        tx.db.prepare('UPDATE invitations SET state=\'ACCEPTED\',consumed_at_utc=?,version=version+1 WHERE id=?').run(stamp, invite.id);
        tx.db.prepare('INSERT INTO relations(id,trainer_id,client_id,invitation_id,state,accepted_at_utc,confirmed_at_utc,version) VALUES (?,?,?,?,?,?,?,1)').run(relationId, invite.trainer_id, actorId, invite.id, known ? 'ACTIVE' : 'PENDING_CONFIRMATION', stamp, known ? stamp : null);
        if (known) tx.db.prepare('INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES (?,?,?,?,?,1)').run(id(), relationId, stamp, stamp, 'initial acceptance');
        const insert = tx.db.prepare('INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,window_end_exclusive_utc,include_weight,granted_by,eligible_from_utc,version) VALUES (?,?,?,\'ACTIVE\',?,?,?,?,?,1)');
        const created = payload.grants.map(grant => { const grantId = id(); insert.run(grantId, relationId, grant.kind, grant.startUtc ?? null, grant.endExclusiveUtc ?? null, grant.includeWeight ? 1 : 0, actorId, stamp); return { item: grant, grantId }; });
        if (created.some(grant => grant.item.kind === 'HISTORY')) {
          if (!historyPublisher) fail('conflict');
          historyPublisher.publish(tx, { clientId: actorId, relationId, grants: created.filter(grant => grant.item.kind === 'HISTORY'), selectedGrants: payload.grants, acceptedAt: stamp, operationId, snapshot });
        }
      } catch (error) { if (/UNIQUE constraint failed: relations\.client_id/.test(error.message)) fail('conflict'); throw error; }
      const token = tx.bumpAggregate('INVITATION', key);
      const relationToken = tx.bumpAggregate('RELATION', [relationId]);
      const result = { relationId, state: known ? 'ACTIVE' : 'PENDING_CONFIRMATION', acceptedAt: stamp };
      const references = [{ kind: 'INVITATION', key }, { kind: 'RELATION', key: relationToken.key }];
      tx.recordMutation({ operationId, actorId, capability: 'ACCEPT_INVITATION', subjectId: actorId, aggregateKind: 'INVITATION', aggregateKey: key, payloadSha256, resultEntityType: 'relation', resultEntityId: relationId, resultVersion: relationToken.version, resultMetadata: { result, references } });
      tx.audit({ actorId, subjectId: actorId, entityType: 'relation', entityId: relationId, before: { invitationState: 'PENDING', relationState: null, grants: [] }, after: { invitationState: 'ACCEPTED', relationState: result.state, grants: consentShape(payload.grants) }, requestId });
      return { operationId, entity: { type: 'relation', id: relationId, version: relationToken.version }, versionTokens: [{ ...token }, relationToken], result, requestId };
    });
  }
  function invitationDecision({ actorId, body, requestId, action }) {
    const kind = action === 'revoke' ? 'invitationRevoke' : 'invitationToken';
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, kind);
    return store.transaction({ actorId, requestId }, tx => {
      let invite;
      if (action === 'revoke') { invite = tx.db.prepare('SELECT * FROM invitations WHERE id=?').get(payload.invitationId); if (!invite || invite.trainer_id !== actorId) fail('not-found'); requireCapabilityTx(tx, { actorId, capability: 'CREATE_INVITATION' }); }
      else { requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: 'ACCEPT_INVITATION' }); invite = invitationByToken(tx, payload.token); if (!invite || (invite.known_client_id && invite.known_client_id !== actorId)) fail('invite-invalid'); }
      const key = canonicalAggregateKey([invite.id]); const capability = action === 'revoke' ? 'CREATE_INVITATION' : 'ACCEPT_INVITATION'; const replay = tx.mutation(operationId); const payloadSha256 = hashPayload(payload);
      if (replay) {
        if (replay.actor_id !== actorId || replay.capability !== capability || replay.aggregate_kind !== 'INVITATION' || replay.aggregate_key !== key || replay.payload_sha256 !== payloadSha256) fail('conflict');
        const versionTokens = [{ kind: 'INVITATION', key, version: tx.getAggregateVersion('INVITATION', key) }];
        return { operationId, replayed: true, entity: replayEntity(tx, replay, versionTokens), versionTokens, result: JSON.parse(replay.result_metadata_json), requestId };
      }
      if (action !== 'revoke') invitationForToken(tx, payload.token);
      if (tx.getAggregateVersion('INVITATION', key) !== expectedVersion || invite.state !== 'PENDING') fail('conflict');
      const state = action === 'revoke' ? 'REVOKED' : 'REJECTED'; tx.db.prepare('UPDATE invitations SET state=?,revoked_at_utc=?,version=version+1 WHERE id=?').run(state, clock(), invite.id);
      const token = tx.bumpAggregate('INVITATION', key); const result = { invitationId: invite.id, state };
      tx.recordMutation({ operationId, actorId, capability, subjectId: action === 'revoke' ? invite.trainer_id : actorId, aggregateKind: 'INVITATION', aggregateKey: key, payloadSha256, resultEntityType: 'invitation', resultEntityId: invite.id, resultVersion: token.version, resultMetadata: result });
      const auditSubjectId = invite.known_client_id ?? (action === 'revoke' ? actorId : actorId);
      tx.audit({ actorId, subjectId: auditSubjectId, entityType: 'invitation', entityId: invite.id, before: { state: invite.state }, after: { state, invitationId: invite.id }, reason: payload.reason ?? null, requestId });
      return { operationId, entity: { type: 'invitation', id: invite.id, version: token.version }, versionTokens: [token], result, requestId };
    });
  }
  function changeRelation({ actorId, body, requestId, action, admin = false }) {
    const payloadKind = action === 'confirm' ? 'relationConfirm' : 'relation';
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, payloadKind);
    const relationId = payload.relationId;
    const subjectId = ['revoke', 'reactivate-accept'].includes(action) ? actorId : null;
    return mutateAuthority({ actorId, capability: action === 'confirm' ? 'CONFIRM_RELATION' : 'CHANGE_RELATION', subjectId, aggregateKind: 'RELATION', aggregateKey: [relationId], operationId, expectedVersion, payload, requestId, authorityContext: { relationId, withdrawalOnly: action === 'revoke' } }, tx => {
      const relation = tx.db.prepare('SELECT * FROM relations WHERE id=?').get(relationId); if (!relation) fail('not-found');
      const stamp = clock(); const actorIsClient = relation.client_id === actorId;
      if (admin && !isAdmin(actorId)) fail('forbidden');
      if (!admin && action !== 'confirm' && !(actorIsClient || relation.trainer_id === actorId)) fail('not-found');
      if (action === 'confirm') {
        if (relation.trainer_id !== actorId || relation.state !== 'PENDING_CONFIRMATION') fail('conflict');
        try {
          tx.db.prepare("UPDATE relations SET state='ACTIVE',confirmed_at_utc=?,version=version+1 WHERE id=?").run(stamp, relationId);
          tx.db.prepare('INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES (?,?,?,?,?,1)').run(id(), relationId, relation.accepted_at_utc, stamp, 'trainer confirmation');
          const active = tx.db.prepare("SELECT 1 FROM relation_grants WHERE relation_id=? AND state='ACTIVE' LIMIT 1").get(relationId);
          if (!active) {
            const pending = tx.db.prepare('SELECT * FROM relation_pending_grants WHERE relation_id=?').all(relationId);
            const insert = tx.db.prepare("INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,window_end_exclusive_utc,include_weight,granted_by,eligible_from_utc,version) VALUES (?,?,?,'ACTIVE',?,?,?,?,?,1)");
            for (const grant of pending) insert.run(id(), relationId, grant.kind, grant.window_start_utc, grant.window_end_exclusive_utc, grant.include_weight, relation.client_id, relation.accepted_at_utc);
            tx.db.prepare('DELETE FROM relation_pending_grants WHERE relation_id=?').run(relationId);
          }
        }
        catch (error) { if (/UNIQUE constraint failed: relations\.client_id/.test(error.message)) fail('conflict'); throw error; }
      } else if (action === 'suspend') {
        if (relation.state !== 'ACTIVE') fail('conflict'); tx.db.prepare("UPDATE relations SET state='SUSPENDED',reason=?,version=version+1 WHERE id=?").run(payload.reason, relationId); closeRelationAccess(tx, relationId, stamp, payload.reason);
      } else if (action === 'end' || action === 'revoke') {
        if (relation.state === 'ENDED') fail('conflict'); tx.db.prepare("UPDATE relations SET state='ENDED',ended_at_utc=?,reason=?,version=version+1 WHERE id=?").run(stamp, payload.reason, relationId); closeRelationAccess(tx, relationId, stamp, payload.reason);
      } else if (action === 'reactivate-request') {
        if (relation.state !== 'SUSPENDED') fail('conflict'); tx.db.prepare("UPDATE relations SET state='REACTIVATION_PENDING',reason=?,version=version+1 WHERE id=?").run(payload.reason, relationId);
      } else if (action === 'reactivate-accept') {
        if (!actorIsClient || relation.state !== 'REACTIVATION_PENDING') fail('conflict');
        try { tx.db.prepare("UPDATE relations SET state='ACTIVE',reason=?,version=version+1 WHERE id=?").run(payload.reason, relationId); tx.db.prepare('INSERT INTO relation_access_windows(id,relation_id,eligible_from_utc,enabled_from_utc,reason,version) VALUES (?,?,?,?,?,1)').run(id(), relationId, stamp, stamp, 'client reactivation acceptance'); }
        catch (error) { if (/UNIQUE constraint failed: relations\.client_id/.test(error.message)) fail('conflict'); throw error; }
      } else fail('conflict');
      const state = tx.db.prepare('SELECT state FROM relations WHERE id=?').get(relationId).state;
      const activeGrants = tx.db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(relationId);
      return { entity: { type: 'relation', id: relationId }, result: { relationId, state }, before: { state: relation.state }, after: { state, grants: consentShape(activeGrants) }, reason: payload.reason ?? null, auditSubjectId: relation.client_id };
    });
  }
  function closeRelationAccess(tx, relationId, stamp, reason) {
    tx.db.prepare('UPDATE relation_access_windows SET ended_at_utc=?,reason=?,version=version+1 WHERE relation_id=? AND ended_at_utc IS NULL').run(stamp, reason, relationId);
    tx.db.prepare("UPDATE relation_grants SET state='REVOKED',revoked_at_utc=?,version=version+1 WHERE relation_id=? AND state='ACTIVE'").run(stamp, relationId);
  }
  function replaceGrants({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'grant');
    if (payload.grants.some(grant => grant.kind === 'HISTORY')) fail('history-projection-pending');
    return mutateAuthority({ actorId, capability: 'CHANGE_GRANT', subjectId: actorId, aggregateKind: 'RELATION', aggregateKey: [payload.relationId], operationId, expectedVersion, payload, requestId, authorityContext: { relationId: payload.relationId } }, tx => {
      const relation = tx.db.prepare('SELECT state FROM relations WHERE id=?').get(payload.relationId);
      if (!relation || relation.state !== 'ACTIVE') fail('conflict');
      const before = { relationState: relation.state, grants: consentShape(tx.db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(payload.relationId)) };
      const stamp = clock(); tx.db.prepare("UPDATE relation_grants SET state='REVOKED',revoked_at_utc=?,version=version+1 WHERE relation_id=? AND state='ACTIVE'").run(stamp, payload.relationId);
      const insert = tx.db.prepare('INSERT INTO relation_grants(id,relation_id,kind,state,window_start_utc,window_end_exclusive_utc,include_weight,granted_by,eligible_from_utc,version) VALUES (?,?,?,\'ACTIVE\',?,?,?,?,?,1)');
      for (const grant of payload.grants) insert.run(id(), payload.relationId, grant.kind, grant.startUtc ?? null, grant.endExclusiveUtc ?? null, grant.includeWeight ? 1 : 0, actorId, stamp);
      const grants = consentShape(payload.grants);
      return { entity: { type: 'relation', id: payload.relationId }, result: { relationId: payload.relationId, grants }, before, after: { relationState: 'ACTIVE', grants } };
    });
  }
  function revokeGrant({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'grantRevoke');
    return mutateAuthority({ actorId, capability: 'CHANGE_GRANT', subjectId: actorId, aggregateKind: 'RELATION', aggregateKey: [payload.relationId], operationId, expectedVersion, payload, requestId, authorityContext: { relationId: payload.relationId, withdrawalOnly: true } }, tx => {
      const relation = tx.db.prepare('SELECT state FROM relations WHERE id=?').get(payload.relationId);
      if (!relation || relation.state !== 'ACTIVE') fail('conflict');
      const grant = tx.db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND kind=? AND state='ACTIVE'").get(payload.relationId, payload.kind);
      if (!grant) fail('conflict');
      const before = { relationState: relation.state, grant: consentShape([grant])[0] };
      const stamp = clock(); tx.db.prepare("UPDATE relation_grants SET state='REVOKED',revoked_at_utc=?,version=version+1 WHERE relation_id=? AND kind=? AND state='ACTIVE'").run(stamp, payload.relationId, payload.kind);
      if (payload.kind === 'PLAN') {
        tx.db.prepare("UPDATE relations SET state='ENDED',ended_at_utc=?,reason=?,version=version+1 WHERE id=? AND state!='ENDED'").run(stamp, payload.reason, payload.relationId);
        closeRelationAccess(tx, payload.relationId, stamp, payload.reason);
      }
      const state = payload.kind === 'PLAN' ? 'ENDED' : relation.state;
      return { entity: { type: 'relation', id: payload.relationId }, result: { relationId: payload.relationId, revoked: payload.kind, ...(payload.kind === 'PLAN' ? { state } : {}) }, before, after: { relationState: state, revoked: payload.kind }, reason: payload.reason };
    });
  }
  function confirmCommercialOperation({ actorId, body, requestId }) {
    const { operationId, expectedVersion, payload } = validateMutationEnvelope(body, 'commercial');
    return mutateAuthority({ actorId, capability: 'CONFIRM_SUBSCRIPTION', subjectId: payload.clientId, aggregateKind: 'SUBSCRIPTION', aggregateKey: [payload.clientId], operationId, expectedVersion, payload, requestId }, tx => {
      const stamp = clock(); const current = tx.db.prepare('SELECT * FROM subscription_intervals WHERE client_id=? AND start_utc<=? AND end_exclusive_utc>? ORDER BY end_exclusive_utc DESC LIMIT 1').get(payload.clientId, stamp, stamp);
      const today = panamaDateAtServerClock(() => new Date(stamp));
      const active = !!current;
      const activeStartPanama = active ? new Date(Date.parse(current.end_exclusive_utc) - 5 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
      const startPanama = activeStartPanama ?? (payload.kind === 'CUSTOM' ? payload.customStartPanama : today);
      if (active && payload.kind === 'CUSTOM' && payload.customStartPanama !== startPanama) fail('conflict');
      if (payload.kind === 'CUSTOM' && payload.customEndPanamaInclusive < startPanama) fail('conflict');
      const anchorDay = active ? current.anchor_day : Number(startPanama.slice(-2));
      const endExclusiveUtc = periodEndExclusiveUtc({ startPanama, kind: payload.kind, customEndPanamaInclusive: payload.customEndPanamaInclusive, anchorDay });
      const intervalId = id(); tx.db.prepare('INSERT INTO subscription_intervals(id,client_id,start_utc,end_exclusive_utc,anchor_day,kind,reference,reason,created_by,created_at_utc,version) VALUES (?,?,?,?,?,?,?,?,?,?,1)').run(intervalId, payload.clientId, panamaDayStartUtc(startPanama), endExclusiveUtc, anchorDay, payload.kind, payload.reference, payload.reason, actorId, stamp);
      tx.db.prepare('INSERT INTO commercial_operations(operation_id,actor_id,client_id,payload_hash,expected_subscription_version,result_interval_id,created_at_utc) VALUES (?,?,?,?,?,?,?)').run(operationId, actorId, payload.clientId, hashPayload(payload), expectedVersion, intervalId, stamp);
      const startUtc = panamaDayStartUtc(startPanama);
      const interval = { id: intervalId, startUtc, endExclusiveUtc, kind: payload.kind };
      const before = { interval: current ? { id: current.id, startUtc: current.start_utc, endExclusiveUtc: current.end_exclusive_utc, kind: current.kind } : null };
      return { entity: { type: 'subscription', id: payload.clientId }, result: { clientId: payload.clientId, interval, entitlement: { active: startUtc <= stamp && stamp < endExclusiveUtc, startUtc, endExclusiveUtc } }, before, after: { interval }, reference: payload.reference, auditSubjectId: payload.clientId };
    });
  }
  function commercialClients(actorId, page) {
    return store.transaction({ actorId }, tx => {
      requireActive(actorId); if (!activeRole(tx.db, actorId, 'COORDINATOR')) fail('forbidden');
      const at = clock();
      const requested = readPage(page);
      const sql = "SELECT s.client_id, i.start_utc, i.end_exclusive_utc FROM coordinator_scopes s LEFT JOIN subscription_intervals i ON i.id=(SELECT current.id FROM subscription_intervals current WHERE current.client_id=s.client_id ORDER BY CASE WHEN current.start_utc<=? AND current.end_exclusive_utc>? THEN 1 ELSE 0 END DESC, current.end_exclusive_utc DESC LIMIT 1) WHERE s.coordinator_id=? AND s.removed_at_utc IS NULL AND EXISTS(SELECT 1 FROM operational_roles r WHERE r.account_id=s.client_id AND r.role='CLIENT' AND r.removed_at_utc IS NULL) ORDER BY s.client_id";
      const result = requested ? pagedFilteredRows(tx, sql, [at, at, actorId], requested, row => identity.get(row.client_id)?.active) : { items: tx.db.prepare(sql).all(at, at, actorId).filter(row => identity.get(row.client_id)?.active), hasMore: false };
      const clients = result.items
        .map(row => ({ clientId: row.client_id, entitlement: { active: !!row.start_utc && row.start_utc <= at && at < row.end_exclusive_utc, startUtc: row.start_utc ?? null, endExclusiveUtc: row.end_exclusive_utc ?? null, version: tx.getAggregateVersion('SUBSCRIPTION', [row.client_id]) } }));
      return requested ? { clients, hasMore: result.hasMore, nextOffset: result.nextOffset } : clients;
    });
  }
  function trainerPortfolio(actorId, page) {
    return store.transaction({ actorId }, tx => {
      requireActive(actorId); if (!activeRole(tx.db, actorId, 'TRAINER')) fail('forbidden'); const at = clock();
      const requested = readPage(page);
      const sql = "SELECT r.id,r.client_id,r.state FROM relations r WHERE r.trainer_id=? AND r.state='ACTIVE' AND EXISTS(SELECT 1 FROM subscription_intervals s WHERE s.client_id=r.client_id AND s.start_utc<=? AND s.end_exclusive_utc>?) ORDER BY r.id";
      const result = requested ? pagedRows(tx, sql, [actorId, at, at], requested) : { items: tx.db.prepare(sql).all(actorId, at, at), hasMore: false };
      const portfolio = result.items.map(row => ({ relationId: row.id, clientId: row.client_id, state: row.state, version: tx.getAggregateVersion('RELATION', [row.id]) }));
      return requested ? { portfolio, hasMore: result.hasMore, nextOffset: page.offset + portfolio.length } : portfolio;
    });
  }
  function trainerRelations(actorId, page) {
    return store.transaction({ actorId }, tx => {
      requireActive(actorId); if (!activeRole(tx.db, actorId, 'TRAINER')) fail('forbidden');
      const requested = readPage(page);
      const sql = 'SELECT r.id,r.state,i.commercial_name FROM relations r JOIN invitations i ON i.id=r.invitation_id WHERE r.trainer_id=? ORDER BY r.accepted_at_utc DESC,r.id';
      const result = requested ? pagedRows(tx, sql, [actorId], requested) : { items: tx.db.prepare(sql).all(actorId), hasMore: false };
      const relations = result.items.map(row => ({
        relationId: row.id,
        clientAlias: row.commercial_name,
        state: row.state,
        grants: row.state === 'PENDING_CONFIRMATION' ? [] : tx.db.prepare('SELECT * FROM relation_grants WHERE relation_id=? ORDER BY kind,window_start_utc,id').all(row.id).map(grant => ({
          grantId: grant.id,
          kind: grant.kind,
          state: grant.state,
          ...(grant.window_start_utc ? { startUtc: grant.window_start_utc } : {}),
          ...(grant.window_end_exclusive_utc ? { endExclusiveUtc: grant.window_end_exclusive_utc } : {}),
          ...(grant.include_weight ? { includeWeight: true } : {}),
          ...(grant.eligible_from_utc ? { eligibleFromUtc: grant.eligible_from_utc } : {})
        })),
        version: tx.getAggregateVersion('RELATION', [row.id])
      }));
      return requested ? { relations, hasMore: result.hasMore, nextOffset: page.offset + relations.length } : relations;
    });
  }
  function clientRelations(actorId, page) {
    return store.transaction({ actorId }, tx => {
      requireActive(actorId);
      const requested = readPage(page);
      const sql = 'SELECT id,trainer_id,state,accepted_at_utc,confirmed_at_utc,ended_at_utc FROM relations WHERE client_id=? ORDER BY accepted_at_utc DESC, id';
      const result = requested ? pagedRows(tx, sql, [actorId], requested) : { items: tx.db.prepare(sql).all(actorId), hasMore: false };
      const relations = result.items.map(row => ({
        relationId: row.id,
        trainer: { id: row.trainer_id },
        state: row.state,
        acceptedAt: row.accepted_at_utc,
        confirmedAt: row.confirmed_at_utc,
        endedAt: row.ended_at_utc,
        grants: row.state === 'PENDING_CONFIRMATION' ? [] : consentShape(tx.db.prepare("SELECT * FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind").all(row.id)),
        pendingProposals: row.state === 'PENDING_CONFIRMATION'
          ? consentShape(tx.db.prepare("SELECT kind,window_start_utc,window_end_exclusive_utc,include_weight FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind,window_start_utc,id").all(row.id).length ? tx.db.prepare("SELECT kind,window_start_utc,window_end_exclusive_utc,include_weight FROM relation_grants WHERE relation_id=? AND state='ACTIVE' ORDER BY kind,window_start_utc,id").all(row.id) : tx.db.prepare('SELECT kind,window_start_utc,window_end_exclusive_utc,include_weight FROM relation_pending_grants WHERE relation_id=? ORDER BY kind,window_start_utc,id').all(row.id))
          : [],
        version: tx.getAggregateVersion('RELATION', [row.id])
      }));
      return requested ? { relations, hasMore: result.hasMore } : relations;
    });
  }
  function trainerInvitations(actorId, page) {
    return store.transaction({ actorId }, tx => {
      requireActive(actorId); if (!activeRole(tx.db, actorId, 'TRAINER')) fail('forbidden');
      const requested = readPage(page);
      const sql = 'SELECT id,state,commercial_name,expires_at_utc FROM invitations WHERE trainer_id=? ORDER BY created_at_utc DESC, id';
      const pageResult = requested ? pagedRows(tx, sql, [actorId], requested) : { items: tx.db.prepare(sql).all(actorId), hasMore: false };
      const invitations = pageResult.items
        .map(row => ({ invitationId: row.id, state: row.state, commercialName: row.commercial_name, expiresAt: row.expires_at_utc, version: tx.getAggregateVersion('INVITATION', [row.id]) }));
      return { invitations, hasMore: pageResult.hasMore, versionTokens: [{ kind: 'INVITE_SET', key: canonicalAggregateKey([actorId]), version: tx.getAggregateVersion('INVITE_SET', [actorId]) }] };
    });
  }
  function scopePairs(actorId, coordinatorId, clientId, page) {
    return store.transaction({ actorId }, tx => {
      requireActive(actorId); if (!isAdmin(actorId)) fail('forbidden');
      const requested = readPage(page);
      const sql = `WITH current_scope AS (
        SELECT coordinator_id, client_id, removed_at_utc,
          ROW_NUMBER() OVER (PARTITION BY coordinator_id, client_id ORDER BY assigned_at_utc DESC, rowid DESC) AS current_row
        FROM coordinator_scopes
      ) SELECT coordinator_id, client_id, removed_at_utc IS NULL AS assigned
        FROM current_scope WHERE current_row=1
          AND (? IS NULL OR coordinator_id=?) AND (? IS NULL OR client_id=?)
        ORDER BY coordinator_id, client_id`;
      const values = [coordinatorId ?? null, coordinatorId ?? null, clientId ?? null, clientId ?? null];
      const result = requested ? pagedRows(tx, sql, values, requested) : { items: tx.db.prepare(sql).all(...values), hasMore: false };
      const rows = result.items;
      if (coordinatorId && clientId && rows.length === 0) rows.push({ coordinator_id: coordinatorId, client_id: clientId, assigned: 0 });
      const scopes = rows.map(row => ({ coordinatorId: row.coordinator_id, clientId: row.client_id, assigned: !!row.assigned, version: tx.getAggregateVersion('SCOPE', [row.coordinator_id, row.client_id]) }));
      return requested ? { scopes, hasMore: result.hasMore } : scopes;
    });
  }
  function reserveEnrollment({ token, uid, challenge, enrollmentHandle }) {
    return store.transaction({ actorId: 'invite-enrollment' }, tx => {
      const invite = invitationForToken(tx, token); if (invite.known_client_id) fail('invite-invalid');
      if (typeof enrollmentHandle !== 'string' || !/^[A-Za-z0-9_-]{43}(?:\.[A-Za-z0-9_-]{43})?$/.test(enrollmentHandle)) fail('invite-invalid');
      const challengeHash = tokenHash(challenge);
      const initiatorHash = tokenHash(enrollmentHandle);
      const existing = tx.db.prepare('SELECT * FROM enrollment_sessions WHERE invitation_id=? ORDER BY created_at_utc LIMIT 1').get(invite.id);
      if (existing && existing.state !== 'ABORTED') {
        if (existing.state !== 'CHALLENGE_ISSUED') fail('invite-invalid');
        if (existing.initiator_hash !== initiatorHash) fail('invite-invalid');
        tx.db.prepare('UPDATE enrollment_sessions SET challenge_hash=?,updated_at_utc=?,version=version+1 WHERE id=?').run(challengeHash, clock(), existing.id);
        return { enrollmentId: existing.id, uid: existing.uid, resumed: true };
      }
      const stamp = clock(); const enrollmentId = id(); tx.db.prepare("INSERT INTO enrollment_sessions(id,invitation_id,uid,challenge_hash,initiator_hash,state,created_at_utc,updated_at_utc,expires_at_utc,version) VALUES (?,?,?,?,?, 'CHALLENGE_ISSUED',?,?,?,1)").run(enrollmentId, invite.id, uid, challengeHash, initiatorHash, stamp, stamp, invite.expires_at_utc);
      return { enrollmentId, uid, resumed: false };
    });
  }
  function completeEnrollment({ uid, challenge, enrollmentHandle }) {
    return store.transaction({ actorId: 'invite-enrollment' }, tx => {
      const row = tx.db.prepare("SELECT e.*,i.state invitation_state,i.expires_at_utc FROM enrollment_sessions e JOIN invitations i ON i.id=e.invitation_id WHERE e.uid=? AND e.challenge_hash=? AND e.initiator_hash=? AND e.state='CHALLENGE_ISSUED'").get(uid, tokenHash(challenge), tokenHash(enrollmentHandle || ''));
      if (!row || row.invitation_state !== 'PENDING' || row.expires_at_utc <= clock()) fail('invite-invalid');
      tx.db.prepare("UPDATE enrollment_sessions SET state='PENDING_OPERATIONAL_ROLE',updated_at_utc=?,version=version+1 WHERE id=?").run(clock(), row.id);
      return { enrollmentId: row.id, pendingOperationalRole: true };
    });
  }
  function verifyEnrollment({ uid, challenge, enrollmentHandle }) {
    return store.transaction({ actorId: 'invite-enrollment' }, tx => {
      const row = tx.db.prepare("SELECT e.id,i.state invitation_state,i.expires_at_utc FROM enrollment_sessions e JOIN invitations i ON i.id=e.invitation_id WHERE e.uid=? AND e.challenge_hash=? AND e.initiator_hash=? AND e.state='CHALLENGE_ISSUED'").get(uid, tokenHash(challenge), tokenHash(enrollmentHandle || ''));
      if (!row || row.invitation_state !== 'PENDING' || row.expires_at_utc <= clock()) fail('invite-invalid');
      return { enrollmentId: row.id };
    });
  }
  function enrollmentMetadata(uid) { return store.db.prepare("SELECT state FROM enrollment_sessions WHERE uid=? ORDER BY updated_at_utc DESC LIMIT 1").get(uid)?.state === 'PENDING_OPERATIONAL_ROLE'; }
  function recoverEnrollmentIdentity(uid) {
    return store.transaction({ actorId: 'invite-enrollment-recovery' }, tx => {
      const row = tx.db.prepare("SELECT id FROM enrollment_sessions WHERE uid=? AND state='CHALLENGE_ISSUED' ORDER BY updated_at_utc DESC LIMIT 1").get(uid);
      if (!row) return false;
      tx.db.prepare("UPDATE enrollment_sessions SET state='PENDING_OPERATIONAL_ROLE',updated_at_utc=?,version=version+1 WHERE id=?").run(clock(), row.id);
      return true;
    });
  }
  function bootstrapOffline({ ownerId, operationId, payload, requestId = 'offline-bootstrap' }) {
    uuid(operationId, 'operationId'); payload = parseAuthorityPayload('roles', payload);
    if (payload.accountId !== ownerId || !identity.get(ownerId)?.active || !isOwner(ownerId)) fail('offline-owner-required');
    return store.transaction({ actorId: `offline-owner:${ownerId}`, requestId }, tx => {
      const key = canonicalAggregateKey([ownerId]);
      const existingMutation = tx.mutation(operationId);
      const payloadSha256 = hashPayload(payload);
      if (existingMutation) {
        if (existingMutation.actor_id !== `offline-owner:${ownerId}` || existingMutation.subject_id !== ownerId || existingMutation.capability !== 'MANAGE_OPERATIONAL_ROLES' || existingMutation.aggregate_kind !== 'ROLES' || existingMutation.aggregate_key !== key || existingMutation.payload_sha256 !== payloadSha256) fail('conflict');
        return { operationId, replayed: true, entity: { type: existingMutation.result_entity_type, id: existingMutation.result_entity_id, version: existingMutation.result_version }, versionTokens: [{ kind: 'ROLES', key, version: tx.getAggregateVersion('ROLES', key) }], result: JSON.parse(existingMutation.result_metadata_json), requestId };
      }
      const stamp = clock();
      const before = { roles: tx.db.prepare('SELECT role FROM operational_roles WHERE account_id=? AND removed_at_utc IS NULL ORDER BY role').all(ownerId).map(row => row.role) };
      replaceRoles(tx, { accountId: ownerId, roles: payload.roles, reason: payload.reason, actorId: `offline-owner:${ownerId}`, stamp });
      const token = tx.bumpAggregate('ROLES', key);
      tx.recordMutation({ operationId, actorId: `offline-owner:${ownerId}`, capability: 'MANAGE_OPERATIONAL_ROLES', subjectId: ownerId, aggregateKind: 'ROLES', aggregateKey: key, payloadSha256, resultEntityType: 'roles', resultEntityId: ownerId, resultVersion: token.version, resultMetadata: { accountId: ownerId, roles: payload.roles } });
      tx.audit({ actorId: `offline-owner:${ownerId}`, subjectId: ownerId, entityType: 'roles', entityId: ownerId, before, after: { roles: payload.roles }, reason: payload.reason, requestId });
      return { operationId, entity: { type: 'roles', id: ownerId, version: token.version }, versionTokens: [token], result: { accountId: ownerId, roles: payload.roles }, requestId };
    });
  }
  function accessSnapshot(actorId, { managedSubscriptions = false, requestId = '' } = {}) {
    const identityRow = identity.get(actorId); if (!identityRow?.active) fail('unauthenticated');
    const roles = store.db.prepare('SELECT role FROM operational_roles WHERE account_id=? AND removed_at_utc IS NULL ORDER BY role').all(actorId).map(row => row.role);
    const interval = store.db.prepare('SELECT start_utc,end_exclusive_utc,version FROM subscription_intervals WHERE client_id=? AND start_utc<=? AND end_exclusive_utc>? ORDER BY end_exclusive_utc DESC LIMIT 1').get(actorId, clock(), clock());
    const entitlementVersion = store.getAggregateVersion('SUBSCRIPTION', canonicalAggregateKey([actorId]));
    const capability = name => { try { return store.transaction({ actorId, requestId }, tx => { requireCapabilityTx(tx, { actorId, subjectId: actorId, capability: name }); return true; }); } catch { return false; } };
    return { account: { id: actorId, activity: identityRow.activity }, managedSubscriptions, roles, entitlement: { active: !!interval, startUtc: interval?.start_utc ?? null, endExclusiveUtc: interval?.end_exclusive_utc ?? null, version: entitlementVersion }, capabilities: CAPABILITIES.filter(capability), compatibility: { protectedTraining: 'supported' }, requestId, versionTokens: [{ kind: 'ROLES', key: canonicalAggregateKey([actorId]), version: store.getAggregateVersion('ROLES', canonicalAggregateKey([actorId])) }, { kind: 'SUBSCRIPTION', key: canonicalAggregateKey([actorId]), version: entitlementVersion }, { kind: 'EXPORT_SET', key: canonicalAggregateKey([actorId]), version: store.getAggregateVersion('EXPORT_SET', canonicalAggregateKey([actorId])) }, { kind: 'DELETION_REQUEST_SET', key: canonicalAggregateKey([actorId]), version: store.getAggregateVersion('DELETION_REQUEST_SET', canonicalAggregateKey([actorId])) }] };
  }
  return {
    requireCapabilityTx, mutateAuthority, preflightAuthority, setRoles, setScope, bootstrapOffline, accessSnapshot,
    createInvitation, replaceInvitation, previewInvitation, acceptInvitation, invitationDecision, changeRelation,
    replaceGrants, revokeGrant, confirmCommercialOperation, commercialClients, trainerPortfolio,
    trainerRelations, trainerInvitations, clientRelations, scopePairs, reserveEnrollment, verifyEnrollment, completeEnrollment, enrollmentMetadata, recoverEnrollmentIdentity
  };
}
