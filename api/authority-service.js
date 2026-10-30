import crypto from 'node:crypto';
import { CAPABILITIES, canonicalAggregateKey, hashPayload, parseAuthorityPayload, validateMutationEnvelope, uuid } from './authority-contract.js';

const now = () => new Date().toISOString();
const fail = message => { const error = new Error(message); error.code = message; throw error; };
const id = () => crypto.randomUUID();
const activeRole = (db, uid, role) => !!db.prepare('SELECT 1 FROM operational_roles WHERE account_id=? AND role=? AND removed_at_utc IS NULL').get(uid, role);
const entitled = (db, uid, at) => !!db.prepare('SELECT 1 FROM subscription_intervals WHERE client_id=? AND start_utc<=? AND end_exclusive_utc>?').get(uid, at, at);
const currentWindow = (db, relationId, at) => !!db.prepare("SELECT 1 FROM relation_access_windows WHERE relation_id=? AND enabled_from_utc<=? AND (ended_at_utc IS NULL OR ended_at_utc>?)").get(relationId, at, at);
const currentGrant = (db, relationId, kind, at) => !!db.prepare("SELECT 1 FROM relation_grants WHERE relation_id=? AND kind=? AND state='ACTIVE' AND (window_start_utc IS NULL OR window_start_utc<=?) AND (window_end_exclusive_utc IS NULL OR window_end_exclusive_utc>?)").get(relationId, kind, at, at);
const fixedGrantByCapability = Object.freeze({ PUBLISH_PLAN: 'PLAN', READ_TRAINER_EXECUTIONS: 'EXECUTION' });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
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

export function createAuthorityService({ store, identity, isAdmin = () => false, isOwner = () => false, clock = now } = {}) {
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
    const sensitiveCrossRead = new Set(['PUBLISH_PLAN', 'READ_TRAINER_EXECUTIONS', 'READ_CLIENT_PLAN']);
    if (sensitiveCrossRead.has(capability) && actorId !== subjectId && !identity.get(subjectId)?.active) fail('forbidden');
    const policies = {
      ACCESS_PERSONAL_TRAINING: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      MANAGE_OPERATIONAL_ROLES: admin,
      MANAGE_COORDINATOR_SCOPE: admin,
      CREATE_INVITATION: activeRole(db, actorId, 'TRAINER'),
      PREVIEW_INVITATION: true,
      ACCEPT_INVITATION: own,
      CONFIRM_RELATION: activeRole(db, actorId, 'TRAINER') && relation?.trainer_id === actorId && relation?.state === 'PENDING_CONFIRMATION',
      CHANGE_RELATION: own ? relation?.client_id === actorId : admin || (activeRole(db, actorId, 'TRAINER') && relation?.trainer_id === actorId),
      CHANGE_GRANT: own && relation?.client_id === actorId && activeRelation && (withdrawalOnly || entitled(db, actorId, at)),
      PUBLISH_PLAN: activeRole(db, actorId, 'TRAINER') && activeRole(db, subjectId, 'CLIENT') && relationMatchesSubject && relation?.trainer_id === actorId && activeRelation && activeWindow && clientEntitled && hasGrant,
      READ_CLIENT_PLAN: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      READ_OWN_EXECUTIONS: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      START_SESSION: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      FINISH_SESSION: own && activeRole(db, actorId, 'CLIENT') && entitled(db, actorId, at),
      READ_TRAINER_EXECUTIONS: activeRole(db, actorId, 'TRAINER') && activeRole(db, subjectId, 'CLIENT') && relationMatchesSubject && relation?.trainer_id === actorId && activeRelation && activeWindow && clientEntitled && hasGrant,
      CONFIRM_SUBSCRIPTION: activeRole(db, actorId, 'COORDINATOR') && actorId !== subjectId && !!db.prepare('SELECT 1 FROM coordinator_scopes WHERE coordinator_id=? AND client_id=? AND removed_at_utc IS NULL').get(actorId, subjectId),
      READ_COMMERCIAL_CLIENTS: activeRole(db, actorId, 'COORDINATOR') && actorId !== subjectId && !!db.prepare('SELECT 1 FROM coordinator_scopes WHERE coordinator_id=? AND client_id=? AND removed_at_utc IS NULL').get(actorId, subjectId),
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
        return { operationId, replayed: true, entity: { type: replay.result_entity_type, id: replay.result_entity_id, version: replay.result_version }, versionTokens: [{ kind: replay.aggregate_kind, key: replay.aggregate_key, version: tx.getAggregateVersion(replay.aggregate_kind, replay.aggregate_key) }], result: JSON.parse(replay.result_metadata_json), requestId };
      }
      if (tx.getAggregateVersion(aggregateKind, key) !== expectedVersion) fail('conflict');
      const applied = applyTx(tx);
      const token = tx.bumpAggregate(aggregateKind, key);
      const entity = applied.entity || { type: aggregateKind.toLowerCase(), id: subjectId, version: token.version };
      tx.recordMutation({ operationId, actorId, capability, subjectId, aggregateKind, aggregateKey: key, payloadSha256, resultEntityType: entity.type, resultEntityId: entity.id, resultVersion: entity.version || token.version, resultMetadata: applied.result });
      tx.audit({ actorId, subjectId, entityType: entity.type, entityId: entity.id, before: applied.before ?? null, after: applied.after ?? applied.result, reason: payload.reason || null, requestId });
      return { operationId, entity: { ...entity, version: entity.version || token.version }, versionTokens: [token], result: applied.result, requestId };
    });
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
    return { account: { id: actorId, activity: identityRow.activity }, managedSubscriptions, roles, entitlement: { active: !!interval, startUtc: interval?.start_utc ?? null, endExclusiveUtc: interval?.end_exclusive_utc ?? null, version: entitlementVersion }, capabilities: CAPABILITIES.filter(capability), compatibility: { protectedTraining: 'supported' }, requestId, versionTokens: [{ kind: 'ROLES', key: canonicalAggregateKey([actorId]), version: store.getAggregateVersion('ROLES', canonicalAggregateKey([actorId])) }, { kind: 'SUBSCRIPTION', key: canonicalAggregateKey([actorId]), version: entitlementVersion }] };
  }
  return { requireCapabilityTx, mutateAuthority, setRoles, setScope, bootstrapOffline, accessSnapshot };
}
