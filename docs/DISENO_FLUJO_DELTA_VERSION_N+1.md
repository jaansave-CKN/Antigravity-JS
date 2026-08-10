# Diseño técnico — Flujo Delta → Versión N+1 sobre `project_version_hashes`

**Estado:** borrador para decisión — fiscalizado por el Agente Arquitecto (`.claude/agents/architect.md`), aprobado el Paso 3 de la propuesta original con la condición explícita de documentar las preguntas abiertas en vez de resolverlas por inferencia. No se ha escrito código de este flujo todavía — este documento es el prerequisito para poder hacerlo.

---

## 1. Objetivo

Permitir que, tras recibir "banderas rojas" (hallazgos de viabilidad/compliance/estrés financiero), el usuario corrija solo lo señalado (un anexo, una cifra del presupuesto, un dato de la ficha técnica) y dispare un botón **"Continuar Formulación"** que reprocese *solo ese delta* — no todo el proyecto desde cero — y registre el resultado como una nueva versión inmutable.

## 2. Lo que ya existe y no hay que reconstruir

- **Tabla real:** `backend/migrations/009_project_version_hashes.sql` — append-only genuino, no solo por convención: los triggers `trg_pvh_block_mutation` (líneas 57-74) **bloquean** cualquier `UPDATE`/`DELETE` a nivel de base de datos, no solo a nivel de aplicación. RLS forzado sobre `tenant_id` (líneas 79-95). Constraint único `(project_id, hash_value)`.
- **Único escritor real hoy:** `backend/routes/proyectos.routes.js` (`GET /api/proyectos/:id/hash`, líneas ~330-351) — lee `projects` (con fallback a `proyectos` si `projects`/`tenant_id` no existe en el esquema activo, ver auditoría de seguridad de esta misma sesión), arma un payload `{project_id, tenant_id, status, payload_es, payload_en, db_updated_at, hashed_at}`, lo hashea y hace `INSERT ... ON CONFLICT (project_id, hash_value) DO UPDATE` con `triggered_by = 'api_request'`.

## 3. Preguntas abiertas — sin resolver a propósito, requieren tu decisión

### 3.1 ¿Quién escribe la Versión N+1?

`viabilidadAgent.js` y `arbolObjetivosAgent.js` son **funciones puras sin acceso a base de datos** (confirmado leyendo ambos archivos completos — no importan `runSql`/`getRow`/`supabaseAdmin`). No pueden, por sí mismos, insertar en `project_version_hashes`. El candidato natural es un **route handler nuevo** (mismo patrón que el `GET /api/proyectos/:id/hash` ya existente), por ejemplo `POST /api/proyectos/:id/continuar-formulacion`, que:
1. Reciba el delta (qué anexo/campo cambió).
2. Invoque el/los servicio(s) correspondientes (`viabilidadAgent.js`, etc.) con el contexto actualizado.
3. Escriba el resultado y llame al mismo mecanismo de hash que ya usa `proyectos.routes.js`.

**Decisión pendiente:** ¿este handler vive en `proyectos.routes.js` (junto al hash existente) o en un archivo nuevo dedicado? Cualquiera de las dos es defendible; lo que no es defendible es que "los 4 servicios" escriban la versión directamente, porque no tienen la capacidad técnica de hacerlo hoy.

### 3.2 Split de esquema `org_id` vs. `tenant_id` — sin reconciliar

| Tabla | Columna de tenant real |
|---|---|
| `proyectos`, `project_apu_lineas` (Estresado), `project_hallazgos` (AuditorForense) | `org_id` (esquema "legacy") |
| `projects`, `project_version_hashes` | `tenant_id` (esquema v8.0) |

`EstresadoFinancieroService.js` y `AuditorForenseService.js` operan enteramente en el esquema `org_id`. `project_version_hashes` fue diseñada para el esquema `tenant_id`. Un handler que intente escribir una versión a partir de datos de Estresado/AuditorForense necesita decidir **con qué valor puebla `tenant_id`** — ¿se asume `tenant_id = org_id` (mismo patrón que `auth.middleware.js:198` ya usa como fallback: *"modelo single-tenant-per-user"*), o se trata como dos conceptos distintos que requieren una migración de datos primero?

**No se resuelve aquí** porque requiere confirmar si esa asunción (`tenant_id = org_id`) es correcta para todo el ecosistema o solo para el caso puntual donde ya se usa.

### 3.3 Valor de `triggered_by` para este flujo nuevo

La migración documenta en comentario 3 valores posibles (`'api_request'`, `'status_change'`, `'formulacion_complete'`), pero **no hay `CHECK constraint`** que los limite a esos tres — a nivel de base de datos se puede insertar cualquier string. Hoy solo se usa `'api_request'` en la práctica; `'formulacion_complete'` nunca se implementó (es documentación sin código detrás).

**Propuesta no vinculante:** usar un cuarto valor explícito, `'delta_reprocesado'`, para que quede trazable en la tabla cuál fila vino de este flujo específico vs. del hash simple ya existente. Requiere tu confirmación antes de codificarse.

## 4. Lo que SÍ quedó resuelto en esta ronda (Paso 1 y Paso 2 de la propuesta original)

- **Regla de "punto de equilibrio":** retirada — no aplica al dominio de RadFor-360 (proyectos de cooperación/entidades sin flujo de ingresos propio), confirmado que no hay ningún dato en el esquema al que anclarla.
- **Regla COP/no-USD:** cerrada de verdad, no solo declarada — `presupuesto.routes.js` (`POST /api/proyectos/:id/presupuesto`) reutiliza ahora el guardián `contieneMonedaNoCOP` ya existente en `proyectos.routes.js` (exportado en esta misma sesión), cerrando el único write-path real a `proyectos.presupuesto` que no lo tenía. `viabilidadAgent.js`/`arbolObjetivosAgent.js` no necesitan guardián propio — leen datos que ya pasaron por este filtro al escribirse.
- **Renombre "Orquestador"→"Gerente de Proyecto":** no aplica — la palabra no existe en ninguno de los 4 servicios auditados.
- **RLS manual / FinOps en los 4 servicios:** auditado, sin hallazgos — ya cumplían antes de esta sesión.

## 5. Siguiente paso

Este documento no autoriza código del flujo Delta/N+1 todavía — falta tu respuesta a 3.1 (dónde vive el handler), 3.2 (cómo se puebla `tenant_id`) y 3.3 (nombre de `triggered_by`). Una vez resueltas, esto vuelve al Agente Arquitecto como una propuesta concreta y acotada antes de escribir el endpoint.
