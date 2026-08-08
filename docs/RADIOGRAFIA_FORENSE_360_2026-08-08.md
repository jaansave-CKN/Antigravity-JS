# RADIOGRAFÍA FORENSE 360° — Antigravity OS / Radar Formulador 360
**Fecha de auditoría:** 2026-08-08
**Auditor:** Chief Software Auditor / DevSecOps Lead / System Architect (inspección en disco, no invasiva, servidor no ejecutado)
**Alcance:** proyecto raíz `c:\2026 AI EGIOC5\Antigravity JS` (servicio Render `radar-formulador-360`, `render.yaml:3`). Excluye `proyectos/`, `Repositorios/`, `EGIOC5/`, `ObsidianVault/`, `Radar_Resultados/` — proyectos hermanos con repositorio propio (`.gitignore:23-31`).
**Antecedentes directos:** `docs/RADIOGRAFIA_FORENSE_360_2026-08-06.md` → `docs/RADIOGRAFIA_FORENSE_360_2026-08-07.md` → `docs/INFORME_RECONCILIACION_CIERRE_2026-08-07.md` → `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`. Esta radiografía verifica de forma independiente, leyendo el código, `git log`/`git diff`/`git status` reales y `.env`/`claves_privadas.txt` reales, qué de lo que esos cuatro documentos declara está efectivamente en disco hoy — y qué no.

---

## 0. Hallazgo transversal — la "Operación Exterminio Final" está en disco, pero no en git; y el historial de git no es lo que los informes previos creían

**0.1 Todo lo que `INFORME_RECONCILIACION_CIERRE_2026-08-07.md` declara resuelto, verificado hoy línea por línea, está efectivamente en el working tree — pero como cambios sin commitear.** `git status` muestra `server.js`, `public/src/RadarApp.jsx`, `public/src/MiniMaxChat.jsx`, `src/modules/formulador/{supabaseClient.js,FormuladorPgController.js}`, `package.json`, `AGENTS.md`, `agents/000_Orquestador.cjs` y `.gitignore` como **modificados sin stage** sobre el último commit (`c6fbfab`, 2026-08-06 18:17). Confirmado con `git diff` completo: guardrail RLS real (`supabaseClient.js:11-21`, `assertValidTenant()`), eliminación del fallback silencioso a tenant compartido (`FormuladorPgController.js:26-32`, `DEFAULT_TENANT` retirado), gate de arquitectura real vía Claude (`agents/000_Orquestador.cjs:102-154`, `pedirVeredictoArquitecto()`), ping real de salud a Claude cacheado 120s (`server.js:472-497`), MiniMax reconectado a OpenRouter con el modelo real `minimax/minimax-m2.5` (`MiniMaxChat.jsx:5,45`), `pg` retirado de `package.json`. **Nada de esto está commiteado.** Es trabajo real y verificado, pero vive únicamente en el filesystem local — un `git checkout -- .` o la pérdida de esta máquina lo borraría por completo.

**0.2 El feed "Live" del WebSocket de Radar ya NO es simulado — hallazgo que revierte la conclusión más citada de la radiografía del 06/08.** `server.js:392-437` (`refreshRadarLive()`) ya no marca `_simulado:true`: ejecuta `m1Pipeline.js` real (Claude+Tavily) cada `RADAR_CRON_HOURS` (6h por defecto), compartido entre todos los clientes WS conectados, se omite sin costo si no hay clientes (`server.js:410-413`), y reutiliza el cache dual de 24h. Documentado como "Oleada 2" en `docs/ESTADO.md`. **Matiz importante:** si la llamada a Claude falla (ver §0.4), el `catch` de la línea 432-434 solo hace `console.error` — no hay alerta, así que un fallo silencioso puede pasar inadvertido.

**0.3 `public/estado_antigravity.json` ya no miente — se autocalifica correctamente.** Regenerado hoy a la 1:56 a.m., contiene explícitamente: *"Inventario de carpetas de agentes... NO implica un proceso en ejecución"*, y sus cifras (`agentes_definidos: 8`, `agentes_incompletos: 7`) coinciden con las 15 carpetas reales verificadas con `ls agents/`. Esto **resuelve** el hallazgo §5.3 de la radiografía del 06/08 (que documentaba carpetas eliminadas reportadas como activas).

**0.4 Sin verificar — saldo de la cuenta Anthropic.** `INFORME_RECONCILIACION_CIERRE_2026-08-07.md §1` reportó en vivo, ese mismo día, `400 credit balance too low` al invocar la API real de Claude — bloqueando `/api/chat`, el pipeline de Radar, el cron de Live (§0.2) y el propio gate de arquitectura (§0.1). Esta auditoría es de solo lectura y no arrancó el servidor ni llamó a la API para no incurrir en costo ni alterar estado — **no hay evidencia en disco (logs, commits, notas) de que el saldo se haya recargado.** `logs/audit.log` sigue conteniendo una única línea de 2026-08-06, sin tráfico nuevo registrado. Tratar como **no resuelto hasta verificación en vivo.**

**0.5 Hallazgo nuevo de mayor severidad estructural — el historial local y el remoto (`origin/master`, GitHub) son árboles genealógicamente no relacionados, y el repositorio es público.**
- `git log --oneline --all`: local `master` = `c6fbfab → cf4be9f → 0aef777` (3 commits). `origin/master` = `fbc3c1a → 886894e` (2 commits, distintos).
- `git merge-base master origin/master` → **sin salida, exit code 1: no existe ancestro común.** No es un `squash`/reinicio de la misma línea (como asumían las dos radiografías previas al decir *"indica un squash... rama limpia"*) — es un historial completamente disjunto. En algún momento se reescribió `master` local desde cero (probablemente `git checkout --orphan` o reinit + primer push con `--force`) sin que el remoto se haya actualizado a esa nueva línea, o viceversa.
- Verificado con `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/jaansave-CKN/Antigravity-JS` → **`200`: el repositorio es público**, accesible sin autenticación.
- Inspeccionado el contenido real de los 2 commits huérfanos en `origin/master`: `fbc3c1a` (mensaje propio: *"test_auth.html: Soldado con llaves reales"*) expone en texto plano `public/firebase-config.js` y `public/test_auth.html` una `apiKey` de Firebase (`AIzaSyBdaIbBKlPn1yTxB2g7zuycPk-B1WF9TPk`). **Matiz de severidad real:** una API key *web* de Firebase está diseñada por Google para ser pública (se restringe por dominio/App Check, no por secreto) — no es una fuga crítica per se, pero **no es lo que las radiografías previas afirmaban** ("nunca ha estado en el historial de git" es cierto solo para `.env`/`serviceAccountKey.json`/`claves_privadas.txt`, verificado ahora con `git log --all --diff-filter=A` sobre esos 3 patrones en **todos** los refs → 0 resultados, eso sí se sostiene).
- **Consecuencia práctica:** cualquier intento futuro de sincronizar `git push`/`git pull` entre este local y `origin` fallará o requerirá `--force` (con el riesgo real de sobreescribir uno de los dos historiales). Antes de tocar el remoto, se necesita una decisión explícita del usuario sobre cuál historial es la fuente de verdad.

---

## 1. Topografía de arquitectura y patrón de diseño

### 1.1 Stack real (evidencia: `package.json`, imports en `server.js`, verificado hoy)

| Capa | Tecnología real | Evidencia |
|---|---|---|
| Frontend | React 18.3 + React Router 7 + Vite 5 + Tailwind 4, sin TypeScript | `package.json` |
| Backend | Node.js + Express 4, ESM puro, proceso único | `server.js` (456+ líneas) |
| Backends paralelos | **Confirmado eliminados del disco** — `backend_fastapi.py` y `server-sim.js` ya no existen (`ls` → "No such file or directory"); retirados junto con sus scripts npm (`fastapi`/`server`/`sim`/`start:full`/`start:sim`), según `docs/ESTADO.md` "Oleada 6" | verificado en disco hoy |
| Base de datos | Supabase PostgreSQL vía REST/PostgREST, `pg` **retirado de `package.json`** (cambio sin commitear, ver §0.1) | `supabaseClient.js`, `render.yaml:21-23` |
| Cache/Sesiones | Upstash Redis (REST) con fallback a `Map` en memoria | `cache.js`, `.env:21-22` (credenciales reales) |
| Auth | Firebase Authentication (Google Sign-In) + JWT propio | `FirebaseAdmin.js`, `session-manager.js` |
| IA principal | Claude/Anthropic (`claude-sonnet-4-6`), saldo de cuenta sin verificar hoy (§0.4) | `server.js:29` |
| IA fallback | OpenRouter — ahora con consumidor real (`MiniMaxChat.jsx`, modelo `minimax/minimax-m2.5`) | `server.js`, `MiniMaxChat.jsx:5` |
| Búsqueda | Tavily Search API (tool-use nativo de Claude) | `m1Pipeline.js` |
| Realtime | WebSocket nativo, feed real desde hoy (§0.2) | `server.js:375-437` |
| Validación de entrada | **Nuevo respecto al 06/08:** `zod` (`package.json:42`) real, wired en `server.js`, `CommunicationRouter.js`, `FormuladorRouter.js` (`validation.js`) | verificado con grep, 3 importadores confirmados |

### 1.2 Patrón arquitectónico

Sigue siendo **monolito modular pragmático**, no Hexagonal/DDD estricto — y esto ya no es una afirmación en disputa: `AGENTS.md:36-37` fue corregido hoy/ayer para decirlo explícitamente (*"Hexagonal solo aplica en `src/modules/communications/`... No es DDD ni Hexagonal en el resto del sistema — esa afirmación previa era aspiracional"*), retirando además el rol ficticio `001_ARQUITECTO_CORE` que nunca tuvo implementación (`AGENTS.md:19`, `agents/000_Orquestador.cjs:66-71`). `server.js` sigue siendo el composition root único, sin contenedor de DI.

### 1.3 Manejo de estado y SPOF

Sin cambios respecto al 07/08: `radarData` en memoria (ahora alimentado por datos reales del cron, §0.2, pero el array sigue sin persistir un restart), sesiones y cache en Upstash (persistente), `checkQuota`/`burstLimiter` en memoria (por diseño). SPOF: un solo proceso Node en Render `plan: free` (`render.yaml:8`), sin réplica.

---

## 2. Inventario de MVP y funcionalidades (real vs. stub)

### 2.1 Rutas del frontend (`public/src/App.jsx`, completo, sin cambios de rutas desde 07/08)

| Ruta | Módulo | Estado | Evidencia |
|---|---|---|---|
| `/inicio` | Login | 🟢 Real | `InicioPage.jsx` |
| `/radar` | A | 🟢 Real | `RadarApp.jsx` — REST + WS real + búsqueda IA on-demand |
| `/panel`, `/directorio`, `/favoritos`, `/calendario` | A | 🔴 Stub puro | `FrozenPage.jsx`, `App.jsx:22-25` |
| `fase1-entrada.html` (externa) | B | 🟢 Real | HTML standalone, POST real a `/api/formulador/fase1` |
| `/modulo10` | B | 🟢 Real | `Modulo10Page.jsx` — CRUD completo contra Supabase, único módulo B ya migrado al SPA |
| `/anexos`, `/logistica`, `/dialetica`, `/ficha` | B | 🔴 Stub puro | `FrozenPage.jsx`, `App.jsx:29-32` — motor de `/ficha` es real en `orchestrator-engine.js` pero sin pantalla propia |

### 2.2 El feed "Live" del Radar — de simulado a real (§0.2)

Cambio de estado más significativo de esta radiografía respecto a las dos anteriores: lo que ambas clasificaron como 🟠 *"mitad real, mitad simulado"* / *"stub declarado"* pasa hoy a 🟢 operativo en código, condicionado únicamente al saldo de Anthropic (§0.4) y con manejo de error silencioso (`server.js:432-434`, solo `console.error`) como pendiente real.

### 2.3 `MiniMaxChat.jsx` — ya no es un alias de Claude

Confirmado por `git diff`: apunta a `/api/openrouter/chat` con `model: 'minimax/minimax-m2.5'` (`MiniMaxChat.jsx:5,45`), modelo verificado como real contra la lista pública de OpenRouter según `INFORME_RECONCILIACION_CIERRE_2026-08-07.md §2`. El bug de `checkStatus()` sin token (que mostraba "Offline" aunque el motor funcionara) está corregido (`MiniMaxChat.jsx:17-20`, adjunta `Authorization: Bearer`).

---

## 3. Módulo de administración y seguridad (RBAC y perímetro)

### 3.1 Panel `/admin` — sigue sin existir

`App.jsx` no tiene ninguna ruta `/admin`; `docs/ESTADO.md` lo mantiene en "Oleada 4 — Panel `/admin` mínimo viable", sus 3 checkboxes (`requireAdmin`, vista `audit_logs`, `GET /api/admin/finops`) siguen sin marcar.

### 3.2 RBAC — sin cambios desde el 07/08

`session-manager.js:47` sigue siendo el único punto del repo que lee `role === 'admin'` (dentro de `revokeSession`). Ningún endpoint de negocio diferencia por rol. `Sidebar.jsx` no condiciona nada por `user.role`.

### 3.3 Perímetro de autenticación — intacto y correcto

`PUBLIC_API_PREFIXES = ['/api/health', '/api/convocatorias', '/api/session']` (`server.js:79`), gate `verifyFirebaseAuth` fail-closed sobre todo lo demás bajo `/api/*` (`server.js:80-88`), `burstLimiter` aplicado después (`server.js:90`). Sin cambios ni regresiones.

### 3.4 Validación de entrada — mejora confirmada desde el 06/08

La radiografía del 06/08 reportó *"sin librería de esquemas en ningún punto del árbol"*. **Ya no es así**: `zod` está instalado (`package.json:42`) y `validateBody`/`schemas` de `src/shared/infrastructure/validation.js` se importan en `server.js:22`, `CommunicationRouter.js:2` y `FormuladorRouter.js:6`. Esto fue introducido en el commit `c6fbfab` (2026-08-06), ya reflejado por la radiografía del 07/08 pero corregido aquí explícitamente contra el hallazgo original del 06/08.

### 3.5 Aislamiento multi-tenant — guardrail duro agregado (sin commitear, ver §0.1)

`supabaseClient.js:11-21` (`assertValidTenant()`) aborta en Node, antes de tocar Postgres, cualquier `rpc()` cuyo `p_tenant_id` sea nulo o no tenga forma de UUID (`supabaseClient.js:102`, se invoca en cada llamada a `rpc()` que reciba ese parámetro). `FormuladorPgController.js:26-32` eliminó el fallback silencioso a un tenant compartido (`DEFAULT_TENANT`) — sin `req.user.uid` ni header `x-tenant-id` válido, la petición ahora se rechaza (400) en vez de escribir en un tenant genérico. El aislamiento real sigue siendo el filtro `WHERE tenant_id` dentro de cada función RPC (RLS-por-rol sigue inactivo, degrada a `SERVICE_KEY`, sin cambios ahí), pero ahora hay una segunda capa de defensa en el código Node, no solo en Postgres.

### 3.6 Manejo de secretos — cuadro actualizado con evidencia de hoy

Comparación campo por campo entre `.env` (raíz) y `claves_privadas.txt` (raíz, gitignorado), leídos completos hoy:

| Credencial | `.env` | `claves_privadas.txt` | Estado |
|---|---|---|---|
| Upstash Redis (URL+token) | presente | presente, idéntico | ✅ sincronizado |
| `GITHUB_TOKEN` | `github_pat_11CBJK...` | `github_pat_11CBJK...` (línea 13) | ✅ sincronizado (divergencia previa ya resuelta) |
| `BREVO_API_KEY` | `xkeysib-66f5c9...` | idéntico (línea 19) | ✅ sincronizado; `BREVO_SENDER_EMAIL` sigue vacío — el envío real sigue bloqueado en runtime |
| `STITCH_API_KEY` | `AQ.Ab8RN6IOvk...` | idéntico (línea 38) | ✅ sincronizado, **pero** el archivo tiene 2 claves Google/Stitch adicionales sin usar en `.env` ni en el código: línea 34 (`AQ.Ab8RN6JKiJ...`, bajo "LA TRIADA") y línea 44 (`AQ.Ab8RN6JASlIV...`, dentro de un bloque JSON de config) — 2 claves huérfanas, revocación no confirmada |
| `SUPABASE_SERVICE_KEY` | `sb_secret_hfKCjoz2...` | idéntico (línea 58, "llaves secretas") | ✅ sincronizado — es la clave activa real |
| `SUPABASE_SERVICE_KEY` huérfana | — (no está en `.env`) | `sb_secret_ulPO9UO1...` (línea 7, "Secret keys DATABASE") | 🔴 **sin resolver desde el 07/08** — `INFORME_RECONCILIACION_CIERRE_2026-08-07.md §3 fila 4` ya la marcó pendiente de revocación manual en el dashboard de Supabase; sigue presente sin cambios |
| Supabase `service_role` (JWT legacy) | — (no existe este formato en `.env`, que usa el nuevo formato `sb_secret_`) | JWT completo sin redactar (línea 67) | 🟠 **hallazgo nuevo**: formato JWT antiguo de Supabase (pre-migración al esquema `sb_secret_`/`sb_publishable_`) con privilegio `service_role` (bypass total de RLS) — no hay evidencia en disco de que se haya revocado tras la migración de formato de claves |
| Supabase — token de gestión de cuenta | — | `sbp_9ebdf8f601a0...` (línea 70) | 🟠 privilegio de administración de **toda la cuenta** Supabase (no solo este proyecto), sin consumidor en el código, sin confirmación de revocación |
| `RENDER_API_KEY` | `rnd_8J93C4rAqZ...` | `rnd_qbcHC17Itq...` (línea 76) | 🟠 **sigue divergente** — dos tokens de Render distintos, ninguno confirmado revocado |
| Hostinger (2 cuentas) | — | usuario+contraseña en texto plano (líneas 23-28) | 🟠 sin ningún consumidor en el código de este proyecto — credenciales huérfanas de otro servicio, sentadas en un archivo del repo local |
| GitLab | — | contraseña real + 3 tokens (`glft-`, `glimt-`, `glpat-`, líneas 82-86) | 🟠 mismo patrón — password en texto plano sin relación con el stack actual |
| `STRIPE_SECRET_KEY` | **eliminada por completo** (ya no aparece ni vacía) | — | ✅ limpieza confirmada, consistente con `INFORME_RECONCILIACION_CIERRE_2026-08-07.md` |

**Mitigante que se sostiene:** `.env`, `config/serviceAccountKey.json` y `claves_privadas.txt` nunca aparecen en ningún commit de ningún ref (`git log --all --diff-filter=A` sobre los 3 patrones → 0 resultados) — verificado hoy contra la historia completa, incluida la rama huérfana de `origin/master` (§0.5).

---

## 4. Sistema multiagente, LLMs y FinOps

### 4.1 Cuatro sistemas de definición de agentes coexisten — ya documentado hoy en detalle

`docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` (generado hoy, 2026-08-08, y leído completo para esta radiografía) ya mapea con precisión lo que las radiografías del 06/08 y 07/08 solo mencionaban de pasada: **4 árboles de definición de agentes** — `agents/` (Sistema A, 15 agentes de negocio propios), `.agent/` (Sistema B, 21 agentes/36 skills genéricos de un scaffold de terceros, **sin ninguna relación con el dominio del producto**), `.claude/agents/` (Sistema C, 1 subagente real — `architect.md`, el único con ejecución productiva verificada) y `opencode.json` (Sistema E, config de una herramienta de IDE personal). Cita textual del propio repositorio (`skills/ag_skills_registry.json:5`): *"4 sistemas de agentes coexisten... solo A es ejecutado por este registro"*.

**Confirmado independientemente por esta auditoría:** `grep -rn "from '.*agents/"` y `require(.*agents/` sobre `server.js` y todo `src/`/`public/src/` → **0 resultados**. `agents/` (Sistema A) sigue sin ser importado por el runtime de negocio, exactamente como en las dos radiografías anteriores.

### 4.2 El gate de arquitectura ya no se autofirma — cambio real, sin commitear (§0.1)

`agents/000_Orquestador.cjs --aprobar-diseno` ya no escribe `diseno_aprobado.json` incondicionalmente. Ahora invoca `.claude/agents/architect.md` como system prompt vía API real de Anthropic (`pedirVeredictoArquitecto()`, `agents/000_Orquestador.cjs:102-154`), le pasa el `git diff HEAD` pendiente, y solo firma si el veredicto JSON devuelto es `aprobado:true`. Es el único mecanismo de todo el ecosistema de agentes con ejecución productiva verificada (`docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §1.3`) — pero depende del mismo `ANTHROPIC_API_KEY` cuyo saldo no está confirmado hoy (§0.4), así que en la práctica puede estar tan bloqueado como el resto del sistema de IA.

### 4.3 FinOps — sin cambios

Sigue sin existir agregación, alertas de costo o integración con Langfuse/Helicone. `checkQuota()` sigue siendo el único control real (50/uid/día, en memoria). `AuditLogger.log` sigue registrando `usage` por evento individual en `logs/audit.log` + Firestore — el archivo local sigue con una sola línea desde el 06/08, sin tráfico de producción nuevo registrado.

---

## 5. Telemetría, monitorización y modos standby

### 5.1 Observabilidad de terceros — sin cambios

Sigue sin Sentry/PostHog/GA en código ejecutable. Solo `console.*` + `AuditLogger`.

### 5.2 `estado_antigravity.json` — de "miente por omisión" a autohonesto (§0.3)

Resuelto: el archivo generado hoy declara explícitamente su propia limitación ("inventario de carpetas, no salud de agentes") y sus cifras coinciden con el disco real.

### 5.3 Variables de entorno vacías — cambios puntuales

`STRIPE_SECRET_KEY` fue **eliminada** de `.env` (antes solo estaba vacía). `INNGEST_EVENT_KEY`, `MCP_API_KEY`, `RESEND_API_KEY` siguen vacías, sin consumidor. `DATABASE_URL` sigue vacía (Supabase vía REST la reemplaza).

---

## 6. Monetización, pasarelas y modelo de negocio

**Sin cambios: sigue prácticamente ausente.** `package.json` no tiene ningún SDK de pagos (grep de `stripe|wompi|bold|mercadopago|inngest|sentry|posthog|langfuse|helicone` sobre `package.json` → 0 resultados). La nueva migración `006_modulo10_y_listado.sql` (agregada el 06/08 para Módulo 10) solo crea `formulador_indicadores` — ningún campo de facturación, moneda de plataforma ni suscripción. `INNGEST_EVENT_KEY` sigue siendo la única variable bajo el comentario `# --- MONETIZACIÓN ---` en `.env:44`, vacía y sin código que la lea. `docs/ESTADO.md` reconfirma la postergación como decisión explícita del usuario ("Oleada 5 — Pospuestas por decisión explícita del usuario (2026-08-06)").

---

## 7. Matriz de diagnóstico definitiva (snapshot 2026-08-08)

| # | Módulo / Subsistema | Estado | Evidencia clave | vs. informe anterior |
|---|---|---|---|---|
| 1 | Perímetro auth (`verifyFirebaseAuth`, fail-closed) | 🟢 OPERATIVO | `server.js:79-90` | Sin cambio |
| 2 | Login SPA (Firebase Google Sign-In) | 🟢 OPERATIVO | `InicioPage.jsx` | Sin cambio |
| 3 | Sesión JWT propia + revocación | 🟢 OPERATIVO | `session-manager.js` | Sin cambio |
| 4 | Cache/sesiones Upstash Redis | 🟢 OPERATIVO | `.env:21-22` | Sin cambio |
| 5 | Validación de esquema (zod) | 🟢 OPERATIVO | `validation.js`, 3 importadores | **Mejora vs. 06/08** (antes 🔴 ausente) |
| 6 | Radar — REST+WS+búsqueda IA on-demand | 🟢 OPERATIVO (código) | `RadarApp.jsx`, `m1Pipeline.js` | Sin cambio; bloqueo real por saldo Anthropic sin verificar hoy (§0.4) |
| 7 | Radar — feed "Live" automático | 🟢 OPERATIVO (código) | `server.js:392-437` | **Mejora vs. ambos informes previos** (antes 🟠 simulado) |
| 8 | Formulador Fase 1 (RLS multi-tenant) | 🟢 OPERATIVO | `FormuladorRouter.js`, migraciones 001-006 | Sin cambio |
| 9 | Guardrail RLS duro en Node (`assertValidTenant`) | 🟢 OPERATIVO | `supabaseClient.js:11-21` | **Nuevo, sin commitear** (§0.1/§3.5) |
| 10 | Módulo 10 (Indicadores, SPA React) | 🟢 OPERATIVO | `Modulo10Page.jsx` | Sin cambio (ya reportado 07/08) |
| 11 | `/ficha`, Anexos, Logística, Dialéctica (SPA) | 🔴 AUSENTE (stub) | `FrozenPage.jsx` | Sin cambio |
| 12 | Panel/Directorio/Favoritos/Calendario (Radar) | 🔴 AUSENTE (stub) | `FrozenPage.jsx` | Sin cambio |
| 13 | MiniMax vía OpenRouter | 🟢 OPERATIVO | `MiniMaxChat.jsx:5,45` | **Mejora vs. 06/08** (antes alias de Claude); ya reportado 07/08 |
| 14 | Comunicaciones email (Brevo) | 🟡 STANDBY | `BREVO_SENDER_EMAIL` vacío | Sin cambio |
| 15 | Conector GitHub | 🟢 OPERATIVO | `.env:58`, token sincronizado | Sin cambio |
| 16 | Groq/Gemini | 🟡 STANDBY (uso IDE externo) | `.env:77-78`, 0 imports | Sin cambio |
| 17 | Panel `/admin` | 🔴 AUSENTE | sin ruta en `App.jsx` | Sin cambio |
| 18 | RBAC granular (`requireAdmin`) | 🔴 AUSENTE | solo `revokeSession` lee `role` | Sin cambio |
| 19 | Gate de arquitectura (`000_Orquestador.cjs`) | 🟢 OPERATIVO (real) | `agents/000_Orquestador.cjs:102-154` | **Mejora vs. ambos informes previos** (antes autofirmado); sin commitear |
| 20 | Sistema multiagente `agents/` como runtime de negocio | 🔴 AUSENTE (por diseño) | grep 0 resultados en `server.js`/`src/` | Sin cambio, confirmado independientemente |
| 21 | Scaffold genérico `.agent/` (Sistema B) | 🟡 STANDBY (nunca ejecutado) | `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §1.2` | Documentado hoy con detalle nuevo |
| 22 | Dashboard `estado_antigravity.json` | 🟢 OPERATIVO (honesto) | regenerado hoy, cifras exactas | **Mejora vs. 06/08** (antes mentía por omisión) |
| 23 | FinOps — captura de tokens | 🟢 OPERATIVO (alcance limitado) | `AuditLogger` | Sin cambio |
| 24 | FinOps — agregación/alertas | 🔴 AUSENTE | 0 referencias | Sin cambio |
| 25 | Telemetría producto (Sentry/PostHog/GA) | 🔴 AUSENTE | 0 referencias | Sin cambio |
| 26 | Monetización (pasarelas/suscripciones) | 🔴 AUSENTE | sin SDK, sin esquema | Sin cambio; `STRIPE_SECRET_KEY` ahora eliminada de `.env` |
| 27 | Backends paralelos (FastAPI/sim) | ✅ RESUELTO | archivos confirmados ausentes en disco | **Cerrado** desde 06/08 |
| 28 | Dependencia muerta `pg` | ✅ RESUELTO (sin commitear) | retirada de `package.json` | Cerrado en disco, pendiente commit |
| 29 | Saldo cuenta Anthropic | 🔴 **NO VERIFICADO HOY** | sin re-chequeo en vivo (auditoría de solo lectura) | Persistía crítico el 07/08; estado real de hoy desconocido |
| 30 | `SUPABASE_SERVICE_KEY` huérfana sin revocar | 🟠 INCOMPLETO (riesgo) | `claves_privadas.txt:7` | Sin cambio desde 07/08 |
| 31 | Secreto legacy `service_role` (JWT) + token de cuenta Supabase huérfanos | 🟠 INCOMPLETO (riesgo) | `claves_privadas.txt:67,70` | **Hallazgo nuevo de hoy** |
| 32 | `RENDER_API_KEY` divergente `.env` vs. `claves_privadas.txt` | 🟠 INCOMPLETO (riesgo) | `.env:63` vs. `claves_privadas.txt:76` | Sin cambio |
| 33 | Credenciales huérfanas ajenas al stack (Hostinger, GitLab) | 🟠 INCOMPLETO (riesgo) | `claves_privadas.txt:23-28,82-86` | **Hallazgo nuevo de hoy** |
| 34 | Integridad de historial git (`master` vs. `origin/master`) | 🔴 **CRÍTICO — hallazgo nuevo** | `git merge-base` sin ancestro común; repo público (`api.github.com` → 200) | Revierte la lectura "squash limpio" de los 2 informes previos |
| 35 | Secretos reales (.env/serviceAccountKey/claves_privadas) en algún commit de algún ref | ✅ Confirmado 0 en todos los refs | `git log --all --diff-filter=A` | Se sostiene, ahora verificado también contra la rama huérfana remota |
| 36 | Trabajo de remediación 06-07/08 sin commitear | 🟠 **RIESGO OPERATIVO** | `git status` — 8 archivos modificados sin stage | **Hallazgo nuevo de hoy** — todo lo listado como "resuelto" en filas 5, 7, 9, 13, 19, 28 vive solo en disco local |

---

## Resumen ejecutivo

**Lo que mejoró de verdad desde el 06/08, verificado en código y no solo en documentación:** validación de esquema real (zod), guardrail RLS en Node, gate de arquitectura que ya no se autofirma, feed "Live" del Radar corriendo sobre IA real en vez de aleatoriedad simulada, MiniMax reconectado a un motor real distinto de Claude, dashboard de agentes que ya no miente, y dos backends paralelos muertos (FastAPI/sim) físicamente eliminados. Es una jornada de remediación genuina, no cosmética.

**Lo más urgente, en orden:**
1. **Commitear el trabajo pendiente** (§0.1/§36) — ocho archivos con cambios reales y verificados llevan horas solo en el filesystem local, sin red de seguridad de git.
2. **Resolver la relación con `origin/master`** (§0.5/§34) antes de cualquier push/pull — son históricos sin ancestro común; decidir cuál es la fuente de verdad y ejecutar la sincronización deliberadamente, no por accidente con un `git push` normal.
3. **Verificar en vivo el saldo de Anthropic** (§0.4/§29) — sin esto, no se sabe si `/api/chat`, Radar, el feed Live y el propio gate de arquitectura funcionan hoy o están todos bloqueados igual que el 07/08.
4. **Rotar/revocar las credenciales huérfanas** acumuladas en `claves_privadas.txt`: la `SUPABASE_SERVICE_KEY` vieja, el JWT legacy `service_role`, el token de gestión de cuenta Supabase, el `RENDER_API_KEY` divergente, y limpiar las credenciales de Hostinger/GitLab que no pertenecen a este stack.

**Lo que sigue exactamente igual que hace dos días, por decisión explícita, no por descuido:** panel `/admin`, RBAC granular, FinOps agregado, telemetría de producto y monetización — las cinco áreas que `docs/ESTADO.md` declara pospuestas a propósito.

---

*Radiografía generada por inspección directa de archivos reales, `git log`/`git diff`/`git status` en vivo, y verificación cruzada de `.env` contra `claves_privadas.txt` — cada hallazgo cita ruta y, cuando aplica, número de línea.*
