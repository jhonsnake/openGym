# openGym — diseño de producto: suscripción y entrenador humano integrado

**Estado:** aprobado por John para elaborar el plan técnico. No autoriza implementación, cambios de roles, cobros ni cambios en producción.

**Registro de aprobación:** John aprobó el diseño consolidado publicado en `3fa8050723c66c3ba7b8df2db3a4f6cea45935e1` (SHA-256 previo a esta anotación: `02c2771dfdf398cad5463d44e4b7d2f730788de366c5bf4081eb74a31b4fc86c`). La aprobación incluye las propuestas de cierre funcional presentadas: lifecycle, web/PWA online, grants y revocación, invitación manual de siete días y semántica temporal Panamá/UTC con fin de mes. Las secciones que dicen propuesta conservan trazabilidad del borrador aprobado; no reabrir esas elecciones. Política formal de retención/borrado, licencia o reemplazo de medios y configuración comercial/evidencia de pago siguen como puertas de lanzamiento, no valores inventados ni permisos de despliegue.
**Fecha:** 2026-10-30.
**Decisión de producto:** módulo integrado en openGym, no portal separado.

## 1. Propósito y límite del primer lanzamiento

openGym permitirá a un entrenador humano prescribir y revisar entrenamiento de clientes que han consentido la relación, mientras la suscripción vigente del cliente habilita el uso funcional de entrenamiento. La suscripción es un derecho de acceso a la app, independiente de contratar o mantener el servicio de entrenador.

El recorrido ilustrativo es: **invitar → aceptar relación → confirmar cuando la cuenta era desconocida → activar suscripción por operación autorizada → asignar plan y metas → registrar ejecución → revisar cumplimiento**. No impone orden entre vinculación y activación comercial: pueden completarse en cualquier orden. El evento que concede vigencia es la confirmación transaccional de una operación manual del coordinador autorizado, no la carga de una referencia de pago; mostrar éxito solo tras readback de ese periodo persistido.

Este documento consolida decisiones aprobadas, decisiones de diseño tomadas bajo delegación y preguntas que requieren una última revisión comercial. No afirma que el producto actual ya tenga estas capacidades: la auditoría confirma que actualmente no existen entidades ni controles de relación entrenador–cliente, consentimiento, cartera, suscripción ni prescripción compartida. El estado personal sincronizado existente tampoco es una autoridad segura para esos derechos.

### Incluido para aprobación

- Relaciones de entrenador y cliente, consentimiento y cartera segregada.
- Roles combinables Cliente, Entrenador y Coordinador; administración de esos roles por Administrador.
- Suscripción temporal manual, con pagos externos, para acceso funcional.
- Prescripción individual, metas y revisión de ejecuciones consentidas.
- Corte de acceso, recuperación de borrador y exportación/solicitud de datos propios.
- Auditoría, pruebas de autorización y despliegue controlado.

### Fuera del primer lanzamiento

- Pasarela, cobros automáticos, precios, moneda, descuentos, comprobación automática de pago, cancelación y reembolsos.
- Biblioteca de plantillas de entrenador. Sigue siendo una **idea**, no entidad, hito ni prueba obligatoria del primer lanzamiento.
- Chat, nutrición, fotos, medidas, notas privadas compartidas, progreso automático, cambio automático de entrenador y carteras compartidas.
- Retención definitiva, borrado automático y compromisos de revocación de datos ya descargados.

## 2. Principios y decisiones rectoras

1. **Tres dominios independientes.** Cuenta (identidad/passkey y recuperación), suscripción (derecho temporal) y relación de entrenamiento (consentimiento y visibilidad) no se sustituyen entre sí.
2. **Mínimo privilegio.** Un rol, una invitación, una suscripción o un identificador adivinado nunca bastan por sí solos para acceder a datos de otra persona.
3. **Autoridad de servidor.** Vigencia, roles, ámbito, relación y grants se comprueban en cada acción protegida, incluida una sesión abierta. El reloj y el documento personal del dispositivo no elevan derechos.
4. **Separación de datos.** Relaciones, permisos, prescripciones, versiones y proyecciones compartidas requieren un dominio online transaccional separado del JSON personal de sincronización. Un cliente antiguo no puede sobrescribir esa autoridad con una subida de su perfil.
5. **Preservación sin acceso implícito.** Vencer, suspender relación o retirar un rol no borra cuenta ni registros; conservar datos no concede consulta funcional.
6. **Sin éxito falso.** Una acción bloqueada no muestra guardado, renovación ni compartición exitosa. Se conserva el contexto recuperable cuando corresponde.

## 2.1 Enfoques considerados

- Módulo integrado frente a portal separado: John eligió integrar. Mantiene un acceso, los editores y el recorrido personal existentes; el portal duplicaría identidad y navegación. La integración exige revisar autorización y compatibilidad antes de cambiar producción.
- Autoridad compartida dentro del JSON personal frente a dominio transaccional separado: se recomienda el segundo. La sincronización actual reemplaza documentos completos y clientes antiguos no deben poder borrar o conceder derechos comerciales. La elección de motor, migraciones y APIs concretas se reserva al plan técnico; no se incorpora infraestructura nueva por este documento.

## 3. Actores, ámbito y capacidades

Los roles operativos son fijos y combinables; no hay editor de permisos personalizado ni jerarquía que eluda ámbito, suscripción o consentimiento.

| Actor | Puede hacer | Nunca obtiene por ello |
|---|---|---|
| Cliente | Usar su espacio personal con rol Cliente y suscripción vigente; aceptar/rechazar/revocar relación; registrar ejecución; conceder grants explícitos; solicitar/exportar sus datos propios aun sin vigencia | Activar su propia suscripción, conceder roles/ámbito, aceptar por otra cuenta, abrir datos de otros |
| Entrenador | Crear y revocar sus invitaciones; confirmar una cuenta no preidentificada; prescribir y revisar solo relaciones activas con grants aplicables | Activar/renovar suscripciones si no es además Coordinador; ver cartera ajena, historial no concedido o actividad privada |
| Coordinador | Activar o renovar únicamente clientes que el Administrador le asignó; consultar identidad comercial mínima y vigencia | Prescribir, leer entrenamiento/peso/notas, gestionar roles, ampliar ámbito, autoactivarse o auto-renovarse |
| Entrenador + Coordinador | Suma las dos capacidades anteriores, cada una con su control propio | Eludir consentimiento, acceso a cartera ajena o prohibición de activar la propia suscripción |
| Administrador | Gestionar las combinaciones Cliente/Entrenador/Coordinador y asignar ámbito comercial explícito, con motivo y lectura de confirmación | Derecho automático de coordinación, ámbito global, acceso de entrenador o cambio de las protecciones existentes de propietario/último administrador |
| Propietario / mecanismo privilegiado existente | Conserva el mecanismo existente de administración/propietario; una futura concesión de coordinación global requiere diseñar un flujo privilegiado explícito y no existe por inferencia | Una modificación implícita de reglas de último propietario; este diseño no la cambia |

Un administrador que deba operar suscripciones necesita también capacidad de Coordinador y un ámbito explícito. La coordinación puede existir sin rol de Entrenador. El backoffice autorizado no exige suscripción personal, pero el uso personal como cliente sí exige rol Cliente y suscripción vigente.

## 4. Estados y transiciones autorizadas

### 4.1 Cuenta y rol operativo

| Estado | Actor → acción → permiso | Resultado / siguiente paso |
|---|---|---|
| Cuenta sin rol operativo | Administrador asigna Cliente, Entrenador y/o Coordinador, con motivo | La identidad permanece; solo se habilita la capacidad correspondiente, no una suscripción ni una relación |
| Rol vigente | Administrador retira rol con motivo | Efectivo en servidor incluso para sesiones abiertas; no borra datos ni altera eventos válidos anteriores |
| Entrenador con clientes activos | Administrador retira Entrenador | Debe elegir resolución explícita por cada vínculo: finalizar o iniciar reasignación con consentimiento; no hay transferencia silenciosa de historial ni de consentimiento |
| Coordinador retirado | Administrador retira Coordinador | Falla toda activación/renovación posterior; no cancela periodos ya concedidos |
| Cliente retirado | Administrador retira Cliente | Se bloquea el uso personal por rol; no borra datos ni cancela/reembolsa un periodo por defecto |

La asignación de rol, ámbito y suscripción se guarda de forma separada. Ningún actor se amplía rol o ámbito desde perfil, sincronización o API ordinaria.

### 4.2 Invitación y relación de entrenamiento

Un cliente puede tener **un solo entrenador activo** en la primera versión. La relación siempre conserva un identificador propio para que una futura ampliación no reescriba autorizaciones.

| Estado de invitación | Actor → acción → permiso | Estado / siguiente paso |
|---|---|---|
| Borrador | Entrenador crea ficha comercial mínima e invitación | No crea cuenta, acceso, suscripción ni datos compartidos |
| Pendiente | Cliente autenticado abre enlace y revisa entrenador, cuenta y alcance | Abrir no consume ni concede acceso; puede cambiar de cuenta o rechazar |
| Aceptada, cuenta conocida | Cliente acepta por su propia cuenta | Se activa relación si la comprobación transaccional confirma que no hay otro entrenador activo; comienza el intervalo de datos acordado |
| Aceptada, cuenta no preidentificada | Cliente acepta; Entrenador confirma que la cuenta corresponde al cliente | Hasta la confirmación no hay acceso ni intercambio de datos; al confirmar se aplica la misma comprobación de entrenador activo |
| Rechazada | Cliente rechaza | La cuenta continúa intacta; no se comparte nada |
| Revocada / vencida | Entrenador emisor revoca, o vence la invitación | No puede aceptarse; reenviar genera una nueva invitación y no otorga acceso |

La aceptación consume la invitación, pero el estado de la relación se guarda por separado. No usar un solo campo para las dos máquinas.

| Estado de relación | Actor → acción → permiso | Estado / siguiente paso |
|---|---|---|
| Pendiente de confirmación | Cliente de cuenta desconocida acepta; entrenador emisor confirma | No hay lectura hasta confirmar y reunir grant/vigencia; revalidar unicidad de entrenador al confirmar |
| Activa | Entrenador prescribe/revisa dentro de grants; Cliente usa con vigencia | Otro vínculo activo se deniega |
| Suspendida | Propuesta para aprobación: entrenador responsable o administrador suspende con motivo, sin cambiar vigencia comercial | Se detienen asignaciones y lecturas compartidas; actividad personal con suscripción sigue privada; no se congela ni reembolsa el periodo automáticamente |
| Reactivación pendiente | Propuesta: entrenador o administrador solicita; cliente acepta reanudar compartir | Solo se reactiva con capacidad de entrenador vigente y sin otro vínculo activo; sin respuesta permanece suspendida. Comparte únicamente ventana nueva, no el intervalo suspendido |
| Finalizada/revocada | Cliente revoca por sí mismo; propuesta adicional: entrenador responsable o administrador finaliza con motivo | Corta lectura incluso de lo antes compartido; continuar requiere invitación/aceptación nueva |

Propuesta para quitar rol Entrenador: el administrador resuelve sus vínculos activos/suspendidos con cierre explícito antes de retirar el rol, en operación coherente, sin crear vínculos huérfanos. No se implementa transferencia automática en la primera versión. Si se requiere otro entrenador, cerrar vínculo anterior e invitar/aceptar uno nuevo sin transferir historial/grants. Ni cierre ni suspensión alteran la suscripción independiente. Estas autoridades y mecánicas adicionales requieren aprobación de este diseño; no se presentan como decisiones previas de John.

**Elección de diseño propuesta, reversible:** enlace privado copiable, token opaco almacenado como hash, un solo uso, con caducidad de **7 días**, revocable y sin datos personales en URL ni logs. Es una propuesta, no una confirmación previa. El canal de entrega sigue abierto. GET, previsualizaciones y terceros no consumen el enlace ni revelan datos.

**Datos y ventana de compartición.** Aceptar la relación no autoriza retrospectivamente actividad anterior. El corte temporal ya acordado para elegibilidad es la aceptación del cliente, no la confirmación posterior del entrenador. Antes de confirmar una cuenta desconocida no hay acceso efectivo; la lectura solo se habilita después de esa confirmación, relación activa, consentimiento aplicable y suscripción vigente. No reinterpretar elegibilidad como autorización para compartir intervalos suspendidos, vencidos o sin grant. Historial anterior exige grant adicional explícito. Al reactivar después de suspensión, solo se comparte actividad nueva desde esa reactivación; el intervalo suspendido no se comparte automáticamente. Finalizar o revocar elimina el acceso del entrenador de modo provisionalmente aprobado; una relación nueva no revive datos, grants ni ventanas previas.

### 4.3 Suscripción

La suscripción pertenece al cliente y es independiente de su relación de entrenamiento. Tener entrenador, aceptar una invitación o registrar evidencia externa no prueba pago ni concede derecho.

| Estado | Actor → acción → permiso | Resultado / siguiente paso |
|---|---|---|
| Sin vigencia / futura | Cliente inicia sesión o consulta estado; Coordinador asignado prepara operación | Solo identidad, recuperación, estado, renovación y solicitudes/exportación de datos propios; no UI de entrenamiento |
| Vigente | Servidor alcanza el inicio efectivo | Cliente con rol Cliente puede usar acciones protegidas; Entrenador puede leer solo ejecución concedida de relación activa; Coordinador conserva solo gestión comercial |
| Vencida | Servidor alcanza el fin efectivo, sin gracia | Cliente pierde acceso funcional; entrenador pierde también lecturas de entrenamiento; Coordinador asignado conserva renovación; no se borra nada |
| Vigencia restaurada/ampliada | Coordinador confirma operación autorizada y servidor persiste el intervalo | El estado se deriva del intervalo resultante, no de una etiqueta permanente Renovada; no revive vínculo finalizado ni grants revocados |

Preparar o confirmar una renovación son estados de operación, no estados de suscripción. Preparar referencia/periodo no concede acceso. La confirmación manual autorizada persiste el intervalo y devuelve su versión; readback confirma el resultado. Si está vigente se extiende desde su fin actual; si venció se propone inicio en activación, siempre mostrando fechas exactas. Evidencia externa y vigencia son registros separados.

Las duraciones aprobadas son mensual, trimestral, semestral, anual y rango personalizado. Se calculan en meses de calendario y siempre muestran fecha efectiva de inicio y fin. Editar fechas cambia la selección a Personalizada; esta exige motivo. Precio, moneda y configuración comercial no se deducen de la duración.

**Elecciones de diseño propuestas, reversibles:** presentar el último día completo en zona horaria de negocio Panamá y guardar el límite como instante UTC exclusivo; para renovaciones por meses, conservar la fecha-ancla original y aplicar un ajuste al último día del mes cuando la fecha no exista, evitando deriva. Deben aprobarse antes de fijar contrato de acceso.

No hay pasarela ni autocargos en la primera versión. Un coordinador autorizado registra actor, cliente, periodo, motivo, referencia y fecha del servidor; el servidor confirma la vigencia de modo transaccional e idempotente. No se almacenan tarjetas ni credenciales bancarias y un comprobante manual no se presenta como pago verificado.

## 5. Matriz de acceso: acción → condiciones → estado/siguiente paso

| Acción | Condiciones de permiso acumulativas | Resultado si faltan / siguiente paso |
|---|---|---|
| Crear invitación | Entrenador activo | Crea solo invitación; no cartera con datos clínicos ni acceso |
| Aceptar relación | Cliente autenticado por passkey/credencial propia; invitación válida; consentimiento informado | Activa o deja pendiente de confirmación; sin suscripción no habilita entrenamiento |
| Confirmar cuenta desconocida | Entrenador emisor; aceptación pendiente; identificación verificada por su canal | Activa atómicamente o rechaza por relación activa concurrente |
| Ver cartera | Entrenador; relación propia activa; grant aplicable; suscripción vigente del cliente | Denegar sin revelar existencia; vencimiento del cliente corta lectura también desde URL/API/sesión abierta |
| Asignar/publicar plan o metas | Entrenador; relación propia activa; grant de plan; cliente vigente | Genera versión individual; suspensión/finalización/vencimiento deniega nuevas asignaciones |
| Consultar plan / iniciar sesión | Cliente; rol Cliente; suscripción vigente; asignación propia | Sin vigencia, mostrar estado y renovación, no contenido del plan |
| Registrar ejecución o finalizar sesión | Cliente; rol Cliente; suscripción vigente; sesión/plan propio | Sin vigencia bloquear escritura protegida, conservar borrador local sin éxito remoto |
| Revisar ejecución | Entrenador; relación activa; grant de ejecución; cliente vigente | Solo proyección consentida; nunca actividad no relacionada, datos de otro trainer ni intervalo no concedido |
| Ver peso corporal | Entrenador; relación activa; consentimiento específico de peso; cliente vigente | La aceptación general no basta; revocación corta nuevas lecturas |
| Gestionar suscripción | Coordinador; cliente asignado en su ámbito; no es propia suscripción | Ve identidad comercial mínima/vigencia, no entrenamiento; revalida rol y ámbito al persistir |
| Gestionar roles/ámbitos | Administrador por controles operativos; motivo; sin autoedición | No cambia privilegios de propietario/último admin; ámbito global solo vía privilegiada explícita |
| Exportar/solicitar datos propios sin vigencia | Cliente autenticado; alcance propio; controles de descarga y límites | Canal separado del entrenamiento; excluye planes privados de entrenador, contenido licenciado y datos ajenos |

## 6. Experiencia del cliente y del equipo

### Cliente

1. Recibe un enlace por el canal que se apruebe y ve identidad del entrenador, cuenta seleccionada, propósito y categorías de datos antes de aceptar.
2. Crea credenciales o inicia sesión personalmente; el entrenador nunca crea passkey ni consiente en su nombre.
3. Si la cuenta era desconocida, ve «pendiente de confirmación del entrenador», sin contenido compartido. Si ya era conocida, ve relación activa o un conflicto de entrenador activo sin revelar cartera ajena.
4. Con relación, rol y vigencia, recibe un plan asignado y metas opcionales. La interfaz señala qué ejecución se comparte y bajo qué alcance.
5. Al vencer, deja de navegar o registrar entrenamiento; ve estado, ruta de renovación, recuperación y exportación/solicitud de sus datos. El borrador existente se preserva, no se envía ni se marca como guardado.
6. Tras renovar, elige explícitamente recuperar el borrador. Recuperarlo no lo finaliza, duplica, sube ni comparte automáticamente; el intervalo sin derecho no se atribuye por fecha del dispositivo.

### Entrenador

1. Ve solo su cartera activa y el estado mínimo necesario: pendiente, activa, suspendida/finalizada y vigencia que afecta su capacidad de lectura.
2. Antes de asignar, revisa los grants de plan, ejecución, historial y peso. Sin el grant correspondiente no aparece ni se recupera por URL directa.
3. Prescribe por cliente y publica una versión; una versión nueva no modifica sesiones ya iniciadas.
4. Revisa cumplimiento exclusivamente de ejecuciones vinculadas a sus planes/metas y dentro de la ventana compartida. Vencimiento, revocación, finalización o retirada de rol cortan lectura inmediatamente en servidor.

### Coordinador y administrador

1. El administrador concede combinaciones operativas y asigna clientes a coordinadores, con motivo, resumen y guardado explícito.
2. El coordinador autorizado registra la operación externa y activa/renueva; ve solo identidad comercial mínima, periodo y estado.
3. La coordinación no crea una relación de entrenamiento ni acceso a rutinas, peso, notas o historial. Un administrador sin coordinación/ámbito no obtiene bypass.

## 7. Prescripción, metas y privacidad

### Plan y ejecución

- La prescripción es del entrenador; la ejecución real es del cliente. El entrenador no sobrescribe sets, sustituciones, omisiones, adiciones ni resultados.
- Cada ejercicio tiene objetivos comunes y ajuste opcional por serie para carga, repeticiones y RPE. Las repeticiones pueden ser exactas o rango; carga y esfuerzo pueden quedar sin prescribir. No se transforma ausencia en cero ni en cumplimiento.
- La ejecución registra valores reales de cada serie y esfuerzo percibido de forma distinta del objetivo. La clasificación completado/parcial/omitido/sustituido es una propuesta de revisión, no un porcentaje automático ni una progresión automática.
- Al iniciar una sesión se fija una instantánea inmutable de la versión prescrita. Editar o publicar después no reescribe la sesión iniciada ni sus resultados.

### Metas

Se incluyen metas opcionales de constancia (sesiones por semana), peso corporal y rendimiento (marca de ejercicio con carga y repeticiones explícitas). Tienen objetivo medible y fecha opcional; los cambios conservan evolución y no ajustan el plan automáticamente. Las unidades, validaciones de medición y relación exacta RPE/RIR requieren cierre de producto, sin reabrir estas tres categorías.

### Paquete de consentimiento propuesto para aprobación

Aceptar seguimiento autoriza prescripción y revisión de ejecución ligada al plan dentro de la ventana consentida; no autoriza todo el perfil. Rechazar ese paquete impide activar la relación de entrenamiento, pero no impide usar personalmente la app si la suscripción está vigente. Historial anterior y peso corporal son permisos separados y opcionales; el histórico debe tener un rango explícito. No introducir periodos por defecto para importarlo.

Propuesta: revocar el paquete de seguimiento finaliza el vínculo y corta todo acceso del entrenador, incluido lo ya compartido. Revocar solo peso o histórico corta nuevas consultas de esa categoría/rango, incluidas las mediciones anteriores, sin terminar por sí mismo el vínculo. Minimizar también resúmenes, metas, descargas y cachés para que no expongan indirectamente la categoría revocada. No borrar registros originales del cliente ni prometer borrar descargas externas. Volver a compartir una categoría requiere un grant nuevo; reactivar relación o renovar no lo restaura.

### Visibilidad por defecto

| Dato | Visibilidad para entrenador |
|---|---|
| Planes/metas asignados y ejecución asociada | Solo relación activa, grant aplicable y suscripción vigente del cliente |
| Entrenamiento personal ajeno al plan | Privado por defecto |
| Historial anterior a la aceptación | Solo grant histórico adicional y verificable |
| Peso corporal | Solo consentimiento específico; rechazarlo no bloquea el plan |
| Fotos, medidas corporales y notas personales | No se comparten automáticamente; fuera del primer lanzamiento |
| Intervalo suspendido | No se comparte automáticamente tras reactivación |

Retirar acceso al finalizar o revocar elimina la consulta del entrenador de datos antes compartidos, como decisión provisional aprobada. Las copias descargadas fuera del sistema no pueden revocarse garantizadamente; no se promete DRM ni borrado remoto.

## 8. Requisitos de autorización, integridad y auditoría

- Cada lectura y escritura protegida debe comprobar en el servidor actor, rol vigente, ámbito, relación, estado, grant, suscripción y versión aplicable. Ocultar una pantalla no es control suficiente.
- Las operaciones concurrentes deben ser idempotentes y transaccionales: dos aceptaciones no generan dos entrenadores activos; reintentar la misma renovación no duplica periodo; retirar un rol invalida una operación aún no confirmada. Una renovación legítima distinta no es un replay: requiere un nuevo intento explícito sobre la versión vigente de la suscripción. Si dos coordinadores usan la misma versión anterior, uno confirma y el otro recibe conflicto para revisar las nuevas fechas antes de volver a confirmar; no extender dos veces silenciosamente ni descartar una compra diferente como duplicado.
- Las respuestas y auditorías minimizan datos: no revelar si existe una cuenta, cartera o relación por IDs ajenos. Paginación y filtros no atraviesan límites de relación.
- Registrar para cambio de rol/ámbito, invitación, consentimiento, relación y vigencia: actor, destinatario, transición anterior/nueva, motivo cuando aplique, referencia y fecha del servidor. La auditoría no contiene sets, notas ni salud innecesaria.
- La administración existente tiene lecturas amplias de perfiles; no debe usarse como vía de entrenador ni declararse corregida por este diseño. Su revisión de privacidad es una puerta de lanzamiento.

## 9. Escenarios de aceptación

1. **Doble consentimiento de cuenta desconocida.** Un entrenador invita; una cuenta nueva acepta; antes de confirmar, el entrenador no puede leer ni prescribir. Tras confirmar, solo se activa si no hay otro entrenador activo.
2. **Aislamiento de carteras.** Con dos entrenadores y dos clientes, cualquier lectura, escritura, enumeración, invitación o identificador cruzado devuelve denegación sin filtrar datos.
3. **Consentimiento no equivale a vigencia.** Un cliente con relación activa pero suscripción vencida no abre plan ni registra; el entrenador tampoco lee sus entrenamientos; el coordinador asignado sí puede renovar sin verlos.
4. **Corte en sesión abierta.** La vigencia vence durante una sesión: se bloquean nuevas acciones y sincronización protegida, se conserva borrador y no se informa éxito remoto. Tras renovar, recuperar exige elección explícita y no hay carga/compartición automática.
5. **Periodo y renovación.** El coordinador asignado registra un trimestral; se muestran fechas exactas. Una renovación vigente empieza al fin actual; una vencida propone activación. Reintentar no duplica derecho ni cambia fechas pasadas.
6. **Prescripción inmutable.** El entrenador publica una nueva versión después de comenzar sesión; la sesión conserva objetivos originales y el entrenador no puede sobrescribir ejecución real.
7. **Privacidad de categorías.** Sin grant histórico o consentimiento de peso, el entrenador no ve esos datos; aceptar al entrenador no desbloquea entrenamiento personal ajeno, fotos, medidas ni notas.
8. **Fin y reactivación.** Finalizar corta incluso historial compartido. Una relación posterior requiere nueva aceptación y comparte solo datos nuevos; no revive permisos, historia ni el intervalo suspendido.
9. **Roles y ámbito.** Entrenador sin Coordinador no renueva por API; coordinador sin Entrenador no prescribe ni lee datos; administrador sin coordinación y ámbito no opera vigencias; retirar coordinación invalida una sesión abierta.
10. **Clientes antiguos y offline.** Una subida del JSON personal antiguo no cambia suscripciones, relaciones ni prescripciones. Un cliente offline no recibe acceso compartido ni encola asignaciones/revisiones como éxito.

## 10. Despliegue, riesgos y métricas propuestas

### Puertas duras antes de producción

1. Aprobar las preguntas críticas de §11 y política de privacidad/retención aplicable.
2. Resolver licencia comercial o reemplazo de los medios de ejercicios antes de ofrecer una suscripción comercial.
3. Validar que rutas, sesiones abiertas, caché, PWA y clientes nativos no eluden vigencia ni filtran datos; no prometer revocación absoluta de datos ya descargados.
4. Demostrar pruebas negativas de autorización, doble entrenador, revocación, vencimiento durante sesión, cliente antiguo y modo offline.
5. Revisar la superficie administrativa existente para que no se presente como autorización de entrenador.

### Compatibilidad y offline propuestos para aprobación

Primer lanzamiento del producto gestionado: web/PWA con comprobación online del servidor para cargar contenido protegido y ejecutar acciones. Sin conexión o sin poder comprobar acceso, mostrar estado no verificable y no habilitar nuevas acciones de entrenamiento; conservar el borrador sin falso éxito remoto. No incluir licencia offline temporal en este corte. El backoffice también requiere conectividad y autorización actual.

Clientes nativos/antiguos sin estos controles no se consideran soportados para usar el nuevo servicio. El plan técnico definirá negociación de versión/capacidades y la respuesta de actualización necesaria; no confiar en una cabecera enviada por el cliente para conceder derechos. Las APIs siempre comprueban vigencia independientemente de la versión. Diseñar caché/PWA para no servir datos protegidos después de fallo de comprobación o cambio de cuenta, sin prometer retirar contenido que un cliente antiguo ya descargó.

Antes de imponer el corte: inventariar clientes y datos pendientes, facilitar exportación/adopción explícita del estado propio y mostrar aviso de actualización. La adopción de un borrador no activa permisos ni comparte intervalos privados. No imponer eliminación local ni migración automática para aparentar compatibilidad. Las versiones mínimas exactas son responsabilidad del plan técnico y deben probarse contra los clientes realmente usados.

### Lanzamiento controlado propuesto

- Piloto interno con un entrenador y clientes consentidos; prueba separada obligatoria con dos entrenadores para aislamiento.
- Activación manual y reversible por grupos, con observación de denegaciones, errores de vigencia y recuperación de borradores antes de ampliar.
- No imponer el corte a clientes previos hasta completar pruebas de compatibilidad, comunicación y recuperación. No borrar ni migrar automáticamente sus datos como mecanismo de despliegue.
- Definir procedimiento de soporte que restablezca acceso solo mediante autoridad/ámbito válidos, sin usar acceso a datos de entrenamiento como atajo.

### Riesgos y mitigaciones

| Riesgo | Mitigación exigida |
|---|---|
| Filtración entre carteras o por admin existente | Dominio separado, comprobación por relación/grant en cada endpoint, pruebas negativas y revisión de admin |
| Cliente antiguo sobrescribe autoridad | Suscripción y relaciones fuera del blob personal; pruebas de PUT y conflictos |
| Corte remoto incompleto por caché/offline | Auditoría de clientes/PWA/nativo, modo online para funciones compartidas, comunicación honesta y despliegue gradual |
| Pérdida o falso éxito al vencer | Borrador conservado, recuperación explícita, sin upload/backfill automático |
| Operación comercial indebida | Ámbito explícito, prohibición de autoactivación, auditoría e idempotencia; no etiquetar evidencia manual como pago verificado |
| Uso comercial de medios sin derecho | Licencia verificable o reemplazo antes de comercializar |

### Métricas propuestas, no medidas actualmente

- Tasa y tiempo de conversión por estado: invitación enviada → aceptación → confirmación → relación activa → primera asignación → primera sesión compartida.
- Porcentaje de renovaciones realizadas antes del vencimiento y tiempo hasta recuperar acceso después de renovación.
- Denegaciones de autorización por tipo (rol, ámbito, relación, grant, vigencia) y cualquier intento de acceso cruzado.
- Porcentaje de borradores recuperados explícitamente, abandonados y casos de falso éxito detectados (objetivo: cero).
- Tasa de errores/idempotencia en renovaciones e invitaciones y número de conflictos de entrenador activo.
- Cobertura de pruebas de matriz de autorización y tasa de regresiones en clientes anteriores/offline.

No se usarán como métrica datos de salud o ejecución individual salvo que una política de privacidad aprobada lo permita de forma minimizada.

## 11. Preguntas críticas para una única revisión final

1. **Privacidad y retención:** aprobar política formal de conservación, borrado, copias de seguridad, auditoría, exportación y revocación por categoría; este diseño no inventa plazos legales ni retención indefinida.
2. **Medios comerciales:** confirmar licencia comercial adecuada o decisión de reemplazo de medios antes de lanzar una oferta de pago. No es permiso para reutilizarlos ni bloquea por sí solo planificar código sin comercializar.
3. **Invitación:** aprobar o modificar canal, vinculación de identidad, caducidad propuesta de siete días y reenvío/revocación. La elegibilidad desde aceptación y el bloqueo hasta confirmación para cuenta desconocida se mantienen; concretar grants sin mover ese corte.
4. **Lifecycle y compatibilidad:** aprobar o corregir los valores concretos propuestos en §4.2 y §10: suspensión por entrenador/administrador, reactivación con aceptación del cliente, uso personal con suscripción, cierre seguido de nueva invitación para cambiar entrenador y lanzamiento web/PWA online sin soporte de clientes antiguos que no cumplan controles.
5. **Tiempo comercial:** aprobar zona Panamá, último día inclusivo en UI/límite UTC exclusivo y ajuste fin-de-mes propuestos, o sustituirlos por otra regla explícita.
6. **Pago externo:** definir evidencia aceptable, responsable de comprobación y procedimiento comercial. Precio y moneda pueden configurarse para lanzamiento; no bloquean el contrato de producto si se mantienen fuera del código de derechos.
7. **Cancelación y reembolsos:** permanecen fuera de la primera versión; aprobar política antes de habilitarlos, sin inferirla de activar/renovar.
8. **Permisos de datos y autoridad excepcional:** aprobar el paquete y revocación por categoría de §7. La asignación global de coordinación, si se necesita, requiere autorización privilegiada explícita y plan propio; no es necesaria para el piloto de ámbitos directos ni existe por inferencia del mecanismo actual. No hay autoasignación ni cambio implícito de protecciones del propietario.

## 12. Aprobación solicitada

La aprobación de este documento fija el contrato funcional y de privacidad descrito, junto con las decisiones propuestas que se confirmen en §11. No aprueba arquitectura concreta, base de datos, framework, endpoints, despliegue, cobros, cambios de producción ni uso comercial de medios sin la puerta correspondiente. Después de esa aprobación procede un plan técnico separado y su autorización expresa.
