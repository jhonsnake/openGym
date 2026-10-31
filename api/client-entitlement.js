// Client access is deliberately independent from operational roles. A finite commercial
// interval remains the normal source, while a narrowly provisioned offline grant has no expiry.
export function activeClientEntitlement(db, clientId, at) {
  const indefinite = db.prepare('SELECT id,version FROM indefinite_client_entitlements WHERE client_id=? AND revoked_at_utc IS NULL ORDER BY granted_at_utc DESC,id DESC LIMIT 1').get(clientId);
  if (indefinite) return { kind: 'INDEFINITE', id: indefinite.id, version: indefinite.version, startUtc: null, endExclusiveUtc: null };
  const interval = db.prepare('SELECT id,start_utc,end_exclusive_utc,version FROM subscription_intervals WHERE client_id=? AND start_utc<=? AND end_exclusive_utc>? ORDER BY end_exclusive_utc DESC,id DESC LIMIT 1').get(clientId, at, at);
  return interval ? { kind: 'FINITE', id: interval.id, version: interval.version, startUtc: interval.start_utc, endExclusiveUtc: interval.end_exclusive_utc } : null;
}

export const clientEntitled = (db, clientId, at) => activeClientEntitlement(db, clientId, at) !== null;
