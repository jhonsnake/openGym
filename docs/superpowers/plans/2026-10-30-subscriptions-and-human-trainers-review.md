# Revisión del plan técnico de suscripciones y entrenadores

Estado: listo para revisión del plan por John. No constituye aprobación de implementación, pruebas de software superadas ni autorización de despliegue.

Documentos revisados:
- 2026-10-30-subscriptions-and-human-trainers.md
- 2026-10-30-subscriptions-and-human-trainers-contracts.md
- ../specs/2026-10-30-subscriptions-and-human-trainers-design.md

## Hallazgos cerrados en el plan

- Suscripción aplicada también a APIs personales existentes y shell/sync/PWA, con modo gestionado explícito y excepciones acotadas.
- Invitación sin token en query/log/storage, alta invite-only recuperable y destinatario preidentificado ligado al UID exacto.
- Contratos de metas, carga, ejecución, omisiones/sustituciones y ventanas/grants alineados con productores, rutas y consumidores.
- Fuentes explícitas y proyecciones mínimas de historial/peso, conservando propiedad y exportación del cliente después de retirar acceso al entrenador.
- SQLite como autoridad única compartida, sin doble escritura al JSON personal.
- Revalidación de autoridad, ledger durable de todas las mutaciones, versiones por aggregate y pruebas planeadas de carrera con conexiones SQLite reales.
- Bootstrap privilegiado separado, identidad activa y solicitud de borrado sin eliminación automática no autorizada.
- Pruebas de navegador real con servidor y web aislados, pasos de dependencia/descubrimiento y viewports explícitos.
- Backup consistente en staging con origen read-only, misma imagen autorizada y restauración aislada; nunca reemplazar la base productiva al exportar.
- Trazabilidad de tareas, archivos, contratos y pruebas; resultados futuros marcados PLANNED y sin atribución de herramientas en entregables.

La comprobación final focalizada no encontró contradicciones concretas en los tres bloques que habían quedado parciales: binding de identidad, historial/peso/DTOs y replay/versiones. Los demás hallazgos ya habían sido revisados como abordados.

## Evidencia ejecutada durante planificación

Lectura del código y manifiestos existentes; comprobación de rutas/archivos, enlaces y secuencia de tareas; comparación exacta de la especificación copiada contra el origen aprobado. Probe local de DatabaseSync y sqlite.backup en Node 22.23.0: disponibles, con advertencia experimental. Se consultó la versión publicada de la dependencia de navegador, sin instalarla.

No se ejecutaron pruebas del producto nuevo, builds, instalaciones, cambios de cuentas ni operaciones en producción. La compatibilidad real de la imagen Node 22.23.4, suites unit/API/browser/ops, licencia de medios, política formal de retención y configuración comercial siguen como gates posteriores. La ejecución requiere revisión y autorización del plan.
