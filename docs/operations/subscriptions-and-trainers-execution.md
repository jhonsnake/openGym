# Ejecución del MVP de suscripciones y entrenadores

## Autorización y contrato

John autoriza implementar, verificar y desplegar el MVP de https://gym.johnprada.co una vez superados sus gates, sin reiterar aprobación de tareas ordinarias. Esta autorización sustituye las restricciones de planificación únicamente del encabezado y handoff anteriores; no altera los requisitos funcionales aprobados ni autoriza privilegios reales por suposición.

Base exacta de contrato y código: 28a6e92481d6e79327312fcaafe7eb0b93f739c6 de jhonsnake/openGym. Rama de ejecución: feat/subscriptions-human-trainers. Especificación, plan y anexo: docs/superpowers/. No reabrir diseño ni aceptar una respuesta de plan en lugar de implementación.

Requisito visual adicional de John: adoptar la paleta de https://eponasalud.com/entrena/login.php y retirar logo/iconos identificativos de openGym. Paleta declarada verificada: #07003c fondo, #14007d principal, #210d67 fondo alternativo, #1d0b6b superficie, #ffad2f acento, #ffffff texto, #c3bce8 secundario, #3d2c8f borde. No copiar marca, imágenes ni código de EPONA/FUNBEAT. Conservar avisos de licencia y recursos PWA neutros cuando sean necesarios.

Decisión comercial adicional explícita: John eligió excluir las animaciones y demás archivos restringidos de Gym Visual y conservar catálogo textual y diagramas permitidos. El build web excluye catalogue/media y fija VITE_BUILTIN_EXERCISE_MEDIA=0; su consumo frontend y los iconos PNG neutros están en corrección. La imagen final debe demostrar ausencia real de esos archivos. El código fuente del fork es público; mantener acceso al código correspondiente de la versión desplegada.

## Límites que siguen vigentes

Preservar cuentas/passkeys y datos, dominio/RP_ID/ORIGIN y otros servicios. No reactivar el origen. No inventar precios, pagos, derechos de medios, retención o identidades privilegiadas. No conceder roles/subscripciones reales sin target y alcance explícitos. Activación gestionada exige gates de privacidad/comercial/compatibilidad; un bloqueo de activación no cancela implementación ni pruebas independientes seguras. No declarar listo con suites fallidas, controles sin activar o funciones ausentes.

## Estado y propiedad

- T0–T2: base de autoridad corregida y verificada. Hallazgos cerrados de validación, esquema, permisos, contexto server-only, replay, auditoría y atomicidad. La suite API completa terminó con 722 tests PASS, 0 fallos, sin saltos; esto no prueba handlers T3+ aún inexistentes ni ausencia de defectos no cubiertos. Backup T10 mantiene defecto WAL separado y pendiente; no aceptar ni desplegar ese helper hasta corregirlo. OpenAPI de las cuatro rutas iniciales y CSP cuentan con pruebas ejecutadas. Las suites completas frontend todavía son inconclusas por timeout bajo carga, no verdes.
- Identidad visual y T0 browser: dueño frontend/public y estilos/componentes de marca, frontend package/lock/config y pruebas propias. Sin api/*; sin cambiar flujos de dominio todavía. No solapar escritores de App/Login/SW con fases siguientes.
- T3–T4: siguiente implementación backend autorizada, desde el servicio/contrato estable; interfaces nuevas deben usar authorityContext server-only y conservar los guards ya revisados. No requiere repetir aprobación.
- T5–T7: pendiente, API secuencial con el mismo dueño de server.js.
- T8–T9: pendiente, integración real y navegador sin mocks.
- T10: cambios offline de scripts y pruebas de backup/restore recibidos, sin operaciones remotas. Detectado por prueba adicional: immutable=1 en el helper omitía commits WAL (fuente 1 fila, snapshot 0, éxito falso); corregir mediante copia quiescente privada de DB+WAL y backup SQLite que los reconcilie, con fuente intacta. NO desplegar ese helper antes de la regresión y prueba real de imagen. Helper de snapshot e integración con imagen final quedan pendientes del contrato de almacén corregido. T11 y evidencia final pendientes.
- Despliegue: pendiente de implementación, revisión y gates.

Evidencia temporal y briefs: /home/jhonsnake/.hermes/cache/scratch/opengym-mvp/. Los informes de procesos no sustituyen revisión del diff ni ejecución de gates. Sólo quien coordina integra, marca tareas completadas, hace commits/push y verifica remoto. Ningún escritor recibe permiso para commit, push, SSH, producción ni atribuciones en entregables.

## Evidencia

Preflight local: repositorios de código/operaciones/Obsidian limpios; rama creada desde el contrato exacto. Node local 22.23.0, Codex CLI 0.165.0, Docker disponible. Runtime base verificado en contenedor real node:22.23.4-alpine, digest sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914: Node v22.23.4 abrió SQLite, creó/leyó fila, ejecutó sqlite.backup y abrió snapshot read-only con integrity_check=ok y una fila. node:sqlite mantiene advertencia experimental. La imagen final de la aplicación aún debe pasar su gate propio. Preflight remoto read-only: api/web/Caddy saludables, API health ok y almacenamiento escribible, una cuenta; no se alteró producción. Suites del nuevo producto y producción del MVP: PENDING.
