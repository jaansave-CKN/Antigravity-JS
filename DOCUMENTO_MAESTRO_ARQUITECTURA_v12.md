# Documento Maestro de Arquitectura — RadarFondos 360 v12

**ASFALTICA S.A.S.** · Reemplaza la versión 11.0 · Verificado directamente contra el código real mediante 4 auditorías paralelas con acceso de lectura al repo (grep + lectura de archivo completo + verificación en vivo con servidor levantado), no contra la prosa de v11.

**Estado:** en operación, verificado 2026-08-06. **Base de datos:** PostgreSQL / Supabase (pgvector). **Despliegue:** un solo servicio Render (Node/Express), no Railway+Render.

**Protocolo aplicado:** el propio `CLAUDE.md` de este repo exige evidencia citada (archivo:línea o comando ejecutado) para cualquier afirmación de auditoría — nace de un incidente real donde una auditoría externa y una sesión previa de Claude en este mismo proyecto heredaron hallazgos falsos sin re-verificar. Este documento sigue esa regla sin excepción, incluida la auto-corrección de un hallazgo propio (ver §01, HNSW).

---

## 00 · Resumen ejecutivo

RadarFondos 360 es una plataforma SaaS de dos pilares — **Radar** (rastreo de convocatorias de financiación) y **Formulador** (estructuración de proyectos con IA, metodología MGA/DNP) — con un pipeline de auditoría financiera en Pesos Colombianos (4 motores) construido, probado y verificado sin fabricación de cifras. Esta versión corrige la topología de despliegue de v11 (un solo servicio, no dos), documenta con precisión los 6 agentes de IA (varios detalles de v11 estaban desactualizados o eran incorrectos), y cierra 3 endpoints backend que existían sin consumidor de frontend — ver §13.

| Capa | Tecnología real |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, dev en puerto 5173 |
| Backend | Node.js/Express, monolito `server.js`, puerto `process.env.PORT` (fallback código 3000; `.env`/`.env.example` fijan 8000 en dev) |
| Base de datos | PostgreSQL (Supabase) — pgvector con **dos estrategias de índice coexistiendo** (ver §01) |
| Autenticación | JWT propio (HS256, pbkdf2 100k/sha512) — sin fallback Supabase Auth real (código muerto eliminado, ver §10) |
| Almacenamiento | Supabase Storage |
| Despliegue | **Un solo servicio Render**, `render.yaml` → `node server.js` sirve API + estático del frontend build |

---

## 01 · Fe de erratas — qué cambió respecto a la v11.0

| Afirmación en v11.0 | Estado real verificado (2026-08-06) |
|---|---|
| "Despliegue: Railway (backend) + Render (frontend)" | **Falso.** `render.yaml` define un único servicio Node; ningún paso de CI (`.github/workflows/radar.yml`) toca Railway. `railway.json` y `Dockerfile.backend`/`Dockerfile.frontend` eran archivos huérfanos — **eliminados hoy** (Operación Bisturí, §13). `Dockerfile.backend` además arrancaba `uvicorn backend.server_fastapi:app`, un archivo Python que solo existe en `archive/python_legacy/` — nunca coincidió con el backend real (Express). |
| "pgvector con índices HNSW" | **Incompleto, no falso.** Existen **dos columnas vector(768) con estrategias de índice distintas**: `backend/migrations/001_postgres_schema.sql` crea índices **IVFFlat** sobre la columna `embedding`; `server.js:707-717` crea en el bootstrap del servidor índices **HNSW** (`CREATE INDEX ... USING hnsw(...)`) sobre una columna nativa más nueva, `embedding_vec`, con backfill automático desde `embedding`. **Autocorrección del propio proceso de auditoría de hoy:** un primer sub-agente reportó "HNSW ausente, 0 resultados en grep" — bastó levantar el servidor real y leer el log de arranque (`[DB] pgvector: columnas vector(768) e índices HNSW listos`) para encontrar el `CREATE INDEX ... USING hnsw` real en `server.js:712-713`, que el grep anterior no había cubierto. Ninguna versión de este documento debe volver a colapsar esto a una sola respuesta sin releer ambos archivos. |
| "`auth.middleware.js` valida primero Supabase Auth, cae a JWT local" | **Falso.** Ese archivo no existía; la lógica vivía inline en `server.js` (~149-196). `validateSupabaseToken()` (`backend/config/supabase.config.js`) tenía cero invocaciones reales — no había fallback Supabase, solo JWT propio. **Corregido hoy:** `authenticateToken` extraído a `backend/middlewares/auth.middleware.js` real; `validateSupabaseToken()` eliminada (código muerto confirmado, no solo declarado). |
| Ruta de aprobación manual `/admin/usuarios-pendientes` | **Imprecisa.** La ruta real es `/api/admin/usuarios/pendientes` (`server.js`, backend) — el frontend consume esa ruta vía `AdminUsuariosPendientesPage`, montada en `/admin/usuarios-pendientes` (ruta de **frontend**, no del endpoint). v11 no distinguía las dos. |
| "RLS habilitada en 31 tablas públicas" | **Impreciso.** 43 statements `ENABLE ROW LEVEL SECURITY` en las migraciones versionadas cubren **35 tablas únicas**, no 31. |
| Componente `PlanGate` | **Ubicación incorrecta, no ausente.** Sí existe y sí gatea `/checklist`, `/entrada`, `/anexos`, `/logistica`, `/contexto`, `/arbol-objetivos`, `/exportacion`, `/compliance`, `/dialectica`, `/viabilidad`, `/ficha`, `/presupuesto` (`require="formulador"`) — pero está definido **inline dentro de `client/src/main.tsx:213`**, no como archivo propio `PlanGate.tsx`. El gate de datos de suscripción (hooks `hasRadar`/`hasFormulador`) viene de `SubscriptionContext.tsx` (`useSubscription`), que `PlanGate` consume internamente. |
| Veredictos de `viabilidadAgent.js`: "VIABLE / VIABLE_CON_OBSERVACIONES / NO_VIABLE / RECHAZADO_INCOHERENCIA" | **Falso.** El enum real (`viabilidadAgent.js:71`) es `['APROBADO_TECNICAMENTE','OBSERVACION_CRITICA','RECHAZADO_INCOHERENCIA']` — 3 valores, no 4, y con nombres distintos. |
| `embeddingsService.js` usa `text-embedding-004` | **Falso.** Ese modelo devuelve 404 desde Google — el propio código (líneas 5-18) documenta el reemplazo por `gemini-embedding-001`. Además, a diferencia de los otros 5 agentes de IA, **no tiene fallback heurístico** (lanza `EMBEDDINGS_ERROR` si falla) y **no está en la lista de consumidores de `geminiCircuitBreaker.js`** — el patrón "los 6 agentes comparten resiliencia" de v11 no aplica a este. |
| "Los 6 agentes... nunca lanzan una excepción" | **Falso para 2 de 6.** `arbolObjetivosAgent.js:115` lanza excepción real si Gemini falla por error no-cuota (no degrada siempre). `embeddingsService.js` tampoco degrada (ver arriba). |
| Backend usa `gemini-2.0-flash` en `arbolObjetivosAgent.js` | **Falso.** Usa `gemini-1.5-flash` (línea 63). `viabilidadAgent.js` sí usa `gemini-2.0-flash` (verificado, ese dato de v11 era correcto). |
| Radar sin Perplexity/Tavily | **Cierto para el backend, con una excepción de marketing no documentada.** `client/src/pages/ControlPanel.tsx:647` (ruta `/settings`) muestra el texto **"BÚSQUEDA EN TIEMPO REAL · MOTOR PERPLEXITY AI"** como supuesta capacidad del plan Enterprise — no existe ningún backend que la respalde. Es un texto de UI que afirma una integración inexistente, contradiciendo el mismo principio de "no fabricar" que v11 predicaba para el pipeline financiero. **No corregido en esta ronda** (fuera del alcance de Sinaosis/Bisturí) — queda como hallazgo abierto. |
| Cron Radar 02:00/02:30/03:00 COT | **Confirmado exacto**, más una 4ª tarea no documentada por v11: `01:45` COT, expira convocatorias vencidas (`CronScheduler.js:141`), previa a los dos rastreos. |
| Brevo "configurado parcialmente" | **Cierto en dev, falso en producción.** `.env` local tiene `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` reales; `.env.production` tiene placeholders `CONFIGURAR_EN_RENDER_DASHBOARD` sin completar. `.env.example` marca Brevo como legacy, reemplazado por Resend — que tampoco está configurado en ningún entorno. |
| SMMLV 2026 = $1.750.905 COP (Decretos 1469/1470) | **Confirmado exacto**, hardcodeado una sola vez (`ValorExponencialService.js:22`), reusado en el resto del pipeline financiero sin re-declararse — sin violaciones del principio "ningún motor fabrica una cifra" en los 4 motores. |
| `SIA_Radar/` usa Tavily | Cierto pero irrelevante — esa carpeta está en `.gitignore`, tiene su propio `.git`, no forma parte del código versionado/entregado de este repo. |

---

## 02 · Stack tecnológico real

### Frontend
React 19.2.6 + TypeScript + Vite 8.0.14, `client/src/`, ~25 páginas con `React.lazy()`. `vite.config.ts:44` fija puerto 5173 en dev.

### Backend
Node.js/Express, monolito `server.js` (root del repo, no `backend/server.js`). `PORT = parseInt(process.env.PORT || '3000', 10)` en código; `.env`/`.env.example` operan con `PORT=8000`. En Render, la plataforma inyecta `PORT`.

### Base de datos
PostgreSQL vía Supabase. **Dos rutas de vectores coexistiendo** — ver §01. RLS: 35 tablas únicas con `ENABLE ROW LEVEL SECURITY` en migraciones versionadas; **blindaje secundario** — el backend opera con acceso directo (`pg` Pool, Capa 1 de `database.config.js`) o `service_role` REST (Capa 2, fallback confirmado en vivo hoy: "pg falló, escalando a REST"), ambos bypasean RLS por diseño. El aislamiento real es `WHERE org_id = req.userId` explícito por ruta.

### Despliegue
Un solo servicio Render (`render.yaml`, `runtime: node`, `startCommand: node server.js`). El deploy real solo hace `POST` a la API de Render (`.github/workflows/radar.yml`) — Firebase, Railway y Docker no forman parte de la cadena de despliegue real, pese a que `railway.json`/`docker-compose.yml`/Dockerfiles existían en el árbol (los 2 primeros huérfanos ya eliminados; `docker-compose.yml` sigue vigente como herramienta de desarrollo/staging **local**, no de producción — construye desde el `Dockerfile` raíz, no desde los `Dockerfile.backend/frontend` ya eliminados).

---

## 03 · Organigrama del sistema

```
RadarFondos 360
├── Bloque 0 · Centro de Mando
│   ├── Favoritos
│   └── Bóveda de credenciales (CredentialsPage.tsx + credentialVault.js)
├── Bloque A · Radar
│   ├── Rastreo 1 (EntityScraper.js) — 02:30 COT
│   ├── Rastreo 2, fuentes externas — 02:00 COT
│   ├── Expiración de convocatorias — 01:45 COT (no documentado en v11)
│   └── M2 · Puente (transfiere convocatoria seleccionada al Formulador)
├── Bloque B · Formulador (M3-M12, 12 rutas ya con consumidor tras hoy)
│   ├── M3 · Árbol de Objetivos (arbolObjetivosAgent.js)
│   ├── Motor Dialéctico
│   ├── Configuración Logística + Proponente/Equipo (nuevo hoy)
│   ├── Presupuesto APU (nuevo hoy — antes sin pantalla)
│   ├── Marco Normativo (generación + edición manual, cableado hoy)
│   ├── Compliance
│   ├── Radicación (cross-check real)
│   ├── Reporte Maestro (PDF SSR, reconectado hoy)
│   ├── Ficha Técnica Maestra (hash SHA-256)
│   └── Consultor Estratégico — Viabilidad IA (viabilidadAgent.js)
└── Suscripciones / RBAC (requireAccess + PlanGate inline en main.tsx)
```

---

## 04 · Bloques y módulos — estado verificado con evidencia archivo:línea

| Módulo | Backend | Montado | Frontend consumidor |
|---|---|---|---|
| M3 Árbol de Objetivos | `arbolObjetivosAgent.js` (117L, Gemini 1.5 Flash + fallback mock) | `server.js:39` import, rutas `server.js:4265,4527` | `ArbolObjetivosPage.tsx:76,115` ✅ |
| Motor Dialéctico | `motorDialectico.routes.js` (98L, SQL real) | `server.js:4770` | `DialecticaPage.tsx:207,253` ✅ |
| Config. Logística (proponente/NIT) | `configLogistica.routes.js:6,15` | `server.js:4773` | **Sin consumidor hasta hoy** → `ConfigProponente.tsx` (nuevo) montado en `LogisticaPage.tsx` ✅ |
| Logística — tramos transporte | `configLogistica.routes.js:69,83` | `server.js:4773` | `LogisticaPage.tsx:125,166` ✅ (ya existía) |
| Presupuesto APU | `presupuesto.routes.js` (135L, `apuEngine.js` real) | `server.js:4791` | **Sin consumidor hasta hoy** → `PresupuestoPage.tsx` (nuevo) ✅ |
| Marco Normativo — generar | `marcoNormativo.routes.js:17` | `server.js:4776` | `Modulo10Page.tsx:158` ✅ (ya existía) |
| Marco Normativo — leer/editar manual | `marcoNormativo.routes.js:7,53` | `server.js:4776` | **Sin consumidor hasta hoy** → hidratación + notas + guardado agregado a `Modulo10Page.tsx` ✅ |
| Compliance | `compliance.routes.js` (96L, SQL real, Hard-Lock predial) | `server.js:4779` | `DashboardFormuladorPage.tsx:630,696`, `Modulo10Page.tsx:88,126` ✅ |
| Radicación | `radicacion.routes.js` (159L, `runCrossCheck` real) | `server.js:4800` | `ChecklistPage.tsx:169` ✅ |
| Reporte Maestro (PDF) | `reporte.routes.js` (50L, `generarReportePDF`) | `server.js:4806` | **Endpoint fantasma en `ExportacionPage.tsx` hasta hoy** → reconectado al real ✅ |
| Ficha Técnica Maestra | `fichaTecnica.routes.js` (135L, hash SHA-256) | `server.js:4782` | `FichaTecnicaPage.tsx:181,203` ✅ |
| Consultor Estratégico (Viabilidad) | `viabilidadAgent.js` (247L, Gemini 2.0 Flash + heurística) | `server.js:4723`, ruta `4685` | `NN_Viability_Agent.ts:291` ✅ |
| Pipeline financiero (4 motores) | Ver §08 | `server.js:4794-4796` | Sin UI dedicada — datos vía Anexos/Formulador |

---

## 05 · Suscripciones y control de acceso (RBAC)

Confirmado exacto contra el código real. `user_subscriptions` (`access_radar`/`access_formulador` booleanos), índices en `006_performance_indexes.sql:126-133`. Middleware `requireAccess(modulo)` (`server.js:273-296`), usado en ~34 rutas backend. Frontend: `PlanGate` **inline en `main.tsx:213`** (no archivo propio — corrección de v11), consume `useSubscription()` de `SubscriptionContext.tsx`. `devBypass` (`import.meta.env.DEV`) evita bloqueo del nav lateral completo en desarrollo local.

---

## 06 · Agentes de IA — funciones reales (corregido)

Patrón compartido: Gemini primero, gateado por `geminiCircuitBreaker.js` — **pero solo 5 de 6 agentes lo importan** (`embeddingsService.js` no).

| Agente | Función | Modelo real | Fallback |
|---|---|---|---|
| `viabilidadAgent.js` | Veredicto: `APROBADO_TECNICAMENTE` / `OBSERVACION_CRITICA` / `RECHAZADO_INCOHERENCIA` (3 valores, no 4) | Gemini 2.0 Flash | Heurística de reglas determinista |
| `arbolObjetivosAgent.js` | Grafo CENTRAL→ESPECÍFICO→RESULTADO→ACTIVIDAD | Gemini 1.5 Flash (no 2.0) | **Lanza excepción** si falla por error no-cuota — no siempre degrada |
| `enfoqueEntidadAgent.js` | Adapta problemática al lenguaje de la entidad financiadora | Gemini → plantilla | Ruta backend activa (`server.js:4477,4451,4486`), **confirmado sin consumidor frontend** (grep exhaustivo en `client/`) |
| `sectorClassifier.js` | Clasifica convocatorias por sector | Gemini 2.0 Flash | `KW_MAP` multi-idioma real (es/en/fr/de) |
| `embeddingsService.js` | Vectoriza Ficha Técnica (M7) | `gemini-embedding-001` (no `text-embedding-004`) | **Ninguno** — lanza `EMBEDDINGS_ERROR`, no está en circuit breaker |
| `markitdownService.js` | PDF/DOCX/XLSX → Markdown | CLI Python (`markitdown` v0.1.6) | Try/catch en `EntityScraper.js:633`, no rompe el pipeline. **Riesgo de despliegue real**: paquete instalado solo en `.venv` local, ausente de `requirements.txt`; `render.yaml` no instala Python — probablemente roto en producción, no verificable sin acceder al deploy real |

---

## 07 · Relaciones entre módulos

Confirmado sin cambios respecto a v11: `anexos.routes.js:186` dispara `ExtractorService.js` → `AuditorForenseService.js` únicamente si `categoria === 'presupuesto_apu'` y extensión `.xlsx/.xls`; si la extracción falla, revierte el INSERT del anexo.

---

## 08 · Pipeline de auditoría financiera — 4 motores (confirmado sin fabricación)

| Motor | Archivo | Ruta montada | Verificación |
|---|---|---|---|
| 1 Extractor | `ExtractorService.js` (206L) | `anexos.routes.js:20` → `server.js:4794` | Chunks de 500, parseo COP real |
| 2 AuditorForense | `AuditorForenseService.js` (126L) | ídem | Tolerancia $50 COP, idempotente |
| 3 EstresadoFinanciero | `EstresadoFinancieroService.js` (110L) | `estresFinanciero.routes.js:8` → `server.js:4795` | Umbrales 15%/7.5%, `porcentajeIncremento` obligatorio (422 si falta) |
| 4 ValorExponencial | `ValorExponencialService.js` (127L) | `valorExponencial.routes.js:7` → `server.js:4796` | SROI obligatorio del usuario, SMMLV citado con decreto |

**Principio "ningún motor fabrica cifra ni cita legal": sin violaciones encontradas** en los 4 motores tras lectura completa de cada uno.

---

## 09 · Radar — motor de rastreo real

Sin Perplexity/Tavily/Search Grounding en el backend real (confirmado por grep exhaustivo). Scraping estructurado: `EntityScraper.js` (952L) + `DataIngestor.js` (286L) + `sectorClassifier.js` (Gemini solo para sector) + `CronScheduler.js` (4 tareas: 01:45 expiración, 02:00 Rastreo 2, 02:30 Rastreo 1, 03:00 backup S3, todas `America/Bogota`). **Hallazgo abierto no resuelto hoy:** `ControlPanel.tsx:647` anuncia un "Motor Perplexity AI" que no existe en ningún backend — contradice el principio de no fabricar, aplicado aquí al copy de marketing en vez de al pipeline financiero.

---

## 10 · Autenticación (corregido hoy)

- Login propio: `pbkdf2` 100.000 iteraciones/sha512 (`server.js:316,326`), JWT HS256 7 días.
- **`backend/middlewares/auth.middleware.js` ahora existe de verdad** — `authenticateToken` extraído de `server.js` (Operación Bisturí), validado con servidor real levantado (DB conectada, boot limpio).
- **Sin fallback Supabase Auth** — `validateSupabaseToken()` era código muerto (0 invocaciones reales), eliminado.
- Aprobación manual: `is_approved=0` al registrar, endpoint real `POST/GET /api/admin/usuarios/pendientes` (`server.js:1614`), notificación al admin vía Brevo.
- Modo Visitante: `/api/auth/trial`, 24h, 3 tokens/hora/IP (`SecurityMiddleware.js:58-61`).
- Rate limit auth: 5 intentos/15min/IP, 6 rutas `/api/auth/*` (`SecurityMiddleware.js:41-55`).

---

## 11 · Blindajes técnicos verificados

Sin cambios respecto a v11 — no se re-auditaron en esta ronda (fuera de alcance de Sinaosis/Bisturí): aislamiento `org_id` por ruta, rechazo HTTP 422 para moneda no-COP, idempotencia de presupuestos, chunking de 500, hash inalterable (`project_version_hashes`), confirmación de borrado en Anexos.

---

## 12 · Deuda técnica vigente

- **Stripe**: sin credenciales de producción en ningún entorno (`.env`/`.env.production` vacíos o placeholder). `stripe.config.js` guardia con `stripe = null` si falta la key.
- **Resend**: sin configurar en ningún entorno; `emailService.js` reporta "MÓDULO INACTIVO" si falta la key (confirmado en el log de arranque real de hoy).
- **Brevo**: configurado solo en `.env` local — `.env.production` tiene placeholder sin completar. Marcado "legacy" en `.env.example`.
- **`markitdownService.js`**: riesgo real de estar roto en producción Render (Python no se instala en el build) — no verificado end-to-end.
- **`ControlPanel.tsx:647`**: afirma un motor "Perplexity AI" inexistente — deuda de honestidad en el copy de producto, no de código.
- **`enfoqueEntidadAgent.js`**: ruta backend activa sin ningún consumidor de frontend — candidato a eliminar o conectar en una ronda futura.
- Términos/Privacidad con campos pendientes (razón social, NIT), requieren revisión legal.

---

## 13 · Grupo Elite — cambios ejecutados hoy (2026-08-06)

### Operación Sinaosis — conexión backend↔frontend de 3 endpoints huérfanos
1. **`PresupuestoPage.tsx`** (nueva) — consume `GET /api/rendimientos` + `GET/POST /api/proyectos/:id/presupuesto`. Todo el formateo de moneda en COP (`Intl.NumberFormat('es-CO', {currency:'COP'})`), sin excepción. Ruta `/presupuesto` registrada en `main.tsx` y `AppLeftNav.tsx`. Limitación conocida y documentada en el propio archivo: `materiales[]`/`equipos[]` del motor APU se envían vacíos — un editor de líneas de materiales/equipos es una pieza de UI separada, no construida en esta ronda.
2. **`ExportacionPage.tsx`** — el endpoint anterior (`/api/proyectos/:id/exportar/:formato`, 3 botones MGA/BID/OXI) era fantasma. Reconectado a `GET /api/modulo9/reporte/:proyectoId`, el único endpoint real (genera un PDF consolidado, no 3 formatos distintos) — el UI ya no finge variantes que el backend no tiene.
3. **`LogisticaPage.tsx`** — nuevo componente `ConfigProponente.tsx` consume `GET/POST /api/m5/logistica/:proyectoId` (proponente/NIT/tipo de entidad/equipo directivo), dominio distinto de los tramos de transporte que ya tenían consumidor.
4. **`Modulo10Page.tsx`** — antes solo generaba normas (`POST /api/m8/normas/generar`) sin persistir la vista; ahora hidrata desde `GET /api/m8/normas/:proyectoId`, captura `citas_bibliograficas` (antes descartadas), y agrega edición manual de notas con `POST /api/m8/normas/:proyectoId`.
5. **Purga de stubs**: verificado por grep — no existía ningún `FrozenPage`/stub ocupando el lugar de Presupuesto o Reportes; nada que purgar.

**Validación:** `npx tsc --noEmit` — 0 errores en todo el proyecto. `vite build` — build limpio, 4 chunks nuevos generados (`PresupuestoPage`, `ExportacionPage`, `LogisticaPage`, `Modulo10Page`).

### Operación Bisturí — erradicación de infraestructura fantasma y desacoplamiento
1. Eliminados `railway.json`, `Dockerfile.backend`, `Dockerfile.frontend` (huérfanos, confirmado sin referencias reales en `render.yaml`/CI; `docker-compose.yml` usa el `Dockerfile` raíz, no los eliminados).
2. Eliminada `validateSupabaseToken()` de `backend/config/supabase.config.js` (0 invocaciones reales confirmadas).
3. `authenticateToken` extraído de `server.js` (monolito inline) a `backend/middlewares/auth.middleware.js` — `server.js` ahora lo importa. Validado con servidor real levantado localmente: boot limpio, conexión real a Postgres, sin errores relacionados al refactor.
4. Documentación corregida — con una corrección **al hallazgo original**, no una aplicación ciega: HNSW **sí existe** en `server.js:712-713` (índices reales sobre `embedding_vec`), coexistiendo con IVFFlat en las migraciones versionadas (columna `embedding`) — no se reemplazó "HNSW" por "IVFFlat" como pedía la instrucción original porque esa premisa resultó incompleta al verificar con el servidor real levantado. Las otras 3 correcciones (PlanGate inline, ruta admin real, 35 tablas RLS) sí se aplicaron tal cual — ver §01.

**Validación:** `node --check` en los 3 archivos tocados — OK. Servidor real levantado con `.env` de producción local: conexión a Postgres real, extensiones pgvector/unaccent activas, índices HNSW confirmados en el log de arranque, sin errores de import ni de referencia relacionados al refactor.

---

*RadarFondos 360 · ASFALTICA S.A.S. · Documento Maestro v12 · Reemplaza v11.0 · Verificado contra código real y servidor en ejecución, no contra la especificación ni contra auditorías heredadas sin re-confirmar.*
