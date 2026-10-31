# Indefinite personal client entitlement operator procedure

This change is prepared source only. It has not been deployed and has not changed any production account, database, role, session or entitlement.

Schema v6 adds `indefinite_client_entitlements`: an explicit, audited, revocable no-payment grant. It is not a distant-date subscription and does not bypass identity activity or the CLIENT role. Finite subscription intervals are unchanged. The shared authority read covers personal training, trainer access, commercial client readback, snapshots and exports.

After the parent has taken and verified a quiesced backup and identified the exact existing sole-owner UID for `jhonprada@gmail.com`, run only the audited offline tool against a stopped/copy data directory (never raw SQLite):

```bash
node api/scripts/bootstrap-operational-role.mjs \
  --data-dir /path/to/copied-data \
  --uid '<verified-existing-sole-owner-uid>' \
  --email jhonprada@gmail.com \
  --roles CLIENT,TRAINER,COORDINATOR \
  --indefinite-client \
  --reason 'explicit authorized personal no-payment client entitlement' \
  --operation-id '<fresh-UUIDv4>'
```

The tool validates the existing active sole owner, email syntax/normalized uniqueness, all three roles and UUID; snapshots `authority.sqlite`; retains the legacy administrator; emits authority audit rows; and prints a JSON readback with email, roles and null expiry. It never mints a session. Repeating the same operation ID is a safe audited replay.

To revoke the no-payment grant, use a new UUID while the candidate is stopped:

```bash
node api/scripts/bootstrap-operational-role.mjs \
  --data-dir /path/to/copied-data \
  --uid '<verified-existing-sole-owner-uid>' \
  --revoke-indefinite-client \
  --reason 'operator-approved revocation' \
  --operation-id '<fresh-UUIDv4>'
```

Rollback restores the verified pre-operation full data backup; do not delete rows. Old binaries fail closed on schema v6, so a rollback needs the matching prior application image and a coherent backup. `snapshot-authority.mjs` includes the new table, and owned exports include `commercial.indefiniteClientEntitlements`.

Build/test recipe: `cd api && npm ci && npm test`; then `cd frontend && npm ci && npm test && npm run build`. This change updates the authority store/service, training/export/snapshot paths, audited bootstrap tool, browser access gate, contracts and focused tests. It contains no deployment command.
