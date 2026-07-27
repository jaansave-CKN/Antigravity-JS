# Documento Maestro de Arquitectura — RadFor-360 v11
**ASFALTICA S.A.S.** · Reemplaza la versión 10.0 · Verificado directamente contra el código y la base de datos en producción — no contra la especificación original.

**Estado:** en operación, verificado 2026-07-24
**Base de datos:** PostgreSQL / Supabase
**Despliegue:** Railway (backend) + Render (frontend)

---

## 00 · Resumen ejecutivo

RadFor-360 es una plataforma SaaS de dos pilares — **Radar** (rastreo de convocatorias de financiación) y **Formulador** (estructuración de proyectos con IA) — con un pipeline de auditoría financiera en Pesos Colombianos construido y probado sobre datos reales. Este documento reemplaza la v10.0, que describía una migración a Firebase y un motor de búsqueda que no existen en el código real.

| Capa | Tecnología real |
|---|---|
| Frontend | React + Vite + TypeScript, puerto 5173 |
| Backend | Node.js / Express, puerto 8000 |
| Base de datos | PostgreSQL (Supabase), pgvector + HNSW |
| Autenticación | JWT propio (HS256) + fallback Supabase Auth |
| Almacenamiento | Supabase Storage, bucket privado "anexos" |
| Despliegue | Railway + Render, Dockerfile.backend / Dockerfile.frontend |

---

## 01 · Fe de erratas — qué cambió respecto a la v10.0

| Afirmación en v10.0 | Estado real verificado |
|---|---|
| "Migrado a Firebase (Firestore y Auth), eliminando PostgreSQL y JWT manual" | **Falso.** No existe ninguna referencia a Firebase/Firestore en el backend. La base de datos es PostgreSQL vía Supabase; la autenticación es JWT propio firmado con `JWT_SECRET`. |
| "Caché 24h vía Firebase/Redis" | **Falso.** `tokenBlacklist.js` declara explícitamente: "Sin Redis. Sin dependencias externas." |
| "Motor unificado en Gemini 1.5 con Google Search Grounding (reemplaza Perplexity, Tavily y Claude)" | **Falso.** No hay ninguna referencia a Perplexity, Tavily ni Search Grounding. El Radar rastrea entidades reales vía `EntityScraper.js` + `CronScheduler.js`. |
| "Despliegue en contenedores Docker orquestado para alta disponibilidad" | **Parcial.** Sí existen `Dockerfile.backend`/`Dockerfile.frontend`, usados por Railway/Render como mecanismo de build. No hay una capa de orquestación propia (Kubernetes/Swarm) — son plataformas PaaS gestionadas. |
| "Consolidado a una única variable GEMINI_API_KEY" | **Impreciso.** La variable real es `GOOGLE_API_KEY`, usada en 8 módulos de IA (un archivo acepta `GEMINI_API_KEY` como alias de respaldo, sin uso real). |
| RBAC (access_radar/access_formulador), aislamiento por org_id, hash de versión final | **Confirmado**, coincide con el código real. |

**Añadido en esta versión:** el pipeline de auditoría financiera (Sprints 1–4) no existía en la v10.0 — se construyó, probó con datos reales y verificó en esta sesión.

---

## 02 · Stack tecnológico real

### Frontend
- React + TypeScript + Vite, servido en el puerto 5173 vía pm2 (`radar-frontend`).
- Code-splitting con `React.lazy()` para las ~25 páginas del ecosistema.
- Diseño calcado desde Stitch MCP para pantallas específicas (marcadas en el código con "Calco estricto Stitch"); el resto son páginas construidas directamente.

### Backend
- Node.js/Express, puerto 8000 vía pm2 (`radar-backend`), módulos ES en todo el codebase.
- Motor de base de datos con 3 capas de resiliencia (`database.config.js`): pool directo (Capa 1) → REST de Supabase con `service_role` (Capa 2, operando hoy) → degradación controlada (Capa 3).

### Base de datos
- PostgreSQL gestionado por Supabase, extensión `pgvector` con índices HNSW (columnas `vector(768)`).
- Row Level Security habilitada en las 31 tablas públicas. **Nota honesta:** las políticas RLS son un blindaje secundario — el backend siempre opera con `service_role`, que bypasea RLS por diseño. El aislamiento real ocurre en cada ruta vía `WHERE org_id = req.userId`.
- `proyectos.id` y `project_anexos.id` son `TEXT` (no `UUID`) — heredado del bootstrap original de `server.js`.

### Despliegue
- Backend → Railway, vía `Dockerfile.backend` + `railway.json`.
- Frontend → Render, vía `Dockerfile.frontend` + `render.yaml`.
- Archivos → Supabase Storage (bucket privado `anexos`), no disco local — Railway reconstruye el contenedor en cada deploy.

---

## 03 · Organigrama del sistema

```
RadFor-360
├── Bloque 0 · Centro de Mando
│   ├── Favoritos
│   └── Bóveda de credenciales
├── Bloque A · Radar
│   ├── Rastreo 1 (EntityScraper.js)
│   ├── Rastreo 2 (fuentes externas)
│   └── M2 · Puente
├── Bloque B · Formulador
│   ├── M3 · Ingesta / Árbol Objetivos (arbolObjetivosAgent.js)
│   ├── Motor Dialéctico
│   ├── Configuración Logística
│   ├── Presupuesto  ──┐
│   ├── Marco Normativo │  (presupuesto_apu → dispara el)
│   ├── Compliance      │
│   ├── Radicación      ▼
│   ├── Ficha Técnica Maestra    Pipeline Financiero (sección 08)
│   └── Consultor Estratégico (viabilidadAgent.js)
└── Suscripciones / RBAC (requireAccess, todos los módulos lo consultan)
```

---

## 04 · Bloques y módulos

### Bloque 0 — Centro de mando
- **Gestor de Favoritos** — perfiles guardados del Directorio, persistidos en base de datos.
- **Bóveda de credenciales** (`CredentialsPage.tsx` + `credentialVault.js`) — clave de IA propia por usuario; si no la tiene, usa `GOOGLE_API_KEY` del servidor.

### Bloque A — Radar
- **Rastreo 1** — scraping de entidades del Directorio (`EntityScraper.js`).
- **Rastreo 2** — fuentes externas (MacArthur, IDRC, IAF, Wellcome, Ford, OSF, Skoll, Omidyar, CIVICUS, GlobalGiving, NWO).
- Programado vía `CronScheduler.js`: Rastreo 2 → 02:00, Rastreo 1 → 02:30, backup → 03:00 COT.
- Puente M2 → transfiere la convocatoria seleccionada al Formulador.

### Bloque B — Formulador (M3 a M12)

| Módulo | Archivo real |
|---|---|
| M3 — Ingesta / Árbol de objetivos | `arbolObjetivosAgent.js` |
| Motor Dialéctico | `motorDialectico.routes.js` |
| Configuración Logística | `configLogistica.routes.js` |
| Arquitectura Financiera (presupuesto) | `presupuesto.routes.js` |
| Marco Normativo | `marcoNormativo.routes.js` |
| Compliance | `compliance.routes.js` |
| Radicación | `radicacion.routes.js` |
| Reporte / Ficha Técnica Maestra | `reporte.routes.js`, `fichaTecnica.routes.js` |
| Consultor Estratégico (viabilidad IA) | `viabilidadAgent.js` |

---

## 05 · Suscripciones y control de acceso (RBAC)

Confirmado exacto contra el código real. Tabla `user_subscriptions` con columnas `access_radar`/`access_formulador` (booleanas). Middleware `requireAccess(modulo)` en el backend; componente `PlanGate` en el frontend replica la misma lógica.

- **Suscripción Radar** → Rastreo 1/2 + Directorio + Favoritos.
- **Suscripción Formulador** → M3–M12 completos, incluida ingesta manual de pliegos propios.
- **Plan Suite** → ambos, puente M2 sin restricciones.
- Usuario con solo Radar que cruza el puente → redirigido al panel de Planes; el botón valida el permiso *antes* de inyectar datos en el Formulador.

---

## 06 · Agentes de IA — funciones reales

Todos comparten el mismo patrón de resiliencia: intentan Gemini primero, gateados por `geminiCircuitBreaker.js` (corta el circuito si hay error de cuota); si Gemini no está disponible, caen a una heurística o plantilla determinista — nunca lanzan una excepción, siempre devuelven un resultado utilizable con el mismo esquema.

| Agente | Función | Modelo / fallback |
|---|---|---|
| `viabilidadAgent.js` | Audita viabilidad: escala/proporción (población vs meta), coherencia de anexos por taxonomía, veredicto VIABLE / VIABLE_CON_OBSERVACIONES / NO_VIABLE / RECHAZADO_INCOHERENCIA. | Gemini 2.0 Flash → heurística de reglas |
| `arbolObjetivosAgent.js` | Genera el Árbol de Objetivos (M3b): grafo Causas→Problema→Efectos invertido a Medios→Objetivo→Fines, en lenguaje MGA. | Gemini (google/generative-ai) |
| `enfoqueEntidadAgent.js` | Adapta la problemática/población del proyecto matriz al lenguaje de la entidad financiadora. *Nota: la ruta backend sigue activa; no se confirmó si el frontend que la invoca sigue montado.* | Gemini → plantilla determinista |
| `sectorClassifier.js` | Clasifica convocatorias del Radar por sector temático. | Gemini → mapa de palabras clave multi-idioma |
| `embeddingsService.js` | Convierte la Ficha Técnica a vector para búsqueda semántica (pipeline M7). | text-embedding-004, 768 dims |
| `markitdownService.js` | Convierte PDF/DOCX/XLSX a Markdown (CLI Python), extrae campos estructurados de la convocatoria. | MarkItDown (Python) + Gemini |

---

## 07 · Relaciones entre módulos

- **Radar → Formulador:** el Puente (M2) transfiere la convocatoria seleccionada como semilla de un nuevo proyecto — requiere plan Suite.
- **Anexos → Pipeline financiero:** solo un anexo subido con `categoria = presupuesto_apu` y extensión `.xlsx/.xls` dispara `ExtractorService.js` → `AuditorForenseService.js` en cadena; cualquier otra categoría se guarda igual pero no entra al pipeline.
- **Pipeline financiero → Ficha Técnica Maestra:** los hallazgos y métricas están disponibles vía API, pero su inclusión visual en el reporte final es un paso de frontend aún no verificado en esta sesión.
- **Suscripciones → todo:** `requireAccess()` es el único punto de verdad — Radar y cada endpoint del Formulador lo consultan antes de ejecutar lógica de negocio.
- **Auth → Suscripciones:** `/api/auth/verify` devuelve el plan y los flags `access_radar`/`access_formulador` en el mismo payload.

---

## 08 · Pipeline de auditoría financiera — 4 motores (nuevo)

No existía en la v10.0. Construido, probado con datos reales end-to-end, y verificado esta sesión.

| Motor | Disparo | Archivo | Función |
|---|---|---|---|
| 1 | Automático | `ExtractorService.js` | Excel → `project_apu_lineas`, en COP, idempotente, en lotes de 500 |
| 2 | Automático | `AuditorForenseService.js` | HSEQ ausente + descuadres aritméticos → `project_hallazgos` |
| 3 | Deliberado (formulador) | `EstresadoFinancieroService.js` | Choque macroeconómico → VIABLE / EN RIESGO / CRITICO |
| 4 | Deliberado (formulador) | `ValorExponencialService.js` | SROI (ratio explícito) + mapeo ODS por palabras clave |

**Principio de diseño no negociable:** ningún motor fabrica una cifra financiera ni una cita legal. El etiquetado HSEQ es una alerta técnica, no un dictamen; el % de choque y el ratio SROI los define el formulador explícitamente. El único número externo usado es el SMMLV 2026 real ($1.750.905 COP, Decretos 1469/1470 de 2025).

### Flujo del pipeline

```
Formulador sube Excel (categoria=presupuesto_apu)
        │
        ▼
POST /api/proyectos/:id/anexos
        │
        ▼
ExtractorService.js ──► project_apu_lineas
        │
        ▼
AuditorForenseService.js ──► project_hallazgos

  ── Acciones deliberadas, aparte ──
  Formulador indica % de choque + nombre del escenario
        │
        ▼
  EstresadoFinancieroService.js ──► project_escenarios_estres
        │ (si CRITICO)
        ▼
  project_hallazgos

  Formulador indica su propio ratio SROI
        │
        ▼
  ValorExponencialService.js ──► project_sroi_metrics + project_ods_mapping
```

---

## 09 · Radar — motor de rastreo real

No usa Perplexity, Tavily ni Gemini Search Grounding. Es scraping directo y estructurado:
- `EntityScraper.js` visita las páginas de convocatorias de cada entidad ya validada en el Directorio.
- `DataIngestor.js` normaliza lo extraído antes de insertarlo.
- `sectorClassifier.js` usa `GOOGLE_API_KEY` (Gemini) solo para clasificar sector, no para buscar.
- `CronScheduler.js` orquesta la periodicidad.

---

## 10 · Autenticación

- Login/registro propios en `server.js`: contraseña con `pbkdf2` (100.000 iteraciones, sha512), token JWT HS256 (`JWT_SECRET`), expiración 7 días.
- `auth.middleware.js` valida primero contra Supabase Auth si está configurado; si falla, cae a JWT local — necesario porque el login propio nunca emite sesiones reales de Supabase Auth.
- **Aprobación manual de registros (nuevo):** todo registro nuevo queda con `is_approved = 0` — no puede iniciar sesión hasta que un administrador lo apruebe desde `/admin/usuarios-pendientes`. Se dispara un correo de aviso al administrador vía Brevo.
- Modo Visitante: token temporal de 24h (`/api/auth/trial`), limitado a 3 tokens/hora por IP.
- Rate limiting: 5 intentos fallidos por 15 minutos por IP en `/api/auth/*` (contador en memoria).

---

## 11 · Blindajes técnicos verificados

| Blindaje | Mecanismo real |
|---|---|
| Aislamiento multi-tenant | `org_id` filtrado en cada ruta (no solo RLS, inerte bajo `service_role`) |
| Moneda única (COP) | Rechazo HTTP 422 si se detecta USD/EUR/GBP/CAD/MXN |
| Idempotencia de presupuestos | Borra líneas de subidas anteriores con el mismo nombre de archivo antes de insertar |
| Chunking | Inserciones en lotes de 500 filas |
| Hash inalterable | `project_version_hashes` sella cada Ficha Técnica Maestra final |
| Confirmación de borrado | Diálogo antes de "LIMPIAR" o eliminar cualquier fila con contenido en Anexos |

---

## 12 · Deuda técnica real

- Envío de correo depende de credenciales de Brevo (configuradas parcialmente esta sesión); Resend (flujo de Stripe) sigue sin configurar.
- Stripe (cobros reales) sin credenciales de producción.
- Términos/Privacidad tienen campos pendientes (razón social, NIT) y requieren revisión legal.
- Exportación MGA/BID/OXI genera documentos basados en la estructura oficial, no son los formularios descargables exactos del gobierno.

---

*RadFor-360 · ASFALTICA S.A.S. · Documento Maestro v11 · Reemplaza v10.0 · Verificado contra código real, no contra la especificación.*
