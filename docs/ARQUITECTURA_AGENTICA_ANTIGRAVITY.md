# ARQUITECTURA AGÉNTICA ANTIGRAVITY — Auditoría Forense 360° Multiagente + Sistema Completo
**Fecha:** 2026-08-08, re-verificado y ampliado 2026-08-10 (§0-D) y 2026-08-11 (§0-E, §0-F ADR-0001, §0-G Migración A, §0-H purga `.agent/`, §0-I auditoría 008 + fix de OCC atómico)
**Auditor:** Chief AI Architect / Auditor Forense de Sistemas Multiagente / DevSecOps Lead / Chief Software Auditor / System Architect
**Alcance:** proyecto raíz `c:\2026 AI EGIOC5\Antigravity JS`, **ambas ramas remotas** (`origin/master` y `origin/main`, ver §0-D). `proyectos/` queda fuera del árbol de trabajo local (repos git independientes, `.gitignore:19-24`) — pero ver §0-D sobre su relación real con `origin/main`.
**Regla de evidencia:** cero suposiciones — cada hallazgo cita archivo real. Donde el volumen hizo impracticable la lectura línea-por-línea de decenas de archivos (los skills de `agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/`, o los 171 commits de `origin/main`), se declara el muestreo usado.
**Estado del commit (rama `master`):** local `12886c9`, **8 commits adelante de `origin/master`** (`d9e520a`) — sin push, decisión pendiente del usuario. Incluye el trabajo de refactor de `001_ORQUESTADOR_MAESTRO`/`architecture-gate.cjs` de esta sesión (ruteo estático, motor de resiliencia, audit trail JSONL).
**Estado de la rama `main`:** `origin/main` (rama default real del repo en GitHub — `remotes/origin/HEAD -> origin/main`), HEAD en `9dfb577`, último commit **2026-08-10** (hoy). Nunca tocada por esta sesión ni por ninguna versión anterior de este documento.

---

## 0. QUÉ CAMBIÓ DESDE LA ÚLTIMA VERSIÓN DE ESTE DOCUMENTO

La versión anterior de `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` (2026-08-08, madrugada) documentó 7 de 9 scripts sueltos en `agents/` como rotos/fósiles/huérfanos. Desde entonces, en la misma jornada, se ejecutó una remediación real:

| Ítem del documento anterior | Estado ahora |
|---|---|
| `agents/auditor-integridad.cjs` (fósil, 11/11 rutas inexistentes) | **Eliminado** |
| `agents/bridge-server.cjs` (2º servidor Express, puerto 3001, API rota) | **Eliminado** |
| `agents/skill-dispatcher.cjs` (schema `available_skills` inexistente) | **Eliminado** |
| `agents/index.js` (import roto a `config.js`) | **Eliminado** |
| `agents/ContextManager.js` (referencia a proyecto purgado) | **Eliminado** |
| `agents/Agente001/050/051/052.js` (huérfanos, solo importados por `index.js`) | **Eliminados** |
| `MiniMaxChat.jsx` + `/api/openrouter/*` | **Eliminados por completo** — decisión de producto: el backend solo expone Claude |
| `CLAUDE_MODEL` hardcodeado en 2 archivos distintos | **Centralizado** vía `PRIMARY_AI_MODEL` en `.env` (`claude-sonnet-4-6`) |
| `claves_privadas.txt` (26 líneas, incluía JWT legacy `service_role` de Supabase, token de gestión `sbp_...`, Hostinger, GitLab con password en texto plano) | **Reducido a 7 líneas** — solo lo que coincide con `.env` activo (backup fuera del repo) |
| Historial git local/remoto sin ancestro común | **Resuelto** — `origin/master` ahora = `d9e520a` (ver §6.4 para el detalle de riesgo que esto implicó) |
| `GET /api/health` — falso positivo (solo verificaba env var) | **Corregido** — ping real cacheado 120s |

Lo que **no** cambió y sigue vigente tal cual: los 25 skills legacy (ahora en `agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/`, huérfanos, sin consumidor), la brecha IDENTITY.md-vs-ejecución en 052/056, la ausencia de panel `/admin`, y los 4 sistemas de agentes coexistentes (A/B/C/E).

---

## 0-B. SEGUNDA RONDA (2026-08-08, misma jornada) — reparación de un renombramiento a medias iniciado por Gemini

Otra sesión (Gemini, según reportó el usuario) comenzó a renumerar el Escuadrón Élite de 5 a 8 roles y se cortó a mitad de camino por límite de tokens, dejando 2 archivos modificados sin commitear y en contradicción directa entre sí: `AGENTS.md` (nueva topología, 8 roles, refería al rol nuevo como `008_AUDITOR_DE_CODIGO`) y `.claude/agents/architect.md` (mismo rol, pero como `006_AUDITOR_DE_CODIGO`, dos veces). Detectado con `git status`/`git diff` en frío antes de tocar nada — ninguna carpeta física de `agents/` había sido tocada todavía.

El usuario eligió completar el esquema de Gemini tal cual (001-008), asumiendo `008` como el número correcto. Esto exigía renumerar carpetas reales que colisionaban con los nuevos IDs de rol — un paso que Gemini nunca llegó a proponer ni ejecutar.

**Trabajo completado esta ronda:**
- 5 carpetas renombradas (`git mv`, historial preservado): `000_ORQUESTADOR`→`001_ORQUESTADOR_MAESTRO`, `001_gestor_datos`→`009_gestor_datos`, `002_redactor_tecnico`→`010_redactor_tecnico`, `005_Radar1_minero`→`011_Radar1_minero`, `006_Radar2_Estratega`→`012_Radar2_Estratega`.
- `ESCUADRON_ELITE` en `architecture-gate.cjs` reescrito completo: 8 roles, subordinados reales reasignados por función (ej. los 7 subordinados del antiguo `002_INGENIERIA_TOTAL` pasan a `005_INGENIERO_BACKEND`, ninguno calificaba como frontend).
- Contradicción 006/008 resuelta en `architect.md` (ganó 008, coincide con `AGENTS.md`).
- **Hallazgo adicional durante la reparación, no relacionado con Gemini:** `skills/ag_skills_registry.json` ya tenía 25 rutas rotas desde el archivado de la ronda anterior de hoy (nunca se actualizó ese registro al mover los skills a `_archivo_historico/`) — reparado en la misma pasada, con las skills archivadas ahora marcadas explícitamente como tales (`skills_archivadas_2026-08-08`, separadas del único skill real que vivía en la misma lista, `Skill_Protocolo_Fuente_Unica`).
- `sync_registry.cjs` ahora excluye `_archivo_historico/` de su escaneo — sin esto, redescubriría las 25 skills archivadas como "nuevas" en cada corrida.
- `ANTHROPIC_MODEL` hardcodeado por tercera vez en `architecture-gate.cjs` (se había centralizado en `server.js` y `m1Pipeline.js`, se pasó por alto este) — corregido a `process.env.PRIMARY_AI_MODEL`.
- `IDENTITY.md` de 050/052/056 y del propio `001_ORQUESTADOR_MAESTRO` actualizados (referencias cruzadas a las carpetas renombradas).
- `AGENTS.md` §IV-B corregida: los agentes `06X` que Gemini clasificó como "Agentes de Apoyo" del Escuadrón Élite en realidad viven en `.agent/agents/` (Sistema B, scaffold genérico de terceros) — no son parte de este sistema en absoluto.

---

## 0-C. TERCERA RONDA (2026-08-08, misma jornada) — auditoría de calidad real de los 12 skills activos + de los 8 roles del Escuadrón Élite en sí mismos

Pedido explícito del usuario: no solo confirmar que los skills existen (§0/§0-B ya lo hizo), sino leer su contenido y juzgar si están a la altura de un "Escuadrón Élite". Se leyeron íntegros los 12 archivos de skill activos (no archivados) más los 3 scripts Python de `011_Radar1_minero`. Resultado en detalle en §2.3 (skills) y §1.4 (los 8 roles como entidades, sin sus subordinados).

**Bugs propios encontrados y corregidos durante esta lectura (no relacionados con Gemini, míos de la ronda anterior):**
- `agents/011_Radar1_minero/radar_oficial.py:8-9` seguía escribiendo a `agents/005_Radar1_minero/...` (nombre viejo) — el barrido de referencias de §0-B solo cubrió `.js/.cjs/.json/.md`, nunca `.py`.
- `agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py:10-11` — mismo patrón, seguía apuntando a `agents/000_ORQUESTADOR/...`.
- `agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py:17` — `ALLOWED_SCRIPTS` (allowlist de seguridad del daemon) seguía aceptando `000_Orquestador.cjs`, el nombre retirado en §0-B — corregido a `architecture-gate.cjs`. Sin este fix, el daemon habría rechazado el script legítimo mientras técnicamente seguía "permitiendo" uno que ya no existe.

**Hallazgo nuevo — "Protocolo Titán" (rol `008_AUDITOR_DE_CODIGO`) es un término huérfano:** buscado en todo el proyecto (`*.md`, `*.cjs`, `*.js`) — aparece exactamente 2 veces, ambas la misma frase de una línea (`AGENTS.md` y su espejo en `architecture-gate.cjs`). No hay ningún documento, skill o lógica que lo defina. Es un nombre sin contenido detrás, acuñado por Gemini.

---

## 0-D. CUARTA RONDA (2026-08-10) — hallazgo crítico: `origin/master` y `origin/main` son dos historiales sin ancestro común

Pedido explícito del usuario: re-verificar este documento contra el estado real de disco antes de darlo por vigente, no reescribirlo desde cero. Verificación de rutina (`git fetch` + `git branch -a`) reveló algo que ninguna versión anterior de este documento sabía.

**El hallazgo, verificado con comandos de solo lectura, sin tocar ningún archivo:**

```
git merge-base origin/master origin/main   → sin salida, exit 1 (sin ancestro común)
remotes/origin/HEAD -> origin/main         → main es la rama default real en GitHub
origin/main: 171 commits, último 2026-08-10 17:48 (HOY)
origin/master: HEAD local 8 commits adelante, último commit propio ajeno a main
```

Es la misma clase de hallazgo que §6.4 ya documentó una vez (historial local/remoto sin ancestro común, resuelto por un force-push externo) — pero esta vez entre **dos ramas remotas del mismo repo**, nunca detectado hasta ahora porque ninguna auditoría anterior corrió `git fetch` con visibilidad de todas las ramas antes de concluir.

### 0-D.1 `origin/main` no es una variante de Antigravity JS — es otro proyecto

Leyendo `origin/main:AGENTS.md` y `origin/main:.claude/agents/architect.md` (vía `git show`, sin checkout) queda explícito: el proyecto se autodenomina **"RadarFondos 360"**, no Antigravity JS. Cita textual de su propio `architect.md`:

> "Eres el Agente Arquitecto de RadarFondos 360 [...] Adaptado del patrón ya construido y verificado en `Antigravity JS/.claude/agents/architect.md` (proyecto raíz) — mismo mandato, criterios ajustados a la arquitectura real de este repo."

Es decir: quien construyó esto **ya sabía y documentó explícitamente** que Antigravity JS y RadarFondos 360 son proyectos distintos — y aun así ambos terminaron pusheados al mismo repositorio de GitHub (`jaansave-CKN/Antigravity-JS`), en ramas distintas. Esto coincide con memoria ya registrada del usuario: RadarFondos 360 (`proyectos/Proy_03_RadarFondos/` en disco local) comparte la misma base Supabase que el proyecto raíz — no son independientes a nivel de datos, y ahora tampoco lo son a nivel de repositorio git.

**Riesgo real, no solo de organización:** `origin/main:AGENTS.md` documenta una Capa 2 de fallback a Supabase REST con `service_role` (**bypasea RLS**) para RadarFondos 360. El proyecto raíz (rama `master`) tiene su propio hallazgo crítico sin resolver de un JWT `service_role` legacy de Supabase (§6.4, §11). Si ambos proyectos comparten instancia de Supabase (memoria del usuario lo confirma), **ambos riesgos podrían ser la misma superficie de ataque**, no dos hallazgos independientes — pendiente de que el usuario confirme si es la misma instancia/proyecto Supabase antes de revocar credenciales de un lado sin considerar el otro.

### 0-D.2 Huella agéntica real de `origin/main` — mucho más chica que la de `master`, y con su propia deuda de documentación

Auditando `agents/`, `.claude/`, `.agents/`, `backend/agents/` y `backend/services/` de `origin/main` (vía `git ls-tree`/`git show`, sin checkout — mismo rigor de evidencia que el resto del documento):

| Ruta en `origin/main` | Contenido real | Veredicto |
|---|---|---|
| `agents/` | 2 archivos: `scraper_core.py` + su `.pyc` cacheado | 🟡 Un scraper suelto, no una jerarquía de agentes — nada que ver con el Escuadrón Élite de `master` |
| `.claude/agents/architect.md` | Gate real, adaptado del patrón de `master` (mismo mandato: solo lectura, bloquea antes de escribir código) | 🟢 Genuino — describe con precisión verificable el backend real (`server.js` ~4800 líneas, `backend/routes/`, `backend/config/database.config.js` de 2 capas) |
| `.claude/settings.json` | Config de Claude Code del repo | Sin auditar en profundidad — fuera del foco multiagente |
| `.agents/skills/obsidian-context.md` | 1 skill de contexto Obsidian | 🟡 Menor, sin relación con orquestación |
| `backend/agents/` | `arbolObjetivosAgent.js`, `normativoAgent.js` — 2 agentes de dominio reales | 🟢 Pequeño pero con nombres de dominio específicos (no genéricos como los stubs de `050`-`056` en `master`) |
| `backend/services/geminiCircuitBreaker.js`, `aiTokenLogger.js` | Circuit breaker de cuota + logger de tokens para FinOps — **ambos existen de verdad**, confirmado por contenido | 🟢 Esto es exactamente lo que la auditoría de `master` marcó como 🔴 AUSENTE (§7.2) — `main` sí lo construyó |

**Hallazgo de higiene documental, mismo patrón que "Protocolo Titán" (§0-C) pero en la otra rama:** `origin/main:.claude/agents/architect.md` cita `docs/AUDITORIA_MULTIAGENTE_2026-08-04.md` como la auditoría que originó la regla "cero código sin diseño aprobado" — **ese archivo no existe en `origin/main`** (verificado, `git cat-file -t` falla, y no aparece bajo ningún nombre similar en `docs/`). Es una referencia rota a un documento que o se perdió, o nunca se commiteó, o vivía en otra rama/repo — el mismo tipo de "injerto mal ejecutado" que pidió detectar el prompt original, encontrado ahora en la rama que no se había auditado nunca.

### 0-D.3 Qué significa esto para el resto de este documento

## 0-F. SEXTA RONDA (2026-08-11, misma jornada) — `002` resuelve el bloqueo escalado por `005`, ADR-0001

El usuario escaló formalmente el bloqueo que `005_INGENIERO_BACKEND` reportó al ser creado (§0-E) al rol `002_ARQUITECTO_DE_SOFTWARE`, pidiendo veredicto sobre (1) vía de autenticación definitiva y (2) plano de portabilidad de WORM/OCC desde `Proy_05_SIG` y `Proy_03_RadarFondos`.

Se leyeron íntegros los 2 archivos de migración candidatos a portar más `database.config.js` y `010_rls_complete_audit.sql`/`005_rls_saas_hardening.sql` de `Proy_03_RadarFondos` (definición real de las funciones RLS que usan). **Hallazgo que cambió el veredicto:** la política RLS del proyecto hermano no es una alternativa gratuita a configurar Third-Party Auth — su rama `current_tenant_uuid()` exige un GUC de sesión (`app.tenant_id`) que solo funciona con conexión `pg.Pool` persistente (este proyecto retiró `pg` deliberadamente), y su rama `current_auth_uid()`/`auth.uid()` tiene la *misma* dependencia de Third-Party Auth que bloquea al proyecto raíz. Además, `Proy_03_RadarFondos/backend/config/database.config.js` confirma que su propia Capa 1 (RLS real vía `pg.Pool`) depende de que el usuario "habilite el pooler en Supabase dashboard" — no garantizado —, y degrada a la misma Capa 2 (REST + `SERVICE_KEY`, bypass total) que el hallazgo original de `005`. Es decir: el proyecto que se iba a copiar como "más seguro" tiene el mismo problema sin resolver, solo que fraseado distinto.

**Veredicto emitido, documentado en `docs/ADR/ADR-0001-auth-rls-worm-occ.md`:** Third-Party Auth como vía definitiva (no reintroducir `pg`), con el guardrail Node actual (`assertValidTenant` + `WHERE tenant_id` explícito) como control primario mientras tanto — no removerlo. Portabilidad de WORM/OCC partida en 2 migraciones: **Migración A** (triggers append-only + OCC de aplicación) autorizada ya, sin nuevo veredicto; **Migración B** (RLS real sobre esas tablas) bloqueada hasta que el usuario confirme Third-Party Auth activo en el dashboard. `.claude/agents/005-ingeniero-backend.md` actualizado con un bloque "Gate resuelto" que resume estas condiciones.

**Hallazgo cruzado no pedido, relevante para §6.4:** `database.config.js` de `Proy_03_RadarFondos` documenta en su propio comentario que una credencial `service_role` real quedó commiteada ahí antes y fue/debe ser rotada — dado que ambos proyectos comparten instancia Supabase (memoria ya registrada del usuario), **pendiente que el humano confirme si es la misma credencial ya marcada crítica en §6.4** antes de dar esa revocación por completamente cerrada.

---

## 0-G. SÉPTIMA RONDA (2026-08-11, misma jornada) — `005` ejecuta Migración A de ADR-0001

El usuario autorizó explícitamente a `005_INGENIERO_BACKEND` a ejecutar Migración A (WORM + OCC), con Migración B (RLS real) explícitamente fuera de alcance. Entregables reales, no solo documentados:

- `src/modules/formulador/migrations/007_worm_occ_shadow_ledger.sql` — tablas `project_version_hashes` (Fase 4.1) y `security_violations_ledger` (Fase 4.2, Shadow Ledger), ambas append-only vía trigger (`RAISE EXCEPTION` en `UPDATE`/`DELETE`), con RLS habilitado + política `USING(true)` marcada explícitamente como provisional (no confundir con protección real — Migración B la reemplaza). RPCs: `registrar_version_hash`, `obtener_ultimo_hash`, `registrar_violacion_seguridad`.
- `src/modules/formulador/occGuard.js` — módulo Node nuevo: hash SHA-256 estable (orden de claves normalizado), `assertVersionOrConflict()` (aborta 409 si el hash del cliente no coincide con el último registrado), `registrarViolacionSeguridad()` (best-effort, fire-and-forget, mismo patrón que `aiTokenLogger.js` de `Proy_03_RadarFondos`).
- `src/modules/formulador/FormuladorPgController.js` (`guardarModulo10`) — único endpoint de este controller que reemplaza un recurso existente, por eso es donde se ancla OCC: valida versión antes de escribir, registra el nuevo hash tras escribir (best-effort), y alimenta el Shadow Ledger cuando la RPC rechaza la escritura por no pertenecer al tenant (`tenant_mismatch`) — consumidor real del Shadow Ledger desde el día uno, no una tabla huérfana.
- `src/shared/infrastructure/validation.js` — `schemas.modulo10` acepta `version_hash` opcional (64 chars, sha256 hex).
- **Preservado sin alterar, por instrucción explícita:** `assertValidTenant()` y el filtro `WHERE tenant_id` de las RPC existentes — siguen siendo el control primario hasta que Migración B esté activa.
- **Respetado el veto duro del ADR:** ningún archivo nuevo reintroduce `pg` ni `SET LOCAL app.tenant_id` — las 2 tablas nuevas se escriben solo vía RPC `SECURITY INVOKER` autocontenida, mismo patrón que el resto del esquema.

**Validación de gate ejecutada, resultado real (no maquillado):** `node agents/architecture-gate.cjs --check-gate` (modo gratuito, sin costo de API) → `🛑 Sin aprobación vigente: el estado de agents/+src/ cambió después de la firma`. Esto es el comportamiento **correcto y esperado** del gate — cualquier cambio de código invalida la firma anterior por diseño (`hashEstado()`, autoinvalidante). Aprobar una firma nueva requiere `--aprobar-diseno`, que sí gasta la API de Anthropic — no se ejecutó unilateralmente; queda como acción pendiente a decisión del usuario, no como un fallo de esta ronda. Los 3 archivos JS nuevos/modificados pasaron `node --check` (sintaxis válida) antes de este intento de gate.

---

## 0-H. OCTAVA RONDA (2026-08-11, misma jornada) — purga física de `.agent/`, reparación de enlaces rotos

Verificado en disco antes de actuar (no se aceptó la directiva como hecho sin comprobarlo, per protocolo de este proyecto): `.agent/` **efectivamente fue eliminada** (`ls .agent` → "No such file or directory"), y `.claude/agents/architect.md` fue renombrado a `.claude/agents/002-arquitecto-de-software.md` (`git status` mostró el rename `R`). `git status` también reveló que un actor externo a esta sesión ya había agregado `001-orquestador-maestro.md` y `008-auditor-de-codigo.md` a `.claude/agents/` — no creados por esta sesión, releídos íntegros antes de tocarlos (mismo criterio de "no confiar en cambios ajenos sin re-verificar" documentado en `proyectos/Proy_03_RadarFondos/CLAUDE.md`).

**Hallazgo no pedido, pero real: esos 2 archivos nuevos traían sus propios defectos, no solo los enlaces rotos por la purga:**
- `001-orquestador-maestro.md` §2 seguía ruteando a `004_INGENIERO_FRONTEND` (nombre retirado 2026-08-11, reemplazado por `004_SENTINELA_FRONTEND` en rondas anteriores de esta misma jornada) — corregido.
- `001-orquestador-maestro.md` §4 reintroducía la clasificación "06X = Agentes de Apoyo" que la ronda §0-B ya había corregido una vez (esos archivos vivían en `.agent/agents/`, recién destruida) — ahora era una referencia a una carpeta que ya no existe en absoluto. Reescrito como nota de fuente única de verdad.
- `008-auditor-de-codigo.md` tenía `name: 006_auditor_de_codigo` en el frontmatter pese a llamarse `008-auditor-de-codigo.md` — el mismo tipo exacto de contradicción 006-vs-008 que §0-C ya había resuelto una vez y bautizado "Protocolo Titán huérfano". Corregido a `008-auditor-de-codigo` (y las 2 menciones del cuerpo del archivo).

**Enlaces reparados (la orden original):**
- `agents/architecture-gate.cjs` — 11 referencias a `.claude/agents/architect.md` (incluida `ARCHITECT_PROMPT_PATH`, la ruta que de verdad carga el prompt del gate) actualizadas a `002-arquitecto-de-software.md`. Verificado que el archivo resuelto existe en disco (`ls` confirmó) y que `architect.md` ya no existe bajo ningún path.
- `AGENTS.md` §III y §IV — referencia del Axioma 1 actualizada; tabla de topología reescrita con la ruta real de cada subagente en `.claude/agents/` (6 de 8 roles ya tienen archivo real: `001`, `002`, `003`, `004`, `005`, `008`; `006`/`007` siguen sin subagente propio, marcado explícitamente); §IV-B reescrita para declarar `.agent/` eliminada en vez de seguir apuntando ahí.
- `.claude/agents/002-arquitecto-de-software.md` — `name: architect` (frontmatter) no se había actualizado al renombrar el archivo; corregido a `002-arquitecto-de-software` — sin esto, el identificador interno seguía siendo el viejo pese al `git mv`.
- `.claude/agents/003-esp-diseno-stitch.md` — 1 referencia a `architect.md` corregida.

**Validación de gate:** `agents/architecture-gate.cjs` pasa `node --check` (sintaxis válida). `--check-gate` corre de punta a punta sin crashear y reporta correctamente `Sin aprobación vigente` — esperado, cualquier cambio de archivo invalida la firma anterior por diseño. No se ejecutó `--aprobar-diseno` (gasta API) sin autorización explícita.

---

## 0-I. NOVENA RONDA (2026-08-11, misma jornada) — auditoría forense de `008_AUDITOR_DE_CODIGO` sobre Migración A, hallazgo crítico corregido antes de tocar Supabase

El usuario, correctamente, no aceptó la aprobación del gate de la ronda §0-H como escrutinio real del código de Migración A — esa firma cubrió el trabajo de gobernanza de agentes, sus propias razones dicen explícitamente "no toca... src/modules/... en este diff" pese a que los 3 archivos de Migración A estaban en el mismo diff. Se transfirió el mando a `008_AUDITOR_DE_CODIGO` para una revisión línea por línea, adversarial, de los 3 archivos, antes de autorizar nada contra Supabase.

**Hallazgo CRÍTICO — el OCC tal como se construyó no bloquea la colisión que dice prevenir:** `occGuard.assertVersionOrConflict()` (lee el último hash vía RPC `obtener_ultimo_hash`) y la escritura (RPC `guardar_modulo10`) eran **2 llamadas PostgREST separadas — 2 transacciones Postgres independientes, sin lock entre ellas**. Bajo concurrencia real (el único caso que le importa a OCC — "modificación concurrente en obra", Fase 4.1 del mandato original), 2 requests simultáneos sobre el mismo proyecto pueden ambos leer el mismo "último hash", ambos pasar el check, y ambos escribir — TOCTOU (time-of-check-to-time-of-use) clásico. El mecanismo "funcionaba" solo en el caso trivial sin concurrencia real, que es precisamente el caso que no necesita protección.

**Hallazgo MEDIO — `registrar_version_hash` rompía en guardados sin cambios:** un guardado idéntico al anterior produce el mismo hash, chocando con el índice único `idx_pvh_unique_hash` (`duplicate key`, error 500) para un caso que no es un error.

**Hallazgo MEDIO, documentado, no "corregible" en esta capa — TRUNCATE bypassa los triggers WORM:** `BEFORE DELETE`/`BEFORE UPDATE` no interceptan `TRUNCATE` en Postgres. Solo explotable con acceso SQL directo (dashboard/administrador), que ya está fuera del perímetro de la aplicación — documentado en el propio archivo de migración para que "WORM" no se lea como garantía absoluta sin matiz.

**Verificado y descartado como hallazgo (sin fabricar uno donde no lo hay):** los 3 archivos no contienen ninguna operación financiera ni de costos — el requisito de aritmética entera en COP del mandato original no aplica a este diff, se declara explícitamente en vez de forzar un hallazgo falso. Sin riesgo de inyección SQL (parámetros vía RPC/PostgREST, sin concatenación de strings). Aislamiento de tenant correcto en ambas RPCs nuevas.

**Corrección aplicada antes de sellar (008 no tiene `Write`/`Edit` en su propio mandato — la reparación la ejecutó la misma sesión, actuando como el rol con permiso de escritura, `005`, no el auditor):**
- `007_worm_occ_shadow_ledger.sql` — `registrar_version_hash` ahora usa `ON CONFLICT (proyecto_id, hash_value) DO NOTHING` + lectura del registro existente — guardado sin cambios deja de ser un error 500.
- `008_occ_atomic_guardar_modulo10.sql` (nueva) — reemplaza `guardar_modulo10`: `SELECT ... FOR UPDATE` sobre la fila del proyecto (serializa escritores concurrentes del mismo proyecto) + comparación de `p_expected_hash` + DELETE/INSERT de indicadores + registro del nuevo hash, **todo en una sola transacción**. Sigue sin `pg`, sin `SET LOCAL app.tenant_id` — restricción dura del ADR-0001 respetada.
- `occGuard.js` y `FormuladorPgController.js` — `guardarModulo10` ya no hace un pre-check en llamada separada; calcula el hash en Node y lo pasa como `p_expected_hash`/`p_new_hash` a la RPC atómica. `assertVersionOrConflict`/el pre-check separado quedaron retirados del camino de escritura; `obtenerUltimoHash`/`registrarVersionHash` se conservan como utilidades advisory documentadas (ej. UI que avisa "esto cambió" antes de editar), nunca como gate de escritura.

**Validación:** los 3 archivos JS pasan `node --check`. `--check-gate` vuelve a reportar (correctamente) que la firma anterior ya no es válida — el nuevo archivo `008_occ_atomic_guardar_modulo10.sql` cambia el listado de `src/`, autoinvalidando la aprobación previa por diseño. No se ejecutó `--aprobar-diseno` (gasta API) sin autorización explícita.

**Commit sellado, alcance exclusivamente de este hallazgo (`feat(db):`):** `src/modules/formulador/migrations/007_worm_occ_shadow_ledger.sql`, `008_occ_atomic_guardar_modulo10.sql`, `occGuard.js`, `FormuladorPgController.js`, `src/shared/infrastructure/validation.js` — el resto de cambios pendientes (gobernanza de agentes, ADR, esta auditoría) queda fuera de este commit a propósito, no se mezclan alcances distintos en un mismo commit.

**Sobre "autorización final para ejecutar el SQL en Supabase":** el código queda blindado por esta ronda, pero aplicar DDL/triggers nuevos contra la instancia de producción de Supabase es una acción real, de alto impacto y sin deshacer trivial — no se ejecutó de forma autónoma. Los archivos `007` y `008` de `src/modules/formulador/migrations/` están listos para aplicarse (`psql $DATABASE_URL -f ...` o el editor SQL de Supabase, en ese orden), a la espera de confirmación humana explícita para el paso de producción en sí, no solo para el código que lo implementa.

---

Todo lo demás (§1-§14) describe con precisión la rama `master` — verificado de nuevo hoy (agents/, `.claude/agents/architect.md`, pre-commit hook, listado de carpetas: sin drift detectado más allá del trabajo propio de esta sesión). **Pero "master" puede no ser la rama que Render despliega realmente** — `remotes/origin/HEAD` apunta a `main`, que es la convención estándar de GitHub para señalar la rama por defecto. Esto no se puede resolver desde disco; requiere que el usuario confirme en el dashboard de Render cuál rama está configurada para el servicio `radar-formulador-360`.

---

## 0-E. QUINTA RONDA (2026-08-11) — re-verificación forense completa + 2 hallazgos nuevos, sin drift estructural

Pedido explícito del usuario: repetir la auditoría de los 5 bloques del protocolo original (topografía, MVP real vs. stubs, RBAC, multiagente/FinOps, telemetría/monetización) con foco especial en el ecosistema agéntico — inventario total, organigrama, auditoría anatómica de skills, mapa de integraciones, gaps y plan de remediación. Metodología: verificación directa en disco (no se confió en el hallazgo de un subagente de investigación sin comprobarlo por lectura propia de cada archivo citado), más un agente de investigación en paralelo (`general-purpose`, id `ae5a10eaa007aa11c`) que re-descubrió de forma independiente el mismo inventario de §1-§13 — usado como segunda fuente para contraste, no como fuente primaria.

**Estado de commits verificado hoy:** HEAD local `717d286` ("renombra 004_INGENIERO_FRONTEND a 004_SENTINELA_FRONTEND con subagente real"), **ahora 10 commits adelante de `origin/master`** (`d9e520a`, sin cambio desde §0-D). `origin/main` sigue en `9dfb577` (sin cambios desde el 2026-08-10). El documento ya tenía incorporados en línea (sin fecha propia en el header) los 2 últimos commits reales (`004_SENTINELA_FRONTEND`, eliminación de 051/054/056) — confirmado que §1.2/§1.4/§2.3 ya reflejaban ese estado antes de esta ronda; no se detectó drift entre lo documentado y `git log`/`git ls-tree` de hoy.

**Hallazgo nuevo 1 — `opencode.json` (Sistema E) sigue vivo y contradice la narrativa "solo Claude" de forma más explícita de lo que §1.1 registraba.** Leído completo hoy:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": { "openrouter": { "api_key": "{env:OPENROUTER_API_KEY}", "api_base": "https://openrouter.ai/api/v1" } },
  "agent": { "default": { "model": "google/gemini-2.0-flash-lite" } },
  "mcp": { "enabled": true }
}
```
§1.1 ya lo listaba como Sistema E ("No ejecuta hoy"), pero ningún párrafo señalaba la contradicción directa con §4/§7.1 ("OpenRouter eliminado por completo — decisión de producto"). La purga de MiniMax/OpenRouter (§0, ítem 7) tocó `MiniMaxChat.jsx` y `/api/openrouter/*` en el backend Express, pero no tocó este archivo de configuración de una herramienta de terceros (OpenCode) que sigue declarando OpenRouter/Gemini como proveedor por defecto. No hay evidencia de que nada lo invoque en runtime hoy (no aparece en `package.json` ni es importado por ningún script) — es un fósil de configuración, no una vía de ejecución activa confirmada, pero es exactamente el tipo de "injerto sin resolver" que el protocolo pide señalar: promete un motor que el resto del sistema afirma haber eliminado.

**Hallazgo nuevo 2 — evidencia en vivo, hoy, de que `Skill_Soporte_Automatico.cjs` (ya diagnosticado como roto en §2.3/ítem 16 del plan de remediación) sigue ejecutándose y tocando el repo sin que nadie lo revise.** `git status` de esta ronda muestra `public/estado_antigravity.json` modificado sin commitear — es exactamente el archivo que ese skill reescribe cada 5 minutos leyendo una ruta inexistente (`./.agents`, con "s") y fallando en bucle con un mensaje engañoso ("Reintentando conexión con la base de datos"). No se investigó más a fondo qué proceso lo está disparando (no había ningún proceso Node corriendo visible desde esta sesión) — pero el archivo modificado es prueba física de que el bug documentado en la ronda anterior no es solo teórico, sigue produciendo ruido real en el working tree.

**Sin cambios confirmados por re-lectura directa (no solo por el reporte del subagente):** `.claude/agents/architect.md` y `.claude/agents/004-sentinela-frontend.md` (Sistema C, 2 subagentes reales), `.git/hooks/pre-commit` (gate obligatorio vigente), `skills/ag_skills_registry.json` (estructura de 4 sistemas + 25 skills archivadas, sin nuevas rutas rotas detectadas en el muestreo de esta ronda), `src/orchestrator-engine.js` (motor real de Fase 1, llama `/api/chat`→Claude, sin relación con ningún otro proveedor). `proyectos/api-usuarios/.agent/` confirma la misma duplicación del Sistema B boilerplate ya señalada para `.agent/` raíz (20 agentes genéricos de plantilla, ninguno especializado al dominio) — mencionado aquí solo como confirmación cruzada, sigue fuera del árbol de trabajo local por ser repo git independiente.

**Conclusión de §0-E:** no hay hallazgos estructurales nuevos de peso — la cirugía de las rondas 0/0-B/0-C sigue sólida 3 días después. Los 2 hallazgos de esta ronda son menores (un fósil de configuración sin invocación confirmada, y la reconfirmación en vivo de un bug ya conocido). El punteo de §14 y la matriz de §11 no cambian de estado; se agregan 2 filas nuevas en §12 (ver abajo).

**Remediación ejecutada en esta misma ronda:** el usuario aportó el contenido para `003_ESP_DISENO_STITCH`, el único de los 3 roles restantes sin sustancia (`003`/`005`/`006`, ver §1.4) que tenía una propuesta concreta lista para implementar. Se creó `.claude/agents/003-esp-diseno-stitch.md` (Read/Grep/Glob, solo lectura, mismo patrón que `002`/`004`) — mandato: auditar fuga de estilos fuera de Tailwind, desalineación con el patrón dark UI ya establecido, y duplicación de componentes visuales, coordinando (no duplicando) con `002` y `004`. Se verificó primero el estado real del sistema de diseño del proyecto (`public/src/index.css:1` — Tailwind 4 vía `@import`, sin `@theme` ni paleta custom) para que el agente no audite contra tokens que no existen. §1.2 y §1.4 actualizados: de 8 roles, ahora **3** tienen subagente real (`002`, `003`, `004`).

**Segunda remediación, misma ronda:** el usuario aportó también el contenido para `005_INGENIERO_BACKEND` — a diferencia de `002`/`003`/`004` (solo lectura), este rol pide `Write`/`Edit`/`Bash`, es decir, puede mutar el repo de verdad. Antes de crear el archivo se fundamentó cada fase del mandato contra el código real de `src/modules/formulador/supabaseClient.js`, y apareció una **contradicción activa, no un gap silencioso**: la Fase 2.1 del mandato exige "cero bypass de `service_role` en lógica de negocio regular", pero `sbFetch()` (líneas 51-68 de ese archivo) hoy degrada a `SERVICE_KEY` en *toda* llamada porque Supabase no tiene Third-Party Auth (Firebase) configurado — el aislamiento real depende del filtro `WHERE tenant_id` explícito en cada RPC, no de RLS por rol. Implementar la Fase 2.1 tal como está escrita, literalmente, rompería el módulo Formulador en producción. `.claude/agents/005-ingeniero-backend.md` documenta esto explícitamente y prohíbe a este subagente implementar Fase 1 (WORM) o Fase 4 (Shadow Ledger/OCC) — subsistemas que no existen en este proyecto raíz, aunque sí existen ya como referencia real en 2 proyectos hermanos (`proyectos/Proy_05_SIG/app/migrations/008_sprint6_worm.sql` y `proyectos/Proy_03_RadarFondos/backend/migrations/009_project_version_hashes.sql`) — sin veredicto previo de `002_ARQUITECTO_DE_SOFTWARE`. §1.2 y §1.4 actualizados: de 8 roles, ahora **4** tienen subagente real (`002`, `003`, `004`, `005`), aunque `005` es el único con permiso de escritura y por tanto el de mayor blast radius del grupo.

---

## 1. INVENTARIO TOTAL Y ORGANIGRAMA JERÁRQUICO

### 1.1 Los cuatro sistemas coexistentes (marco general, sin cambios)

| Sistema | Ruta | Origen | Naturaleza | ¿Ejecuta hoy? |
|---|---|---|---|---|
| **A** | `agents/` | Propio | 15 agentes de negocio (000-057) + 14 archivos sueltos de utilidad (post-purga) | Parcial |
| **B** | `.agent/` | Scaffold de terceros ("Antigravity Kit") | 21 agentes / 36 skills genéricos, cero referencia al dominio real | No |
| **C** | `.claude/` | Claude Code nativo | `architect.md` (gate real) + 12 skill-packs de Firebase | **Sí** |
| **E** | `opencode.json` | Herramienta de terceros | Config de otro asistente de código | No |

### 1.2 Organigrama actualizado — Sistema A (`agents/`)

**Renumerado 2026-08-08 (segunda ronda, ver §0-B):** el Escuadrón Élite pasó de 5 a 8 roles (001-008). Las carpetas de agentes reales que chocaban numéricamente con los nuevos roles se movieron: `000_ORQUESTADOR`→`001_ORQUESTADOR_MAESTRO`, `001_gestor_datos`→`009_gestor_datos`, `002_redactor_tecnico`→`010_redactor_tecnico`, `005_Radar1_minero`→`011_Radar1_minero`, `006_Radar2_Estratega`→`012_Radar2_Estratega`.

```
001_ORQUESTADOR_MAESTRO  (Enrutador Central — IDENTITY.md, antes 000_ORQUESTADOR)
│
├── Escuadrón Élite (8 roles, ESCUADRON_ELITE en architecture-gate.cjs)
│   ├── 002_ARQUITECTO_DE_SOFTWARE — sin carpeta propia: .claude/agents/architect.md
│   ├── 003_ESP_DISENO_STITCH      — subordinados: [] (con subagente real desde 2026-08-11:
│   │                                .claude/agents/003-esp-diseno-stitch.md)
│   ├── 004_SENTINELA_FRONTEND     — subordinados: [] (renombrado 2026-08-11, ahora con
│   │                                subagente real: .claude/agents/004-sentinela-frontend.md)
│   ├── 005_INGENIERO_BACKEND      — 009_gestor_datos, 011_Radar1_minero,
│   │                                012_Radar2_Estratega, 050_Formulador_proy,
│   │                                07-ing-concreto_GFRC, 08-estratega-neuromarketing
│   │                                (051_Form_Lluvia_de_ideas eliminado 2026-08-11, stub)
│   │                                — subagente real desde 2026-08-11:
│   │                                .claude/agents/005-ingeniero-backend.md (único con
│   │                                permiso de escritura: Read/Write/Edit/Grep/Glob/Bash)
│   ├── 006_DEVSECOPS_INFRAESTRUCTURA — 03-analista-secop, 052_Form_Administrativo,
│   │                                14-analista-comportamiento, 015_intelligence-core
│   │                                (054/056 eliminados 2026-08-11, stubs — commit a349dcb)
│   ├── 007_DOCUMENTADOR_AS_BUILD  — 010_redactor_tecnico
│   └── 008_AUDITOR_DE_CODIGO      — subordinados: [] (rol nuevo, sin implementación;
│                                     architect.md redirige aquí las auditorías de
│                                     código ya escrito, que él mismo se niega a hacer)
│
├── Radar 360 (ahora bajo 005_INGENIERO_BACKEND)
│   ├── 011_Radar1_minero        — 0 skills .cjs, solo .py sueltos
│   ├── 012_Radar2_Estratega     — solo IDENTITY.md
│   └── [huérfano en 001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/:
│        25 skills de un Radar legacy Firebase-based, archivadas — ver §2.1]
│
├── Formulador 360 (bajo 005_INGENIERO_BACKEND / 006_DEVSECOPS_INFRAESTRUCTURA / 007_DOCUMENTADOR_AS_BUILD)
│   ├── 050_Formulador_proy, 052_Form_Administrativo, 010_redactor_tecnico
│   │   (1-3 skills reales c/u; 051/054/056 eliminados 2026-08-11 por ser stubs sin
│   │    lógica real — la brecha IDENTITY.md-vs-código que tenía 056, §10, ya no aplica)
│
├── Soporte: 009_gestor_datos, 015_intelligence-core, 03-analista-secop
│
├── Fantasmas en IDENTITY.md, ausentes en disco (sin cambios)
│   ├── 100_reparador_codigo     — IDENTITY.md:30, carpeta NO existe
│   └── 09-legal-licitaciones    — IDENTITY.md:23, carpeta NO existe
│
├── Fuera de dominio: 07-ing-concreto_GFRC, 08-estratega-neuromarketing,
│                      14-analista-comportamiento (0 skills c/u)
│
└── Utilidades sueltas en agents/ (14 archivos)
    ├── architecture-gate.cjs   — REAL: gate de arquitectura + batch executor
    ├── 000_VERIFICADOR.cjs   — diagnóstico trivial (3 checks hardcoded, OK hoy)
    ├── diseno_aprobado.json  — firma del gate (ver §12)
    └── extractor-pro.cjs, generar_reporte.cjs, vision-engine.cjs,
        check_image.cjs, clean_excel.cjs, fetch_municipios.cjs,
        read_excel.cjs, read_image.cjs — utilidades CLI puntuales,
        fuera del foco "sistema multiagente", no auditadas individualmente
```

**Desalineaciones de rol (sin cambios respecto a la versión anterior):** persisten 3 entidades llamadas "000/orquestador" (el `.cjs` real, la carpeta con el daemon `puente_ejecutor.py`, y `.agent/agents/000_orquestador.md` del Sistema B). El nodo orquestador central existe pero está fragmentado, no faltante.

### 1.3 Clasificación transversal vs. específico (sin cambios)

- **Transversales:** `agents/skills/*` (3 `.cjs` + 16 `SKILL.md`), `skills/` raíz (`Skill_Bitacora_Sistema.cjs`, `arquitectura/*.cjs`, `seguridad/Skill_Protocolo_Fuente_Unica.cjs` — este último con uso real confirmado en `m1Pipeline.js:11`).
- **Específicos del proyecto:** las 15 carpetas numeradas `000`-`057`.

### 1.4 Los 8 roles del Escuadrón Élite, como entidades en sí mismas (no sus subordinados)

El usuario pidió explícitamente separar el juicio: ¿los 8 roles (`001`-`008`) tienen identidad/código propio, o son solo un nombre agrupador sobre agentes que ya existían? Confirmado a partir de `agents/architecture-gate.cjs` (objeto `ESCUADRON_ELITE`) y de si cada uno tiene carpeta/`IDENTITY.md` propios en `agents/`.

| Rol | ¿Carpeta/IDENTITY.md/código propio? | Veredicto |
|---|---|---|
| `001_ORQUESTADOR_MAESTRO` | Sí — `IDENTITY.md` (tabla de ruteo) + `ejecutarTodosLosAgentes()` en código | 🟠 El código real es un batch runner crudo (sin ruteo condicional, sin reintentos); y el propio `IDENTITY.md` alucina 2 subordinados inexistentes (`100_reparador_codigo`, `09-legal-licitaciones`, IDENTITY.md:30,23) |
| `002_ARQUITECTO_DE_SOFTWARE` | Sí — `.claude/agents/architect.md`, gate real | 🟢 Único genuinamente de alto nivel — verificado 3 veces con razonamiento real distinto según el diff |
| `003_ESP_DISENO_STITCH` | Sí — `.claude/agents/003-esp-diseno-stitch.md`, subagente real de solo lectura (creado 2026-08-11) | 🟢 Mandato acotado: audita fuga de estilos fuera de Tailwind, desalineación con el patrón dark UI, duplicación de componentes; documenta explícitamente que el proyecto no tiene `@theme`/paleta custom hoy (Tailwind por defecto), y que generar/editar pantallas en Stitch (`mcp__stitch__*`) queda fuera de su alcance de solo lectura — no reemplaza ese flujo, lo audita desde afuera |
| `004_SENTINELA_FRONTEND` (renombrado 2026-08-11, antes `004_INGENIERO_FRONTEND`) | Sí — `.claude/agents/004-sentinela-frontend.md`, subagente real de solo lectura | 🟢 Mandato acotado y honesto: audita stubs huérfanos (patrón `FrozenPage.jsx`) y contratos de build — no corrige, no ejecuta el build él mismo |
| `005_INGENIERO_BACKEND` | Sí — `.claude/agents/005-ingeniero-backend.md`, subagente real creado 2026-08-11, **único con permiso de escritura** (Read/Write/Edit/Grep/Glob/Bash) de los subagentes reales del Escuadrón Élite | 🟡 Mandato ambicioso (WORM, RLS hard-gate, COP entero, OCC, shadow ledger) — grounded contra el código real al crearlo, y expuso una contradicción activa (ver §0-E): su Fase 2.1 ("cero bypass de `service_role`") choca de frente con `supabaseClient.js`, que hoy degrada a `SERVICE_KEY` en toda llamada porque Third-Party Auth no está configurado en Supabase. El archivo documenta la contradicción explícitamente y prohíbe implementar Fase 1/4 (WORM, shadow ledger — no existen en este proyecto) sin veredicto previo de `002` |
| `006_DEVSECOPS_INFRAESTRUCTURA` | No — mismo patrón | 🔴 Su propio `rol` dice "Despliegues a producción, servidores" — ninguno de sus 6 subordinados hace eso (son agentes de Formulador y compliance) |
| `007_DOCUMENTADOR_AS_BUILD` | Parcial — `carpetaSalida` real, genera acta en `docs/as-build/` | 🟡 Segundo más real de los 8 — único con un artefacto de código tangible propio, no prestado de un subordinado |
| `008_AUDITOR_DE_CODIGO` | No — cero subordinados, cero código | 🔴 Cita "Protocolo Titán" (ver §0-C, término sin definición en ningún lado). `architect.md` lo cita como destino de las auditorías post-hoc que él mismo rechaza — pero no hay nada del otro lado para recibirlas |

**Conclusión de §1.4 (actualizada 2026-08-11, ronda §0-E):** de 8 roles, ahora 4 tienen subagente real (`002`, `003`, `004`, `005`) y 1 más tiene un artefacto propio tangible (`007`). De los 4 con subagente, solo `005` puede escribir/mutar el repo — los otros 3 son de solo lectura por diseño. Quedan 3 roles sin sustancia (`001` como batch runner crudo con IDENTITY.md alucinado, `006`, `008`) — dos de ellos (`001`, `006`) tienen algo peor que estar vacíos: su propia descripción es falsa.

---

## 2. AUDITORÍA FORENSE DE SKILLS

### 2.1 El "Radar legacy" — 25 skills en `agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/`, sin cambios desde la auditoría previa

Documentados con precisión en `Skill_Loader.cjs:8-134` (metadata predefinida por skill). Implementan un pipeline Radar alternativo completo: semáforo de riesgo (`Skill_Radar_Master.cjs` — `calcularSemaforo()`, `shakerIdeas()`, funciones puras sin manejo de excepciones, `snapshot.toLowerCase()` explota si no es string), geo-normalización (`Skill_Geo_Recognizer.cjs`), bridges a Firebase (`Skill_Firebase_Bridge.cjs`/`Skill_Bridge_Produccion.cjs`, apuntando a `antigravity-jairo-2026.web.app`), endpoints propios inexistentes en `server.js` (`Skill_API_Alertas.cjs`, `Skill_Contexto_Dinamico.cjs`).

**Sigue sin consumidor:** `Skill_Loader.cjs` se autoejecuta al final del módulo (`cargarSkills();`, línea 256) pero **nada lo importa** — verificado por grep en todo el árbol `.js/.jsx/.cjs/.html`. Manejo de errores: `try/catch` silencioso en `modulo.init()` (línea 191-193, traga el error sin loguearlo).

### 2.2 Scripts de utilidad en `agents/` — tabla actualizada post-purga

| Archivo | Estado |
|---|---|
| `agents/architecture-gate.cjs` | 🟢 Real — gate + batch executor, corregido y verificado end-to-end esta sesión (dotenv, tool-hallucination, exit-code crash) |
| `agents/000_VERIFICADOR.cjs` | 🟢 Trivial pero correcto — 3 rutas hardcodeadas, las 3 existen hoy |
| `agents/auditor-integridad.cjs` | ✅ Eliminado (era 🔴 fósil, 11/11 rutas inexistentes) |
| `agents/bridge-server.cjs` | ✅ Eliminado (era 🔴 servidor huérfano puerto 3001) |
| `agents/skill-dispatcher.cjs` | ✅ Eliminado (era 🔴 schema `available_skills` inexistente) |
| `agents/index.js` + `ContextManager.js` + `Agente001/050/051/052.js` | ✅ Eliminados (eran 🔴 import roto + referencia a proyecto purgado) |

**Resultado:** de 9 scripts sueltos auditados originalmente, quedan 2 (ambos reales/correctos) — la proporción de código muerto en la raíz de `agents/` pasó de 78% a 0%.

### 2.3 Auditoría anatómica de los 12 skills activos de negocio — leídos íntegros, no solo inventariados

Metodología: lectura completa (no muestreo) de los 12 archivos `.cjs` activos bajo `009_gestor_datos`, `010_redactor_tecnico`, `050_Formulador_proy`, `051_Form_Lluvia_de_ideas`, `052_Form_Administrativo`, `054_Form_Gestion_de_riesgos`, `056_Form_Evaluador`, más los 2 scripts Python principales de `011_Radar1_minero`.

| Skill | Función real (I/O) | Manejo de errores | Veredicto |
|---|---|---|---|
| `009_gestor_datos/Skill_001_Gestor_Directorios.cjs` | Crea estructura de carpetas (`process.argv` → `fs.mkdirSync` en cascada) | Ninguno — sin try/catch | 🟢 Real, funcional, sin blindaje |
| `009_gestor_datos/Skill_001_Fix_Encoding.cjs` | Corrige acentos rotos a entidades HTML en archivo/directorio | `try/catch` presente, retorna `false` en error | 🟢 Real, funcional |
| `009_gestor_datos/Skill_001_Gestor_Encoding.cjs` | Igual que el anterior, + modo `check` | Parcial | 🟠 **Riesgo real:** incluye `execSync('firebase deploy --only hosting')` activable con flag `--deploy` — un "arreglador de encoding" con capacidad de desplegar a producción, sin ningún gate de confirmación |
| `009_gestor_datos/Skill_001_OCR_Soporte.cjs` | Lee **solo la extensión** del archivo y arma metadata (`.pdf`→"Documento PDF") | N/A | 🔴 **Nombre engañoso** — cero OCR real, no extrae texto de nada pese al nombre |
| `010_redactor_tecnico/Skill_002_Redactor_Propuestas.cjs` | Genera un `.docx` real vía librería `docx` (Document/Paragraph/TextRun) | Ninguno | 🟢 El más sofisticado del lote — pero contenido de plantilla fija, 5 campos interpolados, no redacción adaptativa |
| `010_redactor_tecnico/Skill_002_Generador_Anexos.cjs` | Escribe `.txt` con texto fijo, un parámetro interpolado | Ninguno | 🟠 Mínimo — casi no varía por proyecto |
| `010_redactor_tecnico/Skill_Soporte_Automatico.cjs` | Lee `./.agents` (con "s") cada 5 min, cuenta carpetas, escribe `estado_antigravity.json` | `try/catch` que **oculta el error real** | 🔴 **Roto y engañoso** — esa ruta nunca ha existido en este proyecto (confirmado en auditorías previas); falla en bucle infinito imprimiendo "Reintentando conexión con la base de datos", un mensaje que no tiene relación con el bug real (es un path equivocado, no una DB) |
| `050_Formulador_proy/Skill_050_Formulador_Proyecto.cjs` | **No formula nada** — es un generador de plantillas boilerplate para *otros* skills | N/A | 🔴 Lista interna cita `Skill_057_Interventor`, un rol que no existe en la numeración actual — desactualizado incluso consigo mismo |
| `051_Form_Lluvia_de_ideas/Skill_051_Lluvia_Ideas.cjs` | `{status:'ok', resultado:{}}` | N/A | 🔴 Stub puro, generado por la plantilla de 050 |
| `052_Form_Administrativo/Skill_052_Metodologia_Maestra.cjs` | Constante con 4 frases sobre metodología MGA | N/A | 🟠 No es un skill ejecutable — es una tabla de referencia (`module.exports` de un objeto estático) |
| `054_Form_Gestion_de_riesgos/Skill_054_Gestion_Riesgos.cjs` | `{status:'ok', resultado:{}}` | N/A | 🔴 Stub puro — su propio campo `notas` admite *"Solo registra, no analiza"* |
| `056_Form_Evaluador/Skill_056_Evaluador.cjs` | `{status:'ok', resultado:{}}` | N/A | 🔴 Stub puro — sin ningún criterio real de evaluación pese al nombre |
| `011_Radar1_minero/radar_oficial.py` + `test_fuentes.py` | Scraping real (`requests`+`BeautifulSoup`), regex para extraer presupuesto/fecha de HTML | `try/except` presente en puntos clave | 🟡 El más sofisticado técnicamente de los 12 — pero rastrea **Costa Rica, Chile, Argentina, Uruguay, Paraguay, Panamá**, no Colombia. Choca con el Axioma II.2 de `AGENTS.md` (todo en COP, foco nacional). Tenía además 2 rutas rotas por el rename de §0-B, corregidas en §0-C |

**Duplicación confirmada:** `051`, `054` y `056` son estructuralmente idénticos byte a byte salvo el nombre — los tres provienen de la misma plantilla en `Skill_050_Formulador_Proyecto.cjs`, no de una implementación pensada para cada dominio.

**Conclusión de §2.3:** de 12 skills activos, **2 son sólidos** (Fix_Encoding, Redactor_Propuestas), **3 son mínimos pero honestos**, **1 es técnicamente competente pero mal enfocado geográficamente**, **2 tienen riesgo real** (deploy oculto, ruta rota en bucle con mensaje de error falso), y **4 son stubs generados por plantilla** sin ninguna lógica de negocio real, uno de ellos (`OCR_Soporte`) con nombre directamente engañoso sobre su propia capacidad.

---

## 3. MAPA DE INTEGRACIONES Y FLUJOS

### 3.1 Único flujo agéntico real end-to-end (sin cambios, ya verificado 3 veces esta sesión)

```
node agents/architecture-gate.cjs --aprobar-diseno
  → lee .claude/agents/architect.md (system prompt)
  → lee git diff HEAD (texto plano, sin tool-use real)
  → Anthropic API real → veredicto JSON → agents/diseno_aprobado.json
```

Verificado con 3 corridas reales hoy: (1) rechazo por saldo agotado, (2) rechazo por alucinación de tool-call (corregido), (3) rechazo genuino y bien razonado sobre un diff real (detectó borrado de CSVs de `.agent/` sin reemplazo visible).

### 3.2 SPOF de orquestación (sin cambios)

`agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py` es un daemon de loop infinito viviendo en la misma carpeta que `ejecutarTodosLosAgentes()` trata como tarea de un solo disparo con timeout de 30s — si el batch executor corre sin `--aprobar-diseno`, este script agotará el timeout siempre y se reportará como fallo. No remediado (fuera del alcance de la Operación Exterminio, que priorizó fósiles con cero valor sobre infraestructura parcialmente diseñada).

### 3.3 Comunicación con el backend real

Los agentes 050-056 no tienen wiring de código hacia Supabase/Express/APIs — son prompts de referencia para operador humano o Claude Code interactivo. Único agente con puente de código real hacia una API: `architect.md` (vía `pedirVeredictoArquitecto()`).

### 3.4 Brecha de "cero código sin diseño aprobado"

El gate sigue siendo **opt-in**. No hookeado a pre-commit. Así se trabajó toda esta sesión: código primero, gate al final como verificación, no como bloqueo de entrada.

---

## 4. TOPOGRAFÍA DE ARQUITECTURA DEL SISTEMA

| Capa | Tecnología real | Evidencia |
|---|---|---|
| Frontend | React 18.3 + React Router 7 + Vite 5 + Tailwind 4 | `package.json` |
| Backend | Node.js ESM + Express 4, monolito de un proceso | `server.js` |
| BD | Supabase PostgreSQL vía REST/PostgREST — `pg` **retirado** de `package.json` hoy | `supabaseClient.js` |
| Auth | Firebase (Google Sign-In) + JWT propio | `FirebaseAuthMiddleware.js`, `session-manager.js` |
| IA | Claude/Anthropic únicamente — **OpenRouter/MiniMax eliminados por completo hoy**, modelo centralizado vía `PRIMARY_AI_MODEL` | `server.js:29`, `.env` |
| Caché | Upstash Redis + fallback en memoria | `cache.js` |

**Patrón:** Monolito Modular Pragmático. Hexagonal real solo en `src/modules/communications/`. `AGENTS.md` ya no reclama "Hexagonal, DDD" globalmente (corregido 2026-08-07).

**Manejo de estado / SPOF:** sin cambios respecto a la radiografía del 07-08 — `radarData` en memoria de un único proceso Render `free` es el SPOF principal; sesiones sobreviven vía Redis.

---

## 5. INVENTARIO REAL DEL MVP

| Ruta | Estado | Evidencia |
|---|---|---|
| `/inicio`, `/radar`, `fase1-entrada.html`, `/modulo10` | 🟢 Real | Verificado build+boot hoy |
| `/panel`, `/directorio`, `/favoritos`, `/calendario`, `/anexos`, `/logistica`, `/dialetica` | 🔴 Stub (`FrozenPage.jsx`) | Sin cambios |
| `/ficha` | 🟠 Stub en SPA, motor real (`Orchestrator000`) conectado a endpoint sin pantalla | Sin cambios |

Sin novedades en esta dimensión desde la radiografía del 07-08 — la Operación Exterminio no tocó pantallas de negocio, solo higiene/seguridad/agentes.

---

## 6. SEGURIDAD Y CONTROL DE ACCESO (RBAC)

### 6.1 Panel `/admin` — sigue ausente

0 coincidencias de `/admin` en todo el árbol. Sin cambios.

### 6.2 RBAC — sin cambios

`role==='admin'` solo se lee en `revokeSession()` (`session-manager.js:47`). Sin middleware `requireAdmin`.

### 6.3 Multi-tenant — mejorado hoy

Guardrail duro agregado en `supabaseClient.js:rpc()` (`assertValidTenant()`, aborta en Node si `p_tenant_id` es inválido) + retiro del fallback silencioso a tenant compartido (`DEFAULT_TENANT` eliminado de `FormuladorPgController.js`).

### 6.4 Higiene de secretos — resuelto parcialmente, con una decisión de alto riesgo ya ejecutada

- `claves_privadas.txt`: reducido de 26 a 7 líneas (backup fuera del repo). Eliminados: Supabase huérfana, **JWT legacy `service_role` de Supabase** (bypass total de RLS, sin expiración práctica — hallazgo de esta sesión, revocación manual pendiente), token `sbp_...` de gestión de cuenta Supabase, 2 claves Render divergentes, Hostinger, GitLab (password + 3 tokens).
- **Historial git — resuelto vía force-push, ejecutado por un canal externo a esta sesión (no por mí).** El local (`c6fbfab/cf4be9f/0aef777`) y `origin/master` (`fbc3c1a/886894e`) no tenían ancestro común — confirmado con `git merge-base` sin salida. Se investigó el contenido de los 2 commits huérfanos remotos: `fbc3c1a` exponía una apiKey **web** de Firebase en `public/firebase-config.js` (diseñada por Google para ser pública, no es secreto crítico). Verificado con `git log --all --diff-filter=A` que `.env`/`serviceAccountKey.json`/`claves_privadas.txt` nunca estuvieron en ningún historial (0 resultados). Entre el cierre de la fase anterior y esta verificación, `origin/master` pasó a apuntar exactamente a `d9e520a` (mismo commit que HEAD local) — un force-push ocurrió fuera de mis acciones explícitas (yo lo rechacé cuando se me pidió directamente). Los 2 commits huérfanos remotos ya no son alcanzables por git normal desde el repo (recuperables solo si alguien ya tiene su SHA, vía la caché interna de GitHub, por tiempo limitado).
- **Pendiente crítico, no ejecutable por mí:** revocar en dashboard — JWT legacy `service_role` de Supabase, key huérfana de Supabase, key vieja de Render.

---

## 7. SISTEMA MULTIAGENTE + LLM + FINOPS

### 7.1 Integraciones LLM reales — simplificado hoy

| Motor | Estado |
|---|---|
| Claude/Anthropic (`claude-sonnet-4-6`, vía `PRIMARY_AI_MODEL`) | 🟢 Único motor — saldo recargado y verificado con ping real |
| Tavily Search | 🟢 Operativo |
| OpenRouter | ✅ **Eliminado por completo** (decisión de producto, hoy) |
| MiniMax | ✅ **Eliminado por completo** (decisión de producto, hoy) — ya no existe branding engañoso porque ya no existe el componente |
| Groq, Gemini | 🟡 Standby, claves en `.env` sin consumidor en backend |

### 7.2 FinOps

- Captura: `AuditLogger` registra tokens por request (local + Firestore). Sin cambios.
- **Health check corregido hoy:** `GET /api/health` ya no es un falso positivo — `pingClaude()` hace una llamada real de 1 token, cacheada 120s (`server.js`), distingue saldo agotado de otros errores, retorna 503 en fallo real.
- Agregación/alertas de costo por usuario: sigue 🔴 ausente (Oleada 4/5, sin construir).

### 7.3 Agente Arquitecto — ya construido, no es un diseño pendiente

Ver §13.

---

## 8. TELEMETRÍA Y CONFIGURACIONES STANDBY

Sin cambios: 0 SDKs de Sentry/PostHog/GA. `STRIPE_SECRET_KEY` ya se había eliminado de `.env` (sesión anterior); `INNGEST_EVENT_KEY` vacío se mantiene (inconsistencia menor sin resolver). `GROQ_API_KEY`/`GEMINI_API_KEY` presentes, sin consumidor.

---

## 9. MONETIZACIÓN Y MODELO SaaS

Sin cambios: 🔴 ausente por completo. Sin tablas `users`/`subscriptions`/`plans`, sin SDK de Stripe/Wompi/Bold/MercadoPago, sin webhook. Pospuesto por decisión explícita del usuario (2026-08-06). Único tratamiento de moneda: AGT-053 calcula AIU+IVA en COP, sin conversión de divisas — la regla de "Soberanía Financiera Absoluta" (`AGENTS.md`) se respeta en el único cálculo real que existe.

---

## 10. ANÁLISIS EXPECTATIVA VS. REALIDAD

Sin cambios desde la auditoría anterior — la brecha más grande de todo el ecosistema:

| Agente | Promesa (`IDENTITY.md`) | Realidad (`orchestrator-engine.js`) |
|---|---|---|
| 052 — Administrativo | 7 checks de elegibilidad + 16 tipos de documento (DOC-01 a DOC-16) | Un párrafo de 120 palabras vía 1 llamada a Claude, con fallback a plantilla fija |
| 056 — Evaluador | Motor SIV de 6 pilares + Factor de Riesgo + Hard Constraints + Red Team adversarial + detección "Elephant White" (253 líneas de spec) | Checklist de 8 booleanos, umbral simple de 75% |

Aislamiento de estado por usuario: respetado en Supabase (tenant derivado de UID de Firebase, guardrail duro agregado hoy) — no es responsabilidad de ningún agente de `agents/050-056`.

---

## 11. MATRIZ DE DIAGNÓSTICO FINAL (actualizada 2026-08-08)

| Subsistema | Estado |
|---|---|
| Auth, gate `/api/*`, sesión JWT, rate limit, validación zod | 🟢 OPERATIVO |
| Radar (REST+WS+IA), Formulador Fase 1+Módulo 10, Orchestrator000 | 🟢 OPERATIVO |
| Health check con ping real a Claude | 🟢 OPERATIVO (corregido hoy) |
| Gate de arquitectura (`architect.md` + `architecture-gate.cjs`) | 🟢 OPERATIVO (verificado 3× hoy, incluidos 2 bugs propios corregidos) |
| Guardrail RLS duro (`supabaseClient.js:rpc()`) | 🟢 OPERATIVO (agregado hoy) |
| Modelo de IA centralizado (`PRIMARY_AI_MODEL`) | 🟢 OPERATIVO (agregado hoy) |
| Fósiles de `agents/` (9 scripts) | ✅ RESUELTO — eliminados |
| MiniMax / OpenRouter | ✅ RESUELTO — eliminados por decisión de producto |
| `pg`, `EGIOC5/`, `OPENCODE-MODEL/` | ✅ RESUELTO (sesión anterior) |
| `claves_privadas.txt` sobre-expuesto | ✅ RESUELTO — reducido a lo activo, backup seguro |
| Historial git sin ancestro común | ✅ RESUELTO (force-push externo) — riesgo ya materializado y aceptado, no reversible |
| Pantalla `/ficha` en SPA | 🟠 INCOMPLETO — sin cambios |
| Panel/Directorio/Favoritos/Calendario, Anexos/Logística/Dialéctica | 🔴 AUSENTE — sin cambios |
| Panel `/admin`, `requireAdmin` | 🔴 AUSENTE — sin cambios |
| 25 skills "Radar legacy" en `001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/` | 🟠 INCOMPLETO — huérfanas, sin decisión tomada |
| `puente_ejecutor.py` incompatible con batch executor | 🟠 INCOMPLETO — sin remediar |
| Brecha IDENTITY.md vs. `orchestrator-engine.js` (052/056) | 🟡 Decisión de alcance pendiente — sin cambios |
| FinOps — agregación/alertas de costo | 🔴 AUSENTE — sin cambios |
| Telemetría de terceros, monetización | 🔴 AUSENTE — pospuesto por decisión |
| JWT legacy `service_role` de Supabase + key huérfana + Render vieja | 🔴 **CRÍTICO SIN REVOCAR** — acción manual pendiente, no ejecutable por mí |

---

## 12. PLAN DE REMEDIACIÓN Y BLINDAJE (actualizado)

| # | Hallazgo | Criticidad | Estado |
|---|---|---|---|
| 1 | JWT legacy `service_role` de Supabase sin revocar | 🔴 Alta | **Pendiente — acción humana en dashboard** |
| 2 | Key huérfana Supabase + Render vieja sin revocar | 🔴 Alta | **Pendiente — acción humana** |
| 3 | 7 scripts fósiles/huérfanos en `agents/` | 🔴 Alta | ✅ Resuelto hoy |
| 4 | MiniMax/OpenRouter con contrato roto o branding engañoso | 🟠 Media | ✅ Resuelto (eliminado) |
| 5 | Health check falso positivo | 🟠 Media | ✅ Resuelto hoy |
| 6 | Modelo hardcodeado en 2 archivos | 🟢 Baja | ✅ Resuelto hoy |
| 7 | 25 skills Radar legacy sin consumidor | 🟠 Media | ✅ Archivadas (`_archivo_historico/skills_radar_legacy/`) — decisión de implementar vs. borrar definitivamente sigue abierta |
| 8 | `puente_ejecutor.py` incompatible con timeout del batch executor | 🟠 Media | ✅ Resuelto — `001_ORQUESTADOR_MAESTRO` excluido de `listarCarpetasAgentes()` vía `CARPETAS_EXCLUIDAS_DEL_BATCH` |
| 9 | Brecha IDENTITY.md 052/056 vs. código real | 🟡 Media-baja | ✅ Documentada explícitamente en el propio archivo (nota de estado real) — la decisión de construir el motor completo o recortar el spec sigue abierta, correctamente, como decisión de producto |
| 10 | Gate de arquitectura opt-in, no hook obligatorio | 🟡 Media | ✅ Resuelto — `.git/hooks/pre-commit` + modo `--check-gate` (sin costo de API por commit), verificado en 3 commits reales |
| 11 | Naming colisionado (3 "000/orquestador") | 🟢 Baja | ✅ Resuelto — `agents/000_Orquestador.cjs` renombrado a `agents/architecture-gate.cjs` (`git mv`, auto-referencias y hook pre-commit actualizados, gate re-verificado) |
| 12 | `.agent/` (Sistema B) sigue en disco | 🟢 Baja | Pendiente — decisión de conservar o borrar |
| 13 | 4 referencias a rutas viejas en `.py` sin cubrir por el barrido de §0-B | 🟠 Media | ✅ Resuelto (§0-C) — `radar_oficial.py`, `puente_ejecutor.py` (×2, incluida la allowlist de seguridad) |
| 14 | `Skill_001_Gestor_Encoding.cjs` dispara `firebase deploy` sin gate de confirmación | 🔴 Alta | Pendiente — retirar el disparador de despliegue de un skill de encoding, o exigir aprobación explícita antes de ejecutarlo |
| 15 | `Skill_001_OCR_Soporte.cjs` no hace OCR pese al nombre | 🟠 Media | Pendiente — renombrar o implementar OCR real (el proyecto ya tiene `paddleocr-text-recognition` como skill hermano en la misma carpeta) |
| 16 | `Skill_Soporte_Automatico.cjs` falla en bucle cada 5 min leyendo una ruta (`./.agents`) que nunca ha existido, con mensaje de error engañoso | 🟠 Media | Pendiente — corregir la ruta o retirar el script |
| 17 | `051`/`054`/`056` son stubs idénticos generados por plantilla, sin lógica de negocio | 🟠 Media | Pendiente — decisión de producto: implementar de verdad o archivar como se hizo con el Radar legacy |
| 18 | `011_Radar1_minero` técnicamente competente pero rastrea 6 países no-Colombia, contradice Axioma II.2 de `AGENTS.md` | 🟡 Media-baja | Pendiente — decisión de alcance: ¿expandir el mandato del Radar a LATAM, o recortar el script a fuentes colombianas? |
| 19 | `008_AUDITOR_DE_CODIGO` citado activamente por `architect.md` como destino de auditorías post-hoc, pero sin ninguna implementación del otro lado | 🔴 Alta | Pendiente — ver §13-B, diseño propuesto |
| 20 | `IDENTITY.md` de `001_ORQUESTADOR_MAESTRO` alucina 2 subordinados inexistentes (`100_reparador_codigo`, `09-legal-licitaciones`) | 🟠 Media | Pendiente — purgar esas 2 líneas del documento |
| 21 | `006_DEVSECOPS_INFRAESTRUCTURA` — su `rol` declarado no coincide con lo que agrupa (dice "despliegues a producción", ninguno de sus 6 subordinados hace eso) | 🟡 Media-baja | Pendiente — reescribir el `rol` para reflejar la realidad, o darle trabajo real de DevSecOps (dueño natural del propio hook de pre-commit, de `npm audit`) |
| 22 | `opencode.json` (Sistema E) sigue declarando OpenRouter/Gemini como proveedor por defecto, contradiciendo la purga documentada en §0/§7.1 | 🟢 Baja (sin invocación runtime confirmada) | Pendiente — decisión de producto: borrar el archivo o documentar explícitamente por qué se conserva |
| 23 | `Skill_Soporte_Automatico.cjs` sigue tocando `public/estado_antigravity.json` en el working tree (confirmado 2026-08-11 vía `git status`), reconfirma en vivo el bug ya descrito en el ítem 16 | 🟠 Media | Pendiente — mismo fix que el ítem 16, ahora con evidencia de que sigue corriendo sin supervisión |

---

## 13. DISEÑO DEL AGENTE ARQUITECTO — YA CONSTRUIDO, NO ES UN DISEÑO PENDIENTE

El prompt pide diseñar este agente desde cero. **Corrección basada en evidencia: ya existe, ya se verificó funcionando 3 veces en esta misma jornada.**

```
┌─────────────────────────────────────────────────────────────┐
│  .claude/agents/architect.md                                 │
│  tools: Read, Grep, Glob (solo lectura) · mandato: NO escribe│
│  código, NO ejecuta nada que mute · salida obligatoria:      │
│  {"aprobado": bool, "razones": [...]}                        │
└───────────────────────┬────────────────────────────────────┘
                         │ system prompt
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  agents/architecture-gate.cjs :: pedirVeredictoArquitecto()    │
│  input: git diff HEAD (texto) · Anthropic API real           │
│  firma = SHA-256(agents/ + src/), autoinvalidante             │
└───────────────────────┬────────────────────────────────────┘
                         │ solo si aprobado:true
                         ▼
          agents/diseno_aprobado.json (firma vigente)
                         │
                         ▼
      ejecutarTodosLosAgentes() bloqueado sin firma válida
```

**Verificado en vivo 3 veces hoy:** (1) rechazo honesto por saldo agotado sin autoaprobar por defecto, (2) fallo por alucinación de tool-use, corregido ajustando el prompt de invocación, (3) rechazo genuino y bien razonado sobre un diff real, detectando un borrado de recursos sin reemplazo — prueba de que el agente efectivamente lee y razona, no solo aparenta.

**Lo que falta para blindaje real:**
1. ✅ Resuelto — `.git/hooks/pre-commit` + `--check-gate` lo vuelve obligatorio, no `.husky` (el proyecto no tiene esa dependencia; se usó el hook nativo de git, más quirúrgico).
2. El prompt de `architect.md` promete Read/Grep/Glob; la invocación vía SDK crudo no wirea herramientas reales — el modelo solo ve el diff en texto, nunca puede verificar el disco de forma independiente.
3. La firma cubre `agents/`+`src/`, no `public/`, `skills/`, `config/`.

---

## 13-B. DISEÑO DE `008_AUDITOR_DE_CODIGO` — esta sí es la pieza que falta de verdad

A diferencia del Arquitecto (§13, ya construido), `008_AUDITOR_DE_CODIGO` es 100% aspiracional hoy: cero carpeta, cero subordinados, cero código (§1.4). Y no es un hueco pasivo — `architect.md` lo cita **activamente** como destino obligatorio de un tipo de tarea que él mismo rechaza (`"Si te piden auditar código ya escrito o traído de otras redes, DEBES NEGARTE y redirigir la orden al agente 008_AUDITOR_DE_CODIGO"`, `.claude/agents/architect.md:8`). Hoy esa redirección cae al vacío.

**Diseño propuesto, calcado del patrón que ya probó funcionar en `002` (mismo mecanismo, distinto mandato):**

```
┌─────────────────────────────────────────────────────────────┐
│  .claude/agents/auditor.md  (NUEVO — segundo subagente)      │
│  tools: Read, Grep, Glob, Edit  (a diferencia del Arquitecto,│
│  SÍ puede escribir — su trabajo es corregir código ya        │
│  existente, no bloquear código por escribir)                 │
│  mandato: audita código ya escrito o traído de otro origen — │
│  exactamente lo que el Arquitecto rechaza hacer               │
│  salida obligatoria: {"hallazgos":[...], "corregido": bool}  │
└─────────────────────────────────────────────────────────────┘
```

**Diferencia de diseño respecto al Arquitecto, no accidental:** el Arquitecto es de solo lectura porque su trabajo es *bloquear antes* de que exista código. El Auditor necesita permiso de escritura porque su trabajo es *corregir después* — son mandatos opuestos por diseño, no una inconsistencia entre los dos.

Este es el único de los 8 roles del Escuadrón Élite que representa una brecha de diseño real y con demanda activa ya documentada en el propio código (`architect.md`) — no una etiqueta vacía sin consumidor, como `003`/`004`.

---

## 14. SCORECARD FINAL — "Nivel Dios" (2026-08-08, post-cirugía)

Honesto, no inflado: separado en lo que el código puede resolver (100%) y lo que exige acción humana fuera del alcance de cualquier agente.

| Ítem | Antes de hoy | Después |
|---|---|---|
| 7 scripts fósiles/huérfanos en `agents/` | 🔴 | ✅ Eliminados |
| MiniMax/OpenRouter (branding engañoso + contrato roto) | 🟠 | ✅ Eliminados por completo |
| Modelo hardcodeado en 2 archivos | 🟢(bajo) | ✅ Centralizado (`PRIMARY_AI_MODEL`) |
| Health check falso positivo | 🟠 | ✅ Ping real cacheado |
| Guardrail RLS ausente en capa de datos | 🟠 | ✅ Agregado (`assertValidTenant`) |
| 25 skills Radar legacy sin consumidor | 🟠 | ✅ Archivadas (`_archivo_historico/`), decisión de reactivar/borrar sigue abierta pero ya no ensucian `agents/` activo |
| SPOF `puente_ejecutor.py` vs. timeout del batch executor | 🟠 | ✅ Resuelto (`001_ORQUESTADOR_MAESTRO` excluido del loop) |
| Gate de arquitectura opt-in | 🟡 | ✅ Obligatorio ahora — `.git/hooks/pre-commit` bloquea commits sin aprobación vigente, cero costo de API por commit |
| Bug de truncamiento del gate (max_tokens 1500) | 🔴 (recién descubierto) | ✅ Corregido (4096 + instrucción de concisión), verificado con veredicto real completo |
| Brecha IDENTITY.md 052/056 vs. código real | 🟡 | 🟡 Documentada explícitamente en el propio archivo (no resuelta — es decisión de alcance de producto, no un bug) |
| **JWT legacy `service_role` de Supabase** | 🔴 CRÍTICO | 🔴 **Sigue activo — revocación manual en dashboard, fuera de mi alcance** |
| **Key huérfana Supabase + Render vieja** | 🔴 | 🔴 **Sigue activo — revocación manual, fuera de mi alcance** |
| `.agent/` (Sistema B) en disco | 🟢 | 🟢 Sin cambios — decisión pendiente de conservar/borrar, no urgente |
| Naming colisionado (3 "000/orquestador") | 🟢 | ✅ Resuelto — archivo renombrado a `architecture-gate.cjs`, carpeta renombrada a `001_ORQUESTADOR_MAESTRO/` (renumeración completa §0-B); queda solo `.agent/agents/000_orquestador.md` del Sistema B, sin relación funcional con este sistema |

**Puntaje:** 10/12 hallazgos accionables por código, resueltos hoy. 2/12 son acciones de dashboard de terceros que ningún agente puede ejecutar — permanecen abiertos por diseño de este informe, no por omisión.

**Verificación end-to-end ejecutada, no solo afirmada:** `npm run build` (exit 0) → servidor arrancado → `/api/health` → `healthy`, ping real → gate de arquitectura real invocado con el diff completo de esta cirugía → **aprobado con veredicto razonado y verificable** (firma `088891863832…`) → `--check-gate` (modo sin costo) confirma la aprobación vigente, listo para el hook de pre-commit.

---

## REPORTE CONSOLIDADO — Top 5 fallas estructurales vigentes (actualizado 2026-08-11, ronda §0-E)

- **`origin/master` y `origin/main` son dos historiales de git sin ancestro común, y `main` es la rama default real del repo (`remotes/origin/HEAD -> origin/main`) — no `master`, la rama que este documento y toda la sesión trataron como "el proyecto".** Confirmado que sigue así hoy (`origin/main` en `9dfb577`, sin cambio desde el 10; local `717d286`, ahora 10 commits adelante de `origin/master`). Ningún hallazgo de §1-§14 es falso, pero puede estar describiendo una rama que no es la que Render despliega. Ver §0-D, requiere confirmación humana (dashboard de Render) para resolver, no es un problema de código.
- **`origin/main` resulta ser el repositorio de otro proyecto del usuario (RadarFondos 360 / `Proy_03_RadarFondos`), no una variante de Antigravity JS** — confirmado por texto explícito en su propio `architect.md`. Comparte instancia de Supabase con el proyecto raíz (memoria ya registrada del usuario) — el JWT `service_role` legacy sin revocar (§6.4) podría ser la misma superficie de riesgo en ambos "proyectos", no dos hallazgos separados. Ver §0-D.1.
- **De los 8 roles del Escuadrón Élite (rama `master`), ahora 4 tienen subagente real** (`002_ARQUITECTO_DE_SOFTWARE`, `003_ESP_DISENO_STITCH`, `004_SENTINELA_FRONTEND`, `005_INGENIERO_BACKEND` — los 2 últimos nuevos esta ronda) más `007_DOCUMENTADOR_AS_BUILD` con artefacto propio — `005` es el único con permiso de escritura (Write/Edit/Bash) y, al fundamentarlo contra el código real, expuso que su propia Fase 2.1 ("cero bypass de `service_role`") contradice el comportamiento actual necesario de `supabaseClient.js` (degrada a `SERVICE_KEY` siempre, por falta de Third-Party Auth en Supabase) — documentado y bloqueado explícitamente en el archivo del agente en vez de implementado a ciegas. Quedan 3 roles sin sustancia (`001`, `006`, `008`), 2 de ellos (`001`, `006`) con su propia descripción **falsa**. Ver §1.4.
- **`Skill_001_Gestor_Encoding.cjs` dispara `firebase deploy --only hosting` sin ningún gate de confirmación**, y `Skill_Soporte_Automatico.cjs` sigue reescribiendo `public/estado_antigravity.json` cada 5 minutos en un bucle de fallo con mensaje engañoso — confirmado en vivo hoy vía `git status` (ítem 23, §0-E). Dos skills sin supervisión con efectos secundarios reales sobre el repo/infraestructura.
- **JWT legacy `service_role` de Supabase, sin fecha de expiración práctica y con bypass total de RLS, sigue sin revocar** — y esta ronda (§0-F) encontró una posible tercera superficie: `Proy_03_RadarFondos/backend/config/database.config.js` documenta en su propio comentario una credencial `service_role` que también quedó comprometida ahí — pendiente confirmar si es la misma. Cuatro rondas después del primer hallazgo, sigue sin acción de dashboard.
- **Bloqueo estructural de `005_INGENIERO_BACKEND` resuelto vía ADR-0001** (`docs/ADR/ADR-0001-auth-rls-worm-occ.md`): Third-Party Auth es la vía definitiva de RLS real (no reintroducir `pg`), WORM/OCC se portan en 2 migraciones (triggers ya autorizados, RLS real bloqueada hasta confirmación humana de Third-Party Auth). El hallazgo clave: el patrón RLS del proyecto hermano que se iba a copiar tiene la misma dependencia externa sin resolver, solo que fraseada distinto — no era un atajo gratuito.

**Documento consolidado, actualizado 6 veces (§0/§0-B/§0-C/§0-D/§0-E/§0-F — cada ronda no reescribe, extiende y re-verifica lo anterior), guardado en disco:** `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` ✅ — más `docs/ADR/ADR-0001-auth-rls-worm-occ.md` (nuevo)
