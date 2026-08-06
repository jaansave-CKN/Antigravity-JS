# RadFor-360 — Modelo de Datos

Complementa `00_documento_maestro_arquitectura.md` §4. Tres almacenes, cada uno con un rol distinto — no hay una sola "base de datos", es deliberado (ver `00d_decisiones_arquitectura.md`).

---

## 1. Supabase / PostgreSQL — dominio Formulador

Proyecto `ozivmsvxbdtjkzleqbcy` (compartido con Proy_03_RadarFondos — tablas namespaced `formulador_*` para evitar colisión). Acceso vía REST/PostgREST, nunca conexión `pg` directa (`DATABASE_URL` vacío a propósito). Todas las tablas: `RLS ENABLED` + política `tenant_id = current_tenant_id()`, más filtro explícito `WHERE tenant_id = p_tenant_id` en cada función `SECURITY INVOKER` — doble candado, no uno solo.

### `formulador_proyectos` (cabecera — Módulos 1-6)
| Columna | Tipo | Nota |
|---|---|---|
| id | UUID PK | `gen_random_uuid()` |
| tenant_id | UUID NOT NULL | 1:1 con `uid` de Firebase (hash determinista) |
| nombre | TEXT NOT NULL | Módulo 1 (agregado Oleada 1 — no existía en el formulario original) |
| codigo, enfoque, regimen, sector_codigo, clasificacion_infra | TEXT | Módulo 1 |
| departamento, municipio, zona | TEXT | Módulo 2 |
| diagnostico | TEXT | Módulo 3 |
| poblacion_total | INTEGER | Módulo 4 |
| status | TEXT | `draft`\|`in_review`\|`published`\|`archived` |

### `formulador_objetivos` / `formulador_oe` (Módulo 7)
Objetivo general + indicador/meta/línea base + `cadena_valor` (JSONB: insumos/actividades/productos/resultados/impacto). `formulador_oe` = objetivos específicos, 1:N sobre `formulador_objetivos`, `ON DELETE CASCADE`.

### `formulador_cronograma` (Módulo 8)
`duracion_meses`, `fecha_inicio`, `fecha_fin`, `fases` (JSONB array), `hitos` (JSONB array).

### `formulador_presupuesto` (Módulo 9)
`presupuesto_total NUMERIC(18,2)`, `moneda CHAR(3) DEFAULT 'COP'` (soberanía financiera COP, ver `AGENTS.md` axioma II.2), `fuentes` (JSONB: SGR/SGP/Cooperación/OxI con `es_publica`), `contrapartida_monetaria`/`contrapartida_especie`.

### `formulador_validaciones_financieras`
Resultado de `insertar_fase1`: `estado` (`ok`\|`advertencia`\|`pendiente`), `porcentaje_contrapartida_real` vs `porcentaje_minimo_requerido` (regla por fondo: SGR 0%, DNP 20%, Kusanone 30%, Cooperación 10%).

### `formulador_indicadores` (Módulo 10 — agregado 2026-08-06)
`proyecto_id` FK → `formulador_proyectos`, `indicador`, `tipo` (`producto`\|`resultado`\|`impacto`), `unidad`, `linea_base`, `meta`, `fuente_verificacion`, `responsable`, `frecuencia_medicion`, `avance_actual`. Upsert por reemplazo total (borra+reinserta todas las filas del proyecto en cada guardado — no hay edición fila-por-fila desde el API).

### Funciones RPC (todas `SECURITY INVOKER`, fijan `set_tenant_context()` al inicio)
| Función | Efecto |
|---|---|
| `insertar_fase1(tenant, ficha, mod7, mod8, mod9)` | Inserta cabecera + módulos 7-9 en una transacción atómica, calcula validación de cofinanciación |
| `obtener_fase1(tenant, proyecto_id)` | Recupera proyecto + módulos 7-9 |
| `listar_proyectos(tenant)` | Lista resumida de proyectos del tenant (agregado Oleada 3) |
| `guardar_modulo10(tenant, proyecto_id, indicadores)` | Reemplaza indicadores del proyecto |
| `obtener_modulo10(tenant, proyecto_id)` | Recupera indicadores |
| `set_tenant_context(tenant_id)` | `set_config('app.tenant_id', ...)` — transaccional, no persiste entre llamadas REST sueltas |
| `current_tenant_id()` | Lee el contexto fijado arriba, usado por las políticas RLS |

**Migraciones:** `src/modules/formulador/migrations/001_formulador.sql` → `006_modulo10_y_listado.sql`, aplicadas en orden contra la base real (verificado, no solo "en el repo").

---

## 2. Firestore — auditoría y telemetría de sistema

| Colección | Contenido | Escritor |
|---|---|---|
| `audit_logs` | Eventos de negocio: `CLAUDE_CHAT_SUCCESS/ERROR`, `SESSION_LOGIN`, `OPENROUTER_ERROR`, `FORMAL_ORDER` — con payload + timestamp | `AuditLogger.js` (Admin SDK, siempre además de respaldo local `logs/audit.log`) |
| `system_reports` | Inventario de carpetas de `agents/` — informativo, no operativo (ver `scripts/generar_reporte.cjs`, corregido Oleada 0 para no fabricar `"READY 24/7"` uniforme) | `generar_reporte.cjs`, cada 10 min + al boot |

**Reglas (`firestore.rules`):** `audit_logs` legible solo por el correo del dueño (`jaansave@gmail.com`), escritura siempre denegada desde cliente (solo Admin SDK). Deny-by-default para el resto — es el único perímetro "admin" verificable hoy sin el panel `/admin` (pendiente, módulo 14).

---

## 3. Upstash Redis (REST) — estado efímero

| Key pattern | TTL | Contenido |
|---|---|---|
| `session:<uuid>` | 24h | `{ uid, role, createdAt, lastSeen }` — sesión JWT propia |
| `radar:<md5(query+filters)>` | 24h | Resultado de `m1Pipeline.js` (Claude+Tavily) — cache compartido entre usuarios |

Fallback a `Map` en memoria si `UPSTASH_REDIS_REST_URL/TOKEN` no están configuradas (hoy sí lo están — `cacheInfo().backend === 'Upstash Redis'`, verificado en vivo 2026-08-06).

---

## 4. Estado deliberadamente NO persistido

| Estado | Vive en | Por qué no se persiste |
|---|---|---|
| `radarData` (seed del Radar) | Array en memoria, `server.js` | Se repuebla vía cron (módulo 4 de la tabla de arquitectura) y REST; reiniciar el proceso solo vuelve al seed, no es una pérdida de datos de usuario |
| `activeQueries` (anti-flood) | `Map`, `session-manager.js` | Una consulta "en vuelo" solo tiene sentido dentro del proceso que la sirve — diseño deliberado, documentado en el propio archivo |
| `checkQuota`/`checkBurst` (límites de uso) | `Map`, `session-manager.js` | Cuota aproximada de anti-abuso, no facturación exacta — aceptable que se resetee en cada reinicio |
