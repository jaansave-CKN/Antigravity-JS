# Auditoría Forense 360° — Ecosistema Multiagente Antigravity JS + RadarFondos 360

**Fecha:** 2026-08-08
**Alcance:** `c:\2026 AI EGIOC5\Antigravity JS\proyectos\Proy_03_RadarFondos` (repo completo, HEAD `2e5481a`)
**Metodología:** lectura directa de código fuente, `grep`/`git` ejecutados contra el repo real, verificación cruzada de cada hallazgo crítico contra el archivo citado. Cero suposiciones: donde no hay evidencia en disco, se declara AUSENTE explícitamente. Toda ruta citada es relativa a la raíz del repo salvo que se indique lo contrario.

**Nota de precedencia documental:** existe un documento previo, `docs/ARQUITECTURA_RADFOR360_2026-08-08.md` (mismo día), que ya adelantó parte de las conclusiones sobre ausencia de un ecosistema multiagente real. Este documento es una auditoría independiente, más amplia en alcance (incluye `SIA_Radar/`, `ai_service/`, `.kilo/`, FinOps, telemetría y monetización con detalle no cubierto allí), y confirma —no hereda sin verificar— los puntos donde coincide.

---

## 1. Inventario total y organigrama jerárquico

### 1.1 Árbol jerárquico real (no el declarado por la documentación)

```
RadarFondos 360 (raíz)
│
├── GOBERNANZA DE AGENTES DE EDICIÓN (gobiernan CÓMO se escribe código, no lógica de producto)
│   ├── CLAUDE.md (raíz)              → directivas Claude Code: protocolo de auditoría verificada
│   ├── .claude/settings.json         → permisos Bash acotados + enableAllProjectMcpServers
│   ├── .claude/settings.local.json   → permisos puntuales + MCP "stitch" habilitado
│   ├── .claude/agents/                → NO EXISTE en este repo
│   ├── AGENTS.md (raíz)              → DESACTUALIZADO (contradice backend/db.js, ver §10)
│   ├── .clinerules                   → gobierna Cline/OpenCode/Jules; declara Kilo Code retirado 2026-08-05
│   ├── .agents/skills/obsidian-context.md → spec de comportamiento, NO es skill invocable
│   └── .kilo/                        → estado local de extensión Kilo Code (retirada), NO versionado
│       └── worktrees/                → 2 checkouts congelados con código YA ELIMINADO de main
│
├── ORQUESTACIÓN DE PROCESOS (infraestructura, NO agentes de IA)
│   ├── orchestrator.js (v1.0)        → arranca backend+frontend, proxy CORS/WS puerto 8080
│   └── 000-orquestador.js (v2.0)     → superset: + túnel Cloudflare, health-check HTTP real
│
├── AGENTES DE PRODUCTO ACTIVOS (invocados en producción, sin supervisor común)
│   ├── backend/agents/normativoAgent.js       → determinístico, invocado desde marcoNormativo.routes.js
│   ├── backend/agents/arbolObjetivosAgent.js  → Gemini + circuit breaker + mock fallback, invocado desde server.js
│   └── backend/services/*.js (7 servicios con LLM real, ver §7)
│
├── SISTEMAS MULTIAGENTE HUÉRFANOS (código presente, sin caller vivo)
│   ├── ai_service/ (Python, FastAPI+LangGraph, 9 nodos)  → wiring en docker-compose.yml, CERO callers en server.js/backend/
│   ├── SIA_Radar/ (Python, 4 agentes 01-04)              → NI SIQUIERA versionado en git, DB propia, lógica placeholder
│   ├── agents/scraper_core.py                             → huérfano, escribe a backend/radar.db (inexistente)
│   └── backend/core/ (Python FastAPI+WebSocket)           → huérfano, arquitectura paralela abandonada
│
└── ag_skills_registry.json                                → AUSENTE (confirmado, 0 ocurrencias en el repo)
```

### 1.2 Clasificación Global vs. Específico de proyecto

| Sistema | Alcance | Global (Antigravity) o específico |
|---|---|---|
| `.claude/settings.json`, `.claude/settings.local.json` | Permisos Bash + MCP `stitch` | Específico de este repo |
| `CLAUDE.md` (raíz) | Directivas de auditoría y despliegue | Específico de este repo (existe también `C:\Users\Usuario\.claude\CLAUDE.md` global, no auditado aquí por estar fuera del repo) |
| `.clinerules` | Fidelidad CSS + cierre de sesión | Específico, pero declara aplicar a "cualquier agente Antigravity" |
| `.agents/skills/obsidian-context.md` | Sincronización de bóveda Obsidian local | Específico de este repo |
| `.kilo/` | Estado de sesiones/worktrees de Kilo Code | Herramienta de terceros, estado 100% local, no versionado |
| `orchestrator.js` / `000-orquestador.js` | Arranque de servicios locales | Específico de este repo |
| `ai_service/`, `SIA_Radar/`, `backend/agents/*`, `backend/core/` | Lógica de producto/IA | Específico de este repo |

### 1.3 Hallazgos de jerarquía

- **No existe un orquestador central de agentes de IA.** La palabra "orquestador" en este repo se usa exclusivamente para gestión de procesos (`orchestrator.js`, `000-orquestador.js` = análogo a PM2 + reverse proxy + túnel), nunca para coordinación de prompts/modelos/agentes.
- **Agentes ejecutores sin validación previa**: `backend/agents/arbolObjetivosAgent.js` y los servicios de `backend/services/` con Gemini (§7) se invocan directamente desde `server.js`/rutas HTTP, sin pasar por ninguna capa de aprobación o revisión adversarial antes de persistir su salida.
- **Ruptura de jerarquía confirmada por evidencia cruzada**: `.kilo/worktrees/quixotic-outrigger/` (creado 2026-05-24) contiene `agents/005_Radar{1,2,3,4}_*` y `backend/workers/scheduler.py` — archivos que el commit `2e5481a` ("chore(radar): erradicación de isla zombie") **eliminó de `main`** el 2026-08-06. El worktree stale de una herramienta ya retirada conserva localmente el código "zombie" que el propio repo documenta haber erradicado.
- **`.claude/agents/architect.md`** existe en la raíz del directorio padre `Antigravity JS/` (no en este repo) según un documento de auditoría previo (`docs/ARQUITECTURA_RADFOR360_2026-08-08.md`) — no gobierna este proyecto específicamente, es scope de la carpeta padre.

---

## 2. Auditoría forense de skills

**Hallazgo principal: no existe un sistema de skills real en este repo.**

| Elemento buscado | Estado | Evidencia |
|---|---|---|
| `.claude/skills/*/SKILL.md` (formato nativo Claude Code) | **AUSENTE** | `Glob ".claude/skills/**/*"` → 0 resultados |
| `.agents/skills/obsidian-context.md` | Existe, pero NO es una skill invocable | El propio archivo (línea 5) admite: *"si el runtime que lo ejecuta es Claude Code, la forma nativa de hacerlo invocable... es además crear `.claude/skills/obsidian-context/SKILL.md`... este archivo no sustituye eso"* |
| `ag_skills_registry.json` | **AUSENTE** | `grep -r "ag_skills_registry"` → única coincidencia es una mención en `docs/ARQUITECTURA_RADFOR360_2026-08-08.md` confirmando su ausencia |

**Función/lógica/I-O de la única "skill" candidata (`obsidian-context.md`):**
- Función: mantener sincronizada una bóveda Obsidian (`_contexto_obsidian/{00_INDEX,hseq_normativa,pendientes,registros_arquitectura,requisitos}.md`) con el estado del proyecto.
- Input: invocación manual del usuario ("actualiza el contexto de Obsidian").
- Output: escritura en `_contexto_obsidian/`.
- Manejo de errores: ninguno definido (es un documento de prosa, no código ejecutable).
- Restricción explícita: prohíbe modificar código (líneas 47-52 del archivo).
- Disparo: **sin automatización** (sin hooks, sin CI) — depende 100% de invocación manual.

**Injertos/duplicaciones/incompatibilidades detectadas:** no aplica en sentido estricto porque no hay un sistema de skills múltiples que pueda duplicarse o chocar entre sí — el hallazgo en sí es la ausencia del sistema que el prompt de auditoría presupone que existe.

---

## 3. Mapa de integraciones y flujos

### 3.1 Comunicación entre agentes

**No existe comunicación agente-a-agente.** Cada "agente" de producto es una función JS pura invocada directamente por un route handler HTTP:

```
Cliente HTTP → server.js / backend/routes/*.js → backend/agents/*.js o backend/services/*.js → Gemini API / PostgreSQL
```

No hay cola de mensajes, bus de eventos, ni protocolo agente-a-agente. El único caso con topología de grafo real es `ai_service/graph.py` (LangGraph, 9 nodos, fan-out/fan-in con bucle condicional anti-alucinación) — pero ese grafo es interno a un único proceso Python, y ese proceso no tiene ningún caller desde el backend Node vigente (ver §3.3).

### 3.2 Conexión con backend

- **PostgreSQL (Supabase)**: motor de 3 capas en `backend/config/database.config.js` — Capa 1 `pg.Pool` → Capa 2 REST Supabase (con `SUPABASE_SERVICE_KEY`, bypass RLS) → Capa 3 degradación controlada (503).
- **Gemini**: SDK dual (`@google/generative-ai` y `@google/genai`, según el servicio), invocado directamente desde `backend/agents/`, `backend/services/`, con `geminiCircuitBreaker.js` como único gate compartido.
- **`ai_service/` (LangGraph)**: `docker-compose.yml:85` define `AI_SERVICE_URL` para el contenedor `backend`, pero **`grep -rn "AI_SERVICE_URL|8100|formulate" server.js backend/` → 0 coincidencias**. El wiring de infraestructura existe; el código Node que lo consumiría (`backend/jobs/formularProyectoInversion.js`) **no existe en el repo** — solo es referenciado por comentarios muertos en `backend/scripts/securityValidation.js:285` y `backend/migrations/013_domain_entities_materialization.sql:176`.

### 3.3 Cuellos de botella y SPOF

Ver detalle completo en §4.4. Resumen:
1. Proceso Express único (`ecosystem.config.cjs`: `exec_mode: 'fork', instances: 1`) con múltiples estados mutables en memoria de módulo: `revokedSet` (blacklist JWT), `radarCache` (caché de convocatorias), `_slowStore` (anti-DDoS), `geminiCB` (circuit breaker de cuota), y contadores de `express-rate-limit` en `MemoryStore`. Un restart pierde todos estos estados simultáneamente; una segunda instancia pm2 los desincronizaría.
2. `CronScheduler.js` corre `node-cron` dentro del mismo proceso Express — no hay worker separado.
3. RLS de PostgreSQL efectivamente inerte en el flujo normal: el backend se conecta con `service_role` (bypass RLS por diseño), así que el aislamiento multi-tenant real depende de que cada query incluya manualmente `WHERE org_id = ?`.

### 3.4 Fugas de contexto / flujos sin control arquitectónico

- `ai_service/` implementa el único paso de validación adversarial (`red_team_evaluation`) de todo el repo, pero está desconectado — los agentes que sí están en producción (`arbolObjetivosAgent.js`, servicios Gemini) no pasan por ningún red-team, solo mitigaciones locales (circuit breaker, mock fallback, sanitización de input).
- `CredentialsPage.tsx` (frontend) ofrece BYOK para 3 proveedores (Google/Gemini, Groq, OpenAI) pero `POST /api/credentials` (`server.js:2075-2090`) ignora el campo `service` y guarda todo en una única columna que solo se lee como clave de Gemini (`resolveGoogleApiKey`, `server.js:214-226`) — una clave de OpenAI/Groq pegada por el usuario nunca llega a su proveedor real.

---

## 4. Topografía de arquitectura del sistema

### 4.1 Stack real (verificado en `package.json`, código)

| Capa | Tecnología real | Evidencia |
|---|---|---|
| Frontend | React 19.2 + TypeScript + Vite 8, React Router v7, Tailwind | `package.json:61-64`, `client/src/main.tsx` |
| Backend | Node.js ≥20 + Express 5.2 (monolito, `server.js` de 4841 líneas) | `package.json:5-6,41` |
| Base de datos | **PostgreSQL exclusivo** (Supabase), pgvector, RLS con políticas reales | `backend/db.js:1-10`, `backend/migrations/001,005,010,026` |
| IA principal | Google Gemini (`gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-embedding-001`) vía `@google/generative-ai` y `@google/genai` | `backend/agents/arbolObjetivosAgent.js`, `backend/services/*.js` |
| IA secundaria (huérfana) | LangGraph + Gemini (`ai_service/`) | `ai_service/graph.py`, `ai_service/nodes.py` |
| IA terciaria (huérfana, no versionada) | OpenRouter + MiniMax (`SIA_Radar/`) | `SIA_Radar/agentes/01_minero/engine.py:10-33` |
| Pagos | Stripe + Wompi (abstracción Strategy) | `backend/payments/*.js` |
| Observabilidad | Sentry + PostHog (ambos en standby) | `client/src/lib/sentry.ts`, `posthog.ts`; `backend/config/sentry.config.js` |

### 4.2 Patrón arquitectónico

**Monolito modular parcial, mayormente plano (routes→DB directo).** No es Hexagonal, no es DDD, no es Serverless.

- No existe `Express.Router()` en `backend/routes/` (0 coincidencias de `router.get/post`); en su lugar, patrón de inyección de dependencias manual: `register*Routes(app, deps)` invocado desde `server.js:4723-4765`.
- El grueso de la lógica de negocio (auth completo, radar/scraping, admin, proxies de IA) vive **inline dentro de `server.js`** (líneas 970-4766), no en módulos separados.
- No hay carpetas `domain/`, `application/`, `infrastructure/`, `use-cases/`.
- Ejemplo de acoplamiento fuerte: `backend/routes/proyectos.routes.js:80-92` construye el `INSERT` SQL crudo directamente dentro del handler HTTP — el controlador ES la capa de acceso a datos.
- Excepción positiva: `backend/payments/` sí implementa una abstracción real vía interfaz (`PaymentProvider.js` + Strategy pattern), documentada explícitamente en sus comentarios de cabecera.

### 4.3 Nivel de acoplamiento por capas

| Capas | Separación real |
|---|---|
| Dominio ↔ Infraestructura | Débil — helpers de acceso a datos (`getRow`, `runSql`) se importan y usan directamente en handlers HTTP, sin repositorio intermedio |
| Aplicación ↔ Presentación | Inexistente como capas formales — Express *es* la capa de aplicación |
| Pagos | Fuerte — único subsistema con contrato/interfaz explícito |
| Agentes IA | Nula — cada agente es un módulo aislado sin contrato común entre sí |

### 4.4 Manejo de estado y SPOF

Estado 100% en memoria de proceso (sin `global.`, pero con variables module-level mutables):

| Estado | Ubicación | Efecto de un restart / 2ª instancia |
|---|---|---|
| Pool/estado de conexión PG | `database.config.js:16-19` (`_pgReady`, `_pgPool`, `_lastRetry`) | Se re-sondea desde cero |
| Blacklist de tokens revocados | `tokenBlacklist.js:30` (`revokedSet`, `Set` en memoria) | Tokens revocados podrían aceptarse temporalmente en un proceso no sincronizado |
| Caché de convocatorias | `radarCache.js:25` (`Map`, TTL 15 min, tope 500) | Se pierde, siguiente request repuebla |
| Anti-DDoS slowdown | `SecurityMiddleware.js:163` (`_slowStore`, `Map`) | Contador se resetea |
| Circuit breaker Gemini | `geminiCircuitBreaker.js:120` (`geminiCB`, singleton) | Cuota consumida se resetea a 0 (falso positivo de disponibilidad) tras cada restart |
| Rate limiting HTTP | `express-rate-limit` sin `store:` → `MemoryStore` | `PostgresRateLimitStore.js` existe pero **no está activado** (confirmado por su propio comentario y por `027_rate_limit_counters.sql`) |
| Despliegue | `ecosystem.config.cjs:14-15` (`exec_mode: 'fork', instances: 1`) | Confirma 1 sola instancia — coherente con (y dependiente de) todo lo anterior |

**SPOF de seguridad (no de disponibilidad)**: migración `026_rls_policies_tenant_isolation.sql` documenta que RLS es "irrelevante en la práctica" porque el backend se conecta siempre con `service_role`. El aislamiento multi-tenant real depende de un `WHERE org_id = ?` correcto en cada query de aplicación — un solo `WHERE` olvidado en cualquier ruta nueva filtraría datos entre tenants sin que la base de datos lo impida.

---

## 5. Inventario real del MVP (Real vs. Mock vs. Stub)

Verificado contra `client/src/main.tsx` (router) y cada `fetch`/`http.*` cruzado contra `server.js`/`backend/routes/*`.

| Módulo | Ruta | Estado | Evidencia |
|---|---|---|---|
| Auth (login/registro/reset/validar) | `/login`, `/register`, `/reset-password`, `/validar` | 🟢 REAL | `AuthContextNew.tsx:214,337,275,419` → endpoints confirmados en `server.js` |
| Radar (grid de convocatorias) | `/radar` | 🟢 REAL | `LayoutPadre.tsx:834,874,946,964` |
| Directorio (+ export PDF cliente) | `/directorio` | 🟢 REAL | `DirectoryPage.tsx`, `GET /api/entidades` |
| Favoritos | `/favoritos` | 🟢 REAL | `FavoritosContext.tsx:33,64,78` |
| Calendario | `/calendario` | 🟠 STUB | `CalendarioPage.tsx:17-23` — array `EVENTOS` hardcodeado (marzo 2024), cero `fetch` |
| Panel de Control (keywords/telemetría) | `/panel` | 🟡 MIXTO | Keywords y quota-status REALES; "Gestión de Favoritos" y "Búnker de Conexiones" solo en `localStorage` |
| Formulador — Entrada | `/entrada` | 🟢 REAL | `EntradaPage.tsx:297` |
| Formulador — Contexto | `/contexto` | 🟡 MIXTO | Persistencia REAL; auditor de coherencia (`Radford360_Agent.ts`) es heurística regex local, no IA |
| Formulador — Motor Dialéctico | `/dialectica` | 🟢 REAL | `DialecticaPage.tsx:207,253` + `motorDialectico.routes.js` |
| Formulador — Logística | `/logistica` | 🟢 REAL | `LogisticaPage.tsx:126,167` |
| Formulador — Anexos | `/anexos` | 🟢 REAL | `AnexosCalcoView.tsx:55,87` |
| Formulador — Árbol de Objetivos | `/arbol-objetivos` | 🟢 REAL (con IA real) | `ArbolObjetivosPage.tsx:76` → `arbolObjetivosAgent.js` (Gemini) |
| Formulador — Exportación | `/exportacion` | 🟢 REAL (solo PDF, sin Excel) | `ExportacionPage.tsx:33` → `GET /api/modulo9/reporte/:id` |
| Formulador — Presupuesto (APU) | `/presupuesto` | 🟡 MIXTO | Persistencia real; materiales/equipos se envían en 0 (editor no construido, documentado en el propio código) |
| Formulador — Compliance | `/compliance` | 🟢 REAL | `Modulo10Page.tsx:139,166,198` |
| Formulador — Viabilidad | `/viabilidad` | 🟡 MIXTO (clave) | Score/rúbrica principal 100% local sin IA (`NN_Viability_Agent.ts`, pesos "no calibrados"); botón "Dictamen IA" sí es real (`/api/proyectos/:id/viabilidad-ia`, Gemini) |
| Formulador — Ficha Técnica | `/ficha` | 🟢 REAL | `FichaTecnicaPage.tsx:181,203` — sello SHA-256 server-side |
| Formulador — Checklist | `/checklist` | 🟠 STUB | Solo agrega banderas de `localStorage`, cero llamadas de red |
| Copiloto IA (panel derecho) | embebido en Formulador | 🟢 REAL | `CoPilotoSidebarChat.tsx:25,49` + `CopilotoService.js` (Gemini) |
| Import CSV/XLSX | `/importar` (solo admin) | 🟢 REAL | `ImportPage.tsx:76` → `FileImporter.js` server-side |
| Credenciales/APIs (BYOK) | `/apis` | 🟡 MIXTO (bug funcional) | Solo Gemini funciona realmente; UI ofrece OpenAI/Groq que el backend no diferencia (§7.7) |
| Admin — Usuarios pendientes | `/admin/usuarios-pendientes` | 🟢 REAL (pero sin `AdminGuard` en frontend, ver §6) | `AdminUsuariosPendientesPage.tsx:22,38` |
| Admin — Permisos | `/admin/permisos` | 🟢 REAL (mismo gap de frontend) | `AdminPermisosPage.tsx` |
| Admin — FinOps & Consumo IA | `/admin` (tab) | 🟢 REAL | `FinOpsTab():179` → `GET /api/admin/finops` |
| Admin — Telemetría | `/admin` (tab) | 🟡 REAL con integración externa apagada | PostHog condicionado a `VITE_POSTHOG_KEY` (ausente → aviso, no iframe) |
| Admin — Pasarela Wompi | `/admin` (tab) | 🟠 Parcial, declarado honestamente en la UI | El propio texto del panel dice que `wompiProvider.js` tiene 3 métodos pendientes de completar contra la doc real de Wompi |
| Buscar / "Radar 24/7" (`BusquedaEnTiempoReal.tsx`) | ninguna ruta | 🔴 STUB huérfano | Solo `window.open(google.com/search)`, no importado por ninguna página |
| AIChat (`/api/ia/chat`) | ninguna ruta | 🟠 Real pero inalcanzable | Backend real, componente no importado por ninguna página |
| RadarGridRealTime (`Dashboard.tsx`) | `/dev/dashboard` (excluida de build prod) | 🔴 MOCK y roto | WebSocket a `/ws/live_radar` sin servidor WS en backend; `MOCK_DATA` hardcodeado sobreescribe cualquier dato real |
| `IntelligenceInbox`, `RadarGlobalStats`, `RadarVisual`, `AlertsView`, `RiesgosView`, `ConsorciosView`, `HistoricoView`, `SignalPanel`, `StatsGrid`, `SystemHealth`, `SystemMonitor`, `FileUploader` | ninguna | 🔴 Código muerto | No importados por ningún otro archivo (verificado por grep individual) |
| `pages/AdminRecoveryPanel.tsx`, `pages/HomePage.tsx`, `pages/ModuloProximamente.tsx` | ninguna | 🔴 Código muerto | No ruteadas, no importadas |

**Cierres del MVP (basado en lo anterior):** Auth, Radar, Directorio, Favoritos, y 8 de 12 submódulos del Formulador (Entrada, Dialéctica, Logística, Anexos, Árbol de Objetivos, Exportación PDF, Compliance, Ficha Técnica, Copiloto) están genuinamente cerrados y conectados a backend real. **Incompletos/mock:** Calendario, Checklist, componente de radar en tiempo real, BYOK multi-proveedor, exportación a Excel (inexistente), sección de materiales del Presupuesto.

---

## 6. Seguridad y control de acceso (RBAC)

### 6.1 Autenticación

`backend/middlewares/auth.middleware.js` (72 líneas): JWT HS256 propio contra `JWT_SECRET`. **No existe el fallback a Supabase Auth que documenta `.env.example:22-33`** — el propio archivo lo admite en su cabecera (líneas 1-9): la función `validateSupabaseToken` nunca tuvo invocaciones reales.

### 6.2 RBAC — sin middleware centralizado

**No existe `roles.middleware.js` ni equivalente.** El patrón repetido 13+ veces en `server.js` es:
```js
if (req.userRole !== 'admin') return res.status(403).json({...});
```
inline dentro de cada handler, sin guardia a nivel de router. Esto explica directamente el hallazgo de §6.3.

### 6.3 Endpoints sin protección de rol — hallazgo de severidad alta, verificado en código real

| Endpoint | Auth | Rol/plan | Línea (`server.js` salvo indicado) |
|---|---|---|---|
| `GET /api/scrape/minciencias` | **Ninguna** (ni siquiera `authenticateToken`) | — | `backend/routes/scraper.routes.js:85` (verificado directamente) |
| `POST /api/entidades` (crea entidad global) | Solo sesión | Ninguno | 2271 |
| `DELETE /api/entidades/:id` (borra/bloquea entidad global) | Solo sesión | Ninguno | 3058 (verificado directamente) |
| `PATCH /api/entidades/:id`, `/status` | Solo sesión | Ninguno | 3186, 3206 |
| `POST /api/entidades/:id/rastrear` (scraping manual) | Solo sesión | Ninguno | 3122 (verificado directamente) |
| `POST /api/entidades/scrape-async` | Solo sesión | Ninguno | 3777 |
| `GET /api/cola-validacion`, `POST .../aprobar`, `.../descartar` (moderación global) | Solo sesión | Ninguno | 3810, 3826, 3834 |
| `POST /api/scheduler/now` (dispara ingesta global) | Solo sesión | Ninguno | 3361 (verificado directamente) |
| `POST /api/radar/start` / `/stop` (arranca/detiene cron de todo el sistema) | Solo sesión | Ninguno | 3395, 3412 (verificado directamente) |

**Impacto real**: cualquier usuario autenticado (incluso plan gratuito, sin rol admin) puede crear/editar/bloquear entidades del Directorio compartido por todos los tenants, disparar scraping manual, arrancar/detener el scheduler global, y aprobar/rechazar entidades en la cola de moderación. Esto contrasta con los endpoints de dinero/usuarios (purgar cuenta, cambiar plan, exportar datos, permisos), que **sí** están correctamente protegidos con `authenticateToken` + chequeo de rol.

### 6.4 Frontend — gap de defensa en profundidad

`client/src/main.tsx:330-332`: solo `/admin` está envuelto en `<AdminGuard>`. **`/admin/usuarios-pendientes` y `/admin/permisos` solo tienen `<AuthGuard>`** (autenticación, no rol) — un usuario no-admin puede navegar y renderizar el shell de esas páginas. No hay fuga de datos porque el backend sí exige rol admin en esos endpoints (`server.js:1571,1580,1609,1620,1640`), pero es una inconsistencia frente al patrón sí aplicado en `/admin`.

### 6.5 Bypasses de desarrollo (todos gateados por `NODE_ENV`)

1. `demo-mode-token` — `auth.middleware.js:41-50`: si `NODE_ENV !== 'production'`, asigna `req.userRole = 'admin'` sin verificar JWT.
2. `POST /api/dev/make-admin` — `server.js:1712-1721`, gateado por `NODE_ENV`.
3. `X-Smoke-Token` reutiliza `JWT_SECRET` como credencial de bearer — `server.js:1236-1238`, comparación no constant-time (`!==`), impacto bajo (solo marca una bandera `production_ready`).

### 6.6 Cabeceras y CORS

- `helmet()` con CSP explícita **solo en producción** (`server.js:1125-1141`); `crossOriginEmbedderPolicy: false` explícito. HSTS/`X-Frame-Options`/`Referrer-Policy` quedan en defaults de la librería (no hay endurecimiento deliberado adicional).
- CORS con **allowlist real** (`FRONTEND_URL` + 2 localhost fijos), no `origin: '*'` — correctamente implementado (`server.js:1143-1159`).

### 6.7 Multi-tenancy / RLS

- `withTenant()` (`database.config.js:385-414`) sí activa RLS real vía `set_config('app.org_id', ...)` cuando el pool `pg` está disponible (Capa 1).
- En Capa 2 (fallback REST con `SUPABASE_SERVICE_KEY`, que bypasea RLS), `injectTenantFilter` **solo protege sentencias `SELECT`** — `INSERT/UPDATE/DELETE` dependen enteramente de que el desarrollador haya escrito el `WHERE org_id = ?` a mano.
- **Contradicción documentación↔código confirmada**: `.env.example:38-41` afirma que `SUPABASE_SERVICE_KEY` "está PROHIBIDO en Fase 3... el código no la usa más". Falso: se usa activamente en `database.config.js:29`, `supabase.config.js:23,39-40`, `server.js:807`, `anexos.routes.js:75`, `production.config.js:20,45,69`.
- Migraciones RLS reales y verificadas: `001,005,010,012,026,031_*.sql` — con políticas concretas, no solo `ENABLE ROW LEVEL SECURITY` vacío.

### 6.8 Rate limiting y secretos

- `authLimiter` (5/15min, anti-fuerza-bruta) aplicado a login/registro/MFA/reset — correcto.
- `aiLimiter` (20/hora) plano, igual para todos los planes de pago (ver §7).
- **Sin secretos reales hardcodeados** en código fuente (búsqueda de patrones `sk_live|AIzaSy|xox[baprs]-` → solo 3 coincidencias, todas placeholders/docstrings). `.env` no está trackeado en git.
- `.mcp.json` (raíz) contiene un token real de Supabase (`sbp_...`) en texto plano, pero está correctamente listado en `.gitignore` (líneas 10 y 71) — **no es un secreto commiteado**, solo expuesto localmente en disco.

---

## 7. Sistema multiagente + LLM + FinOps

### 7.1 Integraciones LLM reales vs. mencionadas

| Proveedor | Uso real | FinOps |
|---|---|---|
| **Google Gemini** (backend Node, producción) | 7 servicios/agentes: `CopilotoService.js`, `viabilidadAgent.js`, `enfoqueEntidadAgent.js`, `arbolObjetivosAgent.js`, `sectorClassifier.js`, `markitdownService.js`, `embeddingsService.js`, + 3 proxies inline en `server.js` | **Parcial** — logging de tokens solo en 4 de ~10 sitios (ver §7.2) |
| **Google Gemini** (`ai_service/`, LangGraph, 6 llamadas/request) | Pipeline completo de formulación institucional con validación adversarial | **Inexistente** — y el servicio está desconectado del backend (§3.2) |
| **OpenRouter + MiniMax** (`SIA_Radar/engine.py:10-33`) | Extracción/búsqueda de convocatorias | **Inexistente** — y el sistema entero no está versionado en git |
| **Groq** (`routes/ai.js`) | Definido pero **no montado** en `server.js` (grep confirma 0 imports) | N/A — código muerto |
| **OpenAI** | Sin ninguna llamada real; solo un placeholder de UI en `CredentialsPage.tsx` | N/A — la integración no existe en el backend |
| **Anthropic/Claude** | Sin uso; `@traceloop/instrumentation-anthropic` es dependencia transitiva no invocada de `posthog-js` | N/A |

### 7.2 Control de consumo de tokens — cobertura real

- Tabla real: `backend/migrations/034_ai_token_logs.sql` (`ai_token_logs`: user_id, agent_name, tokens_input/output, cost_cop_estimated).
- Logger real: `backend/services/aiTokenLogger.js:35-49` (fire-and-forget, costo **estimado** con tarifas de Gemini y tasa USD→COP **hardcodeadas** en 4000, no facturación real).
- **Llamado solo en 4 de ~10 puntos de invocación a Gemini** (`CopilotoService.js:122`, `viabilidadAgent.js:216`, `enfoqueEntidadAgent.js:73`, `arbolObjetivosAgent.js:102`). `sectorClassifier.js`, `markitdownService.js`, `embeddingsService.js` y los 3 proxies genéricos de `server.js` (`/api/ai/generate`, `/api/radar/barrido-gemini`, `/api/ai/convocatoria-analyze`) **no registran nada** — consumo invisible para FinOps en esos puntos.
- Dashboard: `GET /api/admin/finops` (`server.js:1729-1759`, admin-only) — **puramente post-hoc de solo lectura**, sin alertas automáticas ni corte de servicio.

### 7.3 Alertas de costo / límites por plan

**No existen.** `aiLimiter` (20 req/hora) es idéntico para los 3 planes de pago (Radar $149.000, Formulador $399.000, Suite $499.000 COP/mes) — es un rate-limit antiabuso genérico, no un control de costo ligado a monetización. `docs/PRECIOS.md` tampoco documenta límites de IA por plan (consistencia código↔doc, pero por omisión).

### 7.4 Langfuse / Helicone

**Ausentes.** Ninguna referencia en el repo (confirmado por grep). Sin plataforma de observabilidad de LLM.

### 7.5 `ai_service/` — pipeline LangGraph (9 nodos)

```
START → benchmark_query → (fan-out) m4_arbol_objetivos / m5_marco_normativo / m6_match_score
      → consolidate (fan-in) → m10_generate_citations ↔ m10_audit_citations (loop anti-alucinación, máx 3)
      → red_team_evaluation → finalize → END
```
- Único componente del repo con paso adversarial explícito (`red_team_evaluation`: rechaza si OPEX>30%, financiamiento<70%, SROI≤1).
- **Fail-open ante error técnico** en `red_team_evaluation` (`nodes.py:731-738`) — aprueba por defecto si la llamada a Gemini falla, un detalle de riesgo notable.
- Sin logging de tokens, sin rate limit, sin circuit breaker — y sin caller vivo en Node (§3.2).

### 7.6 CredentialVault / BYOK — hallazgo de bug funcional

Dos implementaciones AES-256-GCM redundantes:
- `backend/services/credentialVault.js` — **huérfana**, cero imports fuera de sí misma.
- `backend/pipeline/CryptoHelper.js` — la que realmente usa `resolveGoogleApiKey()` (`server.js:214-226`).

**Bug confirmado**: `POST /api/credentials` (`server.js:2075-2090`) ignora el campo `service` del body y guarda todo en una única columna `user_credentials.api_key_enc` sin diferenciar proveedor. `CredentialsPage.tsx` ofrece 3 "canales" (Gemini, Groq, OpenAI) pero solo Gemini funciona — una clave de OpenAI/Groq pegada por el usuario se guarda pero nunca se usa contra su proveedor real. Adicionalmente, **no existe el endpoint `GET /api/credentials`** que `CredentialsPage.tsx:103,147` espera (solo existe `GET /api/credentials/status`) — esa llamada del frontend siempre devuelve 404.

### 7.7 SIA_Radar — control de costo

Cero mecanismo de control (solo timeout de red de 120s). Riesgo de costo actual bajo porque usa el modelo gratuito de MiniMax, pero sin ninguna barrera si se cambiara a un modelo de pago. Su scheduler de 4h (`SIA_Radar/api/main.py:92`) referencia `workers.scheduler.job_ciclo_rastreo`, módulo **inexistente** en el repo — el ciclo automático está roto; solo es ejecutable manualmente.

---

## 8. Telemetría, monitorización y modos standby

### 8.1 SDKs de monitoreo presentes

| SDK | Dónde se inicializa | Estado real (según `.env`/`.env.production`) |
|---|---|---|
| Sentry (frontend) | `client/src/lib/sentry.ts:1-13`, condicionado a `VITE_SENTRY_DSN` | 🟡 STANDBY — variable ausente en `client/.env` |
| Sentry (backend) | `backend/config/sentry.config.js:15-28`, condicionado a `SENTRY_DSN` | 🟡 STANDBY — **y `SENTRY_DSN` (sin prefijo VITE) ni siquiera está documentada en `.env.example`**, gap de documentación |
| PostHog | `client/src/lib/posthog.ts:13-28`, condicionado a `VITE_POSTHOG_KEY`, enmascaramiento estricto hardcodeado (`mask_all_text`, `mask_all_element_attributes`) | 🟡 STANDBY — `.env.production` trae el placeholder literal `CONFIGURAR_EN_RENDER_DASHBOARD` |
| Logger estructurado propio | `backend/utils/logger.js:12-27` — JSON a stdout/stderr, diseñado para colectores remotos | 🟠 Sin integración real con ningún colector; adopción parcial (8 archivos lo usan, el resto de `server.js` usa `console.*` directo — 85 llamadas) |

### 8.2 Panel `/admin` — pestaña "Telemetría y Control"

`AdminPage.tsx` → `TelemetriaTab()` (líneas 117-166): consulta `GET /api/admin/system-status` (`server.js:1763-1780`, admin-only) y pinta badges `ACTIVO`/`STANDBY` para Sentry, PostHog, Stripe, Wompi, Resend, Brevo, Gemini, Google OAuth. Si PostHog no está configurado, muestra un aviso explícito en vez de intentar cargar el iframe — comportamiento honesto, no un error silencioso.

### 8.3 Variables ENV en modo standby (estado verificado en `.env`/`.env.production`, sin exponer valores de claves reales)

| Variable | Módulo | Estado |
|---|---|---|
| `VITE_SENTRY_DSN` | Sentry frontend | Vacía/ausente |
| `SENTRY_DSN` | Sentry backend | Ausente (y no documentada en `.env.example`) |
| `VITE_POSTHOG_KEY` | PostHog | Placeholder sin poblar en `.env.production` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*` | Pagos Stripe | Vacías |
| `WOMPI_PUBLIC_KEY` / `WOMPI_PRIVATE_KEY` / `WOMPI_EVENTS_SECRET` / `WOMPI_INTEGRITY_SECRET` | Pagos Wompi | Ausentes |
| `GOOGLE_API_KEY` | Gemini IA | **Poblada** (único proveedor de IA activo hoy) |

**Los cuatro módulos de observabilidad/pagos (Sentry, PostHog, Stripe, Wompi) están simultáneamente en modo standby** en el estado actual del repo — código completo y montado, cero credencial poblada.

---

## 9. Monetización, pasarelas y modelo de negocio (SaaS)

### 9.1 Esquema de datos

- `usuarios` (`001_postgres_schema.sql:21-33`): incluye `plan TEXT DEFAULT 'free'`, `org_id`, RLS por `org_id`.
- `user_subscriptions` (creada en `server.js:685-695`, ampliada por `002_multitenant_saas.sql` y `033_subscription_expires_at.sql`): `plan CHECK IN ('free','radar','formulador','suite')`, `stripe_customer_id`, `stripe_subscription_id`, `expires_at`.
- **No existe una tabla `plans` en la base de datos** — los planes están hardcodeados en código (`backend/config/planes.config.js`), no en SQL.
- Sin columna `currency`/`moneda` en las tablas — COP se maneja como campo de objeto JS (`moneda: 'COP'`) y hardcodeado en `wompiProvider.js:94`.

### 9.2 Pasarelas — estado real (no borrador)

Ambas implementaciones están **completas y funcionales**, con abstracción Strategy real (`PaymentProvider.js`):

| Pasarela | Checkout | Verificación de firma de webhook | Idempotencia |
|---|---|---|---|
| **Stripe** (`stripeProvider.js`) | `checkout.sessions.create` real (líneas 55-71) | `stripe.webhooks.constructEvent` (SDK oficial, líneas 73-79) | Tabla `stripe_events` |
| **Wompi** (`wompiProvider.js`) | Web Checkout hosteado con firma de integridad SHA256 (líneas 81-117) | Checksum SHA256 dinámico según `signature.properties` (líneas 125-159) | Tabla `wompi_events` |

Ambos webhooks registrados correctamente en `server.js` (Stripe antes de `express.json()` con `express.raw()`, línea 1162; Wompi después, línea 1170 — orden correcto documentado con comentarios explicando el porqué).

### 9.3 Activación

- Claves vacías **por diseño** en `.env.example`/`.env` — no bloquean el arranque del servidor (`validateProductionEnv`, `server.js:96-138`, solo exige `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `FRONTEND_URL`).
- Los providers degradan con gracia (`_stripe = null` si falta la clave) en vez de crashear.
- **Conclusión: inactivo por decisión de configuración, no por código incompleto.**

### 9.4 Planes y precios (fuente única verificada)

`backend/config/planes.config.js:10-15`: Free ($0), Radar ($149.000 COP/mes), Formulador ($399.000 COP/mes), Suite ($499.000 COP/mes). Re-exportado por `subscriptions.routes.js`, servido en `GET /api/plans`, consumido también por `WompiProvider`. `docs/PRECIOS.md` confirma los mismos valores pero cita como "fuente única" un archivo (`subscriptions.routes.js`) que en realidad solo re-exporta desde `planes.config.js` — desactualización menor de documentación, no de lógica.

---

## 10. Análisis expectativa vs. realidad

Contradicciones documentación↔código confirmadas con evidencia directa (no heredadas de auditorías previas sin releer):

| Documento | Afirma | Código real | Evidencia |
|---|---|---|---|
| `AGENTS.md:16` | "Persistencia: SQLite local en `backend/radar.db` via `sql.js`" | PostgreSQL exclusivo, SQLite eliminado deliberadamente | `backend/db.js:1-10` (verificado directamente) |
| `.env.example:22-33` | "Switch transparente" a Supabase Auth si hay `SUPABASE_URL`/`SUPABASE_ANON_KEY` | Nunca implementado; `auth.middleware.js` solo valida JWT propio | `auth.middleware.js:1-9` |
| `.env.example:38-41` | "`SUPABASE_SERVICE_KEY` PROHIBIDO en Fase 3... el código no la usa más" | Se usa activamente en 5 archivos | `database.config.js:29`, `supabase.config.js:23,39-40`, `server.js:807`, `anexos.routes.js:75`, `production.config.js:20,45,69` |
| `docker-compose.yml:85` (comentario) | "Backend llama a este endpoint [`ai_service`] para ejecutar el pipeline LangGraph" | 0 referencias a `AI_SERVICE_URL`/puerto 8100 en todo `backend/`/`server.js` | Confirmado por grep exhaustivo |
| `000-orquestador.js` (cabecera) | Describe una "Capa C" de microservicios Python (`database.py`, puerto 8001+) | `database.py` fue eliminado en el commit `2e5481a` | Git log |
| `SIA_Radar/README.md` | Describe carpetas `01_minero`…`04_arquitecto` como contenedoras del código | El código real vive en `SIA_Radar/agentes/{01..04}_*`; las carpetas raíz documentadas están vacías | Verificado por listado de directorios |
| `docs/PRECIOS.md:15` | "Fuente única: `subscriptions.routes.js` (PLANES)" | Ese archivo solo re-exporta desde `planes.config.js` | `planes.config.js:4-8` |

**Reglas de negocio críticas — consistencia real:**
- Aislamiento por tenant: correcto en Capa 1 (RLS real), débil en Capa 2 (solo protege `SELECT`) — inconsistencia interna del propio sistema, no solo doc↔código.
- FinOps por plan: el modelo de negocio tiene 3 niveles de precio pero el límite técnico de consumo de IA es idéntico para los tres — no hay contradicción documental (nadie prometió lo contrario por escrito), pero sí una brecha de diseño entre pricing y control técnico.

---

## 11. Matriz de diagnóstico final

| # | Módulo/subsistema | Estado |
|---|---|---|
| 1 | Auth (login/registro/JWT/blacklist/MFA/lockout) | 🟢 OPERATIVO EN PRODUCCIÓN |
| 2 | Radar (scraping Directorio + fuentes externas, polling REST) | 🟢 OPERATIVO EN PRODUCCIÓN |
| 3 | Directorio + export PDF cliente | 🟢 OPERATIVO EN PRODUCCIÓN |
| 4 | Favoritos | 🟢 OPERATIVO EN PRODUCCIÓN |
| 5 | Formulador — Entrada/Dialéctica/Logística/Anexos/Árbol Objetivos/Compliance/Ficha Técnica/Copiloto | 🟢 OPERATIVO EN PRODUCCIÓN |
| 6 | Formulador — Exportación (PDF) | 🟢 OPERATIVO EN PRODUCCIÓN |
| 7 | Formulador — Exportación a Excel | 🔴 AUSENTE / NO CONSTRUIDO |
| 8 | Formulador — Calendario | 🟠 INCOMPLETO / STUB (datos hardcodeados marzo 2024) |
| 9 | Formulador — Checklist | 🟠 INCOMPLETO / STUB (solo agrega `localStorage`) |
| 10 | Formulador — Viabilidad (score/rúbrica principal) | 🟠 INCOMPLETO / STUB (heurística local, pesos no calibrados) |
| 11 | Formulador — Viabilidad IA (dictamen Gemini) | 🟢 OPERATIVO EN PRODUCCIÓN |
| 12 | Formulador — Presupuesto (materiales/equipos) | 🟠 INCOMPLETO / STUB (editor no construido, siempre 0) |
| 13 | Admin — Usuarios/Permisos/FinOps | 🟢 OPERATIVO EN PRODUCCIÓN |
| 14 | Admin — Guard de frontend en subpáginas admin | 🟠 INCOMPLETO (falta `AdminGuard` en 2 rutas) |
| 15 | RBAC de endpoints Directorio/Scheduler/Moderación | 🟠 INCOMPLETO / STUB (solo exige sesión, no rol) |
| 16 | `GET /api/scrape/minciencias` | 🔴 AUSENTE de protección (endpoint anónimo por diseño) |
| 17 | Sentry (frontend + backend) | 🟡 CONSTRUIDO EN STANDBY |
| 18 | PostHog | 🟡 CONSTRUIDO EN STANDBY |
| 19 | Stripe (pagos) | 🟡 CONSTRUIDO EN STANDBY (completo, sin claves) |
| 20 | Wompi (pagos) | 🟡 CONSTRUIDO EN STANDBY (completo, sin claves) |
| 21 | FinOps — logging de tokens Gemini | 🟠 INCOMPLETO / STUB (4 de ~10 sitios) |
| 22 | FinOps — límites de gasto por plan/usuario | 🔴 AUSENTE / NO CONSTRUIDO |
| 23 | BYOK multi-proveedor (OpenAI/Groq) | 🟠 INCOMPLETO / STUB (UI existe, backend no lo soporta) |
| 24 | `ai_service/` (LangGraph, red-team) | 🟡 CONSTRUIDO EN STANDBY (completo, sin caller) |
| 25 | `SIA_Radar/` (4 agentes) | 🔴 AUSENTE en la práctica (ni versionado, lógica placeholder, scheduler roto) |
| 26 | `agents/scraper_core.py` | 🔴 AUSENTE en la práctica (huérfano, DB destino inexistente) |
| 27 | `backend/core/` (Python WebSocket) | 🔴 AUSENTE en la práctica (huérfano, sin integración) |
| 28 | RadarGridRealTime / radar en tiempo real | 🔴 AUSENTE / roto (mock + WS sin servidor, fuera del build de producción) |
| 29 | Sistema de skills (`ag_skills_registry.json`, `.claude/skills/`) | 🔴 AUSENTE / NO CONSTRUIDO |
| 30 | Orquestador central de agentes de IA | 🔴 AUSENTE / NO CONSTRUIDO |
| 31 | RLS multi-tenant (políticas SQL) | 🟢 OPERATIVO (Capa 1) / 🟠 débil en Capa 2 fallback |

---

## 12. Plan de remediación y blindaje

| # | Problema | Evidencia | Criticidad | Acción correctiva |
|---|---|---|---|---|
| 1 | RBAC insuficiente en Directorio/Scheduler/Moderación — cualquier usuario logueado altera datos globales | `server.js:2271,3058,3122,3186,3206,3361,3395,3412,3777,3810,3826,3834` | **Alta** | Crear middleware `requireRole('admin')` centralizado y aplicarlo a estos 11 endpoints antes del handler |
| 2 | `GET /api/scrape/minciencias` sin ninguna autenticación | `backend/routes/scraper.routes.js:85` | **Alta** | Decidir explícitamente: si debe ser público, añadir rate-limit dedicado; si no, añadir `authenticateToken` |
| 3 | Capa 2 (REST/`service_role`) bypasea RLS realmente; `injectTenantFilter` solo protege `SELECT` | `database.config.js:416-424` | **Alta** | Extender `injectTenantFilter` a `INSERT/UPDATE/DELETE`, o forzar que Capa 2 nunca ejecute escrituras sin filtro explícito auditado |
| 4 | Sin límite de gasto IA por plan/usuario | `SecurityMiddleware.js:74-87` (aiLimiter plano) | **Media-Alta** | Definir cuota mensual de tokens/costo por plan y cortar/degradar al superarla, no solo rate-limit por hora |
| 5 | Logging de tokens incompleto (4/10 sitios) | `sectorClassifier.js`, `markitdownService.js`, `embeddingsService.js`, proxies de `server.js` | **Media** | Envolver todas las llamadas Gemini restantes con `aiTokenLogger.logTokenUsage()` |
| 6 | BYOK roto para OpenAI/Groq; falta `GET /api/credentials` | `server.js:2075-2090`, `CredentialsPage.tsx:103,147` | **Media** | Añadir columna/tabla por `service`, implementar el endpoint faltante, o retirar los conectores no funcionales de la UI |
| 7 | `ai_service/` (LangGraph con red-team) completo pero sin integrar | `docker-compose.yml:85` vs. 0 referencias en `backend/` | **Media** | Decidir: integrar (crear el caller Node) o retirar del `docker-compose.yml` para no sostener infraestructura fantasma |
| 8 | `SIA_Radar/` y `agents/scraper_core.py` huérfanos, con lógica placeholder y DBs inexistentes | `SIA_Radar/agentes/*/main.py`, `agents/scraper_core.py` | **Media (higiene)** | Eliminar del disco de desarrollo o documentar explícitamente como "archivado, no ejecutar" |
| 9 | `.kilo/worktrees/` conserva código zombie ya eliminado de `main` | `.kilo/worktrees/quixotic-outrigger/agents/005_Radar*` | **Baja-Media** | Limpiar worktrees stale de Kilo Code localmente (no versionado, sin riesgo de repo, pero riesgo de confusión/ejecución accidental) |
| 10 | `AGENTS.md` desactualizado (SQLite) contradice `db.js` (PostgreSQL) | `AGENTS.md:16,28,43` | **Media (riesgo de regresión)** | Reescribir `AGENTS.md` para reflejar PostgreSQL exclusivo — un agente que confíe en ese archivo podría reintroducir lógica SQLite |
| 11 | Frontend: `/admin/usuarios-pendientes` y `/admin/permisos` sin `AdminGuard` | `main.tsx:330-331` | **Baja (mitigado por backend)** | Envolver ambas rutas en `<AdminGuard>` por consistencia y defensa en profundidad |
| 12 | Componentes/páginas muertas acumuladas (12+ archivos no importados) | `RadarGlobalStats.tsx`, `AlertsView.tsx`, etc. (§5) | **Baja (deuda técnica)** | Eliminar o documentar como archivo de referencia futura |
| 13 | `RadarGridRealTime`/`Dashboard.tsx` mock + WebSocket sin servidor | `Dashboard.tsx:337` | **Baja (ya excluido de prod)** | Completar el servidor WS o eliminar el componente dev |
| 14 | Sin sistema de skills real ni `ag_skills_registry.json` | Confirmado ausente | **Baja (expectativa vs. realidad)** | Si se requiere el patrón, construirlo desde cero; si no, no asumir su existencia en prompts futuros |
| 15 | Sin orquestador central de agentes IA / sin validación adversarial en agentes activos | §1, §3 | **Media** | Evaluar portar el patrón `red_team_evaluation` de `ai_service/` a los agentes Node activos (`arbolObjetivosAgent.js`, servicios Gemini) |

---

## 13. Diseño del Agente Arquitecto (crítico)

**Estado actual: no existe ningún agente con esta función en el repo.** No hay ningún archivo que bloquee, valide o audite arquitectura antes de que otro agente escriba código — el control depende hoy exclusivamente de directivas en prosa (`CLAUDE.md`, `.clinerules`, `AGENTS.md`) que un agente puede o no seguir, sin gate técnico verificable. Esto es consistente con el propio `CLAUDE.md` de este repo, que ya documenta dos episodios donde auditorías previas (propias y externas) generaron hallazgos falsos por no verificar contra el código real.

### 13.1 Propuesta de diseño (nuevo agente obligatorio)

**Nombre:** `Architect Agent`
**Principio rector:** *"Prohibido escribir código sin diseño aprobado."*

**Funciones mínimas requeridas:**
1. **Gate de arquitectura pre-ejecución**: antes de que cualquier agente ejecutor (Claude Code, Cline, Kilo, u otro) modifique código en `backend/`, `client/src/`, o cree un nuevo subsistema (carpeta nueva de agentes/servicios), debe existir un documento de diseño aprobado (arquitectura, contratos de datos, puntos de integración) — análogo al gate de la skill local `grupo-elite` ya presente en el CLAUDE.md global del usuario, pero aplicado también a nivel de este repo.
2. **Bloqueo de agentes ejecutores sin validación**: los hallazgos de este informe (§1, §3) muestran que hoy cualquier agente puede crear un subsistema Python/Node paralelo (como ocurrió 3 veces: `agents/scraper_core.py`, `SIA_Radar/`, `backend/core/`) sin que nada impida la duplicación. El Architect Agent debe verificar, antes de aprobar, si ya existe un sistema equivalente (grep/búsqueda obligatoria) para evitar islas nuevas.
3. **Control de flujos multiagente**: cuando se conecte `ai_service/` (o cualquier otro sistema huérfano) al backend Node, el Architect Agent debe validar que el wiring de infraestructura (`docker-compose.yml`, variables `.env`) tenga un caller real correspondiente en el código — evitando el patrón hoy repetido de "infraestructura declarada, código consumidor ausente".
4. **Verificación de consistencia documento↔código** como paso obligatorio antes de cerrar cualquier tarea de arquitectura — exactamente la regla que el propio `CLAUDE.md` de este repo ya exige ("Protocolo de Auditoría Verificada"), pero hoy sin un agente/gate que la aplique de forma sistemática y no solo cuando el usuario la invoca manualmente.

**Restricciones operativas:**
- Sin permisos de escritura de código de producto — solo lectura + escritura de documentos de diseño/aprobación.
- Debe rechazar explícitamente (no silenciar) cualquier solicitud de crear un nuevo sistema de agentes/scraping/orquestación si ya existe uno equivalente en el repo, citando la ruta del sistema existente.

---

## Notas metodológicas finales

- Todos los hallazgos de severidad Alta en este documento (§6.3, §10) fueron re-verificados por lectura directa de archivo después de ser reportados por los subagentes de exploración, siguiendo el protocolo de auditoría verificada de este repo (`CLAUDE.md`).
- Limitación explícita: no se levantó el servidor ni se probaron endpoints en runtime; la clasificación REAL/MOCK/STUB se basa en existencia de lógica SQL/IA genuina en el backend y su invocación correcta desde el frontend, no en el contenido actual de la base de datos.
- No se auditaron en profundidad los ~56 componentes de `client/src/components/` en su totalidad — se priorizaron los alcanzables desde alguna ruta y los explícitamente solicitados por el prompt de auditoría; puede haber componentes huérfanos adicionales no listados.
