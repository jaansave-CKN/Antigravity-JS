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
| `server.js` | 263 | Sin migrar |
| `backend/routes/anexos.routes.js` | 30 withTenant | **MIGRADO COMPLETO** (commit `1118e61`, 2026-09-05) |
| `backend/routes/biblioteca.routes.js` | 20 → withTenant | **MIGRADO COMPLETO** (2026-09-06, este documento) |
| `backend/routes/proyectos.routes.js` | 25 withTenant | **MIGRADO COMPLETO** (commit `1118e61`, 2026-09-05) |
| `backend/routes/fichaTecnica.routes.js` | 10 → 9 withTenant + 1 sin tenant (a propósito) | **MIGRADO COMPLETO** (2026-09-06, este documento) |
| `backend/routes/compliance.routes.js` | 9 withTenant | **MIGRADO COMPLETO** (2026-09-06, cierre de Fase 2) |
| `backend/routes/marcoNormativo.routes.js` | 8 → withTenant | **MIGRADO COMPLETO** (2026-09-06, este documento) |
| `backend/routes/subscriptions.routes.js` | 7 | Sin migrar |
| `backend/routes/presupuesto.routes.js` / `configLogistica.routes.js` | 7 c/u → withTenant | **MIGRADO COMPLETO** (2026-09-06, Fase 3 lote 1) |
| `backend/routes/radicacion.routes.js` / `motorDialectico.routes.js` / `exportacion.routes.js` / `authGoogle.controller.js` | 5 c/u → withTenant | **MIGRADO COMPLETO** (2026-09-06, Fase 3 lote 2) |
| `backend/routes/reporte.routes.js` | 6 withTenant | **MIGRADO COMPLETO** (commit `1118e61`, 2026-09-05, adelantado desde Fase 2) |
| `backend/routes/wompi.webhook.js` / `stripe.webhook.js` | 2 c/u | Sin migrar — **ver nota de riesgo abajo** |
| `backend/routes/valorExponencial.routes.js` / `matrizRaci.routes.js` / `estresFinanciero.routes.js` / `entradaIA.routes.js` / `copiloto.routes.js` | 1 c/u | **Ya migrados** (services detrás de estas rutas usan `withTenant()`, confirmado por auditoría) |

**Restante real verificado 2026-09-06 (`grep -c` directo, no estimado): ~291 call sites**, concentrados casi todos en `server.js` (263) — Fase 1, Fase 2 y Fase 3 (lotes 1 y 2) quedan 100% cerradas; solo Fase 4 (pagos) y Fase 5 (`server.js`) siguen sin migrar.

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

### Fase 4 — Pagos y suscripciones (riesgo alto — tratar aparte, con ventana de mantenimiento)
`subscriptions.routes.js` (7), `wompi.webhook.js` (2), `stripe.webhook.js` (2). Los webhooks de pasarela son el
punto de mayor cuidado: una migración mal probada aquí puede dejar de registrar un pago real o duplicar un cobro.
Recomendación: migrar en una ventana de bajo tráfico, con modo de reconciliación manual activo 24-48h después.

### Fase 5 — `server.js` (264 call sites, el más grande, se hace al final a propósito)
Es intencional dejarlo para el final: para cuando se llegue aquí, el patrón de refactor + test de regresión +
prueba de aislamiento ya se habrá ejecutado ~130 veces en las fases 1-4, con ajustes de proceso ya incorporados.
Migrar `server.js` de una sola vez sin ese rodaje previo es exactamente el "romper producción sin cobertura
suficiente" que la auditoría original señaló como riesgo. Sub-dividir por bloque funcional dentro del propio
archivo (auth, proyectos, radar, IA) en vez de tratarlo como una sola unidad.

---

## 4. Qué NO hace este roadmap
No fija fechas — depende de cuánto tiempo de sesión/presupuesto se asigne a cada fase, y la Fase 0 es un
prerrequisito real, no opcional. No incluye la migración de `gemini_key_state`/`trial_sessions` a `withTenant()`
porque, verificado en la migración 054, ninguna de las 2 tiene columna de tenant — no son candidatas a este
patrón, son estado global o dato anónimo por diseño (ver comentario en `054_rls_raci_gemini_trial.sql`).
