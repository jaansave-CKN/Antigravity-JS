# RadFor-360 (Antigravity JS) — Radiografía Técnica Forense de 360°

**Alcance:** raíz `c:\2026 AI EGIOC5\Antigravity JS` (`package.json` → `name: "brevo-total-integration"`; producto real: **RadFor-360**, ver `render.yaml:3` → `name: radar-formulador-360`). Excluye `proyectos/`, `Repositorios/`, `EGIOC5/`, `ObsidianVault/`, `Radar_Resultados/` — proyectos hermanos con repos propios, fuera del perímetro de esta app (`.gitignore:23-31`).

**Fecha:** 2026-08-06. **Método:** inspección forense en disco, de solo lectura, sin ejecutar el servidor. Código fuente leído completo en los archivos citados (no solo grep). Cruzado contra `git log`, `git status`, `.env` real y los dos informes previos del mismo día (`docs/RADFOR360_ARQUITECTURA_OPTIMIZACION.md`, `docs/RADFOR360_IMPLEMENTACION_2026-08-06.md`) — donde este documento diverge de esos informes por cambios posteriores confirmados en disco, se marca explícitamente **"⚠️ DIVERGE"**.

---

## 0. Hallazgo transversal — el estado real ya no coincide con la última auditoría escrita

Los dos informes previos de hoy (`RADFOR360_ARQUITECTURA_OPTIMIZACION.md` y su implementación) documentan un login roto, Upstash sin credenciales y el módulo Formulador inejecutable. **Verificado en esta pasada que la mayoría de eso ya cambió**, en algunos casos incluso después de que el propio informe de implementación lo diera por "bloqueado":

- **Login del SPA:** funcional. `public/src/pages/InicioPage.jsx` tiene `onClick={handleLogin}` real, `AuthProvider` envuelve la app (`main.jsx`), `RequireAuth.jsx` protege las rutas. Confirmado leyendo los 3 archivos completos.
- **Upstash Redis:** ⚠️ **DIVERGE del informe de implementación** (que lo marca "Bloqueado — no se pueden fabricar credenciales"). `.env` líneas 21-22 **ya tienen `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` con valores reales**, y el mismo par aparece en `claves_privadas.txt:2-3`. `cacheInfo().backend` en `src/shared/infrastructure/cache.js:92-97` evaluará a `"Upstash Redis"`, no `"In-Memory"`, en el próximo arranque del proceso. Sesiones y cache de Radar ya no dependen de que el proceso siga vivo.
- **Formulador / migraciones Supabase:** desplegadas y verificadas end-to-end según `RADFOR360_IMPLEMENTACION_2026-08-06.md §6bis` (prueba cruzada de 2 tenants real, aislamiento confirmado por `404` al leer el proyecto ajeno). No re-ejecuté la prueba (fuera de alcance de una auditoría de solo lectura), pero el código y las migraciones en disco son consistentes con ese resultado.
- **`estado_antigravity.json` (dashboard de agentes) SÍ está desactualizado** — ver §5.

**Consecuencia práctica para el resto de este documento:** se reporta el estado verificado en disco a fecha de hoy, no el de los informes previos.

---

## 1. Topografía de arquitectura y patrón de diseño

### 1.1 Stack real (evidencia: `package.json`, imports en `server.js`)

| Capa | Tecnología real | Evidencia |
|---|---|---|
| Frontend | React 18.3 + React Router 7 + Vite 5 + Tailwind 4, sin TypeScript | `package.json:40-59`, `vite.config.js` |
| Backend | Node.js + Express 4, ESM puro (`type: "module"`) | `server.js:1-9`, `package.json:5` |
| Backend paralelo (no-producción) | `backend_fastapi.py` (FastAPI/Python) y `server-sim.js` (Node/ws) | ninguno referenciado por `render.yaml` ni por `npm start` real de producción |
| Base de datos primaria | **Supabase (PostgreSQL) vía REST/PostgREST**, no conexión `pg` directa | `src/modules/formulador/supabaseClient.js`, `render.yaml:21-27` (comentario explícito) |
| Cache/Sesiones | Upstash Redis (REST, sin SDK) con fallback a `Map` en memoria | `src/shared/infrastructure/cache.js` |
| Auth | Firebase Authentication (Google Sign-In) + capa JWT propia complementaria | `FirebaseAdmin.js`, `session-manager.js`, `public/src/lib/firebase.js` |
| Motor de IA principal | Claude / Anthropic SDK (`@anthropic-ai/sdk`), modelo `claude-sonnet-4-6` | `server.js:9,28`, `m1Pipeline.js:13` |
| Motor de IA fallback | OpenRouter (proxy REST) | `server.js:284-341` |
| Búsqueda en tiempo real | Tavily Search API (tool-use nativo de Claude) | `m1Pipeline.js:25-77` |
| Realtime | WebSocket nativo (`ws`) en `/ws/live_radar` | `server.js:371-409` |
| Email transaccional | Brevo (SDK instalado, credenciales vacías) | `BrevoEmailAdapter.js`, `.env:37-38` |

### 1.2 Patrón arquitectónico

**Monolito modular con vestigios de Clean/Hexagonal**, no DDD estricto ni microservicios. `src/modules/{formulador,communications,radar}/` sigue una convención `domain/ application/ infrastructure/` (visible completa en `communications/`: `EmailSender.js` (dominio), `SendEmailUseCase.js` (aplicación), `BrevoEmailAdapter.js` (infraestructura)), pero **Formulador y Radar no tienen capa de dominio propia** — el controlador (`FormuladorPgController.js`) habla directo con el adaptador REST de Supabase (`supabaseClient.js`), sin entidades de dominio intermedias. `server.js` es un único punto de composición/wiring (7 routers montados directamente, sin contenedor de inyección de dependencias) — acoplamiento alto en el punto de entrada, bajo entre módulos de negocio entre sí.

### 1.3 Manejo de estado y SPOF (puntos únicos de falla)

| Estado | Dónde vive | Persiste reinicio del proceso |
|---|---|---|
| `radarData` (convocatorias del Radar) | Array en memoria, `server.js:56` | **No** — vuelve al seed estático de 8 filas (`CONVOCATORIAS_SEED`) |
| Sesiones JWT propias | `cache.js` → Upstash Redis (hoy activo, ver §0) | Sí, mientras Upstash siga configurado |
| `activeQueries` (anti-flood) | `Map` en memoria, `session-manager.js:19` | No — diseño deliberado, documentado en el propio archivo |
| Cuota diaria por uid (`checkQuota`) | `Map` en memoria, `session-manager.js:76` | **No** — un reinicio del proceso resetea el límite de 50 consultas/día/usuario |
| Cache de resultados de IA (Radar) | `cache.js` → Upstash (hoy activo) | Sí |

**SPOF confirmados:**
1. **Un solo proceso Node** en Render `plan: free`, sin réplicas (`render.yaml:1-8`) — el ciclo de suspensión por inactividad del tier gratuito reinicia todo lo que no esté en Upstash/Supabase.
2. **WebSocket single-process** — sin adaptador pub/sub; si algún día hay más de una instancia, un broadcast disparado en una instancia nunca llega a un cliente conectado a otra.
3. **`ANTHROPIC_API_KEY` única** — todo el sistema de IA (chat, Radar, Formulador futuro) depende de una sola cuenta Anthropic sin cuota diferenciada por función.

---

## 2. Inventario de MVP y funcionalidades (real vs. stub)

### 2.1 Rutas del frontend (`public/src/App.jsx`, completo)

| Ruta | Módulo | Estado | Evidencia |
|---|---|---|---|
| `/inicio` | Login | 🟢 **Real** | `InicioPage.jsx` — Google Sign-In funcional, `handleLogin` real |
| `/radar` | A — Radar | 🟢 **Real, con dato mixto** | `RadarApp.jsx`: fetch REST + WS reales; búsqueda IA on-demand real (`/api/radar/search`); el *stream* automático del WS es simulado (ver §2.3) |
| `/panel`, `/directorio`, `/favoritos`, `/calendario` | A | 🟠 **Stub visual** | `FrozenPage.jsx` — tarjeta "Frozen — Próximamente", sin lógica ni backend |
| `fase1-entrada.html` (externa) | B — Formulador | 🟢 **Real** | HTML standalone fuera del SPA React; `public/src/modules/formulador/schema.js` + POST real a `/api/formulador/fase1` |
| `/modulo10`, `/anexos`, `/logistica`, `/dialetica`, `/ficha` | B | 🟠 **Stub visual** | Mismo componente `FrozenPage.jsx` reutilizado |

### 2.2 Backend — endpoints `/api/*` (`server.js`, completo)

| Endpoint | Estado | Detalle |
|---|---|---|
| `GET /api/convocatorias` | 🟢 Real | Sirve `radarData` en memoria (seed estático + mutaciones del WS simulado) |
| `POST /api/chat`, `POST /api/minimax/chat` | 🟢 Real | Proxy directo a Claude, con `checkQuota` real |
| `GET /api/minimax/status` | 🟢 Real | Refleja si `ANTHROPIC_API_KEY` está configurada |
| `GET /api/mcp` | 🟢 Real | Escanea configs MCP locales en disco |
| `POST/GET /api/radar/*` (`m1Router`) | 🟢 Real | Claude + Tavily con tool-use, cache dual, SSE de streaming — pipeline de IA más completo del repo |
| `POST /api/session/login|verify`, `DELETE /api/session/:id` | 🟢 Real | JWT propio sobre Firebase, con revocación por dueño/admin |
| `GET /api/health` | 🟢 Real | Ping real a Claude/Tavily/Supabase/JWT, no maqueta estado |
| `GET/POST /api/openrouter/*` | 🟡 **Standby operativo** | Código funcional, pero **cero consumidor en el frontend** — nadie lo llama desde la UI |
| `POST /api/communications/email` | 🟠 **Incompleto** | Código real (`SendEmailUseCase`), pero `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` vacíos en `.env` → falla en runtime si se invoca |
| `GET /api/github/status` | 🟢 Real | `GITHUB_TOKEN` configurado, `GitHubProvider.js` funcional |
| `POST/GET /api/formulador/fase1*` | 🟢 Real | RPC atómicas contra Supabase, RLS + filtro `tenant_id` explícito, verificado end-to-end (§0) |
| `POST /api/execute` | 🔴 **No-op** | `server.js:350-354` — solo hace `AuditLogger.log` y responde `SUCCESS`, no ejecuta nada |
| WS `/ws/live_radar` | 🟠 **Mitad real, mitad simulado** | Conexión, snapshot inicial y broadcast son reales; el contenido que emite cada 30s es aleatorio sobre el seed estático, marcado `_simulado: true` (`server.js:388-409`, comentario de "Honestidad Técnica" explícito en el propio archivo) |

### 2.3 El WS "Live Radar" — el hallazgo de honestidad técnica más citable del repo

`server.js` líneas 388-409 documentan, en el propio código, que el `setInterval` que alimenta el WebSocket **no consulta el pipeline real de IA** (`m1Pipeline.js`) — cicla sobre el seed de 8 convocatorias y le asigna un estado al azar (`Abierta/Próxima/En revisión`) cada 30 segundos, marcando cada evento con `_simulado: true` para que ningún consumidor lo confunda con un hallazgo real. Es simulación **declarada**, no oculta — pero sigue siendo simulación en el badge "LIVE" que ve el usuario en el Sidebar (`Sidebar.jsx:124`).

---

## 3. Módulo de administración y seguridad (RBAC y perímetro)

### 3.1 No existe un panel `/admin`

Ninguna ruta `/admin` en `App.jsx`, ningún componente de administración en `public/src/`. El único "perímetro admin" verificable en todo el sistema es **`firestore.rules`**:

```
match /audit_logs/{logId} {
  allow read: if request.auth != null && request.auth.token.email == 'jaansave@gmail.com';
  allow write: if false;
}
match /{document=**} { allow read, write: if false; }
```

Es una lista blanca de **un solo correo hardcodeado**, no un sistema de roles. Deny-by-default correcto para todo lo demás (`firestore.rules:12-14`).

### 3.2 RBAC en el backend Express — existe el campo, no el enforcement

- `session-manager.js:47` compara `requester.role === 'admin'` — pero **el único lugar del repo que lee ese campo es `revokeSession`** (revocar una sesión ajena). Ningún endpoint de negocio (`/api/formulador/*`, `/api/radar/*`, `/api/chat`) diferencia entre `admin` y `user`.
- El rol viene del JWT propio (`session-manager.js`), que se emite en `/api/session/login` a partir de `decoded.role` del token de Firebase — es decir, requiere que el custom claim `role: admin` esté asignado en Firebase Auth para esa cuenta. No hay UI ni endpoint en este repo para asignar ese claim (se hizo, según el informe previo, con un script de un solo uso ya borrado).

**Conclusión:** RBAC = 🟠 **incompleto** — el mecanismo de autorización por rol existe y es correcto donde se usa, pero cubre exactamente un caso (revocar sesión), no una superficie administrativa real.

### 3.3 Perímetro de autenticación — el gate universal (`server.js:76-84`)

```js
const PUBLIC_API_PREFIXES = ['/api/health', '/api/convocatorias', '/api/session'];
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const isPublic = PUBLIC_API_PREFIXES.some(...);
  if (isPublic) return next();
  return verifyFirebaseAuth(req, res, next);
});
```

Whitelist explícita y corta (3 prefijos públicos); todo lo demás bajo `/api/` exige `Bearer <Firebase ID token>` válido, verificado con el Admin SDK real (`FirebaseAuthMiddleware.js`, 17 líneas, sin condicional de entorno ni bypass). Si `serviceAccountKey.json` no carga, el sistema fallará **cerrado** (rechaza todo con 401), documentado explícitamente en `FirebaseAdmin.js:22`.

### 3.4 Validación de entrada

Sin librería de esquemas (`zod`/`joi`/`express-validator`) en ningún punto del árbol — patrón consistente de checks manuales de 1-2 campos. Más fuerte: `/api/formulador/*` (regex UUID estricta para tenant/id). Más débil: `POST /api/execute` (no valida nada, pero tampoco ejecuta nada real).

### 3.5 Rate limiting

No existe limitador a nivel de infraestructura (IP/WAF). Sí existe **cuota diaria por `uid`** (`checkQuota`, 50/día, en memoria) aplicada en los 4 endpoints costosos de IA (`/api/chat`, `/api/minimax/chat`, `/api/radar/search`, `/api/radar/stream`) — mitigación real pero no persistente entre reinicios.

### 3.6 CORS

`ALLOWED_ORIGINS` explícito por variable de entorno (`.env:75`: localhost + `antigravity-jairo-2026.web.app`); sin la variable, cae a solo `localhost` — falla cerrado, no abierto (`server.js:63-73`). El backend paralelo `backend_fastapi.py` **sí tiene CORS abierto** (`allow_origins=["*"]`, línea 12) — irrelevante en producción porque `render.yaml` no lo despliega, pero es una superficie de riesgo real si alguna vez se ejecuta manualmente expuesto.

### 3.7 Manejo de secretos — hallazgo de mayor severidad de esta auditoría

- `.env` (raíz) contiene **19 credenciales en texto plano** para servicios productivos: Anthropic, Tavily, Upstash, JWT propio, GitHub, Render, Supabase (URL + anon + **service key**), Stitch, OpenRouter, Groq, Gemini.
- `claves_privadas.txt` (raíz, gitignorado) contiene un **inventario adicional y más amplio** de credenciales en texto plano: Upstash, GitHub (token distinto al de `.env`), Brevo (API key completa — **no está en `.env`, que la tiene vacía**), dos cuentas de Hostinger con contraseña, un token de gestión de cuenta de Supabase con alcance de administración de proyecto (`sbp_...`), el JWT `service_role` completo de Supabase, credenciales de Render (distintas a las de `.env`), y una contraseña de GitLab en texto plano.
- **Divergencia confirmada entre `.env` y `claves_privadas.txt` para el mismo servicio** (ej. `GITHUB_TOKEN` y la clave secreta de Supabase no coinciden entre ambos archivos) — indicio de rotación pasada sin sincronizar todas las copias; las versiones huérfanas no están confirmadas como revocadas.
- **Mitigante verificado:** `.gitignore` excluye `.env`, `config/serviceAccountKey.json` y `claves_privadas.txt` explícitamente (`.gitignore:13-15`); `git log --all -- .env / serviceAccountKey.json / claves_privadas.txt` no devuelve ningún commit — ninguno de los tres ha estado nunca en el historial de git de este repositorio.
- **Historial de git es de solo 2 commits** (`git log --oneline`: `cf4be9f`, `0aef777`), el segundo con mensaje explícito *"rama limpia, sin secretos en historial"* — indica un `squash`/reinicio deliberado de historial en algún punto anterior a hoy. No es posible, desde este repositorio, confirmar si alguna versión anterior (pre-squash) llegó a exponer secretos en un remoto; **recomendación de auditoría: tratar toda credencial que haya existido antes del squash como potencialmente expuesta y rotarla como precaución**, en particular las que aparecen divergentes entre `.env` y `claves_privadas.txt`.

---

## 4. Sistema multiagente, LLMs y FinOps

### 4.1 La carpeta `agents/` no es un runtime — es una librería de definiciones

15 carpetas numeradas (`000_ORQUESTADOR`, `001_gestor_datos`, `002_redactor_tecnico`, `005_Radar1_minero`, `006_Radar2_Estratega`, `015_intelligence-core`, `03-analista-secop`, `050_Formulador_proy`, `051_Form_Lluvia_de_ideas`, `052_Form_Administrativo`, `054_Form_Gestion_de_riesgos`, `056_Form_Evaluador`, `07-ing-concreto_GFRC`, `08-estratega-neuromarketing`, `14-analista-comportamiento`), cada una con `IDENTITY.md` (prompt de rol) y archivos `.cjs` sueltos ("skills"). **Confirmado por grep exhaustivo: `server.js` y todo `src/` no importan ni ejecutan (`require`/`import`/`spawn`/`exec`) ningún archivo de `agents/`.** Son definiciones de agente para uso interactivo (vía Claude Code / IDE), no un orquestador productivo corriendo en el servidor.

- `agents/000_Orquestador.cjs`: script CLI que se ejecuta manualmente (`node agents/000_Orquestador.cjs --aprobar-diseno`) para firmar un hash del estado de `agents/`+`src/` como gate de arquitectura — es tooling de desarrollo, no un proceso en producción.
- `agents/bridge-server.cjs`: servidor Express standalone en el puerto 3001 con endpoint `POST /orquestar` — **no está referenciado en ningún script de `package.json`**; si corre, es porque alguien lo lanza a mano (`node agents/bridge-server.cjs`), desconectado del backend real (puerto 5000/10000).
- **Único pipeline multiagente con function-calling real y verificado en producción:** `src/modules/radar/m1Pipeline.js` — Claude orquesta `tavily_search` como tool nativa, hasta 3 iteraciones, con extracción anti-alucinación (`skills/seguridad/Skill_Protocolo_Fuente_Unica.cjs`: regex que marca "Dato Pendiente" si no hay cita textual verificable).

### 4.2 Puntos de integración LLM confirmados

| Proveedor | Uso real | Evidencia |
|---|---|---|
| Anthropic Claude (`claude-sonnet-4-6`) | **Motor principal**, 3 rutas: `/api/chat`, `/api/minimax/chat`, `m1Pipeline.js` | `@anthropic-ai/sdk` en `package.json:21` |
| Tavily | Tool de búsqueda dentro del loop de Claude | `m1Pipeline.js:51-77` |
| OpenRouter | Fallback configurado, código real, 🟡 sin consumidor en UI | `server.js:284-341` |
| Groq, Gemini | 🔴 **Confirmado sin ningún código que los invoque** — presentes en `.env` solo para la extensión IDE `.kilo` local, anotado explícitamente como tal en el propio `.env:67` | grep sin resultados en `src/`, `public/src/` |

### 4.3 FinOps — control de consumo de tokens

- `AuditLogger.log('CLAUDE_CHAT_SUCCESS', { model, tokens: response.usage })` registra el conteo de tokens **por evento individual**, en dos destinos: `logs/audit.log` (append-only local) y colección `audit_logs` en Firestore.
- **No existe agregación, dashboard de costo, alerta de presupuesto, ni límite de gasto en dinero** — es un log crudo evento-por-evento, no un sistema de FinOps.
- **Sin integración con Langfuse, Helicone, ni ninguna plataforma de observabilidad de LLM** — cero referencias en todo el repositorio (`agents/`, `src/`, `public/`, `package.json`).
- El único control de costo real es `checkQuota()` (§3.5): un tope de 50 llamadas/usuario/día, no un tope de tokens ni de dinero, y se resetea en cada reinicio del proceso al vivir en memoria.

**Clasificación FinOps: 🟠 incompleto.** Hay trazabilidad de tokens (auditable a posteriori en `logs/audit.log`/Firestore) pero cero control preventivo de gasto por encima de la cuota fija de llamadas.

---

## 5. Telemetría, monitorización y modos standby

### 5.1 Observabilidad

- **Sin Sentry, PostHog, Google Analytics ni ningún SDK de monitoreo real** en el código ejecutable — las únicas coincidencias de esos términos en todo el repo están en documentación de referencia de skills (`.agent/skills/...`), no en código integrado.
- Logging = `console.log`/`console.warn`/`console.error` en cada módulo, más `AuditLogger` para eventos de negocio (chat IA, login de sesión, errores de OpenRouter, órdenes formales).
- No hay agregador de logs (no ELK, no Datadog, no Grafana) — `logs/audit.log` es un archivo plano local, no persistente si Render recicla el filesystem.

### 5.2 Flags de entorno en modo standby (`.env`, 44 variables declaradas)

**Configuradas con valor real (activas):** `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `UPSTASH_REDIS_REST_URL/TOKEN` (⚠️ ver §0 — activo pese a que la auditoría previa lo daba por pendiente), `JWT_SECRET`, `FIREBASE_CONFIG_PATH`, `GITHUB_TOKEN/OWNER/REPO`, `RENDER_API_KEY`, `SUPABASE_URL/ANON_KEY/SERVICE_KEY`, `STITCH_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` (estas 2 últimas sin consumidor, §4.2), `ALLOWED_ORIGINS`.

**Vacías — módulos en standby real:**
| Variable | Módulo afectado | Efecto si se invoca hoy |
|---|---|---|
| `DATABASE_URL` | Conexión `pg` directa | No usada por el código actual (Supabase vía REST la reemplaza); referenciada solo en un comentario de `.env` como "para completar" |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` | Comunicaciones por email | `POST /api/communications/email` fallaría en runtime — código listo, credencial ausente en `.env` (aunque la key completa sí existe en `claves_privadas.txt`, sin sincronizar) |
| `STRIPE_SECRET_KEY` | Monetización | Sin ningún código que la lea — ver §6 |
| `INNGEST_EVENT_KEY` | Colas/eventos diferidos | Sin ningún código que la lea |
| `MCP_API_KEY`, `RESEND_API_KEY` | Integraciones adicionales | Sin ningún código que las lea |

### 5.3 `public/estado_antigravity.json` — telemetría propia, confirmada desactualizada

Generado por `scripts/generar_reporte.cjs` (importado por `server.js:23`, se ejecuta al arrancar y cada 10 minutos). **Hallazgo verificado:** el archivo en disco (timestamp `6/8/2026, 2:17:59 a.m.`) todavía lista `10-admin-trello` y `12-gestor-mongodb` como agentes con `status: "READY 24/7"` — **ambas carpetas fueron eliminadas del disco en el commit `cf4be9f` (03:11:56)**, posterior a la última generación del reporte. El servidor no se ha reiniciado desde ese commit, así que el dashboard sigue reportando 17 agentes "activos" cuando en disco hoy solo hay 15.

Más grave que la desactualización puntual: **el generador nunca valida nada real** — `scripts/generar_reporte.cjs:24-33` simplemente lista los nombres de carpeta bajo `agents/` y asigna `status: "READY 24/7"` a cada una sin verificar sintaxis, dependencias, ni ejecución. Es un inventario de directorios disfrazado de panel de salud.

### 5.4 Config residual inconsistente

`config/global_config.json` describe una identidad de otro proyecto (`"firm_name": "Gestión de Donaciones"`, `"role": "ABOGADO"`) — no refleja RadFor-360. Archivo huérfano de una etapa anterior del repo, sin consumidor confirmado en `server.js`/`src/` (no importado en ningún punto revisado).

---

## 6. Monetización, pasarelas y modelo de negocio

**Estado: 🔴 prácticamente ausente.**

- `package.json` — **sin ningún SDK de pagos** (no `stripe`, no equivalentes de Wompi/Bold/MercadoPago).
- `src/`, `public/src/` — **cero código** que mencione Stripe, Wompi, Bold, MercadoPago, webhooks de facturación, planes o suscripciones.
- `.env`: `STRIPE_SECRET_KEY` e `INNGEST_EVENT_KEY` existen como **variables reservadas, vacías** — la única traza de una intención futura de monetización, sin ninguna implementación detrás.
- Esquema de base de datos (`src/modules/formulador/migrations/001_formulador.sql` a `005_fix_insertar_fase1.sql`): tablas `formulador_proyectos`, `formulador_objetivos`, `formulador_oe`, `formulador_cronograma`, `formulador_presupuesto`, `formulador_validaciones_financieras` — **todas del dominio de negocio del formulador de proyectos (MGA/DNP), ninguna de facturación**. No hay tabla `users`, `subscriptions`, `plans`, ni `invoices`.
- `moneda CHAR(3) DEFAULT 'COP'` (`001_formulador.sql:169`) es el **presupuesto del proyecto de inversión pública que formula el usuario**, no un sistema de cobro en COP al usuario — cumple el axioma "Soberanía Financiera Absoluta en COP" de `AGENTS.md` §II.2, pero no es evidencia de monetización SaaS.
- Autenticación: Firebase Auth solo gestiona identidad (Google Sign-In); no hay perfil de facturación, tier de plan, ni estado de suscripción asociado al usuario en ningún esquema (Firestore o Supabase) revisado.

**Conclusión:** el producto hoy es de acceso gratuito/interno (lista blanca por email en `firestore.rules`), sin ningún mecanismo de cobro construido, ni parcial.

---

## 7. Matriz de diagnóstico definitiva

| # | Módulo / Subsistema | Estado | Evidencia clave |
|---|---|---|---|
| 1 | Autenticación Firebase (backend, gate universal) | 🟢 OPERATIVO | `FirebaseAuthMiddleware.js`, `server.js:76-84` |
| 2 | Autenticación Firebase (frontend, login SPA) | 🟢 OPERATIVO | `InicioPage.jsx`, `AuthContext.jsx`, `main.jsx` — corrige el hallazgo §0 de la auditoría previa |
| 3 | JWT propio / gestión de sesiones | 🟢 OPERATIVO | `session-manager.js`; persistencia real vía Upstash (§0) |
| 4 | Cache distribuida (Upstash Redis) | 🟢 OPERATIVO (⚠️ diverge de informe previo, que lo daba pendiente) | `.env:21-22`, `cache.js` |
| 5 | Radar 360 — datos REST + WS de conexión | 🟢 OPERATIVO | `RadarApp.jsx`, `server.js:89-92,371-386` |
| 6 | Radar 360 — búsqueda IA on-demand (Claude+Tavily) | 🟢 OPERATIVO | `m1Pipeline.js`, botón real en `RadarApp.jsx` |
| 7 | Radar 360 — feed "Live" automático del WS | 🟠 INCOMPLETO / STUB | `server.js:388-409`, marcado `_simulado:true` en el propio código |
| 8 | Formulador — Fase 1 (backend + Supabase RLS multi-tenant) | 🟢 OPERATIVO | `FormuladorRouter.js`, migraciones `001-005`, verificado end-to-end (§0) |
| 9 | Formulador — UI React (Módulo 10, Anexos, Logística, Dialéctica, Ficha) | 🔴 AUSENTE (solo stub visual) | `FrozenPage.jsx` reutilizado en 5 rutas |
| 10 | Radar — Panel, Directorio, Favoritos, Calendario | 🔴 AUSENTE (solo stub visual) | `FrozenPage.jsx` |
| 11 | Chat Claude (`/api/chat`, `/api/minimax/chat`) | 🟢 OPERATIVO | `server.js:95-162`, `MiniMaxChat.jsx` con auth real |
| 12 | OpenRouter (fallback IA) | 🟡 CONSTRUIDO EN STANDBY | Código real, cero consumidor en UI |
| 13 | Groq / Gemini | 🔴 AUSENTE de la app (solo uso de IDE externo, documentado como tal) | `.env:67-69`, 0 referencias en código |
| 14 | Comunicaciones por email (Brevo) | 🟡 CONSTRUIDO EN STANDBY | Código completo, `BREVO_API_KEY` vacía en `.env` |
| 15 | Conector GitHub | 🟢 OPERATIVO | `GitHubRouter.js`, `GITHUB_TOKEN` configurado |
| 16 | Integración Trello / MongoDB | 🔴 AUSENTE (eliminada deliberadamente) | commit `cf4be9f`, sin residuos de código |
| 17 | Panel `/admin` | 🔴 AUSENTE | sin ruta en `App.jsx`, sin componente |
| 18 | RBAC por rol (`admin`/`user`) | 🟠 INCOMPLETO | campo y check existen (`session-manager.js:47`), solo cubren revocar sesión |
| 19 | Perímetro Firestore (`audit_logs`) | 🟢 OPERATIVO (perímetro mínimo) | `firestore.rules` — lista blanca de 1 email, deny-by-default |
| 20 | Rate limiting de infraestructura (IP/WAF) | 🔴 AUSENTE | sin evidencia en ningún archivo |
| 21 | Cuota diaria por usuario (anti-abuso IA) | 🟢 OPERATIVO (alcance limitado) | `checkQuota()`, en memoria, no persistente |
| 22 | Validación de esquema de entrada (zod/joi) | 🔴 AUSENTE | sin dependencia en `package.json`, checks manuales |
| 23 | Sistema multiagente `agents/` (15 definiciones) | 🟠 INCOMPLETO / andamiaje de diseño, no runtime | sin imports desde `server.js`/`src/`, confirmado por grep |
| 24 | Orquestador central (`000_Orquestador.cjs`) | 🟡 CONSTRUIDO EN STANDBY (CLI manual, no proceso vivo) | sin proceso demonio, sin script en `package.json` |
| 25 | `bridge-server.cjs` (puerto 3001) | 🟡 CONSTRUIDO EN STANDBY | no referenciado por ningún script npm |
| 26 | Pipeline anti-alucinación (`Skill_Protocolo_Fuente_Unica`) | 🟢 OPERATIVO | usado dentro de `m1Pipeline.js` en cada resultado de Tavily |
| 27 | FinOps — logging crudo de tokens | 🟢 OPERATIVO (alcance limitado) | `AuditLogger.log` con `usage` de Claude |
| 28 | FinOps — dashboard/alertas de costo, Langfuse/Helicone | 🔴 AUSENTE | 0 referencias en el repo |
| 29 | Telemetría de errores/producto (Sentry/PostHog/GA) | 🔴 AUSENTE | 0 referencias en código ejecutable |
| 30 | Dashboard de salud de agentes (`estado_antigravity.json`) | 🟠 INCOMPLETO (cosmético + desactualizado) | lista carpetas eliminadas como activas, sin validar ejecución real (§5.3) |
| 31 | Monetización — pasarelas de pago | 🔴 AUSENTE | sin SDK, sin código, solo 2 env vars vacías |
| 32 | Monetización — esquema de suscripciones/planes | 🔴 AUSENTE | sin tablas en ningún esquema revisado |
| 33 | Backends paralelos (`backend_fastapi.py`, `server-sim.js`) | 🟠 INCOMPLETO / sin camino a producción | no referenciados por `render.yaml`; FastAPI con CORS abierto |
| 34 | Gate de build en despliegue (`scripts/db-check.js`) | 🟢 OPERATIVO | aborta el deploy en Render si Supabase no responde |
| 35 | Manejo de secretos — exclusión de git | 🟢 OPERATIVO | `.gitignore` + `git log` confirmando 0 commits históricos con `.env`/`serviceAccountKey.json`/`claves_privadas.txt` |
| 36 | Manejo de secretos — consistencia entre `.env` y `claves_privadas.txt` | 🟠 INCOMPLETO (riesgo) | credenciales divergentes para el mismo servicio, sin confirmación de rotación completa |

---

## Resumen ejecutivo

**Lo más sólido:** el perímetro de autenticación de backend (gate universal Firebase, fail-closed), el pipeline de IA del Radar (Claude+Tavily con anti-alucinación real), y el módulo Formulador (RLS multi-tenant verificado con prueba cruzada real) — son las tres piezas de este repositorio con evidencia de funcionamiento end-to-end, no solo de código escrito.

**Lo más urgente:** (1) sincronizar/rotar las credenciales divergentes entre `.env` y `claves_privadas.txt`, tratando como potencialmente expuesto todo lo que pudo existir antes del *squash* de historial de git; (2) el dashboard `estado_antigravity.json` miente por omisión (agentes eliminados reportados como activos) — o se corrige para validar ejecución real, o se etiqueta explícitamente como "inventario de carpetas", no "salud de agentes".

**Lo más sobredimensionado respecto a lo que hace:** la carpeta `agents/` (15 definiciones + orquestador + bridge-server) sugiere, por volumen, un sistema multiagente en producción; en la práctica el único pipeline agentic real y verificado es `m1Pipeline.js`. El resto es andamiaje de diseño/prompts para uso interactivo, válido como tal, pero no debe leerse como "sistema multiagente operando 24/7" — pese a que el propio `estado_antigravity.json` dice literalmente eso.

**Monetización:** no existe todavía en ninguna forma, ni siquiera parcial — es la dimensión con menor traza de las siete auditadas.
