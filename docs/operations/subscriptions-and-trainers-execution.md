# Ejecución del MVP de suscripciones y entrenadores

## Prueba personal de medios implementada y verificada

Receta explícita personal-test con BUILTIN_EXERCISE_MEDIA=1, todos los medios originales y avisos; comercial separado/default con0 ysinmedios. Ambos builds Docker reales exit0. Las6 pruebas de política pasaron sinfallos/saltos usando ambas imágenes. Se verificaron las13109 rutas/bytesSHA256:6554MP4+6554WebP+NOTICE; cabeceras de formato válidas, NginxHTTP200/MIMEcorrecto y hashes de avisos/licencia iguales. Dos builds negativos probaron rechazo de flags inconsistentes. No se visualizó ni alimentó a modelos con los activos.

Imagen personal de comprobación: sha256:f142dc23386111312029577f417ba24a1921f84ae32a8d9f34f799917e0efc7e. Comercial de comprobación: sha256:e1b08df444057c669e1b0e4d411449f775b9fd8e80ab970a0f07d34ad6921cff. Son frontend8e7+overlay de receta, no candidato funcional final ni despliegue. El próximo artefacto de prueba del MVP usará la variante personal, NO la exclusión comercial. La instrucción de John no otorga licencia comercial ni altera suscripciones/roles.

## Cambio de alcance vigente: prueba personal con animaciones

La instrucción más reciente de John sustituye la exclusión de medios para la fase de prueba personal/no comercial: conservar todos los clips y miniaturas originales, sin modificar y con sus avisos. NOTICE.md admite fork no comercial con los medios de180px; no equivale a licencia comercial. Se mantendrán recetas separadas personal-test(conmedios) y comercial(sinmedios). No cambia vigencias/roles ni autoriza uso comercial, publicación como pack independiente o alimentar modelos con los medios. El catálogo contiene6554MP4+6554WebP, no GIFliterales. La verificación personal será exhaustiva por inventario/rutas/hashes/HTTP, no por inspección visual de los activos. Los apartados inferiores de exclusión son históricos para esta fase y siguen aplicando sólo al build comercial.


## Producción JohnGym: hotfix cerrado, hold retirado

John notificó finalización verificada del hotfix: fuente 955d73fd41ebda7943dffd1ed5929ccef4d281c9, documentación 55f31aa9d5a84962d850c2fdb47e2f4f65acca93, rama pública branding/johngym-stable-hotfix. Handoff: /home/jhonsnake/openGym-branding-hotfix/BRANDING-DEPLOYMENT.md. Se leyó el handoff y se obtuvo la rama remota; no se hizo cherry-pick sobre el árbol sucio.

Nuevo baseline informado/verificado por coordinación: /opt/opengym/compose.yaml usa web johngym-web:955d73fd4, imagen sha256:62509a098c72bcdb5b523c28fc1966927ede5c42672fa50deec983f25e772120; API y datos sin cambios. La coordinación verificó100 pruebas focalizadas+build+2 E2E, health200 y anónimo data401; NO declaró suite heredada completa verde ni passkey real. No sustituye gates MVP.

HOLD DE COORDINACIÓN RETIRADO. MVP puede desplegar sólo tras sus propios gates y targets/alcances reales resueltos. Integrar deliberadamente JohnGym, paleta web scoped data-web-branding, favicon/PWA versionados y SW; conservar picker nativo, iconos de navegación/ejercicios y cambios funcionales. No restaurar branding neutral/openGym. No copiar branding-web.Dockerfile/overlay estable al MVP: conserva medios restringidos, mientras el MVP debe excluirlos. El enlace AGPL del MVP debe corresponder a su propia fuente pública, no quedarse apuntando sólo al hotfix. Refrescar preflight real inmediatamente antes del rollout y preservar la imagen JohnGym como rollback.

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
