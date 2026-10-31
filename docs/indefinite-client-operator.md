# Indefinite personal client entitlement operator procedure

This change is prepared source only. It has not been deployed and has not changed any production account, database, role, session or entitlement.

Schema v6 adds `indefinite_client_entitlements`: an explicit, audited, revocable no-payment grant. It is not a distant-date subscription and does not bypass identity activity or the CLIENT role. Finite subscription intervals are unchanged. The shared authority read covers personal training, trainer access, commercial client readback, snapshots and exports.

After the parent has taken and verified a quiesced backup and identified the exact existing sole-owner UID for `jhonprada@gmail.com`, run only the audited offline tool against a stopped/copy data directory (never raw SQLite):

```bash
node api/scripts/bootstrap-operational-role.mjs --offline \
  --data-dir /path/to/copied-data \
  --uid '<verified-existing-sole-owner-uid>' \
  --email jhonprada@gmail.com \
  --roles CLIENT,TRAINER,COORDINATOR \
  --indefinite-client \
  --reason 'explicit authorized personal no-payment client entitlement' \
  --operation-id '<fresh-UUIDv4>'
```

The `--offline` flag explicitly asserts that all writers are stopped; it does not stop them or prove remote/container process quiescence. Verify the API and any other writers are stopped and disabled from restarting, or use an isolated copy inaccessible to running processes. Do not run simultaneous provisioning commands. Keep that condition until a successful readback and removal of any recovery journal.

The tool validates the existing active sole owner, email syntax/normalized uniqueness, all three roles and UUID; snapshots `authority.sqlite`; retains the legacy administrator; emits authority audit rows; and prints a JSON readback with email, roles and null expiry. It never mints a session. Repeating the same operation ID is a safe audited replay.

Email staging and a mode-0600, fsynced `.bootstrap-recovery.json` journal precede authority mutation. The email rename runs inside the SQLite transaction before COMMIT. Ordinary write/rename failures roll SQLite back and restore the exact original JSON bytes, including sessions. After interruption, the next offline invocation recovers before identity preflight: a committed operation receipt keeps the new JSON; absent receipt restores the old JSON. The API refuses startup while the journal exists. If storage failures prevent recovery, keep everything stopped, preserve the journal, correct the storage problem and retry the same command. Never delete the journal to bypass startup. If JSON differs from both journal versions, recovery refuses to overwrite possible new sessions; investigate unexpected writers and restore a verified coherent full backup if needed. A replay with a different email is rejected. Filesystems must support same-directory atomic rename, hard links and file/directory fsync. Older images do not know this journal and must remain stopped until recovery completes.

Explicit ownership must identify exactly one administrator owner. With no owner markers, only a sole legacy administrator is accepted; ambiguous/multiple owners or administrators fail preflight.

To revoke the no-payment grant, use a new UUID while the candidate is stopped:

```bash
node api/scripts/bootstrap-operational-role.mjs --offline \
  --data-dir /path/to/copied-data \
  --uid '<verified-existing-sole-owner-uid>' \
  --revoke-indefinite-client \
  --reason 'operator-approved revocation' \
  --operation-id '<fresh-UUIDv4>'
```

Revocation accepts an existing sole owner marked disabled or deleted; it never grants roles, reactivates the account or permits HTTP self-assignment. Inactive accounts remain denied access. A physically absent account cannot be identified as an existing owner.

Rollback restores the verified pre-operation full data backup; do not delete rows. Old binaries fail closed on schema v6, so a rollback needs the matching prior application image and a coherent backup. `snapshot-authority.mjs` includes the new table, and owned exports include `commercial.indefiniteClientEntitlements`.

Focused validation: `cd api && node --test test/bootstrap-operational-role.test.js test/authority-service.test.js test/authority-store.test.js test/docker-authority-packaging.test.js`. This change updates the authority store/service, training/export/snapshot paths, audited bootstrap tool, browser access gate, contracts and focused tests. It contains no deployment command.
