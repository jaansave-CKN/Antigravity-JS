# RadFor-360 — Especificación de API

Complementa `00_documento_maestro_arquitectura.md`. Todos los endpoints reales de `server.js` y los routers montados, verificados en el código (no aspiracional). **Gate universal:** todo bajo `/api/*` exige `Authorization: Bearer <Firebase ID token>` **excepto** `/api/health`, `/api/convocatorias`, `/api/session/*` (whitelist explícita, `server.js:78`). **Rate limit:** 20 req/10s por `uid`/IP en todo `/api/*` (Oleada 0); cuota de 50/día por `uid` adicional en los 4 endpoints de IA.

---

## Sesión y salud

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/health` | Pública | — | `{status, services:{claude,openrouter,tavily,supabase,jwt}, cache, sessions}` |
| POST | `/api/session/login` | Pública | `{firebaseToken}` (zod) | `{token, sessionId, expiresIn, uid, email}` — canjea ID token de Firebase por JWT propio |
| POST | `/api/session/verify` | Pública | `{token}` (zod) | `{valid, payload}` |
| DELETE | `/api/session/:sessionId` | Bearer JWT propio | — | `{revoked}` — solo dueño o `role==='admin'` |

## IA — Chat directo

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| POST | `/api/chat` | Firebase | `{messages[], max_tokens?}` | Formato compatible OpenAI — proxy a Claude |
| GET | `/api/minimax/status` | Pública* | — | `{active, engine, model}` (*ruta no está en whitelist, requiere auth pese al nombre) |
| POST | `/api/minimax/chat` | Firebase | `{messages[], max_tokens?}` | Igual que `/api/chat` — mantenida por compatibilidad con `MiniMaxChat.jsx` |

## IA — Radar (`m1Pipeline.js`, montado en `/api/radar`)

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| GET | `/api/radar/status` | Firebase | — | `{pipeline, status, claudeReady, tavilyReady, cache}` |
| POST | `/api/radar/search` | Firebase | `{query, filters?, bypassCache?}` | `{oportunidades[], total, meta}` — Claude+Tavily, cache 24h |
| POST | `/api/radar/stream` | Firebase | `{query, filters?}` | SSE — eventos `start`/`tool_call`/`search_done`/`delta`/`done` |
| DELETE | `/api/radar/cache` | Firebase | — | `{cleared}` — invalida solo el cache en memoria |

## Radar — datos en vivo

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| GET | `/api/convocatorias` | Pública | Array de `radarData` (seed + actualizaciones del cron) |
| WS | `/ws/live_radar` | Ninguna (WS no pasa por el gate HTTP) | Eventos `INITIAL_DATA` / `NEW_FUND_DETECTED` / `STATUS_UPDATE` |

## OpenRouter (fallback de IA, sin consumidor en UI hoy)

| Método | Ruta | Auth | Body |
|---|---|---|---|
| GET | `/api/openrouter/models` | Firebase | — |
| POST | `/api/openrouter/chat` | Firebase | `{model, messages[], max_tokens?}` |
| GET | `/api/openrouter/status` | Firebase | — |

## Formulador (`FormuladorRouter.js`, montado en `/api/formulador`)

| Método | Ruta | Auth | Body | Respuesta |
|---|---|---|---|---|
| POST | `/api/formulador/fase1` | Firebase | `{ficha_fase1, modulo_7, modulo_8, modulo_9}` | `{ok, proyecto_id, estado_validacion, porcentaje_contrapartida}` — RPC `insertar_fase1` |
| GET | `/api/formulador/proyectos` | Firebase | — | `{proyectos:[{id,nombre,sector_codigo,departamento,municipio,status,created_at}]}` (Oleada 3) |
| GET | `/api/formulador/fase1/:id` | Firebase | — | `{proyecto, modulo_7, modulo_8, modulo_9}` |
| POST | `/api/formulador/ficha-tecnica` | Firebase | `{ficha:{metadata,geography,population,technical_core,attachments}}` (zod) | `{success, borrador, evaluation}` — corre `Orchestrator000` server-side (Oleada 1) |
| GET | `/api/formulador/:id/modulo10` | Firebase | — | `{proyecto_id, indicadores[]}` |
| POST | `/api/formulador/:id/modulo10` | Firebase | `{indicadores[]}` (zod) | `{proyecto_id, indicadores_guardados}` — reemplaza todas las filas |

## Comunicaciones

| Método | Ruta | Auth | Body |
|---|---|---|---|
| POST | `/api/communications/email` | Firebase | `{email, subject?, content}` (zod, email válido) — Brevo, `BREVO_API_KEY` configurada, `BREVO_SENDER_EMAIL` pendiente |

## Integraciones

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| GET | `/api/github/status` | Firebase | `{status, fullName, visibility, stars}` |
| GET | `/api/mcp` | Firebase | Configs MCP fusionadas desde disco |

## Utilidad

| Método | Ruta | Auth | Body |
|---|---|---|---|
| POST | `/api/execute` | Firebase | `{user, action}` (zod) — no-op, solo `AuditLogger.log` |

## Pendiente (Oleada 4, autorizada, no construida)

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/api/admin/finops` | Agregación de tokens por día/usuario desde `audit_logs` |
| — | Vista `audit_logs` en panel `/admin` | Lectura vía Firestore directa (sin endpoint propio necesario) |
