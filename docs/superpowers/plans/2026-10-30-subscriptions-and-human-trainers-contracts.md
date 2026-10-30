# Contratos cerrados — suscripciones y entrenadores humanos

Este anexo es parte del plan técnico de 2026-10-30. Define contratos que no deben reinterpretarse por endpoint, UI o test. Identificadores existentes conservan su string literal actual; sólo entidades nuevas de este dominio usan UUID v4 generado por servidor.

## 1. Tipos, enums y límites

`ExistingAccountId` es el UID literal existente, entre 1 y 128 caracteres, sin normalización. `Uuid` es UUID v4. `IsoUtc` es ISO-8601 UTC con `Z`; `Version` es entero seguro >= 0 (0 es aggregate todavía inexistente; filas publicadas desde 1). Cadenas de motivo/referencia/nombre se recortan y validan antes de hash/auditoría.

| Nombre | Valores/límites cerrados |
|---|---|
| OperationalRole | `CLIENT`, `TRAINER`, `COORDINATOR` |
| AccountActivity | `ACTIVE`, `DISABLED`, `DELETED`, `UNKNOWN` (derivada de identidad existente; sólo `ACTIVE` permite capability) |
| InvitationState | `PENDING`, `ACCEPTED`, `REJECTED`, `REVOKED`, `EXPIRED` |
| EnrollmentState | `CHALLENGE_ISSUED`, `IDENTITY_CREATED`, `PENDING_OPERATIONAL_ROLE`, `ABORTED`, `COMPLETED` |
| RelationState | `PENDING_CONFIRMATION`, `ACTIVE`, `SUSPENDED`, `REACTIVATION_PENDING`, `ENDED` |
| GrantKind | `PLAN`, `EXECUTION`, `HISTORY`, `WEIGHT` |
| GrantState | `ACTIVE`, `REVOKED`, `EXPIRED` |
| Capability | `ACCESS_PERSONAL_TRAINING`, `MANAGE_OPERATIONAL_ROLES`, `MANAGE_COORDINATOR_SCOPE`, `CREATE_INVITATION`, `PREVIEW_INVITATION`, `ACCEPT_INVITATION`, `CONFIRM_RELATION`, `CHANGE_RELATION`, `CHANGE_GRANT`, `PUBLISH_PLAN`, `READ_CLIENT_PLAN`, `READ_OWN_EXECUTIONS`, `START_SESSION`, `FINISH_SESSION`, `READ_TRAINER_EXECUTIONS`, `CONFIRM_SUBSCRIPTION`, `READ_COMMERCIAL_CLIENTS`, `EXPORT_OWN_DATA`, `REQUEST_OWN_DELETION` |
| PeriodKind | `MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`, `CUSTOM` |
| GoalKind | `CONSISTENCY`, `BODY_WEIGHT`, `PERFORMANCE` |
| Error code | `unauthenticated`, `forbidden`, `not-entitled`, `relation-inactive`, `grant-missing`, `conflict`, `unsupported-client`, `invite-invalid`, `invite-expired`, `not-found`, `validation-error`, `policy-not-configured` |

Bounds: reason 1–280; reference 1–160; commercial name 1–120; invitation token 32 random bytes base64url and only SHA-256 persisted; invitation TTL exactly 7 days; `operationId`/new domain ID UUID v4; pagination 1–100 (default 25). A foreign relation/portfolio always returns `404 { error: 'not found', code: 'not-found', requestId }`.

## 2. Minimal wire DTOs

All mutation bodies are `{ operationId: Uuid, expectedVersion: Version, payload: T }`, except passkey protocol messages that retain their existing challenge format. Actor IDs never appear in client payloads; server derives them from `readSession`.

```ts
type AccessSnapshot = {
  account: { id: ExistingAccountId, activity: AccountActivity },
  managedSubscriptions: boolean,
  roles: OperationalRole[],
  entitlement: { active: boolean, startUtc: IsoUtc|null, endExclusiveUtc: IsoUtc|null, version: Version },
  capabilities: Capability[],
  compatibility: { protectedTraining: 'supported'|'unsupported' },
  requestId: string,
  versionTokens: { kind: string, key: string, version: Version }[] // only authorized own collections
}
type InvitePreviewInput = { token: string }
type InvitationCreate = { knownClientId?: ExistingAccountId, commercialName: string, grants: GrantInput[] }
type GrantInput = { kind: 'PLAN'|'EXECUTION'|'WEIGHT', startUtc?: IsoUtc, endExclusiveUtc?: IsoUtc } | { kind: 'HISTORY', startUtc: IsoUtc, endExclusiveUtc: IsoUtc, includeWeight?: boolean }
type RelationChange = { relationId: Uuid, reason: string }
type GrantReplace = { relationId: Uuid, grants: GrantInput[] }
type CommercialOperation = { clientId: ExistingAccountId, kind: PeriodKind, customStartPanama?: string, customEndPanamaInclusive?: string, reference: string, reason: string }
type Load = { kind: 'EXTERNAL'|'ASSISTANCE', kg: number } | { kind: 'BODY_WEIGHT' }
type GoalInput = { label: string, dueDatePanama?: string } & (
  { kind: 'CONSISTENCY', targetSessionsPerWeek: number } |
  { kind: 'BODY_WEIGHT', targetWeight: number, unit: 'KG'|'LB' } |
  { kind: 'PERFORMANCE', exerciseId: string, targetLoad: Load, targetReps: number }
)
type PlanTarget = { load?: Load, reps?: { exact: number }|{ min: number, max: number }, effort?: { kind: 'RIR'|'RPE', value: number }, seconds?: number }
type PlanExercise = { entryId?: Uuid, exerciseId: string, mode: 'reps'|'time', sets: number, restSeconds?: number, commonTarget: PlanTarget, setOverrides: Record<string, PlanTarget> }
type PublishPlan = { relationId: Uuid, exercises: PlanExercise[], goalVersionId?: Uuid }
type SessionStart = { planVersionId: Uuid }
type SessionExecution = { sessionId: Uuid, entries: ExecutionEntry[] }
type ExecutionEntry = { planEntryId?: Uuid, exerciseId: string, disposition: 'PERFORMED'|'OMITTED'|'SUBSTITUTED'|'ADDED', sets: ExecutionSet[] }
type ExecutionSet = { phase: 'warmup'|'work', load?: Load, reps?: number, seconds?: number, effort?: { kind: 'RIR'|'RPE', value: number }, completed: boolean, failure?: boolean }
type VersionToken = { kind: string, key: string, version: Version }
type MutationReceipt<T> = { operationId: Uuid, entity: { type: string, id: string, version: Version }, versionTokens: VersionToken[], result: T, requestId: string }
type HistoryGrantInput = { kind: 'HISTORY', startUtc: IsoUtc, endExclusiveUtc: IsoUtc, includeWeight?: boolean }
type BodyweightInput = { weight: number, unit: 'KG'|'LB', reportedDatePanama: string }
```

`AccessSnapshot` has no `scope`, relation ID, trainer/client list, grant list or admin history. Those arrive only from scoped endpoints. `entitlement.active` is server-derived at read time and not a client claim.

## 3. Routes, responses and actors

All listed routes are literal except the export download regex limited to UUID v4. All mutation successes are readbacks after commit and include `requestId`.

| Route | Body/result | Server authorization |
|---|---|---|
| `GET /api/access` | `AccessSnapshot` | authenticated own session |
| `GET /api/admin/operations/users` | identity/role/version metadata for authorized role management; no activity/health | existing active admin; no personal-history fallback |
| `POST /api/admin/operations/roles` | envelope `{accountId, roles, reason}` → snapshot | existing admin, active, non-self, versioned account-role aggregate |
| `POST /api/admin/operations/scopes` | envelope `{coordinatorId, clientId, assigned, reason}` | existing admin, active, non-self, no global scope |
| `POST /api/trainer/invitations` | envelope `InvitationCreate` → `{inviteId,token,expiresAt}` | active trainer; token once only |
| `POST /api/invitations/preview` | `{token}` → minimum trainer/purpose/categories | public minimum; token valid; never consumes |
| existing `POST /api/register/options`, `/verify`, and conditional `/password` | existing body plus invite enrollment binding | invite alternative only; existing password flag unchanged |
| `POST /api/invitations/accept` | envelope `{token, grants}` → relation state | authenticated active identity; client consent; only consumer |
| `POST /api/invitations/reject` | envelope `{token}` | authenticated prospective client; terminal, no relation |
| `POST /api/trainer/invitations/revoke` | envelope `{invitationId,reason}` | issuing active trainer |
| `POST /api/trainer/relations/confirm` | envelope `{relationId}` | issuing trainer; pending only |
| `POST /api/client/relations/revoke` | envelope `RelationChange` | client subject |
| `POST /api/trainer/relations/suspend`, `/end`, `/reactivate-request` | envelope `RelationChange` | responsible trainer |
| `POST /api/client/relations/reactivate-accept` | envelope `RelationChange` | client subject, request pending |
| `POST /api/admin/relations/suspend`, `/end`, `/reactivate-request` | envelope `RelationChange` | existing admin; explicit route and reason |
| `POST /api/client/relations/grants/replace`, `/revoke` | envelope `GrantReplace` / `{relationId,kind,reason}` | client subject |
| `GET /api/trainer/portfolio` | paginated minimum cards | trainer, own active relation, client entitled |
| `GET /api/trainer/relations` | own relationship-management metadata only: id/state/version, consenting client alias | active trainer; includes own suspended/pending/ended relations without training/weight/activity and never grants functional reads of expired clients |
| `POST /api/admin/commercial/operations/confirm` | envelope `CommercialOperation` → entitlement readback | active scoped coordinator, other client |
| `GET /api/admin/commercial/clients` | paginated commercial minimum | active scoped coordinator; never training |
| `POST /api/trainer/plans/publish` | envelope `PublishPlan` → plan version | trainer, own active relation, PLAN grant, client entitled |
| `POST /api/trainer/goals/publish` | envelope `{relationId,goals:GoalInput[]}` → goal version | same PLAN authority; goals optional |
| `GET /api/client/plan/current` | own current plan/goal refs | client + entitlement |
| `GET /api/client/executions` | own unified personal projection, paginated | client + entitlement; includes own shared actuals after trainer relation/grant ends |
| `POST /api/client/sessions/start`, `/finish` | envelopes `SessionStart`/`SessionExecution` | client + entitlement + own assigned plan/session |
| `GET /api/trainer/executions` | paginated projection | trainer + EXECUTION grant + active relation + entitlement + matching window |
| `GET /api/trainer/history?relationId=&grantId=&cursor=` | immutable allowlisted historical share | responsible trainer + explicit active HISTORY grant/range + relation + client entitled; no raw profile |
| `POST /api/client/bodyweight` | envelope `BodyweightInput` → own immutable measurement | CLIENT + own entitlement; actor is owner, server timestamps receipt |
| `GET /api/client/bodyweight` | own merged projection | CLIENT + own entitlement; own export remains allowed expired |
| `GET /api/trainer/bodyweight?relationId=&cursor=` | minimum shared measurement projection | responsible trainer + active WEIGHT grant + relation + client entitled + measurement in authorized window |
| `POST /api/client/exports`, `GET /api/client/exports/{uuid}` | own export job/download | own authenticated session; no entitlement needed |
| `POST /api/client/deletion-requests` | audited request | own authenticated session; no destructive delete |

`426 unsupported-client` is limited to protected resources after authorization would otherwise proceed. Auth, recovery, access, acceptance, renewal, export and deletion request remain usable. `410 invite-expired` is used only for a known expired token; public invalid/revoked/not-found token is the same minimum `invite-invalid` response.

### 3.1 Invitación preidentificada y alta recuperable

`knownClientId`, si está presente, se compara por igualdad literal con el UID autenticado en accept/reject y con el UID ligado al challenge al confirmar alta. No permite crear otro UID, transferir cuenta ni reemplazar la identidad destinataria; una cuenta existente usa login/recuperación, no un nuevo registro para el mismo UID. Token reenviado a un UID diferente devuelve `invite-invalid` sin nombre, existencia, UID ni estado de la cuenta esperada. Preview nunca incluye knownClientId, nombre del cliente ni flags de existencia. Una invitación sin target puede reservar una nueva identidad; no confundirla con una invitación preidentificada.

Antes de persistir passkey/identidad, enrollment reserva bajo transacción SQLite el UID/challenge/invitación válidos; revalida target, revocación, caducidad y consumo. Publicar identidad en db.json y completar enrollment no es atómico entre archivos: si falla antes del archivo, retry usa la reserva existente; si el archivo quedó guardado, login con esa credencial recupera el enrollment del mismo UID, nunca crea una segunda identidad ni concede roles, vínculo o vigencia. Un challenge perdido exige nuevo challenge para la misma reserva/identidad comprobada; no permite apropiarse de una cuenta por poseer el enlace. Sólo accept con sesión y consentimiento consume la invitación. Vencimiento/revocación antes de accept no borra la identidad creada, pero impide activar vínculo/acceso. El administrador ve la cuenta pendiente de rol con siguiente acción explícita; no hay éxito de entrenamiento mientras falten rol/vigencia/confirmación.

## 4. SQLite authority schema and aggregate versions

`authority_meta(schema_version, authority_version, updated_at_utc)` starts at schema 1. Tables use UUID primary keys for new entities, `ExistingAccountId` for existing people, ISO UTC timestamps, `version INTEGER NOT NULL CHECK(version>=1)`, restrictive FKs and enum checks.

* `account_roles(account_id, role, granted_at_utc, granted_by, revoked_at_utc, reason, version)`; unique active `(account_id, role)`.
* `coordinator_scopes(id, coordinator_id, client_id, active, reason, created_by, version)`; one active pair.
* `invitations(id, trainer_id, known_client_id NULL, commercial_name, token_hash UNIQUE, state, expires_at_utc, accepted_by NULL, consumed_at_utc NULL, version)`.
* `enrollments(id, invitation_id, uid, challenge_hash, state, consented_at_utc NULL, created_at_utc, updated_at_utc, version)`; unique `(invitation_id,uid)` and unique active challenge; no credential secret/token plaintext.
* `relations(id, trainer_id, client_id, invitation_id UNIQUE, state, accepted_at_utc, confirmed_at_utc NULL, ended_at_utc NULL, version)`; unique active client using partial index. `accepted_at_utc` is eligibility cut, not permission by itself.
* `relation_access_windows(id, relation_id, eligible_from_utc, enabled_from_utc, ended_at_utc NULL, reason, version)`: immutable closed rows plus one active window. Initial `eligible_from_utc=accepted_at`; `enabled_from_utc=confirmed_at`; reactivation creates a new row with both at its new acceptance/activation. No timestamp is overwritten.
* `relation_grants(id, relation_id, kind, state, window_start_utc, window_end_exclusive_utc NULL, granted_by, revoked_at_utc NULL, version)`: append-only history; at most one active grant of kind/window boundary identity, not `UNIQUE(relation_id,kind)`.
* `subscription_intervals(id, client_id, start_utc, end_exclusive_utc, anchor_day, kind, reference, reason, created_by, created_at_utc, version)` and `commercial_operations(operation_id UNIQUE, actor_id, client_id, payload_hash, expected_subscription_version, result_interval_id, created_at_utc)`.
* `goal_versions(id, relation_id, version_number, payload_json, payload_sha256, created_by, created_at_utc, version)` unique `(relation_id,version_number)`.
* `plan_versions(id, relation_id, version_number, goal_version_id NULL, payload_json, payload_sha256, created_by, published_at_utc, version)` unique `(relation_id,version_number)`.
* `client_sessions(id, client_id, relation_id, plan_version_id, goal_version_id NULL, access_window_id, server_started_at_utc, snapshot_json, state CHECK(state IN ('OPEN','FINISHED')), finished_at_utc NULL, version)`.
* `session_executions(id, session_id UNIQUE, client_id, payload_json, payload_sha256, operation_id UNIQUE, submitted_at_utc, version)`.
* `export_jobs(id, account_id, state, path, created_at_utc, expires_at_utc NULL, version)`; expiry is a configured operational value only when policy exists.
* `deletion_requests(id, account_id, requested_at_utc, state CHECK(state='REQUESTED'), version)`.
* `authority_audit(id, actor_id, subject_id, entity_type, entity_id, before_json, after_json, reason NULL, reference NULL, occurred_at_utc, request_id)`.
* `aggregate_versions(kind, aggregate_key, version INTEGER NOT NULL CHECK(version>=0), PRIMARY KEY(kind,aggregate_key))`: el token por aggregate se conserva incluso si su conjunto de filas está vacío. Ausencia equivale a 0 para la primera creación.
* `mutation_results(operation_id PRIMARY KEY, actor_id, capability, subject_id, aggregate_kind, aggregate_key, payload_sha256, result_entity_type, result_entity_id, result_version, result_metadata_json, committed_at_utc)`: ledger durable común a TODAS las mutaciones, no sólo renovación/finish. Sin token plaintext, datos de salud o perfiles completos. Los ledgers específicos comercial/finish enlazan al mismo registro y se escriben en la misma transacción.
* `bodyweight_entries(id, client_id, weight, unit, reported_date_panama, received_at_utc, operation_id UNIQUE, version)`: medición propia explícitamente publicada mediante POST /api/client/bodyweight, fuente SQLite única, sin dual-write al JSON. Se conserva al terminar vínculo y entra en export del dueño.
* `history_shares(id, client_id, relation_id, grant_id, from_utc, to_exclusive_utc, source_personal_rev, source_personal_wid, source_sqlite_version, projection_json, projection_sha256, published_at_utc, operation_id UNIQUE, version)`: snapshot histórico allowlisted e inmutable autorizado por el cliente; FK a grant/relación, sin prescripción anterior privada ni perfil completo.

An active relation is unique per client. A relation end/suspension closes current grants/windows in the same transaction but does not delete their historical rows. Reactivation creates no active grant: the client must explicitly replace/grant categories after accepting it. A session/execution references its exact plan, goal and window. `authority_version` is a change cursor only, never an optimistic-lock substitute.

### 4.1 Fuente histórica y de peso, consentimiento y proyecciones

HISTORY siempre exige ambos límites UTC, `start < end`, intervalo de datos anterior al instante del consentimiento y confirmación explícita de publicar ese rango en el formulario de grants. La mutación grant replace que añade HISTORY captura una proyección inmutable desde dos fuentes NOMBRADAS del mismo cliente: `readState(clientId).workouts` del JSON personal legado y `session_executions` SQLite propias (incluidas las de relaciones anteriores). No devuelve state ni abre una carpeta/ruta suministrada por el solicitante. La extracción toma sólo reported date, exercise id y sets reales (reps/load/time/effort/failure); excluye notas personales, fotos/media, targets, versiones/snapshots privados de otro entrenador y registros de terceros. Filtra el rango y deduplica por `(sourceKind, sourceRecordId)`; los registros JSON sin identificador reciben ID de snapshot generado por servidor ligado a índice/revisión, no se mezclan por nombre.

Antes de comenzar el commit toma snapshot de estado/rev/wid legado; dentro de la transacción revalida identidad/grant/relación y que rev/wid sigan iguales. Si cambió, devuelve conflicto y exige revisar la nueva previsualización, sin publicar parte. Las filas SQLite se leen dentro de esa misma transacción. La API usa un único proceso escritor del JSON; no afirmar atomicidad entre bases ni soportar un escritor externo no coordinado. El snapshot publicado lleva fuente y fecha del servidor; fechas de actividad JSON son OWNER_REPORTED, nunca prueba de que existió antes del vencimiento. Una edición posterior del JSON no actualiza automáticamente el share. Otorgar un HISTORY nuevo es consentimiento adicional explícito para ese rango; relación/renovación/ejecución ordinaria jamás lo generan ni incluyen intervalos privados automáticamente.

`GET /api/trainer/history` revalida relación activa, cliente vigente y grant HISTORY vigente y devuelve sólo ese share con paginación; revocar/reemplazar grant corta inmediatamente todos sus shares anteriores, sin borrar originales. El dueño conserva acceso/export a sus datos aunque el share se retire. Un grant sin share completado devuelve vacío/estado pendiente, no acceso al state.

WEIGHT tiene productor explícito `POST /api/client/bodyweight` (cliente vigente, UID de sesión, medición validada) y lector trainer bodyweight separado. `GET /api/trainer/bodyweight` sólo proyecta `bodyweight_entries` recibidas por el servidor dentro de una ventana compartida y grant WEIGHT vigentes, con cliente vigente; las fechas reportadas no abren intervalos. El peso legado permanece privado; compartir peso anterior requiere publicación histórica explícita y ambos grants HISTORY + WEIGHT. Al incluir peso en HISTORY, el snapshot toma además `readState(clientId).bodyweight` y bodyweight_entries SQLite propias, únicamente si includeWeight=true fue confirmado y hay grant WEIGHT vigente. Añade sólo fecha/valor/unidad bajo esa categoría, sin otras medidas. Cada fila del share tiene discriminante WORKOUT o BODY_WEIGHT y clave de fuente, para filtrar por grants actuales al leer; no se guarda el state original como snapshot. Revocar WEIGHT oculta también el peso en shares históricos aunque HISTORY continúe; revocar HISTORY retira el share sin cancelar el peso nuevo autorizado. `GET /api/client/bodyweight` combina sus medidas privadas legadas y SQLite con claves de fuente, sin copiar ni dual-write; export propio incluye ambas fuentes. Reactivar crea ventana/grants nuevos y no backfill automático.

### 4.2 Versiones por aggregate y respuestas de lectura

La clave se construye por servidor como JSON canónico de una tupla, nunca por concatenación libre ni por un número recibido como claim. Aggregates: ROLES `[accountId]`; SCOPE `[coordinatorId,clientId]`; INVITE_SET `[trainerId]` para creación; INVITATION `[invitationId]` para accept/reject/revoke; RELATION `[relationId]` para lifecycle Y grants; SUBSCRIPTION `[clientId]`; PLAN_SET `[relationId]`; GOAL_SET `[relationId]`; SESSION_SET `[clientId]` para start; SESSION `[sessionId]` para finish; BODYWEIGHT_SET `[clientId]`; EXPORT_SET `[clientId]`; DELETION_REQUEST_SET `[clientId]`. `expectedVersion=0` es válido sólo si el aggregate no existe; creación incrementa a 1, luego cada commit semántico incrementa exactamente el aggregate afectado. Roles y scopes no derivan versión del máximo de filas; grants comparten versión de relación para no publicar sobre lifecycle obsoleto.

Una mutación que afecta varios aggregates (accept crea relación/grants, start crea sesión) comprueba el token del aggregate primario, bloquea con BEGIN IMMEDIATE y publica las versiones dependientes en la misma transacción. No se permite usar el cursor global `authority_version` como sustituto. Las lecturas mínimas devuelven `{versionTokens:[{kind,key,version}]}` sólo para objetos que el actor está autorizado a modificar: metadata admin de identidad/roles/scopes, tarjetas comerciales para SUBSCRIPTION, metadata trainer relations para RELATION/PLAN_SET/GOAL_SET, plan propio para SESSION_SET y respuesta start para SESSION. `GET /api/access` devuelve sólo sus tokens de colección propia y su versión de suscripción; no cartera/scopes ajenos. Preview válido puede devolver versión de INVITATION sin target UID. Cada respuesta de mutación incluye los tokens nuevos y un readback, evitando que el frontend invente versiones.

## 5. Capability, idempotency, time and validation

Service operations call `store.transaction({actorId,requestId}, tx => { ... })`, which uses `BEGIN IMMEDIATE`. The service executes `requireCapabilityTx` for current authority before replay lookup and before domain read/write; it compares expected aggregate version and transition preconditions only for a fresh operation, as specified below. It uses the current identity adapter and tx SQLite state. On denial it rolls back; success writes domain rows, audit and meta version together. Responses read back committed aggregates.

El contrato común de servicio es `mutateAuthority({ actorId, capability, subjectId, aggregateKind, aggregateKey, operationId, expectedVersion, payload, requestId }, applyTx)`. Sólo el adaptador autenticado construye actor/capability/subject/key; el payload no los concede. Dentro de BEGIN IMMEDIATE valida identidad y autoridad ACTUALES (sin comparar todavía expectedVersion ni exigir el estado previo de una operación ya terminada), busca mutation_results y compara actor, subject, capability y hash canónico del payload validado. Si es replay del mismo intento, revalida permiso actual para ver el recibo y reconstruye resultado desde referencias; si la política actual ya deniega datos no devuelve contenido revocado. El token esperado original no impide reconocer replay. Un tuple diferente no devuelve recibo ajeno y responde conflicto/not-found uniforme según alcance. Para un intento nuevo, compara aggregate_versions con expectedVersion, exige precondiciones de transición y aplica dominio+versions+ledger+audit en la MISMA transacción; failpoint anterior a commit deja cero cambios, failpoint después se recupera por el ledger. Resultado se confirma por readback.

Roles, scopes, creación/aceptación/rechazo/revocación de invitación, lifecycle, grants, planes, metas, sesiones, peso, export y deletion request usan este ledger; no basta tener ledger comercial. El bootstrap offline se audita con operationId explícito y el mismo mecanismo, con autoridad excepcional documentada. Las operaciones de protocolo passkey siguen el enrollment recuperable, no se finge una transacción distribuida. Los recibos no almacenan salud ni secretos: creación de invitación persistirá sólo ID/expiry/version; token se entrega una única vez desde memoria. Si se perdió esa primera respuesta, replay devuelve metadata con `tokenUnavailable:true`, no recrea ni persiste el token; UI ofrece reemplazar la invitación (nuevo operationId y revocación atómica de la anterior). Un cliente no recibe éxito utilizable de enlace sin token. Para finish/publish el recibo referencia versión/ejecución inmutable y su lectura vuelve a proyectar campos según permiso actual.

Prueba concurrente obligatoria con dos conexiones `DatabaseSync` REALES a la misma SQLite: dos procesos coordinados por barrera leen el mismo SUBSCRIPTION version, el primero confirma y el segundo, con operationId distinto, recibe conflicto al adquirir el lock; se asertan un solo periodo nuevo, un solo recibo y un solo evento de éxito. Replays del mismo ID por actor diferente, scope revocado o cuenta deshabilitada no devuelven resultado. Grant retirado entre inicio y finish impide commit y no deja auditoría de éxito. Las pruebas se parametrizan para CADA familia de mutación, incluyendo roles y grants, no sólo comercial/finish. Una nueva compra legítima exige refresco y reconfirmación con ID nuevo, no retry silencioso.

Panama has UTC−05:00. UI start date means `00:00:00` Panama; UI inclusive end means next Panama midnight as exclusive UTC. Literal tests include: `2026-10-30` start → `2026-10-30T05:00:00.000Z`; end inclusive `2026-10-30` → `2026-10-31T05:00:00.000Z`; `2028-02-29` → `2028-03-01T05:00:00.000Z`; Jan-31 monthly `2027-01-31T05:00:00.000Z` ends `2027-03-01T05:00:00.000Z`; next anchored monthly interval starts `2027-03-01T05:00:00.000Z` and ends `2027-04-01T05:00:00.000Z`. Tests hard-code these expected strings independently. Active renewal starts at existing exclusive end; expired activation starts at server-derived Panama day; custom period needs reason and `end > start`.

Plans/executions allow at most 40 exercises and 50 sets/exercise. A plan `reps` target has exactly one reps form (`exact` or `min`/`max`, integral 1–1000 and min ≤ max); a `time` target has seconds integral 1–21600 and no reps/effort. `setOverrides` keys are decimal set indices `0`–`49`; unknown keys are rejected. External/assistance load kg is finite 0–2000; BODY_WEIGHT omits kg and missing load is not zero. Execution effort is exactly one of RIR 0–10 or RPE 6–10 in increments of 0.5 (source `history.js:EFFORT`); warmups cannot have effort/failure; no unknown keys, NaN, infinity, mixed modes or unrecognized exercise IDs. The implementation extracts/tests the same semantic constants as `frontend/src/lib/log-workout.js` (`LOG_LIMITS`) and `frontend/src/lib/history.js` (`EFFORT`) so accepted source validation is reused rather than deferred. Goal label is 1–120; CONSISTENCY requires `targetSessionsPerWeek` integer 1–365; BODY_WEIGHT requires finite `targetWeight` 1–500 plus KG/LB; PERFORMANCE requires recognized `exerciseId`, explicit `targetLoad` and integer `targetReps` 1–1000, never a scalar-only target. BodyweightInput weight uses the same bounds, reports a valid Panama calendar date not in the server's future and is tagged OWNER_REPORTED for the activity date; server receipt time remains authoritative for sharing. Goals do not cause automatic progression. Plan `sets` is integral 1–50; override indices must be less than sets; restSeconds is integral 0–21600. Published `entryId` is server-assigned/preserved within that version, not inferred from exerciseId (the same exercise may appear twice). PERFORMED/OMITTED/SUBSTITUTED must reference an entry in the exact session snapshot; PERFORMED/OMITTED retain its exerciseId, SUBSTITUTED names a different recognized exercise while preserving planEntryId, ADDED omits planEntryId. OMITTED has no performed sets; failure is optional boolean only on working sets. Missing effort is not inferred from failure, and source display/conversion semantics are preserved; actual values never rewrite targets.

## 6. Managed route guard and client behavior

When `MANAGED_SUBSCRIPTIONS=1`, the server must run `ACCESS_PERSONAL_TRAINING` for all legacy personal training route families: data GET/PUT/rev, media read/write/missing/sweep, nudge-check, functional Coach, and push subscribe/status/test/rest-timer/cancel. Required state is active identity + active `CLIENT` role + current entitlement. New shared routes retain their additional relation/grant/scope checks. Safe exceptions are exactly auth/recovery/config/access/invitation enrollment+acceptance, commercial renewal/readback, own export/deletion request, authenticated withdrawal of OWN relationship/category consent and separate authorized role backoffice. Consent withdrawal needs current owner identity, not renewed subscription; adding/replacing grants to share NEW data still requires the normal relationship, role and entitlement policy. Broad admin health/history and trainer/client data fall through to deny/redact, not an exception.

The web gate does not authorize the server. It blocks shell, Workout, protected sync and protected cache until an online `AccessSnapshot` is allowed; older version signals can cause 426 but cannot relax server checks. Client drafts are local isolated data keyed by account/session/plan and require explicit recovery. A client owns its SQLite actuals for personal history/export after trainer access stops; trainer visibility still evaluates current relation, grant, entitlement and the record’s historical access window.
