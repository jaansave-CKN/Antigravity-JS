# Auditoría Forense del Ecosistema Multiagente — Antigravity JS (raíz + proyectos)

**Fecha original:** 2026-08-08 · **Actualizado:** 2026-08-10 (re-ejecución de auditoría solicitada, ver §0-bis)
**Rol:** Chief AI Architect / Auditor Principal de Sistemas Multiagente / DevSecOps
**Alcance real (verificado, no asumido):** `c:\2026 AI EGIOC5\Antigravity JS\` completo — la raíz (proyecto propio, git independiente, HEAD `b5b4507`, sin commits nuevos desde el 2026-08-08 03:14, re-verificado hoy) + `proyectos/Proy_03_RadarFondos` (este repo, HEAD **`47d4f32`**, 8 commits nuevos desde la versión anterior de este documento) + `proyectos/Proy_04_Geomatrix` (git independiente) + `proyectos/Proy_05_SIG` + `~/.claude/` global del usuario.
**Metodología:** lectura directa de archivos reales, `find`/`grep`/`git` ejecutados contra disco, sin heredar hallazgos de auditorías previas sin releer el archivo que los sustenta. Donde ya existe una auditoría previa extremadamente reciente y verificable (la de la raíz `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`, fechada el mismo día, post-remediación), se cita como fuente y se **re-verifican sus claims más fuertes** en vez de copiarlas a ciegas — ver §1.4.

---

## 0-bis. Qué cambió realmente desde la versión anterior (2026-08-08 → 2026-08-10)

Esta auditoría fue solicitada de nuevo, con la misma estructura de 5 fases, sin que el prompt hiciera referencia a que ya existía una versión de este documento. Verificación en disco antes de reescribir nada:

- **Raíz `Antigravity JS/`:** `git log -1` → HEAD `b5b4507`, mismo commit que el sondeo de mtimes (`find agents .agent .claude skills -newermt "2026-08-08"`) confirma: sin cambios estructurales, solo artefactos esperables de uso normal del gate (`agents/diseno_aprobado.json` se reescribe cada vez que alguien corre `--aprobar-diseno`) y ediciones puntuales de 2 `IDENTITY.md`. **Las secciones §1–§4 de este documento sobre la raíz siguen vigentes tal cual, no se reescriben.**
- **`Proy_03_RadarFondos` (este repo): sí cambió, y de forma directamente relevante para el hallazgo #1 de la tabla de triaje de la versión anterior (§5.1).** Entre el commit `7c03fcf` (citado en la versión anterior) y `47d4f32` (HEAD actual) hay 8 commits nuevos, incluyendo `d822e22 feat(architecture): agente arquitecto + gate de diseno para RadarFondos 360` — **el hallazgo de máxima criticidad de este mismo documento ("Proy_03 no tiene ningún Agente Arquitecto") ya no es cierto**, con matices reales que se detallan en §1.2/§5.1 actualizados: existe una capa que sí funciona (el subagente `architect` de Claude Code, invocado 3 veces en la sesión que lo construyó, con 2 rechazos reales documentados) y una capa que existe en código pero nunca se activó (`scripts/architecture-gate.cjs` vía `.husky/pre-commit`, inerte por falta de `ANTHROPIC_API_KEY` en los 4 commits posteriores a su creación — verificado literal en el log de cada uno: *"[GATE_ARQUITECTURA] Inactivo — falta ANTHROPIC_API_KEY. No se bloquea el commit"*).
- El resto de los cambios en esos 8 commits son features de negocio del Formulador (AIU/IVA por DIAN, Punto de Equilibrio, conector Anexos→viabilidad financiera) — fuera del alcance de una auditoría de *arquitectura agéntica*, pero se mencionan en §3.2 porque `viabilidadAgent.js` y `AuditorForenseService.js` son, en sí mismos, servicios con forma de agente (nombre, responsabilidad de decisión, en un caso llamada real a Gemini) que no existían o no tenían ese alcance en la versión anterior.

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
    ├── Proy_03_RadarFondos/  (este repo, git independiente, HEAD 47d4f32 — actualizado desde 7c03fcf, 8 commits nuevos)
    │   ├── .claude/settings.json, settings.local.json    → permisos Bash acotados + MCP "stitch"
    │   ├── CLAUDE.md                                      → protocolo de auditoría verificada, comando "radiografia"
    │   ├── AGENTS.md                                      → corregido esta sesión (ya no describe SQLite)
    │   ├── backend/agents/{arbolObjetivosAgent,normativoAgent}.js   🟢 REALES, invocados desde server.js/rutas
    │   ├── client/src/agents/{000_formulador,NN_Viability_Agent,Radford360_Agent}.ts  🟢 REALES, lógica de negocio (heurísticas + wrappers a Gemini)
    │   ├── orchestrator.js / 000-orquestador.js            → orquestación de PROCESOS (PM2/proxy/túnel), NO de agentes IA
    │   ├── archive/ai_service_legacy/ (ex ai_service/)      🔴 AUSENTE de producción — Python FastAPI+LangGraph, purgado del árbol activo esta sesión (commit `2d222ee`), 0 caller vivo, decisión ya tomada (archivar, no conectar)
    │   ├── NO existe `.agent/`, NO existe `agents/` propio (carpeta), NO existe `ag_skills_registry.json` propio
    │   ├── 🟡 `.claude/agents/architect.md` — YA EXISTE (commit `d822e22`), invocado 3 veces real vía tool `Agent` desde su creación: 2 rechazos con motivo citando archivo+línea (polaridad de gate de dinero de inversionistas; 4 vacíos de especificación de un conector), 1 aprobación — funciona de verdad, no es un stub. Resuelve el hallazgo #1 de la versión anterior de este documento, con matiz (ver línea siguiente)
    │   └── 🟠 `scripts/architecture-gate.cjs` + `.husky/pre-commit` — YA EXISTE (mismo commit), pero inerte en los 4 commits posteriores: cada uno logueó *"[GATE_ARQUITECTURA] Inactivo — falta ANTHROPIC_API_KEY. No se bloquea el commit"* — nunca bloqueó un commit real. El enforcement que sí ocurrió fue disciplina de sesión, no un gate técnico duro
    ├── Proy_04_Geomatrix/  (git independiente)
    │   └── `.claude/settings.json` → `{"enableAllProjectMcpServers": true}` — sin agentes, sin skills propias, sin AGENTS.md
    └── Proy_05_SIG/  (git independiente)
        └── 0 archivos de infraestructura agéntica (`.claude`, `agents/`, `AGENTS.md`, `.agent/`) — confirmado por búsqueda directa
```

### 1.2 Desalineaciones de rol y ausencia de orquestador central

- **ACTUALIZACIÓN 2026-08-10 — YA NO CIERTO SIN MATIZ:** al momento de escribir la versión anterior de este párrafo (2026-08-08), Proy_03_RadarFondos no tenía Agente Arquitecto. Desde el commit `d822e22` sí existe (`.claude/agents/architect.md`), y hay evidencia real de uso en esta misma sesión: 3 invocaciones vía el tool `Agent`, 2 de ellas con veredicto `{"aprobado": false, ...}` y motivos citando archivo+línea real (rechazó un gate de reinversión con la polaridad invertida, y rechazó una primera versión de un conector Anexos→viabilidad financiera por 4 vacíos de especificación no resueltos). Esto es evidencia de un gate que **razona sobre el repo real**, no de un stub que aprueba todo. **El matiz real:** el mecanismo que efectivamente bloqueó código antes de escribirse fue disciplina conversacional (invocar el subagente y respetar su veredicto antes de codear), no un gate técnico que impida físicamente un commit — el gate técnico (`scripts/architecture-gate.cjs` + `.husky/pre-commit`) existe en código pero está inerte (ver abajo), igual que Stripe/Wompi en este mismo repo: construido, nunca activado. Los 2 agentes de producto (`arbolObjetivosAgent.js`, `normativoAgent.js`) y los 3 archivos de `client/src/agents/` se siguen invocando directamente desde rutas HTTP/páginas sin que NINGÚN gate — ni el conversacional ni el técnico — se interponga en tiempo de ejecución (el gate solo actúa en tiempo de diseño/commit, nunca en runtime, por diseño).
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

Este flujo **no alcanza a `proyectos/`** — es interno al repo raíz.

**ACTUALIZACIÓN 2026-08-10:** `Proy_03_RadarFondos` ahora sí tiene un flujo equivalente, propio, deliberadamente distinto en un punto crítico:

```
.claude/agents/architect.md (subagente Claude Code, tools: Read/Grep/Glob)
  → invocado manualmente vía tool Agent ANTES de escribir código (disciplina de sesión)
  → veredicto JSON {"aprobado": bool, "razones": [...]}
  → si aprobado:false, no se codea hasta resolver los motivos citados

scripts/architecture-gate.cjs + .husky/pre-commit (gate técnico, paralelo, independiente)
  → node scripts/architecture-gate.cjs --check-gate en cada commit
  → requiere ANTHROPIC_API_KEY — AUSENTE en este repo
  → resultado real en los 4 commits desde su creación: "[GATE_ARQUITECTURA] Inactivo... No se bloquea el commit"
```

La diferencia frente al patrón de la raíz es central: en la raíz, el hook de git **impide técnicamente** un commit sin firma vigente (verificado, §1.4). En Proy_03, el hook existe pero está en modo standby — el commit siempre pasa, con o sin fiscalización. La fiscalización real que sí ocurrió dependió de que el operador (yo, en esta sesión) invocara el subagente por decisión propia, no de un mecanismo que lo exigiera. Esto es una brecha real, no cerrada: si `ANTHROPIC_API_KEY` nunca se configura, el gate técnico de este repo seguirá siendo decorativo indefinidamente.

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
| Prompt de esta auditoría | "falta de un Agente Arquitecto que bloquee la escritura de código sin diseño previo" | **ACTUALIZADO 2026-08-10 — parcialmente resuelto, con matiz real.** En la raíz: existe, construido, y hookeado obligatoriamente (bloqueo técnico duro, verificado). En `Proy_03_RadarFondos`: existe desde `d822e22` y se usó 3 veces con evidencia real (2 rechazos citando archivo+línea), pero el bloqueo es **conversacional, no técnico** — el hook `.husky/pre-commit` que debería exigirlo está inerte por falta de `ANTHROPIC_API_KEY` (confirmado en 4 commits consecutivos). Ningún repo tiene el gate actuando en tiempo de ejecución (runtime), solo en tiempo de diseño/commit, por diseño |
| Manejo obligatorio de COP | — | **Respetado en ambos repos donde aplica**: `Proy_03_RadarFondos/backend/config/planes.config.js` (planes en COP, sin conversión) y, según el documento de la raíz (§9, re-citado no re-verificado por mí), el cálculo AIU+IVA de `agents/054_Form_Gestion_de_riesgos` también opera solo en COP. Sin contradicción encontrada |
| Aislamiento de estado por usuario | — | Proy_03: RLS real en Capa 1 pg, débil en Capa 2 REST (ya documentado en la auditoría de seguridad de esta misma sesión). Raíz: guardrail duro `assertValidTenant()` agregado según el documento de la raíz (no verificado por mí directamente — fuera de mi working directory de esta sesión) |

---

## 5. Plan de remediación y blindaje estructural

### 5.1 Tabla de triaje inmediato

| # | Hallazgo | Alcance | Criticidad | Acción |
|---|---|---|---|---|
| 1 | ~~`Proy_03_RadarFondos` no tiene ningún Agente Arquitecto / gate de diseño~~ **RESUELTO PARCIALMENTE (2026-08-10)** | Este repo | **Media** (bajó de Alta) | El subagente (`architect.md`) existe y se usó 3 veces con evidencia real. **Pendiente real:** configurar `ANTHROPIC_API_KEY` para que `scripts/architecture-gate.cjs` deje de estar inerte y el bloqueo pase de "disciplina conversacional" a "gate técnico duro" — sin esa key, un commit futuro sin invocar el subagente pasa igual, sin aviso |
| 2 | 7/9 carpetas de skill vacías en `~/.claude/skills/` global | Global | Media | Verificar con `claude doctor`/soporte si es esperado (bundle interno) o limpiar remanentes de instalación parcial — no asumir que están "rotas" sin esa verificación |
| 3 | Solapamiento de nombres de skill (`docker-expert`, `nodejs-best-practices`, `humanizer-es`) en 3 sistemas sin reconciliar | Raíz (Sistemas A/B/global) | Media | Decidir una única fuente de verdad por skill nominal; documentar cuál gana si hay colisión de invocación |
| 4 | `Agente_Maestro.md` y `bitacora_protocol` de `ag_skills_registry.json` describen proyectos ("PROY_01 Donaciones", "PROY_02 SECOP") que no existen en `proyectos/` real | Raíz | Media (higiene documental, riesgo de confundir a un agente futuro) | Actualizar o marcar explícitamente como histórico/obsoleto |
| 5 | Comentario del hook `pre-commit` de la raíz cita el nombre viejo `000_Orquestador.cjs` pese a ejecutar `architecture-gate.cjs` | Raíz | Baja | Corregir el comentario para que coincida con el comando real |
| 6 | Sistema B (`.agent/`) sigue en disco en la raíz sin decisión de conservar/borrar (ya señalado en el documento de la raíz, re-confirmado aquí) | Raíz | Baja | Decisión de producto pendiente, no técnica |
| 7 | `Proy_04_Geomatrix`/`Proy_05_SIG` sin ningún `AGENTS.md`/protocolo de auditoría propio | Proy_04/05 | Baja-Media | Si se espera el mismo nivel de gobernanza que Proy_03, portar al menos un `CLAUDE.md` mínimo |

### 5.2 Diseño técnico del Agente Arquitecto para `Proy_03_RadarFondos` — YA IMPLEMENTADO (commit `d822e22`), estado real verificado

Esta sección era, en la versión anterior de este documento, una propuesta de diseño. **Ya se construyó e implementó tal como se propuso, y se usó en producción 3 veces desde entonces.** Estado real de cada punto, verificado ahora:

1. **`Proy_03_RadarFondos/.claude/agents/architect.md`** — ✅ existe, frontmatter `tools: Read, Grep, Glob`, `model: inherit`, mandato "no escribes código". Evidencia de uso real (no solo de existencia): 3 invocaciones vía el tool `Agent` esta sesión, 2 rechazos con `{"aprobado": false, "razones": [...]}` citando archivo+línea real, 1 aprobación tras resolver los motivos del rechazo previo.
2. **Gate de ejecución (`scripts/architecture-gate.cjs`)** — ✅ existe (`--check-gate`, `--aprobar-diseno`), pero ⚠️ **nunca se activó de verdad**: requiere `ANTHROPIC_API_KEY`, ausente en `.env` de este repo. Log real de los 4 commits posteriores a su creación (`ba06231`, `a77ff33`, `47d4f32` y uno más): *"[GATE_ARQUITECTURA] Inactivo — falta ANTHROPIC_API_KEY. No se bloquea el commit (standby, igual que Stripe/Wompi/Sentry en este repo)."*
3. **Hook obligatorio (`.husky/pre-commit`)** — ✅ existe, llama `node scripts/architecture-gate.cjs --check-gate`, con resolución de PATH robusta (`command -v node` + fallback a ruta absoluta de Windows) para no romper commits si `node` no está en el PATH del shell que ejecuta el hook. Pero por el punto 2, su verificación siempre resuelve "inactivo, no bloquea" — el hook corre, pero no impide nada hoy.
4. **Restricción operativa** — ✅ cumplida en las 3 invocaciones reales: el subagente nunca escribió código, solo emitió veredictos JSON.
5. **Verificación de duplicación antes de aprobar** — ✅ cumplida en la práctica: en su segunda invocación real (conector Anexos→viabilidad), el subagente citó archivo+línea de servicios existentes (`EstresadoFinancieroService.js`, `ValorExponencialService.js`) para exigir que no se dupidara su lógica de agregación de `project_apu_lineas`.

**Único punto de remediación real que sigue pendiente:** configurar `ANTHROPIC_API_KEY` en este repo para que el punto 2 deje de ser standby y el gate pase de "depende de que el operador decida invocarlo" a "técnicamente imposible de saltarse". Sin esa key, el diseño de esta sección es correcto pero su enforcement real sigue siendo, en la práctica, voluntario.

---

## Notas metodológicas

- **Pase de actualización 2026-08-10:** esta auditoría se re-ejecutó a pedido explícito, sin que el prompt supiera que ya existía una versión previa (2026-08-08). En vez de reescribir el documento entero desde cero (que habría re-verificado hallazgos ya confirmados sin ganancia de precisión), se verificó primero qué cambió realmente en disco (`git log`, mtimes) y solo se actualizaron las secciones donde el estado real cambió — la raíz `Antigravity JS/` no tuvo commits nuevos y sus hallazgos siguen vigentes tal cual; `Proy_03_RadarFondos` sí cambió (8 commits, incluyendo la creación real del Agente Arquitecto que este mismo documento pedía como remediación) y esas secciones se reescribieron con evidencia nueva.
- Todo hallazgo de este documento fue verificado por lectura/`find`/`grep` directos en esta sesión — no se copió ningún hallazgo del documento de la raíz sin re-confirmar al menos su claim más fuerte (§1.4).
- Limitación explícita: no se auditó línea-por-línea el contenido completo de las 15 carpetas de agentes numeradas de la raíz (`agents/001-057`) ni de los ~22 skills de `.agent/skills/` — esa auditoría exhaustiva ya existe y está fechada el mismo día en `Antigravity JS/docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md`; reproducirla aquí sería redundante, no más preciso.
- `Proy_04_Geomatrix` y `Proy_05_SIG` se auditaron solo en su superficie agéntica (existencia de `.claude/`, `agents/`, `AGENTS.md`, `ag_skills_registry.json`) — no se auditó su lógica de negocio interna, fuera del foco de este documento.
