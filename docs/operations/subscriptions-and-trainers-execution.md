# Ejecución del MVP de suscripciones y entrenadores

## HOLD web vigente: segundo hotfix de textos JohnGym

John pidió retirar los textos visibles openGym de la interfaz y conservar JohnGym en español e inglés. La coordinación prepara el hotfix aislado en /home/jhonsnake/openGym-branding-hotfix, sólo frontend visible; mantiene licencias/avisos, rutas/IDs internos, datos, API y PASSWORD_LOGIN=1. No hay despliegue productivo de esta sesión en curso: el hito backend publicado en7fefdc74a933d412f42da49696ed7a41e716c75a es sólo fuente, con803testsAPI y revisión crítica aprobados.

Bloquear despliegue web y rollout MVP combinado hasta confirmación explícita de cierre. El trabajo local, builds y QA continúan. Al cerrar: leer handoff/base/commit/delta y nuevo baseline servido; integrar los textos por rutas y hashes desde la base verdadera, sin cherry-pick ciego ni reemplazar componentes MVP con archivos del hotfix estable. No retirar licencias/avisos ni cambiar identificadores internos. PASSWORD_LOGIN=1 e invitaciones/suscripciones siguen vigentes. Este hold web nuevo es distinto del hold breve de contraseña ya retirado.


## Credenciales productivas: PASSWORD_LOGIN=1 verificado y obligatorio en MVP

John confirmó la habilitación de usuario/contraseña junto con passkeys e invitaciones y levantó el hold breve. Se verificó públicamente /api/config: password_login=true, invite_only=true, allow_guest=false, HTTP200; health ok=true/users=1/writable=true. No se probó aquí un envío real de contraseña ni registro. Cambio externo documentado en PASSWORD-LOGIN.md, commit b408c1b659f1ebe33db0d76a579cef71a446fa55 de hermes-stack, remoto comprobado; API estable sin cambio de imagen y datos/cuentas intactos según la coordinación.

La futura entrega MVP debe preservar PASSWORD_LOGIN=1 y ambos métodos de autenticación, sin saltar invitaciones, consentimiento, roles o vigencia. La plantilla local ya tiene1; contrato de despliegue reforzado y suite operativa23 PASS. Los gates funcionales, privacidad, fuentes y restore siguen pendientes independientemente del hold retirado.

## Publicación backend y resultado frontend reconciliados

Fuente backend publicada en7fefdc74a933d412f42da49696ed7a41e716c75a, remoto y lectura pública anónima del código comprobados por hash. Corresponde al API de803pruebas sin fallos/saltos y revisión crítica aprobada; no implica despliegue ni finalización del MVP.

La suite frontend congelada terminó con6618pruebas:6616PASS/2FAIL. Se corrigió una aserción asíncrona del montaje App esperando la llamada real del efecto, sin eliminar el assert. El fallo CSP provino de un auxiliar web/Dockerfile antiguo en la fixture, distinto del WIP Root; no de una excepción de CSP autorizada. Root App+CSP10/10PASS posteriores, pero la nueva suite completa sigue pendiente y debe capturar también todos los auxiliares sucios, no sólo frontend/API. El snapshot fallido se conserva como evidencia.

T9 candidato continúa aislado con imagen API corregida y PASSWORD_LOGIN=1. Hold web de textos JohnGym activo hasta confirmación externa, sin impedir QA local. No sobrescribir el hotfix ni restaurar0 en autenticación; preservar todos los medios personales y gates de journeys, restore y activación nominal.

## Hito backend verificado: 803 pruebas y revisión crítica aprobadas

La suite API posterior a ambos arreglos terminó: 803 pruebas aprobadas, 0 fallos, 0 saltos y exit 0. El contenido Root coincide con los 188 archivos API del snapshot consent-reviewed-v2. Revisión crítica independiente aprobada, sin errores ni concerns; el HIGH de grants idénticos y los filtros scopes quedan cerrados. El scan previo a publicación no encontró atribuciones nuevas; los candidatos de credenciales eran únicamente fixtures aisladas de test, no valores productivos.

Se conserva la evidencia real de recuperación, subconjuntos y privacidad: tokens autoritativos, ventana original, omisiones explícitas, diff de permisos sin recortar categorías intactas, gap privado excluido, datos nuevos visibles y HISTORY explícito sin ampliación automática. Migración esquema 5 y metadata mínima cerrada verificadas. Los 23 tests operativos actuales incluyen el contrato de PASSWORD_LOGIN=1 y sus canaries; helper real empaquetado pasó WAL ±SHM, cursor, 22 tablas, integridad y rechazo de esquema futuro.

Este hito permite publicar el backend probado, NO desplegar ni aceptar el MVP completo. La nueva suite frontend congelada, T9 con imagen corregida y ambos métodos de acceso, journeys clínicos, restore integral, imagen web personal con TODOS los medios y activación nominal siguen bajo sus gates. La producción sólo recibió la habilitación externa de contraseña documentada arriba; no se alteraron aquí cuentas, roles o suscripciones reales.

## Revisión de las correcciones aprobada; validación integral posterior pendiente

La revisión independiente del snapshot consent-reviewed-v2 aprobó ambos arreglos, sin errores ni concerns: grants idénticos conservan ID/corte/versión y snapshot HISTORY, los cambios reales reciben un periodo nuevo y el paginador acepta filtros autorizados sin relajar ACL ni validación de otras rutas. El probe HTTP conserva ejecución1→1 y peso1→1, excluye el gap privado y permite su reenvío sólo mediante HISTORY explícito;33pruebas independientes de consentimiento y9de ámbitos aprobadas. Los 189 archivos del snapshot coincidieron por hash antes/después.

Nueva suite API completa y nueva suite frontend sobre1229fuentes congeladas en ejecución. T9 continúa sobre imagen nueva sha256:5c455f924dfb05d92d0b1200081baa3ef0033928f5b1ebad7f24434ceec8a933, ya comprobada con helper empaquetado real y WAL±SHM/esquema5/22tablas/integridad/futuro. Prueba ambos métodos de autenticación en fixture con PASSWORD_LOGIN=1, manteniendo invitaciones y bloqueo de entrenamiento sin vigencia. No usar la imagen antigua ni proclamar passkeys/contraseña comprobadas por mostrar sólo controles.

Producción sólo recibió el cambio externo de autenticación documentado arriba, sin despliegue MVP. Los gates de browser/journeys clínicos, restore, fuente pública, todos los medios personales y activación nominal siguen abiertos. Los apartados inferiores son históricos frente a este corte.

## Suite API 801 PASS; dos correcciones de integración pendientes

La nueva suite API completa terminó con 801 pruebas aprobadas, 0 fallos y 0 saltos, exit 0. La revisión crítica no aprobó ese snapshot: aunque cerró la brecha WEIGHT original, subconjuntos, migración y DTOs, detectó que replaceGrants también reinicia los grants idénticos y sus cortes. Agregar HISTORY conservando EXECUTION/WEIGHT hizo pasar sus lecturas de 1 registro a 0. No borra los registros propios, pero recorta inesperadamente acceso consentido. Corregir mediante diff transaccional por identidad exacta, conservando IDs, cortes y snapshots de categorías sin cambios; nueva concesión tras retirada debe seguir protegiendo el intervalo privado.

El T9 final sí confirmó roles mediante UI real y quedó bloqueado en GET de ámbitos, no por un recibo inválido. Se identificó la causa en el servidor: la ruta permite filtros coordinatorId/clientId, pero su paginador genérico rechaza esas claves. Corrección acotada para reutilizar el decodificador de cursor tras la whitelist existente, sin relajar otras rutas ni conceder permisos. Ambos cambios tienen archivos exclusivos y nuevos tests; repetir revisión y suite API después de integrarlos.

Frontend: nueva suite completa en ejecución sobre 1229 archivos congelados en repositorio completo, con auxiliares API esquema 5. No fuente cambiante ni fixture parcial. Persisten los gates de journeys M1 con API corregida, restore integral, fuente publicada y activación nominal. Todos los medios personales permanecen; no despliegue MVP ni cambios de roles/suscripciones reales.

## Esquema 5 empaquetado: pruebas acotadas aprobadas, gate integral en curso

La revisión independiente acotada aprobó las tres correcciones de recuperación, con los 187 archivos congelados coincidentes: tokens de sesión recuperables, ventana original y representación explícita de cada ejercicio. No es aprobación global.

Se entregó la corrección de subconjuntos de consentimiento, el límite server-owned eligible_from_utc por grant y la migración 4→5. El mismo oráculo aislado de WEIGHT que antes reproducía el fallo ahora confirma privateGapReturned=false y freshMeasurementVisible=true, sin HISTORY implícito. La revisión crítica de privacidad/migración y la nueva suite completa API están en ejecución; no se acepta todavía el conjunto por los resultados focales.

Verificación operativa directa: 20 pruebas PASS con esquema 5 y SQLite real, transporte Docker simulado. Nueva imagen API intermedia sha256:bf31a9e14234857216e02ded8870ff4945772d4d6283f2aa0f04deb7fb94eda8. Su helper empaquetado real pasó WAL con y sin SHM, fila y cursor conservados, 22 tablas contadas, integridad y rechazo de esquema futuro. Las fuentes DB/WAL/SHM no cambiaron. No hubo código host superpuesto en /app, puertos públicos ni acceso a producción. No equivale al restore integral ni a una imagen final con fuente publicada.

T9 ya muestra el encabezado administrativo y el diagnóstico registra confirmación visible de roles tras HTTP 200, pero la aserción del harness continúa fallando. No se da por probado un defecto del recibo API ni se debilita su validación: falta adjudicar el selector y la evidencia exacta. El resto de los journeys M1 sigue sin aceptar. Todos los medios personales permanecen y el MVP no está desplegado.

## Corte vigente: recuperación entregada, consentimiento y navegador bajo corrección

Los bloques inferiores son históricos frente a este corte. La recuperación incorporó tokens SESSION/SESSION_SET, vínculo a la ventana original, metadatos mínimos close-only y omisiones explícitas. Su revisión independiente acotada, sobre 187 archivos congelados, está en curso. La suite completa API terminó con 799 pruebas: 797 PASS, 2 FAIL y 0 SKIP. No se acepta como verde: los dos fallos corresponden a una regresión T7 que exige TODOS los grants propuestos al aceptar una invitación, en vez de respetar un subconjunto elegido explícitamente. Se corrige junto con el límite duradero de WEIGHT por periodo/categoría, manteniendo la coincidencia exacta de cada propuesta seleccionada, los registros privados y HISTORY expresamente consentido. No se añade ningún grant ni se concede peso implícitamente.

La suite frontend congelada sobre repositorio completo terminó con 6612 pruebas: 6610 PASS, 2 FAIL y 0 pendientes. Un fallo era el alias Docker ya corregido y publicado en 13eb7ac; el otro era un marcador de valor vacío en ClientTraining (em dash frente al en dash establecido). Se reprodujo RED y corrigió ese carácter. Después pasaron 27 pruebas actuales de 6 archivos: placeholder, ClientTraining, wrapper API, TrainerPrescriptions, ClientConsent y montaje de App. Esto NO sustituye una nueva suite completa contra la fuente posterior.

El workspace de entrenamiento, prescripción, metas y consentimiento fue entregado. Queda pendiente el productor server-owned de grants/grantId y trainerId para los lectores HISTORY y el consentimiento contextual. T9 anterior pasó M0, pero quedó bloqueado al buscar el encabezado administrativo en M1; no demuestra ausencia de ruta ni una ceremonia passkey. Se investiga autenticación, bootstrap, origen, readiness y fuente del navegador, sin mocks de API ni montaje alternativo. Después deben probarse ambos viewports con API real y comprobar persistencia.

La prueba personal conserva TODOS los 6554 MP4, los 6554 WebP y sus avisos. La privacidad sigue siendo un gate. No se modificaron producción ni identidades, roles o suscripciones reales. El MVP no se ha desplegado.

## Bloqueo de privacidad y verificación empaquetada más recientes

La prueba aislada de retirada y nueva concesión de WEIGHT reprodujo exposición de una medición capturada durante el intervalo privado, sin HISTORY explícito. No hubo datos reales ni producción afectados. El despliegue queda bloqueado: se requiere un límite duradero por periodo/categoría de consentimiento y regresiones de no exposición, preservando captura privada, registros propios y exportación. La corrección está preparada para el siguiente corte API exclusivo; no se asume implementada.

La imagen T7 local sha256:c504edfab06ec67094df4a61b7e7710de7880b8c36917ee555fc0a2362858b65 sí pasó HTTP real empaquetado: exportación propia 200 con identidad activa sin CLIENT/vigencia, descarga private/no-store, ajeno/desconocido 404 opaco, solicitud de eliminación 200 REQUESTED y archivo personal sin cambios. Root de contenedor de sólo lectura, capabilities retiradas y puertos sólo loopback verificados; recursos de prueba eliminados. Esto no prueba aún T9 ni los arreglos pendientes de sesiones/consentimiento.

La suite frontend de la fixture parcial no pasó: 6458 pruebas, 6390 PASS/68 FAIL y suites sin cargar. Se corrigieron 30 mocks conservando el módulo real de guardias; resultados focales reportados 394/394. Se reprodujo y corrigió además una aserción que rechazaba un alias Docker válido: 51 pruebas API-base/CSP coordinadas PASS, cambio de test publicado en13eb7ac20995342041eadbde72af796ec2021034. Nueva suite congelada sobre repositorio completo en ejecución. Workspace de prescripción/consentimiento y harness T9 real continúan; no declarar MVP completo.

## Verificación más reciente: integración T7 y recuperación bajo corrección

- T7 módulo propio: revisión independiente aprobada, 5 pruebas coordinadas PASS. Integración HTTP/DTO/Docker: 15 pruebas focales coordinadas PASS sobre fixture completa con fuentes T7 congeladas; no es gate global.
- Productores añadidos: preview con invitationVersion/proposedGrants; lecturas trainer de plan y metas bajo el mismo grant PLAN; token BODYWEIGHT_SET propio. El enum sigue PLAN/EXECUTION/HISTORY/WEIGHT.
- T6 no aprobado: revisión detectó falta de token SESSION en recuperación y reutilización indebida de una ventana cerrada. Se reprodujo además una ejecución aceptada con 2 ejercicios prescritos, sólo 1 reportado y ninguna omisión explícita. Corrección y regresiones en curso; no desplegar con estos defectos.
- Full API de la fixture parcial T6: 792 pruebas, 786 PASS/6 FAIL/0 SKIP. Cinco fallos corresponden a fuentes auxiliares ausentes de la fixture y uno al helper de carrera descubierto como prueba sin argumentos. No declarar suite verde ni alterar asserts para ocultarlos; repetir con fuente completa y descubrimiento correcto tras las correcciones.
- Operaciones: 20 pruebas PASS en esquema 4; transporte Docker simulado. Imagen API intermedia real de esquema 4 y helper empaquetado conservaron WAL/cursor con y sin SHM, 22 tablas e integridad; no sustituye restore final.
- Frontend de invitaciones/Commercial/exportación continúa; ClientTraining está en implementación separada. Build de snapshot previo con medios=1 y hint gestionado=1 aprobado; Chromium real con API caída no ofreció Guest ni hizo solicitudes personales. No se probó aquí una ceremonia passkey real ni el MVP completo.
- Todos los medios originales se mantienen en la variante personal. Producción y cuentas/roles/suscripciones reales no se modificaron.

## Corte actual y contratos técnicos T7

La revisión independiente acotada de T5fix1 aprobó los tres hallazgos y el endurecimiento de cursores/tokens. El coordinador verificó31tests afectados; no es gate global API. La primera entrega T6/T7 fue PARCIAL: sólo flag público M1, allow_guestfalse, guardlegacy inicial e inventario con2tests HTTP. T7, workers, paginación SQL y current-session no estaban hechos; no se aceptan por exit0 del escritor. Se separaron T6 completado/integración y T7 módulo nuevo con propiedad exclusiva; UI de invitaciones continúa independientemente. Suite operativa completa actual:20PASS usando factory esquema4 sin cambios durante el gate, transporteDocker mock; NOrestorefinal.

Decisiones técnicas adoptadas bajo la delegación existente, sin nuevas reglas comerciales/legales: ExportInput y DeleteInput son objetos vacíos cerrados dentro del sobre común operationId/expectedVersion/payload; se rechaza cualquier campo desconocido, incluso en replay. El servidor determina UID, IDs y timestamps. Exportación JSON propia on-demand autenticada a fecha de descarga; el job guarda sólo metadatos, sin archivo de salud retenido ni TTL/legal purge inventado. READY significa disponible para generar, no snapshot inmutable en fecha de solicitud. Incluye legado propio allowlisted, actuals SQLite propios y metadata comercial/consentida propia; nunca snapshots privados de prescripción, scopes/carteras ajenos, tokens/secretos/auditoría de otros ni colección de activos licenciados. La solicitud de eliminación sólo registra/audita REQUESTED, no borra datos.

AccessSnapshot proporcionará EXPORT_SET/DELETION_REQUEST_SET actuales como metadata incluso sin CLIENT/vigencia. GET/api/client/sessions/current proporciona exclusivamente sesión propia OPEN y su snapshot original con tokens SESSION/SESSION_SET, sólo con CLIENT activo, vigencia y derechos actuales de la relación; devuelve null si no hay sesión. Publicar otro plan no reescribe la sesión iniciada. Son productores necesarios para los journeys ya aprobados; implementación/verificación aún pendientes de los escritores actuales. El contrato funcional aprobado28a6e no se reescribe.

## Prueba personal de medios implementada y verificada

Receta explícita personal-test con BUILTIN_EXERCISE_MEDIA=1, todos los medios originales y avisos; comercial separado/default con0 ysinmedios. Ambos builds Docker reales exit0. Las6 pruebas de política pasaron sinfallos/saltos usando ambas imágenes. Se verificaron las13109 rutas/bytesSHA256:6554MP4+6554WebP+NOTICE; cabeceras de formato válidas, NginxHTTP200/MIMEcorrecto y hashes de avisos/licencia iguales. Dos builds negativos probaron rechazo de flags inconsistentes. No se visualizó ni alimentó a modelos con los activos.

Imagen personal de comprobación: sha256:f142dc23386111312029577f417ba24a1921f84ae32a8d9f34f799917e0efc7e. Comercial de comprobación: sha256:e1b08df444057c669e1b0e4d411449f775b9fd8e80ab970a0f07d34ad6921cff. Son frontend8e7+overlay de receta, no candidato funcional final ni despliegue. El próximo artefacto de prueba del MVP usará la variante personal, NO la exclusión comercial. La instrucción de John no otorga licencia comercial ni altera suscripciones/roles.

## Cambio de alcance vigente: prueba personal con animaciones

La instrucción más reciente de John sustituye la exclusión de medios para la fase de prueba personal/no comercial: conservar todos los clips y miniaturas originales, sin modificar y con sus avisos. NOTICE.md admite fork no comercial con los medios de180px; no equivale a licencia comercial. Se mantendrán recetas separadas personal-test(conmedios) y comercial(sinmedios). No cambia vigencias/roles ni autoriza uso comercial, publicación como pack independiente o alimentar modelos con los medios. El catálogo contiene6554MP4+6554WebP, no GIFliterales. La verificación personal será exhaustiva por inventario/rutas/hashes/HTTP, no por inspección visual de los activos. Los apartados inferiores de exclusión son históricos para esta fase y siguen aplicando sólo al build comercial.


## Producción JohnGym: hotfix cerrado, hold retirado

John notificó finalización verificada del hotfix: fuente 955d73fd41ebda7943dffd1ed5929ccef4d281c9, documentación 55f31aa9d5a84962d850c2fdb47e2f4f65acca93, rama pública branding/johngym-stable-hotfix. Handoff: /home/jhonsnake/openGym-branding-hotfix/BRANDING-DEPLOYMENT.md. Se leyó el handoff y se obtuvo la rama remota; no se hizo cherry-pick sobre el árbol sucio.

Nuevo baseline informado/verificado por coordinación: /opt/opengym/compose.yaml usa web johngym-web:955d73fd4, imagen sha256:62509a098c72bcdb5b523c28fc1966927ede5c42672fa50deec983f25e772120; API y datos sin cambios. La coordinación verificó100 pruebas focalizadas+build+2 E2E, health200 y anónimo data401; NO declaró suite heredada completa verde ni passkey real. No sustituye gates MVP.

HOLD DE COORDINACIÓN RETIRADO. MVP puede desplegar sólo tras sus propios gates y targets/alcances reales resueltos. Integrar deliberadamente JohnGym, paleta web scoped data-web-branding, favicon/PWA versionados y SW; conservar picker nativo, iconos de navegación/ejercicios y cambios funcionales. No restaurar branding neutral/openGym. No copiar branding-web.Dockerfile/overlay estable sobre el MVP: perdería cambios funcionales. Durante la prueba personal vigente se conservan TODOS los medios originales mediante el target personal-test; la exclusión sigue sólo en la variante comercial separada. El enlace AGPL del MVP debe corresponder a su propia fuente pública, no quedarse apuntando sólo al hotfix. Refrescar preflight real inmediatamente antes del rollout y preservar la imagen JohnGym como rollback.

## Autorización y contrato

John autoriza implementar, verificar y desplegar el MVP de https://gym.johnprada.co una vez superados sus gates, sin reiterar aprobación de tareas ordinarias. Esta autorización sustituye las restricciones de planificación únicamente del encabezado y handoff anteriores; no altera los requisitos funcionales aprobados ni autoriza privilegios reales por suposición.

Base exacta de contrato y código: 28a6e92481d6e79327312fcaafe7eb0b93f739c6 de jhonsnake/openGym. Rama de ejecución: feat/subscriptions-human-trainers. Especificación, plan y anexo: docs/superpowers/. No reabrir diseño ni aceptar una respuesta de plan en lugar de implementación.

Requisito visual adicional de John: adoptar la paleta de https://eponasalud.com/entrena/login.php y retirar logo/iconos identificativos de openGym. Paleta declarada verificada: #07003c fondo, #14007d principal, #210d67 fondo alternativo, #1d0b6b superficie, #ffad2f acento, #ffffff texto, #c3bce8 secundario, #3d2c8f borde. No copiar marca, imágenes ni código de EPONA/FUNBEAT. Conservar avisos de licencia y recursos PWA neutros cuando sean necesarios.

Decisión comercial adicional explícita: John eligió excluir las animaciones y demás archivos restringidos de Gym Visual y conservar catálogo textual y diagramas permitidos. El build web excluye catalogue/media y fija VITE_BUILTIN_EXERCISE_MEDIA=0; su consumo frontend y los iconos PNG neutros están en corrección. La imagen final debe demostrar ausencia real de esos archivos. El código fuente del fork es público; mantener acceso al código correspondiente de la versión desplegada.

## Límites que siguen vigentes

Preservar cuentas/passkeys y datos, dominio/RP_ID/ORIGIN y otros servicios. No reactivar el origen. No inventar precios, pagos, derechos de medios, retención o identidades privilegiadas. No conceder roles/subscripciones reales sin target y alcance explícitos. Activación gestionada exige gates de privacidad/comercial/compatibilidad; un bloqueo de activación no cancela implementación ni pruebas independientes seguras. No declarar listo con suites fallidas, controles sin activar o funciones ausentes.

## Estado y propiedad

- T1/T2 foundation aceptada/publicada en 7f47dce0543e0d22f9e92c49e3722dd0b664e0ca: 722 API PASS antes del corte T3/T4. No se reabre ni equivale a MVP completo.
- T3/T4 parcial: 18 tests focalizados PASS coordinados. Revisión congelada relations-reviewed-v1 detectó 6 P1 y 4 P2: reserva UID/iniciador, replay terminal, sujeto comercial activo/CLIENT, tokens aggregate dependientes, persistencia del consentimiento pendiente, semántica de rangos/grants, auditoría, readback activo, paginación/alias y OpenAPI. No aceptado todavía. Inscripción real/failpoints/password condicional/carrera multiproceso en ejecución por dueño único de server.js; luego corregir políticas 2–9 y re-review sin solapar el archivo. HISTORY permanece asignado a T5.
- Calendario: coordinador reprodujo bloqueo de renovaciones anchor30 (2027-03-31 devolvía el mismo fin). Corrección acotada de subscription-calendar.js y authority-time.test.js en ejecución; no presentar Jan31 PASS como prueba de todas las anclas.
- Branding intermedio: focal107 + build + guestE2E2 reportados tras corregir 22 fallos. Gate completo siguiente agotó 1200s (exit124), no PASS ni fallo funcional demostrado. Nuevo full con maxWorkers1/timeout3600 en ejecución. Conservar código frontend congelado; JohnGym final llegará del hotfix coordinado y debe integrarse sin revertirlo.
- Primitivas frontend: coordinador ejecutó 23 PASS en authority-api/access-gate/trainer-draft/CSP. Dispose y cliente por cuenta; retry de intención inmutable. Son librerías, no T8 integrado.
- T5 componente de proyecciones puro recibido (8 PASS reportados), no integrado. Coordinador reprodujo: fechas DAY UTC omiten día Panamá, filas null-prototype de SQLite se rechazan y filtro conserva discriminante inesperado; corrección acotada + peso SQLite y claves de fuente en ejecución. No declarar HISTORY funcional antes de persistencia/guards/rev-wid/lectores.
- T5 dominio/HTTP, T6 guards legacy, T7 export/delete request y T8/T9 interfaces/navegador real todavía pendientes. Backend secuencial por dueño de server.js; módulos puros paralelos no autorizan ese archivo.
- T10: helper WAL corregido y probado con fuente/root read-only en Node22.23.4, con/sin SHM y schema futuro rechazado. Ocho tests coordinados helper+empaquetado PASS; packaging detectó y corrigió falta de COPY subscription-calendar.js. Labels fuente API/web apuntan al fork público. Ops corregido sin red/puertos: discovery20 PASS (15 T10+5proxy), bash-n PASS. Prueba comercial estática PASS, prueba imagen real SKIPPED: imagen API final, restore real y exclusión de medios en imagen final PENDING. No desplegar los scripts aún.
- T11 OpenAPI cerrado: escritor exclusivo YAML/test estructural en ejecución para finding10; no reemplaza implementación API.
- JohnGym 955d73fd41ebda7943dffd1ed5929ccef4d281c9 integrado deliberadamente en el árbol MVP:24 cambios+4 altas por hashes de entrada/salida, sin cherry-pick ni pérdida de lógica/medios comerciales; picker nativo restaurado y CSS web scoped. Hold de coordinación retirado; sólo gates MVP pendientes. Full frontend anterior completó6557 PASS+3timeouts/6560; rerun focal12PASS con20s. Nuevo full JohnGym maxWorkers1/testTimeout20000 en ejecución. No afirmar full verde todavía.

Evidencia activa y briefs: /home/jhonsnake/.hermes/cache/scratch/opengym-mvp/. Copia privada duradera de evidencia cerrada: /home/jhonsnake/.local/state/opengym-mvp/. Handoff canónico: /home/jhonsnake/hermes-stack/services/opengym/HANDOFF.md. Releerlo tras compactación, conservar compactación nativa/sesión/trabajos. Los informes no sustituyen pruebas coordinadas. Sólo coordinación integra, publica commits/push y verifica remoto; nadie más tiene permiso de producción.


## Corte JohnGym de frontend verificado y listo para publicar fuente

Identidad JohnGym/paleta web scoped, iconos versionados, picker nativo y SW integrados sin cherry-pick. Revisión independiente SOURCE ONLY: passed=true, sin problemas de seguridad/lógica; johngym-source-review.md. Coordinador verificó suite completa frontend:6573PASS/0FAIL, exit0; build verificado; los2E2E descubiertos desktop/móvil:2PASS. Estos E2E son guest/preferencias con API no disponible, NO T9 de autenticación/servicio. El gate de filesystem de imagen web sigue pendiente. Fuente de este componente puede publicarse sin incluir API/opsWIP y sin desplegar.

T5 se integró por3vías con schema3 y fue revisado; NO aceptado: dos P1 (HISTORY multirrango/errores internos y customEx no conectado) y un P2 OpenAPI, más endurecimiento de cursores/tokens. FullAPI más reciente:774PASS/1FAIL/1SKIP, exit1; el fallo es una aserción de log cross-origin que recibió undefined; la causa aún requiere confirmación y no se da por corregida; skip heredado por ventana de medianoche. Fixture de fecha UTC/Panamá de T5 ya reproducida y corregida sólo en test:6PASS. Ningún fullAPI actual se declara verde.

PrimerUI de administración existe sólo en worktree aislado;30PASS coordinados, editor scopes siguiente corte34PASS reportados. No se integra por copia completa ni se confunde con shell/sync/invitaciones/entrenamiento/T9 terminados. T6/T7, imagen final, restore integral, targets nominales y despliegue siguen pendientes. Producción JohnGym no fue modificada por este corte.

## Corte de catálogo de autoridad verificado

Componente T5 de IDs reconocido probado independientemente: manifiesto literal desde EXDB+EXALIAS, generador determinista conectado al build, resolver sin prefijo permisivo ni runtime Vite, callback de custom sólo servidor. Coordinador ejecutó4 pruebas del catálogo y2 de empaquetado, todas PASS. El JSON contiene sólo IDs, no medios restringidos ni perfiles. Se publica este componente por separado; no completa dominio T5 ni cambia producción. El resto del WIP API/branding/ops no se incluye en ese commit.

Estado posterior de T3: suite API completa766 PASS/0fallos sobre v2, pero revisión independiente mantiene2P1+4P2 y NO acepta el corte. Corrección fix-only siguiente en ejecución. Ops volvió a fallar2/20 al avanzar el esquema a2 por fixture parcial v1; corrección de fixtures y comprobación de tablas completas en ejecución. No repetir el antiguo20PASS como estado actual.
## Evidencia

Preflight local: repositorios de código/operaciones/Obsidian limpios; rama creada desde el contrato exacto. Node local 22.23.0, Codex CLI 0.165.0, Docker disponible. Runtime base verificado en contenedor real node:22.23.4-alpine, digest sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914: Node v22.23.4 abrió SQLite, creó/leyó fila, ejecutó sqlite.backup y abrió snapshot read-only con integrity_check=ok y una fila. node:sqlite mantiene advertencia experimental. La imagen final de la aplicación aún debe pasar su gate propio. Preflight remoto read-only: api/web/Caddy saludables, API health ok y almacenamiento escribible, una cuenta; no se alteró producción. Suites del nuevo producto y producción del MVP: PENDING.
