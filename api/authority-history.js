import crypto from 'node:crypto';
import { hashPayload } from './authority-contract.js';
import { composeHistoryShare } from './authority-projections.js';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const id = () => crypto.randomUUID();
const equalSnapshotIdentity = (a, b) => (a?._rev ?? 0) === (b?._rev ?? 0) && (a?._wid ?? null) === (b?._wid ?? null);
const usableState = state => state === null ? {} : state;
const validState = state => !!state && typeof state === 'object';

export function createHistoryPublisher({ readStateStrict } = {}) {
  if (typeof readStateStrict !== 'function') throw new TypeError('readStateStrict is required');

  function prepare(clientId, needsHistory) {
    if (!needsHistory) return null;
    const state = usableState(readStateStrict(clientId));
    if (!validState(state)) fail('conflict');
    return state;
  }

  function publish(tx, { clientId, relationId, grants, selectedGrants, acceptedAt, operationId, snapshot }) {
    if (!grants.length) return;
    const current = usableState(readStateStrict(clientId));
    if (!validState(snapshot) || !validState(current) || !equalSnapshotIdentity(snapshot, current)) fail('conflict');
    const sqliteRows = tx.db.prepare('SELECT id,payload_json AS payloadJson,submitted_at_utc AS submittedAtUtc FROM session_executions WHERE client_id=?').all(clientId);
    const sqliteBodyweightRows = tx.db.prepare('SELECT id,weight,unit,reported_date_panama AS reportedDatePanama,received_at_utc AS receivedAtUtc FROM bodyweight_entries WHERE client_id=?').all(clientId);
    const weightAllowed = selectedGrants.some(grant => grant.kind === 'WEIGHT');
    for (const { item, grantId } of grants) {
      const share = composeHistoryShare({
        workouts: current.workouts,
        bodyweight: current.bodyweight,
        profileUnit: current.unit,
        legacyRevision: current._rev ?? 0,
        legacyWid: current._wid ?? null,
        sqliteRows,
        sqliteBodyweightRows,
        fromUtc: item.startUtc ?? item.window_start_utc,
        toExclusiveUtc: item.endExclusiveUtc ?? item.window_end_exclusive_utc,
        consentAtUtc: acceptedAt,
        serverNowUtc: acceptedAt,
        includeWeight: item.includeWeight === true || item.include_weight === 1,
        weightAllowed
      });
      tx.db.prepare('INSERT INTO history_shares(id,client_id,relation_id,grant_id,from_utc,to_exclusive_utc,source_personal_rev,source_personal_wid,source_sqlite_version,projection_json,projection_sha256,published_at_utc,operation_id,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)').run(
        id(), clientId, relationId, grantId, item.startUtc ?? item.window_start_utc, item.endExclusiveUtc ?? item.window_end_exclusive_utc,
        String(current._rev ?? 0), current._wid ?? null, tx.getAggregateVersion('SESSION_SET', [clientId]), JSON.stringify(share), hashPayload(share), acceptedAt, operationId
      );
    }
  }

  return { prepare, publish };
}
