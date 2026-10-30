# Ejecución del MVP de suscripciones y entrenadores

## Autorización y contrato

John autoriza implementar, verificar y desplegar el MVP de https://gym.johnprada.co una vez superados sus gates, sin reiterar aprobación de tareas ordinarias. Esta autorización sustituye las restricciones de planificación únicamente del encabezado y handoff anteriores; no altera los requisitos funcionales aprobados ni autoriza privilegios reales por suposición.

Base exacta de contrato y código: 28a6e92481d6e79327312fcaafe7eb0b93f739c6 de jhonsnake/openGym. Rama de ejecución: feat/subscriptions-human-trainers. Especificación, plan y anexo: docs/superpowers/. No reabrir diseño ni aceptar una respuesta de plan en lugar de implementación.

Requisito visual adicional de John: adoptar la paleta de https://eponasalud.com/entrena/login.php y retirar logo/iconos identificativos de openGym. Paleta declarada verificada: #07003c fondo, #14007d principal, #210d67 fondo alternativo, #1d0b6b superficie, #ffad2f acento, #ffffff texto, #c3bce8 secundario, #3d2c8f borde. No copiar marca, imágenes ni código de EPONA/FUNBEAT. Conservar avisos de licencia y recursos PWA neutros cuando sean necesarios.

## Límites que siguen vigentes

Preservar cuentas/passkeys y datos, dominio/RP_ID/ORIGIN y otros servicios. No reactivar el origen. No inventar precios, pagos, derechos de medios, retención o identidades privilegiadas. No conceder roles/subscripciones reales sin target y alcance explícitos. Activación gestionada exige gates de privacidad/comercial/compatibilidad; un bloqueo de activación no cancela implementación ni pruebas independientes seguras. No declarar listo con suites fallidas, controles sin activar o funciones ausentes.

## Estado y propiedad

- T0–T2: en ejecución inicial. Dueño API: api/* exclusivamente, sin frontend ni operaciones. Contratos/SQLite/identidad/capabilities/bootstrap y pruebas aisladas; no operaciones remotas.
- Identidad visual y T0 browser: dueño frontend/public y estilos/componentes de marca, frontend package/lock/config y pruebas propias. Sin api/*; sin cambiar flujos de dominio todavía. No solapar escritores de App/Login/SW con fases siguientes.
- T3–T4: pendiente, depende de servicio/contrato estable.
- T5–T7: pendiente, API secuencial con el mismo dueño de server.js.
- T8–T9: pendiente, integración real y navegador sin mocks.
- T10–T11: pendiente, backup/restore y evidencia final.
- Despliegue: pendiente de implementación, revisión y gates.

Evidencia temporal y briefs: /home/jhonsnake/.hermes/cache/scratch/opengym-mvp/. Los informes de procesos no sustituyen revisión del diff ni ejecución de gates. Sólo quien coordina integra, marca tareas completadas, hace commits/push y verifica remoto. Ningún escritor recibe permiso para commit, push, SSH, producción ni atribuciones en entregables.

## Evidencia

Preflight local: repositorios de código/operaciones/Obsidian limpios; rama creada desde el contrato exacto. Node local 22.23.0, Codex CLI 0.165.0, Docker disponible. Runtime base verificado en contenedor real node:22.23.4-alpine, digest sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914: Node v22.23.4 abrió SQLite, creó/leyó fila, ejecutó sqlite.backup y abrió snapshot read-only con integrity_check=ok y una fila. node:sqlite mantiene advertencia experimental. La imagen final de la aplicación aún debe pasar su gate propio. Preflight remoto read-only: api/web/Caddy saludables, API health ok y almacenamiento escribible, una cuenta; no se alteró producción. Suites del nuevo producto y producción del MVP: PENDING.
