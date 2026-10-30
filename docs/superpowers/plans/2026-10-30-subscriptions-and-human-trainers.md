# Plan técnico corregido — suscripciones y entrenadores humanos

**Estado:** plan técnico para revisión de John. No autoriza implementación, instalación, build, SSH, despliegue ni cambios de roles reales. Los commits de implementación descritos son futuros; la documentación sí puede publicarse bajo el flujo vigente. La especificación aprobada en `../specs/2026-10-30-subscriptions-and-human-trainers-design.md` no se modifica ni se reabre.

## 1. Resultado, límites y decisiones de seguridad

El primer corte añade una autoridad SQLite para suscripción, relación, prescripción y ejecución compartida. SQLite es la única autoridad de planes, sesiones y ejecuciones compartidas; `db.json` y el estado personal conservan únicamente actividad personal no compartida. No hay dual-write ni promesa de atomicidad entre SQLite y `db.json`.

`MANAGED_SUBSCRIPTIONS` es una variable de servidor, con valor por defecto `0`. En `0` se conserva el comportamiento upstream de rutas personales. En `1`, el servidor exige cuenta activa, rol `CLIENT` y entitlement vigente para todo uso personal de entrenamiento, incluso en rutas antiguas; una cabecera de versión solamente negocia compatibilidad y nunca concede acceso. El objetivo de producción es `1` únicamente para el target/grupo autorizado después de las puertas de §14. No se promete DRM ni retirada de bytes ya descargados.

Se mantienen los límites aprobados: no pasarela, cancelación, devolución, biblioteca de plantillas, progreso automático, coordinador global, migración de autenticación automática, borrado automático, ni retención inventada. La eliminación administrada en modo gestionado es **solicitud y fallo cerrado** hasta que haya una política aprobada: no se permite un borrado destructivo que requiera una saga. En modo legado no se cambia la eliminación existente.

Los contratos cerrados que consumen todas las tareas están en el [anexo de contratos](2026-10-30-subscriptions-and-human-trainers-contracts.md). Ninguna tarea interpreta esos campos por su cuenta.

## 1.1 Ciclo verificable obligatorio por tarea

Cada tarea se ejecuta como unidad revisable y no se marca terminada por crear un módulo. Aplicar estos pasos a los casos/contratos que la tarea nombra:

- [ ] Escribir primero los tests unit/API/browser/ops propios, con las aserciones del anexo y fixtures aislados.
- [ ] Ejecutar su comando focalizado y registrar RED por la ausencia del comportamiento que se va a implementar; si es cobertura de código ya correcto, declararlo cobertura y no inventar RED.
- [ ] Implementar sólo los archivos y contratos de la tarea, sin tocar archivos de otro dueño en paralelo.
- [ ] Ejecutar de nuevo el comando, observar GREEN real, hacer refactor sin cambiar contrato y repetir las regresiones afectadas.
- [ ] En tareas con UI, completar editar → guardar → readback → recargar → comprobar efecto posterior y fallo con borrador preservado. Backend/API aislado no equivale a navegador real.
- [ ] Revisión de requisito/seguridad del corte, actualizar matriz con salida real y crear commit descriptivo + push/remoto verificado sólo cuando la ejecución se autorice. No sumar pruebas PLANNED como ejecutadas.

## 2. Orden, dependencias y propiedad exclusiva

Una sola persona implementadora es dueña de cada modificación de `api/server.js`; las tareas que lo citan se hacen secuencialmente en el orden listado. La revisión independiente verifica contratos y evidencia, no altera la propiedad del archivo. Los commits nombrados abajo son futuros y sólo se crean tras una autorización de implementación.

| Orden | Tarea dueña | Depende de | Archivos principales | Salida verificable futura |
|---:|---|---|---|---|
| 0 | Runtime y dependencia browser | autorización de implementación | `frontend/package.json`, `frontend/package-lock.json`, `frontend/playwright.config.js` | lock reproducible y descubrimiento Playwright |
| 1 | Contrato, SQLite e identidad | 0 para la parte browser; ninguna para API | `api/authority-contract.js`, `api/authority-store.js`, `api/identity-authority.js` | migración y adaptador fail-closed |
| 2 | Bootstrap offline, roles, scopes y capability | 1 | `api/authority-service.js`, `api/server.js` | `AccessSnapshot`, roles/scopes actuales |
| 3 | Invitación, inscripción y relación | 1–2 | `api/authority-service.js`, `api/server.js`, login | enlace seguro, registro invite-only, lifecycle |
| 4 | Suscripción y calendario | 1–2 | contrato, servicio, servidor | intervalo transaccional e idempotente |
| 5 | Prescripción, metas y ejecución | 1–4 | contrato, store, servicio, servidor | sesiones/actuals sólo SQLite |
| 6 | Frontera gestionada del legado | 2, 4–5 | `api/server.js`, Coach/push tests | denylist completa en modo `1` |
| 7 | Exportación propia y solicitud de eliminación | 1, 5–6 | `api/authority-export.js`, servidor | export propio incluso vencido |
| 8 | Web/PWA y journeys | 3–7 | `App.jsx`, `Workout.jsx`, store, SW, vistas | shell y sincronización gobernados por access |
| 9 | Harness browser real | 0, 3–8 | `frontend/e2e/*` | Chromium desktop/móvil contra API/web reales |
| 10 | Backup/restauración operativa | 1, 5 | API snapshot + repo operativo | protocolo único y restore aislado |
| 11 | OpenAPI, trazabilidad y release gates | 0–10 | OpenAPI, runbook, docs | matriz archivo→test y gates honestos |

## 3. Tarea 0 — runtime y dependencia browser (futura; no ejecutar ahora)

**Archivos:** modificar `frontend/package.json`, `frontend/package-lock.json`; crear `frontend/playwright.config.js`; modificar el script `test:e2e` en `frontend/package.json`.

Después de autorización de implementación, añadir **exactamente** `@playwright/test@1.64.1` como `devDependency` y regenerar el lock con `cd frontend && npm install --save-dev --save-exact @playwright/test@1.64.1`. Revisar ambos diffs; luego usar `cd frontend && npm ci` para las ejecuciones reproducibles. Instalar Chromium para el entorno de prueba con `cd frontend && npx playwright install chromium`, nunca como parte de esta planificación. Definir `test:e2e` como `playwright test`, `baseURL` local, proyectos Chromium desktop y móvil, artefactos de fallo y prohibición de `page.route`/mocks de `fetch` en esta suite.

La puerta de runtime de la imagen candidata debe ejecutar Node **22.23.4**: cargar `node:sqlite`, abrir/migrar una base temporal y ejecutar su backup integrado. Node 22.23.0 ya ofrece `DatabaseSync` y `sqlite.backup` como experimentales, pero no sustituye esta puerta de la imagen futura. El API no añade dependencias npm SQLite. Pruebas planificadas: `npx playwright test --list`, prueba de import de `node:sqlite` y backup en el contenedor candidato. Commit futuro: `test: add pinned browser harness`.

## 4. Tarea 1 — contrato, almacén e identidad activa

**Archivos:** crear `api/authority-contract.js`, `api/authority-store.js`, `api/identity-authority.js`, `api/test/authority-store.test.js`, `api/test/authority-contract.test.js`; modificar `api/Dockerfile` sólo al copiar archivos ya creados.

Implementar exactamente el esquema, DTOs, enums, límites, versiones y rutas del anexo §§1–5, incluidas sus secciones 3.1, 4.1 y 4.2. Crear aggregate_versions y mutation_results para todas las familias, bodyweight_entries y history_shares; no simular una versión de colección con el máximo de filas. `authority.sqlite` contiene toda autoridad compartida; `authority-store` sólo maneja SQLite, migraciones, backup y repositorios. La política vive en el servicio, no en el store. Abrir con `DatabaseSync`, `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=FULL`; migrar dentro de transacción y rechazar esquema futuro.

`identity-authority` adapta el UID literal existente y su estado actual de `db.json` a `{ uid, active }`. Cada capability y cada replay leen esa fuente antes de permitir acción: desconocido, `disabled` o borrado equivale a denegación, aunque quede una fila SQLite. El arranque falla cerrado en modo gestionado si no puede abrir/migrar autoridad o inicializar el adaptador. No se reclama una FK imposible entre archivos.

Pruebas futuras: migración, FKs/checks, dos ventanas disjuntas, grant histórico revocado/reconcedido, rollback de dominio/auditoría/versión juntos, identidad desconocida/deshabilitada, y `sqlite.backup` sin `-wal`/`-shm`. Ejecutar después de implementación: `cd api && node --test test/authority-contract.test.js test/authority-store.test.js`.

## 5. Tarea 2 — bootstrap, roles, scopes y capability transaccional

**Archivos:** crear `api/scripts/bootstrap-operational-role.mjs`; modificar `api/authority-service.js`, `api/server.js`, `api/Dockerfile`, `api/test/authority-routes.test.js`, `api/test/authority-identity.test.js`.

La ruta ordinaria de roles/scopes exige administrador existente, motivo de 1–280 caracteres, versión del aggregate y nunca admite autoedición. `isAdmin` existente abre sólo la gestión operativa; no satisface `TRAINER`, `COORDINATOR`, relación, grant ni entitlement. Las rutas administrativas generales de historial/peso quedan denegadas o redactadas en modo gestionado hasta una política explícita; no son fallback de cliente ni entrenador.

Para la provisión inicial aprobada, planear el CLI offline `bootstrap-operational-role.mjs --uid <uid-existente> --roles ... --reason ...`. Antes de escribir verifica mediante la semántica actual que el UID literal existe y es propietario existente, exige motivo, realiza preflight y snapshot de `authority.sqlite`, y audita actor `offline-owner:<uid>`. No acepta contraseñas, tokens, UID nuevo ni una API; no se ejecuta por el arranque y su ejecución queda como gate separado. Puede asignar roles/scope iniciales a ese propietario según el diseño aprobado, sin crear un privilegio global ni exigir un segundo administrador. Un segundo administrador es posible como decisión operativa, no requisito.

Crear `requireCapabilityTx(tx, { actorId, subjectId, capability, relationId?, grantKind?, expectedVersion? })`. Dentro del mismo `BEGIN IMMEDIATE`, revalida identidad activa, roles, scope, relación, grant, ventana y entitlement presentes. Usar mutateAuthority del anexo §5 para TODAS las mutaciones; para replay comprobar autoridad actual antes de recuperar recibo y no comparar primero expectedVersion ni precondiciones que el propio commit ya cambió; el store aporta lecturas y commits, no autoriza. `expectedVersion` se compara con el aggregate listado en el anexo, no con una versión global. `GET /api/access` devuelve el `AccessSnapshot` mínimo derivado de servidor y no claims, carteras o scopes ajenos.

Pruebas futuras: `every_mutation_family_persists_one_replay_receipt_and_aggregate_version`, `empty_role_set_and_missing_subscription_have_version_zero`, `same_invite_create_replay_never_persists_or_returns_lost_plaintext_token`, `two_real_sqlite_connections_same_subscription_version_one_commits`, `scope_revoked_before_same_operation_replay_denies_result`, sesión abierta tras retirada, admin sin coordinator, coordinator sin scope, autoasignación, owner bootstrap válido/UID no-owner rechazado, identidad deshabilitada, y rutas administrativas sin fallback. Ejecutar: `cd api && node --test test/authority-routes.test.js test/authority-identity.test.js test/server-first-user-admin.test.js test/server-admin-state.test.js`.

## 6. Tarea 3 — invitación, inscripción recuperable y lifecycle

**Archivos:** modificar `api/authority-contract.js`, `api/authority-store.js`, `api/authority-service.js`, `api/server.js`, `api/test/authority-routes.test.js`, `frontend/src/App.jsx`, `frontend/src/views/Login.jsx`; crear pruebas de login/vista que correspondan.

La previsualización es `POST /api/invitations/preview` con `{ token }`, nunca GET/query. El router obtiene sólo el fragmento `#invite=<token>`, lo elimina inmediatamente mediante `history.replaceState`, lo mantiene únicamente en memoria y no lo manda a analytics, logs, query, almacenamiento local, SW ni URL de red. Puede existir un POST público mínimo de inscripción ligado a invitación; no hay alta pública general, preview general ni bypass de administrador.

El token de invitación es alternativa acotada al código admin en `POST /api/register/options` y `POST /api/register/verify`; `POST /api/register/password` participa sólo si `PASSWORD_LOGIN` ya está habilitado. No se activa `PASSWORD_LOGIN`. El servicio crea un registro de inscripción durable y reanudable ligado a UID de servidor, invite, challenge y consentimiento; debe tratar explícitamente los crash/failpoints entre escritura de identidad en `db.json` y SQLite. Una cuenta recuperada puede quedar sin rol operativo y nunca recibe relación, grants ni entitlement hasta terminar los pasos; al reintentar, se recupera o se rechaza de forma segura. Registro no consume invitación: sólo `POST /api/invitations/accept` autenticado, con consentimiento de cliente, la consume. Una cuenta nueva queda `PENDING_OPERATIONAL_ROLE`; un administrador asigna el rol de forma posterior. Esto no inventa coordinador/admin.

Implementar todas las transiciones literales del anexo: revoke/reject de invitación, accept, confirm de desconocida, client revoke, trainer suspend/end/reactivate request, client reactivate accept, admin suspend/end/reactivate request, y replace/revoke de grants. Aceptación fija elegibilidad temporal; una cuenta desconocida no tiene lectura hasta confirmación. Reanudación crea una ventana nueva, no restaura grants y no revela el intervalo suspendido: el cliente debe conceder grants nuevos por separado. La aceptación/confirmación mantiene un único entrenador activo transaccionalmente. Si knownClientId existe, accept/reject y challenge/enrollment sólo admiten ese UID literal; no registrar otro UID ni revelar a una cuenta diferente el target o su existencia. Preview válido no devuelve target/alias de cliente. Al conceder HISTORY exigir rango UTC explícito y publicar el snapshot mínimo de anexo §4.1, con rev/wid estable o conflicto y sin leer state completo para responder al trainer.

Pruebas futuras incluyen `known_target_invite_rejects_other_uid_without_identity_oracle`, `known_target_invite_cannot_register_replacement_uid`, `unknown_target_signup_resumes_same_uid_after_each_failpoint`, token sin URL/log/storage, `INVITE_ONLY` con passkey y soft credential, password sólo cuando configurado, revoke/expiry durante registro, registro sin consumo, cada failpoint/retry de inscripción, doble entrenador, ventanas no contiguas, cambios de grant y lectura vacía antes de confirmar. Ejecutar: `cd api && node --test test/authority-routes.test.js test/authority-identity.test.js` y los tests frontend nuevos con `cd frontend && npm test -- src/views/Login*.test.jsx src/App*.test.jsx`.

## 7. Tarea 4 — intervalos comerciales, calendario e idempotencia

**Archivos:** modificar contrato/servicio/store/servidor; crear `api/test/authority-time.test.js`; ampliar `api/test/authority-routes.test.js`.

Implementar `POST /api/admin/commercial/operations/confirm` y lectura comercial limitada conforme al anexo. La mutación sólo ocurre tras `requireCapabilityTx` de coordinator scoped, identidad activa y actor distinto al cliente. Para un intento NUEVO se exige versión SUBSCRIPTION actual; el replay sigue primero la autoridad/tuple del anexo §5 y no falla sólo porque su commit anterior incrementó la versión. Un replay reevalúa autoridad antes de leer resultado y debe coincidir `actorId`, `subjectId`, `operationId`, hash de payload y operación; cualquier diferencia falla sin filtrar resultado. Un operation ID nuevo con versión vieja es conflicto; el conflicto de renovación requiere refresco y reconfirmación con una nueva operación.

El cálculo usa únicamente reloj servidor, `America/Panama`, fecha final UI inclusiva y límite UTC exclusivo; los casos ISO de §5 del anexo son literales esperados, no cálculo mental en el test. No hay precio, moneda, tarjeta ni pago verificado.

Ejecutar después: `cd api && node --test test/authority-time.test.js test/authority-routes.test.js`. Commit futuro: `feat: add scoped commercial intervals`.

## 8. Tarea 5 — prescripción inmutable, metas y actuals SQLite

**Archivos:** modificar contrato/store/service/server y `api/test/authority-routes.test.js`; crear `api/test/authority-execution.test.js`.

Publicar versiones inmutables de plan y metas como aggregates distintos; PERFORMANCE conserva exerciseId + targetLoad + targetReps y no un target escalar; los entryId de la versión distinguen ejercicios repetidos y enlazan omisión/sustitución/adición sin reescribir prescripción. Crear productor/lector propio de peso y proyecciones de peso/histórico del anexo §4.1, con UI de consentimiento/publicación explícita en T8; el snapshot de sesión enlaza IDs/versiones concretas y queda readonly. Validar targets y ejecución mediante el contrato cerrado que reutiliza los límites semánticos actuales de `frontend/src/lib/log-workout.js` (`LOG_LIMITS`) y `frontend/src/lib/history.js` (`EFFORT`): no se deja validación de reps/carga/esfuerzo como TBD. El servicio no admite que entrenador altere una ejecución, sustitución u omisión del cliente.

Inicio y finish revalidan capability dentro de la transacción. `finish` inserta una sola vez en SQLite, con `operationId` ligado a actor/subject/payload hash, y devuelve la misma ejecución sólo al mismo actor autorizado en replay. No se escribe `state-<uid>.json`; `PUT /api/data` no crea ni muta actuals compartidos. La lectura privada unificada de historial y el export del propio cliente proyectan sus actuals SQLite aun si una relación/grant termina; revocación sólo corta visibilidad del entrenador. La proyección trainer exige relación actual, grant, entitlement y la ventana que contiene la ejecución; no hay visibilidad automática en huecos.

Pruebas futuras: `performance_goal_preserves_exercise_load_and_reps`, `execution_keeps_omission_substitution_addition_and_failure`, `effort_accepts_half_steps_and_rejects_other_steps`, `history_grant_requires_explicit_range_and_never_returns_raw_profile`, `history_projection_includes_authorized_legacy_and_prior_sqlite_actuals_without_private_targets`, `weight_has_explicit_owner_producer_and_requires_current_grant`, `weight_revocation_redacts_weight_from_historical_share`, goal v1→v2, snapshot estable, ejecución distinta de target pero válida, límites y enums, trainer no edita actual, finish retry, finish fallido conserva draft, `finish_shared_session_never_writes_state_json`, legacy PUT inocuo, ejercicio fuera de ventana, y export propio tras fin de relación. Ejecutar: `cd api && node --test test/authority-execution.test.js test/authority-routes.test.js`.

## 9. Tarea 6 — guardia completa de modo gestionado y sync legado

**Archivos:** modificar `api/server.js`, `api/coach/routes.js` sólo si debe recibir el guard explícito, `api/authority-service.js`; crear/modificar `api/test/authority-legacy-sync.test.js`, `api/test/authority-compatibility.test.js`, `api/test/server-media.test.js`, `api/test/server-data-rev-endpoint.test.js`.

Inventariar cada handler antes de cambiarlo. Con `MANAGED_SUBSCRIPTIONS=1`, `CLIENT` activo + entitlement actual se exige antes de **GET/PUT `/api/data`, GET `/api/data/rev`, GET `/api/nudge-check`, PUT/GET/missing/sweep de `/api/media/*`, rutas funcionales Coach, y subscribe/status/test/rest-timer/cancel de push**. Los workers de nudge/push y Coach no consumen actividad de un cliente no entitled. `GET /api/config`, autenticación/recuperación, `GET /api/access`, aceptación de invitación, renovación, export y solicitud de eliminación segura son excepciones explícitas; el backoffice de rol/scope/comercial mantiene su capacidad propia, no entitlement personal.

El mismo guard protege API antigua independientemente de cabecera de versión. En `0`, pruebas de regresión demuestran que las rutas personales legacy siguen upstream. Admin health/history/peso no recibe excepción: denegar o redactar hasta política posterior. Registrar una allowlist/denylist junto al dispatcher y una prueba que falle si una ruta funcional inventariada queda sin decisión.

Pruebas futuras: cliente gestionado expirado no GET/PUT/rev/media/nudge/Coach/push; sesión expira entre start/finish; disabled/deleted corta capability; headers antiguos no bypass; modo 0 conserva rutas; admin nunca fallback; media own-folder sólo con entitlement. Ejecutar: `cd api && node --test test/authority-legacy-sync.test.js test/authority-compatibility.test.js test/server-data-rev-endpoint.test.js test/server-data-wid.test.js test/server-media.test.js`.

## 10. Tarea 7 — exportación propia y eliminación request-only

**Archivos:** crear `api/authority-export.js`, `api/test/authority-export.test.js`; modificar `api/server.js`, `api/Dockerfile`, `frontend/src/views/Settings.jsx`, `frontend/src/lib/export-csv.test.js` sólo si requiere adaptación.

El export es propiedad del UID autenticado, aun vencido, y se construye por allowlist. Incluye sus registros comerciales/consentimientos y proyección de sus actuals compartidos; excluye payload privado de prescripción, ejercicios/licencias no propios, auditoría de otros, carteras y scopes. Las descargas usan `Cache-Control: private, no-store`. `POST /api/client/deletion-requests` registra/audita una petición sin invocar `removeAccount`; las rutas destructivas gestionadas devuelven `policy-not-configured` hasta una futura saga aprobada. No se barre ni migra autenticación.

Pruebas futuras: expirado exporta, fin/revocación de trainer conserva actuals propios, campos prohibidos ausentes, trabajo no enumerable, descarga no-store y delete request no elimina estado. Ejecutar: `cd api && node --test test/authority-export.test.js && cd ../frontend && npm test -- src/lib/export-csv.test.js`.

## 11. Tarea 8 — shell, PWA y journeys web

**Archivos:** crear `frontend/src/lib/authority-api.js`, `frontend/src/lib/access-gate.js`, `frontend/src/lib/trainer-draft.js`, `frontend/src/views/ClientTraining.jsx`, `frontend/src/views/Trainer.jsx`, `frontend/src/views/Commercial.jsx` y pruebas; modificar `frontend/src/App.jsx`, `frontend/src/views/Workout.jsx`, `frontend/src/store/useStore.js`, `frontend/src/components/ServerSync.jsx`, `frontend/public/sw.js`, `frontend/src/views/Admin.jsx`, `frontend/src/views/Settings.jsx`, `frontend/src/locales/es.js` y los locales que el patrón actual requiera.

`GET /api/access` al arranque, entrada de ruta, foco y justo antes de acción protegida alimenta un gate `unverified|blocked|allowed`; también se reconsulta tras 401/403/409/426. Gatear shell existente, `Workout`, inicio/final, sync y caché protegida, no sólo las vistas nuevas. Mientras esté blocked/unverified/offline, conservar el borrador fuera de `S` y de `PUT /api/data`, no hacer cola ni éxito remoto. Recuperación es un click explícito que requiere el mismo `serverSessionId`/`planVersionId`; no finish, backfill ni comparte automáticamente.

El SW continúa sin cachear `/api/`, y purga las vistas/datos protegidos en logout, cambio de cuenta y denegación. Esto no promete borrar recursos de un cliente antiguo. El formulario de metas usa el GoalInput discriminado (PERFORMANCE exige ejercicio, carga y reps); la ejecución distingue OMITTED/SUBSTITUTED/ADDED y failure sin convertirlo en targets. Incorporar en ClientTraining el registro explícito de peso a POST bodyweight, revisión de grants y publicación de un rango HISTORY con preview mínimo y confirmación; el trainer consulta las rutas history/bodyweight separadas. La cola de vínculos suspendidos/pendientes usa GET trainer/relations de metadata, no la cartera de entrenamiento que queda vacía al vencer. Las vistas trainer/comercial consumen sólo sus APIs scoped; no usan JSON personal. Entrenador ve cartera mínima y grants; client ve pendiente de rol/confirmación o renovación/export, no plan protegido. No añadir plantilla de entrenador ni progresión automática.

Pruebas futuras unitarias/UI cubren `performance_goal_editor_persists_all_three_fields`, `history_share_requires_range_preview_and_explicit_submit`, `trainer_reads_history_weight_only_from_authorized_projections`, `expired_client_can_withdraw_own_consent_without_renewing`, gate, draft, switch, rutas directas, fragmento, reactivación y separación de admin/comercial/trainer. Ejecutar: `cd frontend && npm test -- src/lib/authority-api.test.js src/lib/access-gate.test.js src/lib/trainer-draft.test.js src/views/ClientTraining.test.jsx src/views/Trainer.test.jsx src/views/Commercial.test.jsx src/App.no-tabs.test.js src/App.workout-tabbar.test.jsx`.

## 12. Tarea 9 — browser real

**Archivos:** crear `frontend/e2e/fixtures.mjs`, `frontend/e2e/subscriptions-trainers.spec.js`; modificar la configuración de T0 si hace falta.

Las fixtures levantan API y web reales contra `DATA_DIR` temporal aislado y usan cuentas sintéticas. Para WebAuthn emplean el soporte virtual/soft credential determinista del navegador de pruebas; no codifican sesión en el producto. No se intercepta `fetch` ni se reemplaza la API. Casos: desktop y móvil; invite-only passkey; token fragmento desaparece antes de la primera navegación/API/storage/log; aceptación pendiente; role assignment posterior; dos trainers/dos clients; expiración durante sesión; recarga y URL directa; logout/switch; SW/offline; renovación readback; export vencido; denylist legacy. Ejecutar: `cd frontend && npm run test:e2e`, después de `npm ci`, browser setup y arranque de fixtures. Commit futuro: `test: cover subscriptions in real browsers`.

## 13. Tarea 10 — backup y restore exactos (repo operativo futuro)

**Archivos en openGym:** crear `api/scripts/snapshot-authority.mjs`; modificar `api/Dockerfile`, `api/test/authority-store.test.js`. **Archivos en `/home/jhonsnake/hermes-stack/services/opengym`:** modificar `scripts/vps-backup-channel`, `scripts/source-nas-backup`, `tests/test_backup_channel_contract.py`, `tests/test_safe_archive.py`, `OPERATIONS.md`, y durante un rollout autorizado `compose.yaml` con el digest de la release autorizada. Son cambios futuros separados; esta tarea no ejecuta operaciones.

Protocolo único: adquirir el lock existente; instalar trap de reinicio de api/web antes de detener escritores; `docker compose stop api web`; resolver y registrar el ID/digest real de la imagen API desplegada desde compose y `docker image inspect` (nunca hardcodear `1.4.3`); crear `stage=$(mktemp -d "$lock_dir/export.XXXXXX")`, `chmod 700 "$stage"`; correr el helper de esa misma imagen con producción `/source` read-only y stage rw; producir `stage/authority.sqlite` por backup SQLite integrado; abrirlo read-only y verificar `integrity_check` y esquema aceptado por **ese runtime**.

El tar se construye desde datos quiescentes en staging: copiar datos necesarios a stage, excluir **todo** `authority.sqlite*` de la fuente, reemplazar sólo el artefacto de stage por `stage/authority.sqlite`, y archivar la única entrada canónica `authority.sqlite`. Nunca copiar, renombrar ni sobrescribir la base productiva ni sus sidecars. El trap reinicia api/web incluso si falla snapshot, tar, cifrado o transferencia; limpia staging sólo después de registrar resultado. Conserva cifrado/hash/retención no destructiva.

Restore extrae a un directorio nuevo, valida member allowlist/tipos/tamaños, hash e integridad, y arranca la misma imagen autorizada contra esa copia. El runtime informa migraciones/esquemas compatibles; no se compara eternamente contra `1`. Validar conteos de entidades no sensibles, un smoke API real y el archivo completo; sólo entonces promover mediante rename reversible conservando el directorio anterior. Las pruebas de contrato crean un tar/SQLite sintético y comprueban hash de fuente intacta, rechazo de sidecars/snapshot, imagen igual a compose, schema futuro incompatible, conteos e inicio aislado; no buscan sólo cadenas. Ejecutar tras implementación: `cd /home/jhonsnake/hermes-stack/services/opengym && python3 -m unittest tests/test_backup_channel_contract.py tests/test_safe_archive.py`; el commit operativo futuro contiene exactamente esos archivos y `compose.yaml` si cambió el image ref.

## 14. Tarea 11 — OpenAPI, matriz y gates de release

**Archivos:** modificar `api/openapi.yaml`, `README.md` o `docs/README.md`; crear `docs/operations/subscriptions-and-trainers-runbook.md`; modificar pruebas anteriores sólo para cerrar referencias.

OpenAPI se genera contra el anexo completo: cuerpos, respuestas, errores 401/403/404/409/410/422/426, y rutas literales. El runbook debe marcar cada resultado como `PLANNED`, `EXECUTED PASS` o `EXECUTED FAIL`; los nombres de prueba de este documento son planeados, no evidencia actual. La matriz debe contener requisito → tarea dueña → archivos productores/consumidores → unit/API/browser/ops tests. Mínimo:

| Requisito | Dueño | Archivos | Pruebas futuras |
|---|---|---|---|
| Guard completo y legacy | T6/T8 | `api/server.js`, Coach, `App.jsx`, store, SW | authority legacy/compat + E2E direct/offline |
| Invite/register seguro | T3/T9 | service/server/Login/App/e2e | routes/identity + browser fragment/passkey |
| DTO/lifecycle/ventanas/metas | T1/T3/T5 | contract/store/service/server | contract/store/routes/execution |
| SQLite actuals/proyección propia | T5/T7 | store/service/export | execution/export/legacy |
| Capability/replay/versiones | T2/T4/T5 | service/store/server | routes/time/execution race |
| Identidad/bootstrap/recovery | T1–3/T7 | identity/CLI/server | identity failpoints/bootstrap/delete request |
| Browser real | T0/T9 | package/lock/config/e2e | `--list`, Chromium desktop/móvil |
| Backup/restore | T10 | snapshot + ops scripts/compose | Python fixture restore contract |

Futuras puertas, en orden: contrato/API y node tests; `cd frontend && npm ci && npm test && npm run build`; browser setup, `npm run test:e2e`; backup fixture; imagen Node 22.23.4; staging aislado; revisión de endpoints admin; licencia de medios; privacidad/retención/auditoría/export/revocación; proceso de evidencia comercial; matriz de clientes y comunicación/adopción; piloto reversible. Sólo después un rollout autorizado puede cambiar imagen/configuración y activar `MANAGED_SUBSCRIPTIONS=1` para el grupo aprobado. No se ejecuta ningún gate en esta tarea de planificación.

## 15. Handoff

La implementación comienza únicamente con autorización expresa posterior. La persona implementadora sigue las tareas en orden; una revisión independiente valida los contratos, evidencia de tests, imagen y restore. Ningún artefacto de producto debe atribuir decisiones a una herramienta o proveedor.
