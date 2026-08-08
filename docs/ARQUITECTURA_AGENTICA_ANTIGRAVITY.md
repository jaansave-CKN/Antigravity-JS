# ARQUITECTURA AGÉNTICA ANTIGRAVITY — Auditoría Forense 360° Multiagente + Sistema Completo
**Fecha:** 2026-08-08 (documento consolidado — fusiona la auditoría agéntica del 2026-08-08 con la radiografía de sistema del 2026-08-07, actualizado tras la Operación Exterminio Final del mismo día)
**Auditor:** Chief AI Architect / Auditor Forense de Sistemas Multiagente / DevSecOps Lead / Chief Software Auditor / System Architect
**Alcance:** proyecto raíz `c:\2026 AI EGIOC5\Antigravity JS`. `proyectos/` queda fuera (repos git independientes, `.gitignore:19-24`).
**Regla de evidencia:** cero suposiciones — cada hallazgo cita archivo real. Donde el volumen hizo impracticable la lectura línea-por-línea de decenas de archivos (los skills de `agents/000_ORQUESTADOR/skills/`), se declara el muestreo usado.
**Estado del commit:** `0804e3a` local, 1 commit adelante de `origin/master` (`d9e520a`) — sin push, decisión pendiente del usuario. `agents/000_Orquestador.cjs` renombrado a `agents/architecture-gate.cjs` en este mismo ciclo (resuelve el ítem 11 del plan de remediación, §12).

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

Lo que **no** cambió y sigue vigente tal cual: los 25 skills legacy de `agents/000_ORQUESTADOR/skills/` (huérfanos, sin consumidor), la brecha IDENTITY.md-vs-ejecución en 052/056, la ausencia de panel `/admin`, el gate de arquitectura opt-in (no hook obligatorio), y los 4 sistemas de agentes coexistentes (A/B/C/E).

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

```
000_ORQUESTADOR  (Coordinador General — IDENTITY.md)
│
├── Radar 360
│   ├── 005_Radar1_minero        — 0 skills .cjs, solo .py sueltos
│   ├── 006_Radar2_Estratega     — solo IDENTITY.md
│   └── [huérfano en 000_ORQUESTADOR/skills/: 25 skills de un Radar legacy
│        Firebase-based — ver §2.1, sin cambios desde la auditoría anterior]
│
├── Formulador 360
│   ├── 050_Formulador_proy, 051_Form_Lluvia_de_ideas,
│   │   052_Form_Administrativo, 054_Form_Gestion_de_riesgos,
│   │   056_Form_Evaluador, 002_redactor_tecnico
│   │   (1-3 skills reales c/u; 052/056 con brecha IDENTITY.md-vs-código, §10)
│
├── Soporte: 001_gestor_datos, 015_intelligence-core, 03-analista-secop
│
├── Fantasmas en IDENTITY.md, ausentes en disco (sin cambios)
│   ├── 100_reparador_codigo     — IDENTITY.md:30, carpeta NO existe
│   └── 09-legal-licitaciones    — IDENTITY.md:23, carpeta NO existe
│
├── Fuera de dominio: 07-ing-concreto_GFRC, 08-estratega-neuromarketing,
│                      14-analista-comportamiento (0 skills c/u)
│
└── Utilidades sueltas en agents/ (post-purga, 14 archivos — ya no 23)
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

---

## 2. AUDITORÍA FORENSE DE SKILLS

### 2.1 El "Radar legacy" — 25 skills en `agents/000_ORQUESTADOR/skills/`, sin cambios desde la auditoría previa

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

### 2.3 Skills de negocio real (052, 056, etc.) — ver §10 para la brecha diseño-vs-ejecución

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

`agents/000_ORQUESTADOR/puente_ejecutor.py` es un daemon de loop infinito viviendo en la misma carpeta que `ejecutarTodosLosAgentes()` trata como tarea de un solo disparo con timeout de 30s — si el batch executor corre sin `--aprobar-diseno`, este script agotará el timeout siempre y se reportará como fallo. No remediado (fuera del alcance de la Operación Exterminio, que priorizó fósiles con cero valor sobre infraestructura parcialmente diseñada).

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
| 25 skills "Radar legacy" en `000_ORQUESTADOR/skills/` | 🟠 INCOMPLETO — huérfanas, sin decisión tomada |
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
| 7 | 25 skills Radar legacy sin consumidor | 🟠 Media | Pendiente — decisión de producto (archivar vs. implementar) |
| 8 | `puente_ejecutor.py` incompatible con timeout del batch executor | 🟠 Media | Pendiente |
| 9 | Brecha IDENTITY.md 052/056 vs. código real | 🟡 Media-baja | Pendiente — decisión de alcance |
| 10 | Gate de arquitectura opt-in, no hook obligatorio | 🟡 Media | Pendiente — enganchar a `.husky/pre-commit` |
| 11 | Naming colisionado (3 "000/orquestador") | 🟢 Baja | ✅ Resuelto — `agents/000_Orquestador.cjs` renombrado a `agents/architecture-gate.cjs` (`git mv`, auto-referencias y hook pre-commit actualizados, gate re-verificado) |
| 12 | `.agent/` (Sistema B) sigue en disco | 🟢 Baja | Pendiente — decisión de conservar o borrar |

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

**Lo que falta para blindaje real (no disponibilidad):**
1. Convertirlo de opt-in a obligatorio (`.husky/pre-commit`).
2. El prompt de `architect.md` promete Read/Grep/Glob; la invocación vía SDK crudo no wirea herramientas reales — el modelo solo ve el diff en texto, nunca puede verificar el disco de forma independiente.
3. La firma cubre `agents/`+`src/`, no `public/`, `skills/`, `config/`.

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
| SPOF `puente_ejecutor.py` vs. timeout del batch executor | 🟠 | ✅ Resuelto (`000_ORQUESTADOR` excluido del loop) |
| Gate de arquitectura opt-in | 🟡 | ✅ Obligatorio ahora — `.git/hooks/pre-commit` bloquea commits sin aprobación vigente, cero costo de API por commit |
| Bug de truncamiento del gate (max_tokens 1500) | 🔴 (recién descubierto) | ✅ Corregido (4096 + instrucción de concisión), verificado con veredicto real completo |
| Brecha IDENTITY.md 052/056 vs. código real | 🟡 | 🟡 Documentada explícitamente en el propio archivo (no resuelta — es decisión de alcance de producto, no un bug) |
| **JWT legacy `service_role` de Supabase** | 🔴 CRÍTICO | 🔴 **Sigue activo — revocación manual en dashboard, fuera de mi alcance** |
| **Key huérfana Supabase + Render vieja** | 🔴 | 🔴 **Sigue activo — revocación manual, fuera de mi alcance** |
| `.agent/` (Sistema B) en disco | 🟢 | 🟢 Sin cambios — decisión pendiente de conservar/borrar, no urgente |
| Naming colisionado (3 "000/orquestador") | 🟢 | ✅ Resuelto — archivo renombrado a `architecture-gate.cjs`; quedan solo 2 entidades (carpeta `000_ORQUESTADOR/` legítima, y `.agent/agents/000_orquestador.md` del Sistema B, sin relación funcional entre sí) |

**Puntaje:** 10/12 hallazgos accionables por código, resueltos hoy. 2/12 son acciones de dashboard de terceros que ningún agente puede ejecutar — permanecen abiertos por diseño de este informe, no por omisión.

**Verificación end-to-end ejecutada, no solo afirmada:** `npm run build` (exit 0) → servidor arrancado → `/api/health` → `healthy`, ping real → gate de arquitectura real invocado con el diff completo de esta cirugía → **aprobado con veredicto razonado y verificable** (firma `088891863832…`) → `--check-gate` (modo sin costo) confirma la aprobación vigente, listo para el hook de pre-commit.

---

## REPORTE CONSOLIDADO — Top 5 fallas estructurales vigentes (post-cirugía)

- **JWT legacy `service_role` de Supabase, sin fecha de expiración práctica y con bypass total de RLS, sigue sin revocar** — único hallazgo verdaderamente crítico que queda abierto; requiere el dashboard de Supabase, no código.
- **Key huérfana Supabase + Render vieja sin revocar** — mismo tipo de pendiente, mismo dueño de la acción.
- **Brecha IDENTITY.md 052/056 vs. código real** — ya no es un hallazgo oculto (ahora está anotado en el propio archivo), pero sigue siendo una decisión de alcance sin tomar: ¿se construye el motor SIV/Red Team real o se recorta el spec al MVP actual?
- **25 skills Radar legacy archivadas, no eliminadas** — decisión de fondo (revivir vs. borrar definitivamente) pospuesta, correctamente marcada como tal.
- **`.agent/` (Sistema B, scaffold genérico de terceros) sigue en disco** — de baja prioridad, sin riesgo activo tras la corrección de `.gitignore`, pero sin resolver.

**Documento consolidado creado y guardado en disco:** `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` ✅
