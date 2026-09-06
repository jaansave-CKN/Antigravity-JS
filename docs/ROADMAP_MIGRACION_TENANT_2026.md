# Roadmap — Migración del Pool Principal a `withTenant()` (RadFor-360)

> **ACTUALIZACIÓN 2026-09-06 (re-verificado en vivo, no supuesto):** este documento
> quedó desactualizado por 2 sesiones de trabajo real que no lo tocaron. Estado
> real confirmado contra el código y la BD antes de escribir esta nota:
> - **Fase 1 COMPLETA** (commit `1118e61`, 2026-09-05, sesión previa a este
>   documento actualizarse): `anexos.routes.js` y `proyectos.routes.js`
>   totalmente migrados a `withTenant()`. Ese mismo commit migró también
>   `reporte.routes.js` (Fase 2) de forma adelantada.
> - **Fase 2 — ✅ OFICIALMENTE LIQUIDADA (2026-09-06):** `biblioteca.routes.js`
>   (20 call sites), `fichaTecnica.routes.js` (10, 1 se queda intencionalmente
>   sin tenant — verificación pública de hash sin sesión), `marcoNormativo.routes.js`
>   (8) y `compliance.routes.js` (9, cierre de la fase) migrados y verificados
>   (GRANT vía `059_rls_scoped_grants_fase2.sql`; 11/11 + 10/10 pruebas de
>   regresión + aislamiento cruzado passed en 2 tandas). `compliance.routes.js`
>   incluyó un caso real no trivial: la ruta de admin-bypass (`PATCH
>   /api/proyectos/:id/estado-legal`) tenant-escopa por `proyecto.org_id` (el
>   dueño real), no por `req.userId` — de lo contrario RLS habría bloqueado
>   silenciosamente a cualquier admin gestionando un proyecto ajeno, verificado
>   con una prueba dedicada (admin real vs proyecto de otro tenant).
> - Se agregó `withTenantTransaction()` a `database.config.js` (mismo contrato
>   que `runTransaction()`, pero corre bajo el pool RLS-escopado) — necesario
>   para el sello atómico de Ficha Técnica (M12), reutilizable en Fase 3 para
>   `presupuesto.routes.js`/`configLogistica.routes.js`, que el roadmap original
>   ya anticipaba con "mismo patrón de transacción atómica".
> - **Fase 3, lote 1 — ✅ COMPLETADO (2026-09-06):** `presupuesto.routes.js` y
>   `configLogistica.routes.js` migrados. GRANT en
>   `060_rls_scoped_grants_fase3.sql` (solo `project_budgets`). Primer uso real
>   de `withTenantTransaction()` fuera de Ficha Técnica. `catalogo_rendimientos`
>   excluida a propósito (RLS activo sin política = deny-all sin BYPASSRLS, sin
>   columna de tenant — catálogo global). 14/14 pruebas passed.
> - **Fase 3, lote 2 — ✅ COMPLETADO (2026-09-06):** `radicacion.routes.js` (5),
>   `motorDialectico.routes.js` (5), `exportacion.routes.js` (5) y
>   `authGoogle.controller.js` (5) migrados a `withTenant()`. GRANT en
>   `061_rls_scoped_grants_fase3_lote2.sql` (`project_indicators` y
>   `user_credentials` — el resto de las tablas del lote ya tenía GRANT de
>   fases previas). Hallazgo colateral: `getGoogleAccessToken()`
>   (`authGoogle.controller.js`) no tiene ningún caller real en el repo hoy
>   (verificado con `grep -rn "getGoogleAccessToken("` — solo su propia
>   definición; `server.js` la importa en la línea 24 pero nunca la invoca) —
>   se migró igual por consistencia del archivo, documentado como código
>   muerto, no como deuda de tenant. 15/15 pruebas de regresión + aislamiento
>   cruzado passed (incluye una prueba de que `DELETE /api/auth/google/revoke`
>   borra la fila de verdad en BD, no solo devuelve 200).
> - **Fase 4 — ✅ COMPLETADA (2026-09-06):** `subscriptions.routes.js` (7),
>   `stripeProvider.js::getOrCreateCustomer()` y el motor de negocio
>   `subscriptionEvents.js` (usado por ambos webhooks) migrados. GRANT en
>   `062_rls_scoped_grants_fase4.sql` (solo `user_subscriptions`).
>   `stripe_events`/`wompi_events` (ledger de idempotencia de los webhooks)
>   quedan deliberadamente sin escopar — ver detalle en la sección Fase 4 más
>   abajo. Encontrado y corregido un bug real preexistente (no de tenant):
>   `cancel_at_period_end` es INTEGER, el código bindeaba un boolean de JS —
>   nunca se había ejecutado porque Stripe está dormido en este entorno
>   (llaves vacías). 17/17 pruebas passed.
> - **Hallazgo pendiente de re-verificar en la próxima sesión (no es deuda de
>   Fase 4, es un residuo de fases anteriores marcadas "ya migradas" sin
>   re-chequear a fondo):** `matrizRaci.routes.js`, `copiloto.routes.js`,
>   `entradaIA.routes.js`, `estresFinanciero.routes.js` y
>   `valorExponencial.routes.js` tienen cada uno 1 `getRow()` crudo restante —
>   un `checkOwnership(proyectoId, userId)` que consulta `proyectos` en el
>   pool principal ANTES de delegar a un service que sí usa `withTenant()`.
>   No es una fuga de datos hoy (el filtro `WHERE id = ? AND org_id = ?` ya es
>   correcto a nivel de app), pero es exactamente el mismo patrón de
>   `checkOwnership` que se migró en `motorDialectico.routes.js` (Fase 3 Lote
>   2) — la tabla `inventario real` de la sección 1 los listaba como "Ya
>   migrados" sin haber re-verificado este detalle. Bajo riesgo, bajo costo de
>   arreglar (5 archivos × 1 línea), candidato natural para un lote de cierre
>   rápido antes o durante la Fase 5.
> - **Fase 5, Bloque 1 (Auth & Sesión en `server.js`) — ✅ COMPLETADO
>   (2026-09-06):** 26 call sites migrados (`register`, `login`, `mfa/*`,
>   `verify`, `validar-por-correo`, `me`, `change-password`, `reset-password`,
>   `validate-action`). `usuarios`/`user_subscriptions` ya tenían GRANT
>   completo de fases previas — sin migración de GRANT nueva. `revoked_tokens`
>   (blacklist de tokens) queda deliberadamente sin escopar — ledger de
>   seguridad GLOBAL cargado completo en memoria al arrancar, mismo criterio
>   que `stripe_events`/`gemini_key_state`. El panel de administración de
>   usuarios (~40 call sites, físicamente intercalado en el mismo rango de
>   `server.js`) y `/api/credentials/*` quedan fuera a propósito — son áreas
>   funcionales distintas, para un Bloque 2/3 futuro. 35/35 pruebas passed vía
>   HTTP real (registro, login, MFA completo con TOTP real, cambio de
>   contraseña con revocación bulk verificada, reset de contraseña con
>   anti-replay verificado en BD, logout, aislamiento cruzado entre 2 usuarios
>   reales).
> - **Fase 5, Bloque 2 (Administración de Usuarios) — ✅ COMPLETADO
>   (2026-09-06):** 15 call sites migrados en las 8 rutas admin-bypass
>   (`aprobar`, `rechazar`, `permisos`, `dev/make-admin`, `aprobar-por-correo`,
>   `rechazar-por-correo`, `purgar` + el helper `registrarAuditoriaAdmin`).
>   GRANT en `063_rls_scoped_grants_fase5_bloque2.sql` (solo `user_favorites`).
>   `DELETE /usuarios/:id/purgar` consolidado en una sola
>   `withTenantTransaction()` atómica (mejora real de atomicidad, antes solo
>   una parte de la cascada estaba en transacción). Vistas admin genuinamente
>   globales (`auditoria`, `usuarios/pendientes`, `usuarios`, `finops`) quedan
>   sin escopar a propósito — RLS no puede expresar "todas las filas de todos
>   los tenants"; `admin_audit_log`/`ai_token_logs` además tienen RLS activo
>   sin ninguna política (deny-all verificado en vivo). 28/28 pruebas passed,
>   incluida una prueba hostil explícita: un `withTenant()` con el tenant
>   INCORRECTO (el id del admin) contra la fila de un usuario objetivo afecta
>   0 filas — RLS rechaza la intrusión a nivel de base de datos.
> - **Regla para la próxima sesión**: antes de elegir el siguiente lote,
>   re-verificar con `grep -c` real (getRow/getRows/runSql vs withTenant\*) en
>   cada archivo de la tabla de abajo — este documento puede volver a
>   desactualizarse si otra sesión migra código sin actualizarlo aquí.

**Fecha:** 2026-09-04/05. **Contexto:** `docs/AUDITORIA_SEGURIDAD_2026-09-04.md` §3 dejó documentada la deuda —
el pool principal (rol `postgres`, `BYPASSRLS=true`) sigue sirviendo ~397 call sites reales sin backstop de RLS,
protegidos hoy solo por filtro manual `WHERE org_id = ?`/`checkOwnership()` por ruta. Este documento traza cómo
cerrar esa deuda por fases verificadas, no en una sola pasada.

**Por qué por fases y no de una vez:** el propio pool principal existe porque repuntar `DATABASE_URL` a un rol sin
`BYPASSRLS` de golpe rompería en silencio el 100% de las ~397 rutas que nunca hacen `SET LOCAL app.org_id` — RLS
sin ese contexto deniega todo por defecto. Migrar por fases, archivo por archivo, con test de regresión antes de
avanzar a la siguiente, es la única forma de hacer esto sin apagón.

---

## 1. Inventario real (verificado, no estimado)

| Ubicación | Call sites (`getRow`/`getRows`/`runSql`) | Estado |
|---|---:|---|
| `server.js` (núcleo, Fase 5) | 263 → ~222 pendientes + 26 withTenant (Bloque 1: auth/sesión) + 15 withTenant (Bloque 2: admin usuarios) | **Bloque 1 y Bloque 2 MIGRADOS** (2026-09-06) — resto del archivo pendiente |
| `backend/routes/anexos.routes.js` | 30 withTenant | **MIGRADO COMPLETO** (commit `1118e61`, 2026-09-05) |
| `backend/routes/biblioteca.routes.js` | 20 → withTenant | **MIGRADO COMPLETO** (2026-09-06, este documento) |
| `backend/routes/proyectos.routes.js` | 25 withTenant | **MIGRADO COMPLETO** (commit `1118e61`, 2026-09-05) |
| `backend/routes/fichaTecnica.routes.js` | 10 → 9 withTenant + 1 sin tenant (a propósito) | **MIGRADO COMPLETO** (2026-09-06, este documento) |
| `backend/routes/compliance.routes.js` | 9 withTenant | **MIGRADO COMPLETO** (2026-09-06, cierre de Fase 2) |
| `backend/routes/marcoNormativo.routes.js` | 8 → withTenant | **MIGRADO COMPLETO** (2026-09-06, este documento) |
| `backend/routes/subscriptions.routes.js` | 7 → withTenant | **MIGRADO COMPLETO** (2026-09-06, Fase 4) |
| `backend/payments/subscriptionEvents.js` | 5 (resuelven tenant, luego escopan) + 1 sin tenant (a propósito) | **MIGRADO COMPLETO** (2026-09-06, Fase 4) |
| `backend/routes/presupuesto.routes.js` / `configLogistica.routes.js` | 7 c/u → withTenant | **MIGRADO COMPLETO** (2026-09-06, Fase 3 lote 1) |
| `backend/routes/radicacion.routes.js` / `motorDialectico.routes.js` / `exportacion.routes.js` / `authGoogle.controller.js` | 5 c/u → withTenant | **MIGRADO COMPLETO** (2026-09-06, Fase 3 lote 2) |
| `backend/routes/wompi.webhook.js` / `stripe.webhook.js` | 2 c/u sin tenant (a propósito — ledger de idempotencia global) | **EXCEPCIÓN DOCUMENTADA** (2026-09-06, Fase 4) |
| `matrizRaci.routes.js` / `copiloto.routes.js` / `entradaIA.routes.js` / `estresFinanciero.routes.js` / `valorExponencial.routes.js` | 1 c/u (`checkOwnership` crudo) | **RESIDUO por re-verificar** (ver nota arriba) |
| `backend/routes/reporte.routes.js` | 6 withTenant | **MIGRADO COMPLETO** (commit `1118e61`, 2026-09-05, adelantado desde Fase 2) |

**Restante real verificado 2026-09-06 (`grep -c` directo, no estimado): ~228 call sites** — ~222 en `server.js`
(263 menos los 26 del Bloque 1 y los 15 del Bloque 2 de Fase 5 — el resto incluye tanto trabajo pendiente real como
las excepciones globales ya documentadas de ambos bloques) + 5 residuos de `checkOwnership()` crudo (ver hallazgo
arriba) + 1 en `presupuesto.routes.js` que es la excepción deliberada de `catalogo_rendimientos`, no deuda real.
Fase 1, Fase 2, Fase 3 (lotes 1 y 2) y Fase 4 quedan 100% cerradas; Fase 5 (`server.js`) tiene su Bloque 1
(auth/sesión) y Bloque 2 (admin de usuarios) completos — el resto del archivo sigue pendiente.

**Cobertura de tests hoy:** 13 tests totales (`test:smoke` 8 + `test:security` 5) para ~397 call sites — insuficiente
para migrar con confianza sin ampliarla primero. Ver Fase 0.

---

## 2. Principio rector de cada fase

Ningún archivo pasa de "sin migrar" a "migrado" sin que las 3 condiciones se cumplan, en orden:
1. **Refactor de código**: cada `getRow/getRows/runSql` del archivo pasa a ejecutarse dentro de `withTenant(orgId, cb)`.
2. **Test de regresión propio del archivo** (no solo el smoke test genérico) verificando que las consultas legítimas siguen devolviendo datos.
3. **Prueba de aislamiento cross-tenant real** (mismo patrón que se acaba de aplicar en la migración 054: 2 tenants
   de prueba, confirmar que uno no ve datos del otro, limpiar el fixture) antes de dar el archivo por cerrado.

Un archivo que falla el paso 2 o 3 **no avanza** — se revierte ese archivo puntual a la lista de pendientes, no se
fuerza para no romper producción.

---

## 3. Fases

### Fase 0 — Cerrar el gap de observabilidad antes de tocar código (1-2 días)
- Arreglar el bloqueador descubierto durante la migración 054: `server.js` no puede arrancar en frío hoy
  (`node server.js` sin wrapper) porque `database.config.js`/`supabase.config.js` leen `process.env.SUPABASE_SERVICE_KEY`
  a nivel de módulo, y el import de esos módulos ocurre antes de que `loadEnv()` (`backend/env-loader.js`) se
  ejecute en el cuerpo de `server.js` — confirmado en vivo, no hipótesis (ver Hallazgo Nuevo #1 en el resumen
  ejecutivo de esta sesión). Sin arreglar esto, ningún test que dependa de un servidor vivo (`test:smoke`,
  `test:security`) es ejecutable de forma confiable en ningún entorno que no pre-cargue el `.env` por otro medio.
- Ampliar `test:smoke`/`test:security` (o crear un `test:tenant-isolation` dedicado) para que cada fase de abajo
  tenga cobertura automatizada, no solo la prueba manual puntual que se corrió para la migración 054.

### Fase 1 — ✅ COMPLETA (commit `1118e61`, 2026-09-05)
`anexos.routes.js` y `proyectos.routes.js` migrados por completo a `withTenant()`. GRANT en
`055_rls_scoped_grants_fase1.sql`.

### Fase 2 — ✅ OFICIALMENTE LIQUIDADA (2026-09-06)
`reporte.routes.js` — completado de forma adelantada en el commit `1118e61` (2026-09-05).
`biblioteca.routes.js` (20), `fichaTecnica.routes.js` (10), `marcoNormativo.routes.js` (8) y
`compliance.routes.js` (9) — migrados a `withTenant()`, GRANT en `059_rls_scoped_grants_fase2.sql` (cubre
`compliance_data`, `config_logistica`, `marco_normativo`, `versiones_proyecto`, `project_biblioteca`,
`project_biblioteca_carpetas`; `proyectos` ya tenía GRANT desde `055`). 21/21 pruebas de regresión + aislamiento
cruzado passed en total, en 2 tandas (11/11 + 10/10), vía HTTP real contra el backend vivo, con tenants de prueba
insertados y limpiados en cada corrida — nunca contra mocks.

Excepciones documentadas, ambas deliberadas (no deuda pendiente):
- `GET /api/m12/verificar/:hash` (fichaTecnica.routes.js) — verificación pública de un sello ya emitido, sin
  `authenticateToken`, no hay `req.userId` que pasarle a `withTenant()`. Mismo criterio que `gemini_key_state`/
  `trial_sessions` (sección 4).
- `PATCH /api/proyectos/:id/estado-legal` (compliance.routes.js) — el lookup inicial de `proyectos` se queda sin
  tenant-escopar (un admin gestionando el proyecto de OTRO usuario necesita verlo para decidir si tiene permiso,
  antes de que exista un tenant sobre el cual escopar la query — mismo problema del huevo y la gallina que
  `authenticateToken` resolviendo identidad antes de que exista contexto de tenant). Las escrituras posteriores en
  `compliance_data` SÍ se tenant-escopan, pero con `proyecto.org_id` (el dueño real de la fila) como tenantId, no
  `req.userId` — verificado con prueba dedicada: un admin de prueba cambiando el `estado_legal` de un proyecto que
  no le pertenece, confirmando que la escritura queda bajo el tenant correcto (el dueño real puede seguir
  leyéndola) y no bajo el id del admin.

### Fase 3 — Rutas con escritura de datos de negocio (riesgo medio)
`compliance.routes.js` se adelantó y ya quedó migrado al cierre de Fase 2 (ver arriba).

**Lote 1 — ✅ COMPLETADO 2026-09-06:** `presupuesto.routes.js` (7 call sites) y `configLogistica.routes.js` (7)
migrados a `withTenant()`. GRANT en `060_rls_scoped_grants_fase3.sql` (solo `project_budgets` — `config_logistica`,
`logistica_tramos` y `proyectos` ya tenían GRANT de fases previas). El INSERT masivo de ítems APU y el
DELETE+INSERTs de tramos de logística pasan a `withTenantTransaction()` — primer uso real del helper fuera de
Ficha Técnica. 14/14 pruebas de regresión + aislamiento cruzado passed.

Exclusión deliberada verificada en vivo antes de tocar código: `catalogo_rendimientos` (presupuesto.routes.js)
tiene RLS **activo pero sin ninguna política** y no tiene columna de tenant — es un catálogo de referencia GLOBAL
(rendimientos de obra), no datos por tenant. En Postgres, RLS habilitado sin política es deny-all para cualquier
rol sin BYPASSRLS (el GRANT no lo arregla: controla el permiso de la operación, no qué filas se ven). Se queda en
el pool principal (`getRow`/`getRows`), mismo criterio que `gemini_key_state`/`trial_sessions` (sección 4).

**Lote 2 — ✅ COMPLETADO 2026-09-06:** `radicacion.routes.js` (5), `motorDialectico.routes.js` (5),
`exportacion.routes.js` (5) y `authGoogle.controller.js` (5) migrados a `withTenant()`. GRANT en
`061_rls_scoped_grants_fase3_lote2.sql` (`project_indicators` y `user_credentials` — `proyectos`,
`compliance_data`, `config_logistica`, `motor_dialectico`, `objetivos_arbol` y `project_change_theory` ya tenían
GRANT de fases previas). 15/15 pruebas de regresión + aislamiento cruzado passed vía HTTP real contra el backend
vivo (incluye radicación completa con Hard-Lock predial despejado vía `PATCH /api/proyectos/:id/estado-legal`,
config dialéctica, exportación PDF y ciclo status/revoke de credenciales OAuth de Google, con verificación directa
en BD de que el DELETE de `revoke` borra la fila de verdad).

Hallazgo colateral (no es deuda de tenant, se documenta para no perderlo): `getGoogleAccessToken()`
(`authGoogle.controller.js`) no tiene ningún caller real en el repo — verificado con
`grep -rn "getGoogleAccessToken("`, solo aparece su propia definición; `server.js` la importa (línea 24) pero
nunca la invoca. Es código muerto hoy. Se migró igual a `withTenant*` por consistencia del archivo (toca
`user_credentials`), pero no hay ningún flujo en producción que la ejecute.

Con esto, **Fase 3 queda oficialmente liquidada** (compliance.routes.js adelantado en el cierre de Fase 2, lote 1
y lote 2 completos).

### Fase 4 — ✅ COMPLETADA (2026-09-06) — Pagos y suscripciones
`subscriptions.routes.js` (7 call sites) migrado a `withTenant()`, incluyendo un caso real de admin-bypass en
`POST /api/subscription/activate` (tenantId = `target_user_id` cuando un admin activa el plan de OTRO usuario,
nunca `req.userId` — mismo criterio que `compliance.routes.js`). GRANT en `062_rls_scoped_grants_fase4.sql` (solo
`user_subscriptions` — `usuarios` y `proyectos` ya tenían GRANT de fases previas).

`stripeProvider.js::getOrCreateCustomer()` migrado (recibe `withTenantRow`/`withTenantRun` en vez de `getRow`/
`runSql` crudos, ya tenía `tenantId` como parámetro propio). `wompiProvider.js` no requirió cambios — su
`getOrCreateCustomer()` es un passthrough sin acceso a BD (Wompi no modela "customer").

`backend/payments/subscriptionEvents.js` (el corazón de negocio de ambos webhooks) migrado con un patrón nuevo
frente a todo lo anterior: un webhook de pasarela no trae JWT, así que no hay `req.userId` del que partir.
`_handleSubscriptionActive`/`_handleSubscriptionCanceled`/`_handlePaymentSucceeded` resuelven primero el tenant
real (`usuarios.id`) con una lectura SIN escopar por `stripe_customer_id` (mismo problema del huevo y la gallina
que `authenticateToken`/el admin-bypass de `compliance.routes.js`: no se puede escopar una consulta por un tenant
que todavía no se conoce) y RECIÉN AHÍ abren `withTenant(tenantId, ...)` para la escritura real.
`_handleCheckoutCompleted` es la excepción: `event.tenantId` ya viene resuelto desde el checkout (metadata de
Stripe / `reference` de Wompi), así que escopa directo, sin lectura previa. `_handlePaymentFailed` se queda sin
escopar a propósito — su única operación es una lectura de solo notificación por email, ya filtrada por
`stripe_customer_id`; escoparla exigiría resolver el tenant primero solo para repetir la misma lectura, sin
ganancia real. El parámetro `{ pool }` que recibía `applyPaymentEvent()` desapareció — ya no hace falta, las
funciones internas importan `getRow`/`withTenant` directo de `database.config.js`.

**Hallazgo real durante las pruebas (no relacionado con RLS, capturado porque el test ejecutó el código con
valores reales por primera vez):** `user_subscriptions.cancel_at_period_end` es `INTEGER` en la BD, pero
`_handleSubscriptionActive`/`_handleSubscriptionCanceled` bindeaban/escribían un `boolean` de JS (`!!event.
cancelAtPeriodEnd` como parámetro, y el literal `FALSE` en SQL) — el driver `pg` rechaza ambos casos contra una
columna integer ("invalid input syntax for type integer"). Bug preexistente al refactor de tenant (idéntico antes,
vía `pool.connect()` crudo) que nunca se había disparado en este entorno porque `STRIPE_SECRET_KEY` está vacía
(pagos dormidos, ver `project_modulo_pagos_stripe.md`) — habría fallado igual en el primer webhook real de Stripe.
Corregido a `event.cancelAtPeriodEnd ? 1 : 0` / literal `0`, mismo patrón ya usado por `access_radar`/
`access_formulador` en la misma tabla.

**EXCLUSIÓN DELIBERADA, verificada en vivo antes de tocar código:** `stripe_events` (`stripe.webhook.js`) tiene una
política RLS REAL (`tenant_id = app.org_id`) pero su `tenant_id` es `NULL` para la mayoría de eventos de Stripe
(solo `checkout.completed` lo trae resuelto de entrada) — es un ledger de IDEMPOTENCIA GLOBAL (dedup por id de
evento de la pasarela), no dato de tenant; el chequeo "¿ya procesé este evento?" debe poder ejecutarse ANTES de
saber a qué tenant pertenece, para cualquier tipo de evento. Escoparlo habría bloqueado el INSERT bajo RLS (NULL no
satisface `tenant_id = ?`) o vuelto invisible el registro para chequeos futuros. Se queda en el pool principal,
mismo criterio que `catalogo_rendimientos`/`gemini_key_state`/`trial_sessions`. `wompi_events` (`wompi.webhook.js`)
ni siquiera existe todavía en esta BD — su `CREATE TABLE IF NOT EXISTS` nunca se completó con éxito (sin tráfico
real de Wompi que lo haya disparado) — no había nada que otorgar.

17/17 pruebas passed: 9 vía HTTP real contra el backend vivo (`subscriptions.routes.js`, incluida la prueba de
admin-bypass y de aislamiento cruzado en `GET /subscription`/`POST /bridge/transfer`) + 8 a nivel unitario contra
`applyPaymentEvent()` directamente (Stripe/Wompi dormidos en este entorno — sin llaves configuradas no hay firma
real de webhook que verificar por HTTP; se probó la lógica de negocio real con 2 tenants falsos y `stripe_customer_id`
sintéticos, confirmando que un evento de un customer nunca toca la fila ni los tokens del otro tenant).

### Fase 5 — `server.js` (264 call sites, el más grande, se hace al final a propósito)
Es intencional dejarlo para el final: para cuando se llegue aquí, el patrón de refactor + test de regresión +
prueba de aislamiento ya se habrá ejecutado ~130 veces en las fases 1-4, con ajustes de proceso ya incorporados.
Migrar `server.js` de una sola vez sin ese rodaje previo es exactamente el "romper producción sin cobertura
suficiente" que la auditoría original señaló como riesgo. Sub-dividir por bloque funcional dentro del propio
archivo (auth, proyectos, radar, IA) en vez de tratarlo como una sola unidad.

**Bloque 1 — ✅ COMPLETADO (2026-09-06) — Auth & Sesión.** Alcance estrictamente delimitado a las rutas bajo
`/api/auth/*` que manejan identidad/sesión: `register`, `login`, `mfa/challenge`, `mfa/status`, `mfa/setup`,
`mfa/confirmar`, `mfa/desactivar`, `verify`, `validar-por-correo`, `me`, `change-password`, `reset-password` y
`validate-action` — 26 call sites migrados a `withTenantRow()`/`withTenantRun()`. Deliberadamente FUERA de este
bloque (es un área funcional distinta, aunque vive físicamente intercalada en el mismo rango de líneas de
`server.js`): el panel de administración de usuarios (listar/aprobar/desactivar/promover/purgar, ~40 call sites
entre `validar-por-correo` y `trial`) y `/api/credentials/*` (BYOK de notebook, tabla `user_credentials`) — quedan
para un Bloque 2/3 futuro. `usuarios` y `user_subscriptions` ya tenían GRANT completo a `rf360_rls_scoped` de fases
previas (Fase 1 y Fase 4) — **no se necesitó ninguna migración de GRANT nueva para este bloque.**

Patrón aplicado, consistente con toda la Fase 3/4: las búsquedas por EMAIL (`register`'s chequeo de duplicado,
`login`, `forgot-password`) se quedan sin escopar a propósito — el tenant (el propio id del usuario) no existe
todavía o no se conoce hasta resolver el email. En cuanto se conoce el id (recién generado en `register`, resuelto
por email en `login`, o extraído de un JWT ya verificado — `payload.sub` en `mfa/challenge`/`validar-por-correo`/
`reset-password`), toda operación posterior sí escopa. `register`'s INSERT en `usuarios` es un caso nuevo frente a
Fases 1-4: el id se genera en JS ANTES del INSERT, así que puede auto-escoparse (`withTenantRun(id, ...)`) desde el
primer momento — no hay problema del huevo y la gallina para una fila que uno mismo está creando con un id ya
conocido.

**EXCLUSIÓN DELIBERADA, verificada en vivo:** `revoked_tokens` (blacklist de tokens, `backend/middlewares/
tokenBlacklist.js`) se queda sin escopar — es un ledger de seguridad GLOBAL que se carga COMPLETO en memoria al
arrancar el servidor (para poder rechazar en O(1) el token revocado de CUALQUIER usuario, no solo el del tenant
actual); escoparlo habría sido arquitectónicamente incorrecto, no solo innecesario. Mismo criterio que
`stripe_events`/`gemini_key_state`/`trial_sessions`.

35/35 pruebas passed vía HTTP real contra el backend vivo, con 2 usuarios reales (no mocks): registro completo
(verificando en BD que el INSERT escopado de `usuarios` Y el de `user_subscriptions` — este dentro de un
try/catch — de verdad aterrizan), login con password incorrecto/correcto (verificando el UPDATE escopado de
`failed_login_attempts`/`locked_until`), `verify` con aislamiento cruzado explícito entre los 2 usuarios, ciclo MFA
completo (`setup` → `confirmar` con un código TOTP real generado con `otplib` → `login` con `mfaRequired` →
`challenge` con un segundo código real → `status` → `desactivar`), `change-password` con verificación de que el
JWT emitido ANTES del cambio queda invalidado por la revocación bulk (`tokens_invalidated_at`), el flujo completo
de `forgot-password`/`reset-password` (token auto-firmado con el mismo `JWT_SECRET` real, ya que el envío de email
está inactivo en este entorno) incluyendo el rechazo de reintentar el mismo token de reset ya usado (verificado
además directo en BD que `revoked_tokens` sí recibió el hash), `logout` con verificación de que el token usado
queda rechazado de inmediato, y `trial` como sanity check de que la ruta más simple del bloque sigue intacta.
`test:smoke` 8/8 y `test:security` 5/5 (100%).

**Bloque 2 — ✅ COMPLETADO (2026-09-06) — Administración de Usuarios.** 15 call sites migrados a
`withTenantRow()`/`withTenantRun()`/`withTenantTransaction()` en: `registrarAuditoriaAdmin` (lectura del propio
admin), `POST /admin/usuarios/:id/aprobar`, `POST /admin/usuarios/:id/rechazar`, `PATCH /admin/usuarios/:id/permisos`
(matriz de módulos + vigencia + bloqueo), `POST /dev/make-admin` (dev-only), `GET /admin/usuarios/:id/aprobar-por-correo`,
`GET /admin/usuarios/:id/rechazar-por-correo` y `DELETE /usuarios/:id/purgar`. GRANT en
`063_rls_scoped_grants_fase5_bloque2.sql` (solo `user_favorites` — el resto de las 6 tablas objetivo ya tenía GRANT
de fases previas).

**REGLA DE ORO aplicada en las 8 rutas anteriores: el tenantId de toda escritura es el usuario OBJETIVO
(`targetId`/`req.params.id`/`payload.sub`), nunca `req.userId` del admin** — incluso en las 2 rutas de "un clic desde
el correo" (`aprobar-por-correo`/`rechazar-por-correo`), que no tienen sesión de admin real (usan un sentinel
`admin_id='sistema-correo-1clic'` solo para el audit log) pero SÍ operan sobre un usuario objetivo real.

`DELETE /usuarios/:id/purgar` — la cascada de borrado (Habeas Data, Ley 1581) — se consolidó en UNA sola llamada a
`withTenantTransaction(targetId, queries)` cubriendo las 7 escrituras (loop de `versiones_proyecto`/`project_budgets`
por proyecto + `proyectos` + `user_favorites` + `user_subscriptions` + `user_gemini_keys` + `usuarios`), incluyendo
el `set_config('app.allow_pvh_purge', 'true', true)` como primera query de la misma transacción — mejora real de
atomicidad frente al código anterior (antes solo el DELETE de `proyectos` estaba envuelto en una transacción; un
fallo a mitad de la cascada podía dejar una purga parcial).

**EXCLUSIONES DELIBERADAS, verificadas en vivo (no son deuda pendiente, son vistas de admin genuinamente
GLOBALES/cross-tenant por diseño, o chequeos que necesitan ver TODOS los tenants):**
- `GET /admin/auditoria`, `GET /admin/usuarios/pendientes`, `GET /admin/usuarios`, `GET /admin/finops` — reportes
  administrativos cross-tenant por naturaleza (un admin necesita ver TODOS los usuarios/toda la auditoría/todo el
  consumo de IA, no solo un tenant) — RLS no puede expresar "todas las filas de todos los tenants", solo "las filas
  de UN tenant". Protegidas por el chequeo `req.userRole==='admin'`, no por RLS.
- `admin_audit_log` y `ai_token_logs` — verificado en vivo: RLS ACTIVO pero CERO políticas definidas (deny-all para
  `rf360_rls_scoped` sin importar el GRANT) — refuerza que estas 2 tablas nunca debieron tenant-escoparse.
- El chequeo "último admin activo" (`PATCH /permisos` y `DELETE /purgar`) — debe ver admins de TODOS los tenants
  para decidir si queda alguno más; escoparlo por el tenant objetivo lo volvería inútil.
- Búsqueda por email en `POST /dev/make-admin` (chicken-and-egg, tenant desconocido hasta resolver el email).

28/28 pruebas passed vía HTTP real contra el backend vivo, con fixtures reales (1 admin + 4 usuarios objetivo, nunca
contra cuentas reales de producción): admin-bypass verificado en `aprobar`/`permisos` con aislamiento cruzado
explícito (la cuenta del admin y la de un tercer usuario de control quedan intactas), **prueba hostil explícita**:
una llamada directa a `withTenant(adminId, ...)` intentando escribir sobre la fila de `targetA` usando el tenant
INCORRECTO (el id del admin, simulando el bug exacto que la Regla de Oro previene) afecta **0 filas** — RLS rechaza
la intrusión a nivel de base de datos, no solo por lógica de aplicación —, el flujo de aprobación de un clic sin
sesión, y la cascada completa de `purgar` verificada en las 7 tablas (todas realmente borradas para el usuario
purgado) con aislamiento cruzado verificado en las mismas 7 tablas contra un segundo usuario con datos paralelos
(ninguna fila suya se tocó). `test:smoke` 8/8 y `test:security` 5/5 (100%).

---

## 4. Qué NO hace este roadmap
No fija fechas — depende de cuánto tiempo de sesión/presupuesto se asigne a cada fase, y la Fase 0 es un
prerrequisito real, no opcional. No incluye la migración de `gemini_key_state`/`trial_sessions` a `withTenant()`
porque, verificado en la migración 054, ninguna de las 2 tiene columna de tenant — no son candidatas a este
patrón, son estado global o dato anónimo por diseño (ver comentario en `054_rls_raci_gemini_trial.sql`).
