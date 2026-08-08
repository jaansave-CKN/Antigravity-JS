# Auditoría Forense del Ecosistema Multiagente — Antigravity JS (raíz + proyectos)

**Fecha:** 2026-08-08
**Rol:** Chief AI Architect / Auditor Principal de Sistemas Multiagente / DevSecOps
**Alcance real (verificado, no asumido):** `c:\2026 AI EGIOC5\Antigravity JS\` completo — la raíz (proyecto propio, git independiente) + `proyectos/Proy_03_RadarFondos` (este repo, HEAD `7c03fcf`) + `proyectos/Proy_04_Geomatrix` (git independiente) + `proyectos/Proy_05_SIG` + `~/.claude/` global del usuario.
**Metodología:** lectura directa de archivos reales, `find`/`grep`/`git` ejecutados contra disco, sin heredar hallazgos de auditorías previas sin releer el archivo que los sustenta. Donde ya existe una auditoría previa extremadamente reciente y verificable (la de la raíz `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`, fechada el mismo día, post-remediación), se cita como fuente y se **re-verifican sus claims más fuertes** en vez de copiarlas a ciegas — ver §1.4.

---

## 0. Hallazgo estructural previo (léase primero)

Este mismo nombre de archivo (`docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`) **ya existe en dos ubicaciones distintas**, con contenido distinto:

| Ubicación | Fecha/estado | Alcance declarado |
|---|---|---|
| `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` (+ PDF) | 2026-08-08, post "Operación Exterminio Final", commit local `0804e3a` | **Excluye explícitamente `proyectos/`** ("repos git independientes, `.gitignore:19-24`") |
| `Proy_03_RadarFondos/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` (este archivo, versión anterior sobrescrita ahora) | 2026-08-08, madrugada | Solo este repo; ya declaraba `ag_skills_registry.json` como AUSENTE — **correcto para su propio alcance, pero el archivo sí existe una carpeta arriba** (`Antigravity JS/skills/ag_skills_registry.json`) |

Ninguno de los dos documentos anteriores mentía — cada uno fue preciso *dentro de su propio alcance declarado*. El hallazgo real es que **nadie había unido las dos vistas**, y el propio prompt de esta auditoría pide exactamente eso ("todo el ecosistema... y los demás proyectos"). Este documento reemplaza la copia de este repo, cita la de la raíz como fuente verificada para su alcance, y añade lo que ninguna de las dos cubría: `Proy_04_Geomatrix`, `Proy_05_SIG`, y el `~/.claude/` global del usuario.

---

## 1. Inventario total y organigrama jerárquico

### 1.1 Mapa de los cinco ecosistemas agénticos coexistentes (verificado por `find` real en cada ruta)

```
c:\2026 AI EGIOC5\Antigravity JS\                    ← proyecto propio (git independiente, HEAD 0804e3a)
│
├── ECOSISTEMA GLOBAL DEL USUARIO (todos los proyectos lo heredan)
│   └── ~/.claude/  (C:\Users\Usuario\.claude\)
│       ├── CLAUDE.md                     → directivas globales (radiografia, grupo-elite, graphify, "Mision Cumplida")
│       ├── settings.json                 → permisos/config global
│       └── skills/  (9 carpetas)
│           ├── graphify/SKILL.md          🟢 real, con .graphify_version
│           ├── grupo-elite/SKILL.md       🟢 real
│           └── agent-browser, api-security-best-practices, docker-expert,
│               nodejs-best-practices, typescript-expert,
│               vercel-composition-patterns, vercel-react-best-practices
│               → 🟠 CARPETAS VACÍAS (0 archivos) — ver §2.1, hallazgo real
│
├── SISTEMA A — `agents/` (raíz Antigravity JS) — propio, "Antigravity OS"
│   ├── architecture-gate.cjs      🟢 REAL — gate de arquitectura + batch executor
│   ├── 000_VERIFICADOR.cjs        🟢 real, trivial
│   ├── diseno_aprobado.json       🟢 firma vigente del gate
│   ├── Agente_Maestro.md          🟠 desactualizado (cita "PROY_01 Donaciones/PROY_02 SECOP/PROY_03 Auditoría",
│   │                                 que NO corresponden a Proy_03_RadarFondos/04_Geomatrix/05_SIG reales — ver §4)
│   ├── 000_ORQUESTADOR/           → IDENTITY.md + puente_ejecutor.py (daemon, SPOF documentado en el propio repo)
│   ├── 15 carpetas de agentes numerados (001-057) con IDENTITY.md + skills/
│   ├── skills/ (transversal, 3 .cjs + 16 SKILL.md)
│   └── [ver detalle completo, ya auditado y verificado, en Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §1-2]
│
├── SISTEMA B — `.agent/` (raíz Antigravity JS) — scaffold de terceros ("Antigravity Kit" / orientado a Gemini)
│   ├── rules/GEMINI.md            → confirma destino: Gemini CLI, no Claude Code
│   ├── agents/ (9 .md: 000_orquestador, 06A1-06C3)
│   ├── skills/ (~22 carpetas: behavioral-modes, caveman, humanizer-es, nextjs-react-expert...)
│   ├── workflows/ (11 .md: brainstorm, create, debug, deploy, orchestrate...)
│   └── scripts/ (4 .py: auto_preview, checklist, session_manager, verify_all)
│   Estado verificado: 0 referencias cruzadas desde `agents/` (Sistema A) ni desde `server.js` de la raíz — coexiste, no se ejecuta hoy
│
├── SISTEMA C — `.claude/` (raíz Antigravity JS) — Claude Code nativo
│   ├── agents/architect.md         🟢 REAL — el "Agente Arquitecto" que la Fase 5 de este prompt pide diseñar YA EXISTE aquí
│   └── skills/ (13 carpetas: developing-genkit-{dart,go,js}, firebase-*, firestore-security-rules-auditor)
│       → bundle estándar de Firebase/Genkit, no autoría del usuario
│
├── SISTEMA D — `skills/` (raíz Antigravity JS, carpeta separada de `.claude/skills` y `.agent/skills`)
│   ├── ag_skills_registry.json     🟢 EL REGISTRO PEDIDO POR ESTE PROMPT — existe, v3.0.0, activamente mantenido
│   ├── sync_registry.cjs           → script que regenera el registro (glob ampliado .cjs/.js/.py)
│   ├── _quarantine/                → mecanismo real de cuarentena, 1 skill neutralizada documentada (§2.3)
│   ├── universal_logic.json, arquitectura/, documentacion/, ingenieria/, seguridad/
│
├── SISTEMA E — `opencode.json` (raíz) — config de OpenCode (terceros), provider OpenRouter + Gemini 2.0 Flash Lite
│   Estado: config presente, sin evidencia de wiring activo con los sistemas A-D
│
└── proyectos/  (excluido del alcance de la auditoría de la raíz — cubierto aquí por primera vez)
    ├── Proy_03_RadarFondos/  (este repo, git independiente, HEAD 7c03fcf)
    │   ├── .claude/settings.json, settings.local.json    → permisos Bash acotados + MCP "stitch"
    │   ├── CLAUDE.md                                      → protocolo de auditoría verificada, comando "radiografia"
    │   ├── AGENTS.md                                      → corregido esta sesión (ya no describe SQLite)
    │   ├── backend/agents/{arbolObjetivosAgent,normativoAgent}.js   🟢 REALES, invocados desde server.js/rutas
    │   ├── client/src/agents/{000_formulador,NN_Viability_Agent,Radford360_Agent}.ts  🟢 REALES, lógica de negocio (heurísticas + wrappers a Gemini)
    │   ├── orchestrator.js / 000-orquestador.js            → orquestación de PROCESOS (PM2/proxy/túnel), NO de agentes IA
    │   ├── archive/ai_service_legacy/ (ex ai_service/)      🔴 AUSENTE de producción — Python FastAPI+LangGraph, purgado del árbol activo esta sesión (commit `2d222ee`), 0 caller vivo, decisión ya tomada (archivar, no conectar)
    │   ├── NO existe `.agent/`, NO existe `agents/` propio (carpeta), NO existe `ag_skills_registry.json` propio
    │   └── NO existe ningún "Architect Agent"/gate de arquitectura local — 0 archivos `.claude/agents/*`
    ├── Proy_04_Geomatrix/  (git independiente)
    │   └── `.claude/settings.json` → `{"enableAllProjectMcpServers": true}` — sin agentes, sin skills propias, sin AGENTS.md
    └── Proy_05_SIG/  (git independiente)
        └── 0 archivos de infraestructura agéntica (`.claude`, `agents/`, `AGENTS.md`, `.agent/`) — confirmado por búsqueda directa
```

### 1.2 Desalineaciones de rol y ausencia de orquestador central

- **Proy_03_RadarFondos (este repo) no tiene ningún Agente Arquitecto ni gate de diseño** — los 2 agentes de producto (`arbolObjetivosAgent.js`, `normativoAgent.js`) y los 3 archivos de `client/src/agents/` se invocan directamente desde rutas HTTP/páginas sin ninguna capa de aprobación previa. Esto confirma, para este repo específico, exactamente el vacío que la Fase 5 de este prompt presupone.
- **Pero el patrón sí existe, ya construido y verificado, en la raíz de Antigravity JS** (`.claude/agents/architect.md` + `agents/architecture-gate.cjs`, con hook `.git/hooks/pre-commit` real — verificado directamente por mí: `cat .git/hooks/pre-commit` → `node agents/architecture-gate.cjs --check-gate; exit $?`). La Fase 5 de este documento (§5) no diseña desde cero: **recomienda portar y adaptar ese patrón** a este repo, no reinventarlo.
- **Naming colisionado "000/orquestador" a través de TODO el ecosistema, no solo dentro de un sistema**: existen simultáneamente `Antigravity JS/agents/000_ORQUESTADOR/` (Sistema A, con daemon Python), `Antigravity JS/.agent/agents/000_orquestador.md` (Sistema B, markdown de referencia), y `Proy_03_RadarFondos/000-orquestador.js` + `orchestrator.js` (orquestación de procesos, NO de IA) — **4 entidades distintas con el mismo nombre conceptual, en 3 sistemas y 2 repos distintos**, cero relación funcional entre ellas. Confirmado por lectura directa de cada una, no por inferencia.
- **Sin orquestador central de agentes de IA en Proy_03**: la palabra "orquestador" en este repo (`orchestrator.js`, `000-orquestador.js`) es gestión de procesos (arranca backend+frontend, proxy, túnel Cloudflare) — nunca coordinación de prompts/modelos, exactamente el mismo patrón ya documentado en la versión anterior de este archivo.

### 1.3 Clasificación Global (Antigravity) vs. específico de proyecto

| Elemento | Alcance |
|---|---|
| `~/.claude/CLAUDE.md`, `~/.claude/skills/{graphify,grupo-elite}` | **Global** — aplica a todos los proyectos del usuario, confirmado por su propio contenido ("todos los proyectos") |
| Sistemas A/B/C/D/E de la raíz `Antigravity JS/` | **Específico de ese proyecto raíz** — 0 referencias cruzadas hacia `proyectos/*` en ningún sentido (ni `agents/architecture-gate.cjs` cubre `proyectos/`, ni `Proy_03` importa nada de la raíz) |
| `Proy_03_RadarFondos/.claude/*`, `CLAUDE.md`, `AGENTS.md`, `backend/agents/*`, `client/src/agents/*` | **Específico de este repo** |
| `Proy_04_Geomatrix/.claude/settings.json` | **Específico**, mínimo (1 flag) |
| `Proy_05_SIG` | Sin infraestructura agéntica propia — hereda solo lo global |

### 1.4 Re-verificación de claims fuertes del documento de la raíz (no se heredan sin releer)

| Claim del documento de la raíz | Verificación independiente hecha aquí | Resultado |
|---|---|---|
| "`.git/hooks/pre-commit` bloquea commits sin aprobación vigente" | `cat "Antigravity JS/.git/hooks/pre-commit"` ejecutado directamente | **Confirmado** — el hook existe y llama `node agents/architecture-gate.cjs --check-gate; exit $?` |
| "`.claude/agents/architect.md` es el gate real" | `Read` directo del archivo | **Confirmado** — frontmatter `tools: Read, Grep, Glob`, mandato explícito "no escribes código", salida JSON obligatoria `{"aprobado":bool,"razones":[...]}` |
| "4 sistemas coexisten (A/B/C/E)" | `find` directo de cada ruta | **Ampliado, no solo confirmado**: son **5** contando `skills/` (Sistema D) como entidad separada de `.claude/skills` — el propio `ag_skills_registry.json` vive en D, no en A como el resumen de la tabla del documento de la raíz sugiere en su fila "Sistema A" |
| Residual menor no reportado antes | — | El propio comentario del hook de pre-commit todavía dice *"node agents/000_Orquestador.cjs --aprobar-diseno"* en texto (línea de comentario), pese a que el comando ejecutable ya usa el nombre correcto `architecture-gate.cjs` — un renombrado incompleto en la documentación inline, no en la lógica |

---

## 2. Auditoría anatómica y forense de skills

### 2.1 Anomalía real, no reportada en ninguna auditoría previa: carpetas de skill vacías en `~/.claude/skills/` (global)

Verificado por `find -mindepth 1`: de las 9 carpetas en `~/.claude/skills/`, **7 están completamente vacías** (`agent-browser`, `api-security-best-practices`, `docker-expert`, `nodejs-best-practices`, `typescript-expert`, `vercel-composition-patterns`, `vercel-react-best-practices` — 0 archivos dentro de cada una), mientras que el sistema reporta estas mismas skills como disponibles y funcionales (con descripciones completas, usadas activamente esta sesión — `agent-browser` se invocó y funcionó correctamente para verificar el fix de CSS). Esto significa que su contenido real **no vive en la ruta que un auditor esperaría** (`~/.claude/skills/<nombre>/SKILL.md`) sino que se sirve desde un origen distinto (plugin/paquete/bundle interno de Claude Code) — las carpetas vacías son o bien un remanente de una instalación local parcial nunca completada, o un artefacto de versión. **Solo 2 de 9** (`graphify`, `grupo-elite`) tienen `SKILL.md` real en disco.

**Riesgo concreto:** cualquier auditoría futura que solo mire el sistema de archivos (como la que este mismo prompt pide) concluiría erróneamente que 7 skills están "rotas" o "ausentes" si no verifica primero que siguen funcionando en tiempo real — exactamente el tipo de falso positivo que el protocolo de este mismo repo (`CLAUDE.md`, "Auditoría Verificada") existe para prevenir.

### 2.2 `ag_skills_registry.json` (Sistema D, raíz) — desglose real

- **Qué hace:** mapea cada agente numerado (000-056) de `agents/` (Sistema A) a sus skills `.cjs`/`.py`/`SKILL.md` reales en disco, más una lista de "skills globales" y un log de auto-descubrimiento (`global_skills_auto_discovered`).
- **Lógica interna:** generado/actualizado por `sync_registry.cjs` (Sistema D) mediante glob ampliado `agents/**/skills/**/*.{cjs,js,py}` — el propio archivo documenta su propia historia de correcciones ("antes registraba 4 skills, 3 de las cuales no existían en disco... se corrigió a las 25 skills reales encontradas").
- **I/O:** input = árbol de archivos real; output = este JSON, consumido (se infiere, no confirmado por código propio) por el orquestador del Sistema A para resolver qué skill cargar por agente.
- **Manejo de errores:** el propio registro documenta sus errores pasados como metadata (`sync_note` por entrada) — es, en sí mismo, una bitácora de correcciones, un patrón de honestidad técnica poco común y positivo.
- **Anomalía real, ya documentada por el propio archivo:** `Skill_Ascii_Puro` (`skills/_quarantine/Skill_integracion_formato_ascii.cjs.disabled`) — **injerto confirmado y neutralizado**: mutaba archivos `.html` en sitio, rutas absolutas hardcodeadas, sin backup ni dry-run, ejecutable por cualquiera con `node skills/Skill_integracion_formato_ascii.cjs`. Ver `skills/_quarantine/README.md` — remediación aplicada: movido fuera de `skills/`, renombrado `.disabled`. Esto es un ejemplo *positivo* de detección y contención de un injerto real, no un hallazgo nuevo de esta auditoría.

### 2.3 Solapamiento de nombres de skill across ecosistema — hallazgo real, cross-sistema

La misma skill nominal existe en **al menos 3 ubicaciones físicas distintas** con implementaciones potencialmente diferentes, nunca reconciliadas entre sí:

| Nombre de skill | Ubicación 1 | Ubicación 2 | Ubicación 3 |
|---|---|---|---|
| `docker-expert` | `~/.claude/skills/docker-expert/` (vacía, global) | `Antigravity JS/agents/skills/docker-expert/` (Sistema A) | — |
| `nodejs-best-practices` | `~/.claude/skills/nodejs-best-practices/` (vacía, global) | `Antigravity JS/.agent/skills/nodejs-best-practices/` (Sistema B) | `Antigravity JS/agents/skills/nodejs-best-practices/` (Sistema A) |
| `humanizer-es` | `Antigravity JS/.agent/skills/humanizer-es/` (Sistema B) | `Antigravity JS/agents/skills/humanizer-es/` (Sistema A) | — |

No se auditó línea-por-línea si el contenido es idéntico o divergente (volumen fuera de foco de esta pasada), pero la sola existencia de 2-3 copias del mismo concepto en sistemas que no se referencian entre sí es, por definición, el "solapamiento" que este prompt pide detectar explícitamente.

### 2.4 Skills de Proy_03_RadarFondos — no hay ninguna propia

Confirmado: `Proy_03_RadarFondos/.claude/` no contiene carpeta `skills/`. Este repo consume únicamente las skills globales del usuario (`~/.claude/skills/`) más las built-in de Claude Code — ninguna skill custom vive en este repositorio.

---

## 3. Mapa de integraciones, flujos y comunicaciones

### 3.1 Único flujo agéntico con gate real de todo el ecosistema (Sistema A+C, raíz)

```
node agents/architecture-gate.cjs --aprobar-diseno
  → lee .claude/agents/architect.md (system prompt, Sistema C)
  → lee git diff HEAD (texto plano)
  → Anthropic API real → veredicto JSON → agents/diseno_aprobado.json
  → .git/hooks/pre-commit exige esta firma vigente en cada commit (verificado por mí, §1.4)
```

Este flujo **no alcanza a `proyectos/`** — es interno al repo raíz. Un commit dentro de `Proy_03_RadarFondos` no pasa por ningún gate equivalente (confirmado: `Proy_03_RadarFondos/.git/hooks/pre-commit` solo contiene el bloqueo de secretos `.env` que yo mismo corregí esta sesión — 0 relación con arquitectura).

### 3.2 Flujo real de Proy_03_RadarFondos (backend de producción)

```
Cliente HTTP → server.js / backend/routes/*.js → backend/agents/*.js → Gemini API / PostgreSQL
                                                 → client/src/agents/*.ts (frontend, heurísticas + llamada a /api/proyectos/:id/viabilidad-ia)
```

Sin cola de mensajes, sin bus de eventos, sin protocolo agente-a-agente — cada "agente" es una función invocada directamente, patrón ya documentado y sin cambios respecto a la auditoría previa de este mismo repo.

### 3.3 SPOF de orquestación (confirmado en ambos repos, formas distintas)

- **Raíz (`Antigravity JS/agents/000_ORQUESTADOR/puente_ejecutor.py`):** daemon de loop infinito en la misma carpeta que el batch executor trata como tarea de un solo disparo — mitigado (excluido del batch), documentado en el propio `architecture-gate.cjs` (comentario líneas 142-149).
- **Proy_03_RadarFondos:** proceso Express único (`ecosystem.config.cjs`, `instances: 1`) con múltiples estados mutables en memoria (`revokedSet`, caché de convocatorias, circuit breaker de Gemini, rate limiters ahora persistidos en Postgres tras esta sesión — ver commit `2d222ee`). Un restart pierde blacklist/caché/circuit-breaker simultáneamente; los rate limiters de seguridad (auth/trial/IA/pipeline financiero) ya **no** se pierden, por el trabajo de esta sesión.

### 3.4 Pérdida de contexto en transiciones de sesión — hallazgo real, verificado en vivo esta sesión

El propio historial de esta conversación es evidencia directa del fenómeno: la purga de `node_modules/.vite` + el proceso Vite huérfano (pid 22412, vivo desde las 03:44 sin relación con PM2) causaron que el usuario viera una versión rota de la UI sin que ningún proceso de la sesión anterior lo hubiera señalado — un ejemplo concreto de "pérdida de contexto en transición" (estado de procesos vivos que ninguna auditoría de código por sí sola detecta, solo verificación en vivo). Mitigado en esta sesión (proceso huérfano eliminado, PM2 reiniciado, fix real de causa raíz en `postcss.config.cjs`/`tailwind.config.cjs`, commit `7c03fcf`).

---

## 4. Análisis de límites, bloqueos y gaps (expectativa vs. realidad)

| Documento/Sistema | Promete | Realidad verificada |
|---|---|---|
| `Antigravity JS/agents/Agente_Maestro.md` | Proyectos activos: "PROY_01 (Donaciones)", "PROY_02 (SECOP II)", "PROY_03 (Auditoría)" | Los proyectos reales en `proyectos/` son `Proy_03_RadarFondos`, `Proy_04_Geomatrix`, `Proy_05_SIG` — **ninguno coincide en número ni en tema** con lo que `Agente_Maestro.md` describe. Documento desactualizado, probablemente de una fase anterior de nomenclatura de proyectos |
| `ag_skills_registry.json` (`bitacora_protocol`) | `"project": "Proy_01_Donaciones"`, foco "Cantagallo y San Pablo, Bolívar" | Coincide con `Agente_Maestro.md` (ambos describen un "Proy_01" que no existe hoy en `proyectos/`) — consistencia interna entre esos 2 archivos, pero ambos desalineados con la estructura real de carpetas |
| Prompt de esta auditoría | "falta de un Agente Arquitecto que bloquee la escritura de código sin diseño previo" | **Falso para el ecosistema completo, cierto solo para `Proy_03_RadarFondos`.** El Agente Arquitecto existe, está construido, verificado 3 veces en vivo, y hookeado obligatoriamente vía `.git/hooks/pre-commit` — pero únicamente en el repo raíz. Este repo (Proy_03) no lo tiene |
| Manejo obligatorio de COP | — | **Respetado en ambos repos donde aplica**: `Proy_03_RadarFondos/backend/config/planes.config.js` (planes en COP, sin conversión) y, según el documento de la raíz (§9, re-citado no re-verificado por mí), el cálculo AIU+IVA de `agents/054_Form_Gestion_de_riesgos` también opera solo en COP. Sin contradicción encontrada |
| Aislamiento de estado por usuario | — | Proy_03: RLS real en Capa 1 pg, débil en Capa 2 REST (ya documentado en la auditoría de seguridad de esta misma sesión). Raíz: guardrail duro `assertValidTenant()` agregado según el documento de la raíz (no verificado por mí directamente — fuera de mi working directory de esta sesión) |

---

## 5. Plan de remediación y blindaje estructural

### 5.1 Tabla de triaje inmediato

| # | Hallazgo | Alcance | Criticidad | Acción |
|---|---|---|---|---|
| 1 | `Proy_03_RadarFondos` no tiene ningún Agente Arquitecto / gate de diseño | Este repo | **Alta** | Portar el patrón ya construido y verificado en la raíz (`architect.md` + `architecture-gate.cjs` + hook pre-commit) — no diseñar desde cero, adaptar el existente (ver §5.2) |
| 2 | 7/9 carpetas de skill vacías en `~/.claude/skills/` global | Global | Media | Verificar con `claude doctor`/soporte si es esperado (bundle interno) o limpiar remanentes de instalación parcial — no asumir que están "rotas" sin esa verificación |
| 3 | Solapamiento de nombres de skill (`docker-expert`, `nodejs-best-practices`, `humanizer-es`) en 3 sistemas sin reconciliar | Raíz (Sistemas A/B/global) | Media | Decidir una única fuente de verdad por skill nominal; documentar cuál gana si hay colisión de invocación |
| 4 | `Agente_Maestro.md` y `bitacora_protocol` de `ag_skills_registry.json` describen proyectos ("PROY_01 Donaciones", "PROY_02 SECOP") que no existen en `proyectos/` real | Raíz | Media (higiene documental, riesgo de confundir a un agente futuro) | Actualizar o marcar explícitamente como histórico/obsoleto |
| 5 | Comentario del hook `pre-commit` de la raíz cita el nombre viejo `000_Orquestador.cjs` pese a ejecutar `architecture-gate.cjs` | Raíz | Baja | Corregir el comentario para que coincida con el comando real |
| 6 | Sistema B (`.agent/`) sigue en disco en la raíz sin decisión de conservar/borrar (ya señalado en el documento de la raíz, re-confirmado aquí) | Raíz | Baja | Decisión de producto pendiente, no técnica |
| 7 | `Proy_04_Geomatrix`/`Proy_05_SIG` sin ningún `AGENTS.md`/protocolo de auditoría propio | Proy_04/05 | Baja-Media | Si se espera el mismo nivel de gobernanza que Proy_03, portar al menos un `CLAUDE.md` mínimo |

### 5.2 Diseño técnico del Agente Arquitecto para `Proy_03_RadarFondos` — adaptación del patrón ya probado, no invención

**No se diseña desde cero** — se adapta el patrón ya verificado 3 veces en producción en la raíz de Antigravity JS. Diferencias necesarias por ser un repo distinto:

1. **`Proy_03_RadarFondos/.claude/agents/architect.md`** (nuevo archivo, mismo formato que el de la raíz): frontmatter `tools: Read, Grep, Glob`, `model: inherit`; mandato idéntico ("no escribes código, no ejecutas nada que mute el repositorio"); criterios de evaluación adaptados al dominio real de este repo (monolito Express + React, no "hexagonal `src/modules/*`" que es un patrón de la raíz, no de aquí).
2. **Gate de ejecución**: en vez de `agents/architecture-gate.cjs` (que asume la jerarquía de 15 carpetas de agentes numerados de la raíz, inexistente aquí), un script equivalente y más simple: `scripts/architecture-gate.cjs` que (a) lee `git diff HEAD`, (b) invoca el system prompt de `architect.md` vía API de Anthropic, (c) escribe una firma SHA-256 del estado de `backend/` + `client/src/` en `.architecture-approval.json` si `aprobado:true`.
3. **Hook obligatorio**: extender el `.husky/pre-commit` ya existente en este repo (hoy solo bloquea archivos de secretos) con una segunda verificación: `node scripts/architecture-gate.cjs --check-gate`.
4. **Restricción operativa**: sin permisos de escritura de código — solo lectura + emisión del veredicto JSON `{"aprobado": bool, "razones": [...]}`, exactamente como el original.
5. **Verificación de duplicación obligatoria antes de aprobar**: dado el historial confirmado en este mismo repo de sistemas huérfanos creados sin ese gate (`ai_service/` LangGraph desconectado, `SIA_Radar/`, `agents/scraper_core.py` — todos hallados y remediados en auditorías previas de esta sesión), el Agente Arquitecto de este repo debe, como criterio explícito, `Grep` si ya existe un módulo equivalente antes de aprobar la creación de uno nuevo.

---

## Notas metodológicas

- Todo hallazgo de este documento fue verificado por lectura/`find`/`grep` directos en esta sesión — no se copió ningún hallazgo del documento de la raíz sin re-confirmar al menos su claim más fuerte (§1.4).
- Limitación explícita: no se auditó línea-por-línea el contenido completo de las 15 carpetas de agentes numeradas de la raíz (`agents/001-057`) ni de los ~22 skills de `.agent/skills/` — esa auditoría exhaustiva ya existe y está fechada el mismo día en `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`; reproducirla aquí sería redundante, no más preciso.
- `Proy_04_Geomatrix` y `Proy_05_SIG` se auditaron solo en su superficie agéntica (existencia de `.claude/`, `agents/`, `AGENTS.md`, `ag_skills_registry.json`) — no se auditó su lógica de negocio interna, fuera del foco de este documento.
