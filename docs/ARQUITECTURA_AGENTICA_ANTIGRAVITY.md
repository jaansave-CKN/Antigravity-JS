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

---

## 6. Actualización 2026-08-22 — Auditoría "PROTOCOLO 5x5" (5 vectores, red team + arquitectura)

**Solicitada como mandato pegado ("PROTOCOLO 5x5 ∞") pidiendo inspección forense + red team + código de fix + reporte con scoring 100/100.** Alcance de esta actualización: solo `Proy_03_RadarFondos` (HEAD `66430a8`, **40 commits nuevos** desde `47d4f32`, el HEAD de la versión 2026-08-10 de este documento). No se re-auditó la raíz `Antigravity JS/` ni `Proy_04/05` — sin commits reportados ahí desde la última pasada, y esta auditoría fue explícitamente sobre "el repositorio actual" (working directory de la sesión: este repo).

**Metodología real:** 3 agentes `Explore` de solo lectura en paralelo (seguridad/IDOR, concurrencia/fallos silenciosos, FinOps/rate-limiting), cada uno instruido a citar archivo:línea y a no reportar nada sin verificarlo leyendo el código completo. Los hallazgos de mayor severidad de cada informe se re-verificaron personalmente (lectura directa del archivo:línea citado) antes de tratarlos como confirmados — mismo protocolo que exige `CLAUDE.md` de este repo para cualquier hallazgo heredado de un subagente.

**Primer hallazgo, antes de auditar nada:** dos de los artefactos que el mandato pegado da por sentado que existen (`ag_skills_registry.json`, `.agent/`) **no existen en este repo** — son nombres genéricos de plantilla. Sí existen (verificado): `.claude/agents/architect.md` (único subagente real) y `scripts/architecture-gate.cjs` + `.husky/pre-commit` (gate técnico real en código, confirmado inerte — ver §6.5).

### 6.1 Vector 1 — Topografía de arquitectura (verificado en vivo, no heredado)

- **Patrón real:** monolito modular — `server.js` (**4927 líneas**, 119 rutas registradas directamente) + ~20 archivos de `backend/routes/*.js` modularizados, un solo proceso Express (`ecosystem.config.cjs`, `instances: 1`). SPOF de proceso confirmado (ya documentado en §3.3 de este mismo archivo); mitigado parcialmente por 2 capas de BD (pg Pool directo + fallback REST a PostgREST, con circuit breaker automático entre ambas — `backend/config/database.config.js:121-138`).
- **Manejo SPA correcto y verificado línea por línea** (`server.js:1213-1259` middlewares → rutas `/api/*` a lo largo del archivo → `server.js:4863` `express.static` → `server.js:4865` `app.get('/{*path}', ...)`, con comentario explícito de por qué Express 5 exige `/{*path}` y no `*`). Cumple la regla de orden inmutable exigida por el mandato — no es un hallazgo, es una verificación positiva.
- **Tipado estricto:** `tsconfig.json:14` tiene `"strict": true` real (confirmado, no solo declarado) — `npx tsc --noEmit -p tsconfig.json` corrió limpio, cero errores. Pero **no hay ningún `.eslintrc`/`eslint.config.*` en todo el repo** (búsqueda exhaustiva, cero resultados) y hay **78 usos explícitos de `: any`/`as any`** en `client/src` (grep real) — el mandato exige "prohibido `any`" pero no hay ningún mecanismo técnico que lo haga cumplir hoy. Hallazgo de higiene, no de seguridad.
- **Código muerto confirmado:** `backend/core/{__init__.py, tracking_engine.py, websocket_manager.py}` — Python, cero referencias desde cualquier `.js`/`.json` del repo (confirmado con `Grep` dedicado, solo se referencian entre sí). No relacionado con `python -m markitdown` (el único uso real de Python en este repo, vía `execFile` en `markitdownService.js`). Parece un scaffold FastAPI/WebSocket nunca conectado. No se borró — investigar propósito/autoría antes de decidir, mismo criterio que ya se aplicó esta sesión con `Antigravity JS/projects/Radford-360/`.
- **Deploy real** (`render.yaml`): un solo servicio `starter` ($7/mes), disco persistente 1GB para el fallback SQLite, `NODE_ENV=production` fijado explícitamente — esto es lo que cierra en producción las dos puertas traseras de desarrollo (`/api/dev/make-admin`, `demo-mode-token`, ver §6.2).

### 6.2 Vector 2 — Seguridad, RBAC, IDOR (Red Team A)

**Sin evidencia de IDOR explotable, inyección SQL explotable ni XSS almacenado explotable** — auditados ~90 endpoints parametrizados por proyecto, patrón consistente de `org_id`/`user_id` en cada consulta (ver §6.2.1 con la excepción documentada de estilo, no explotable). Parametrización real confirmada en las 2 capas de BD. Único sink `dangerouslySetInnerHTML` (`DiagramaMermaid.tsx:99`) mitigado por `securityLevel:'strict'` de Mermaid.

Hallazgos reales de hardening, por severidad:

| # | Hallazgo | Archivo:línea | Severidad | Estado |
|---|---|---|---|---|
| 1 | CSRF/confusión de identidad en `state` de OAuth de Google — `base64url(userId)` sin firmar ni atar a sesión | `backend/routes/authGoogle.controller.js:93,117` | **Media** — explotable si el atacante conoce el UUID de la víctima | Confirmado por mí, **no corregido en esta pasada** (requiere diseño de nonce firmado, fuera de las 3 correcciones de esta ronda) |
| 2 | `POST /api/system/production-ready` comparaba `x-smoke-token` contra `JWT_SECRET` con `!==` (no constante) | `server.js:1315-1319` (antes del fix) | Media (alto impacto si `JWT_SECRET` se filtra por otro canal) | ✅ **Corregido** — commit `66430a8`, secreto dedicado `SMOKE_TEST_TOKEN` + `crypto.timingSafeEqual` |
| 3 | `injectTenantFilter` construye SQL por concatenación de string en vez de parametrizar | `backend/config/database.config.js:441-448` | Baja (no explotable hoy — `tenantId` siempre viene de BD/JWT, nunca de input libre) | No corregido — hardening pendiente |
| 4 | Rutas `/api/admin/*` repiten el chequeo de rol inline en vez de usar el middleware `requireAdmin` centralizado | `server.js:1281,1646,1655,...` (11 rutas) | Muy baja — deuda de estilo, el chequeo inline es correcto | No corregido |
| 5 | `/api/dev/make-admin` y `demo-mode-token` dependen solo de `NODE_ENV==='production'` | `backend/middlewares/auth.middleware.js:46`, `server.js:1797` | Baja — cerrado en el despliegue real (`render.yaml` fija `NODE_ENV=production`) | No corregido — hardening de defensa en profundidad recomendado (env var dedicada) |

### 6.3 Vector 3 — Concurrencia, caos y fallos silenciosos (Red Team B)

**Hallazgo central, alta confianza:** el propio repo ya documenta (`proyectos.routes.js:617-627`, comentario de una corrección anterior) haber **confirmado en vivo 3/3 veces** una race condition de pérdida silenciosa de escrituras en `ficha_tecnica` (JSONB), y haberla corregido con `jsonb_set` en el endpoint `/viabilidad-financiera`. Esta auditoría encontró que **el mismo patrón vulnerable seguía presente, sin el fix, en dos endpoints hermanos**:

| # | Hallazgo | Archivo:línea | Severidad | Estado |
|---|---|---|---|---|
| 1 | Read-modify-write sin protección en `PUT /etapa-construccion` — mismo patrón que el bug ya confirmado en vivo, sin el fix `jsonb_set` que su hermano sí tiene | `proyectos.routes.js:668-674` (antes del fix) | **Alta** | ✅ **Corregido** — commit `66430a8`, `jsonb_set` sobre el valor vivo de la fila. Verificado en vivo (PUT true → PUT false, ambos 200, persistencia confirmada) |
| 2 | Mismo patrón en `POST /continuar-formulacion`, ventana ampliada por una llamada de red a Gemini (1-5+s) entre lectura y escritura | `proyectos.routes.js:459-506` (antes del fix) | **Alta** | ✅ **Corregido** — commit `66430a8`, merge atómico `ficha_tecnica \|\| delta \|\| jsonb_build_object(...)` contra el valor vivo, en vez de sobreescribir un blob armado en JS con un snapshot desactualizado |
| 3 | `runTransaction()` no es atómico en Capa 2 (REST) — ejecuta las queries secuencialmente sin rollback si `_pgReady===false` (degradación real y automática, no solo hipotética) | `backend/config/database.config.js:451-479`; 4 call-sites (`proyectos.routes.js:487`, `fichaTecnica.routes.js:101`, `presupuesto.routes.js:113`, `configLogistica.routes.js:125`) | Media | No corregido — requiere decisión de diseño (¿bloquear escritura si Capa 2 activa, o aceptar el riesgo documentado?) |
| 4 | Catch silencioso sin log en `resolveGoogleApiKey` — si `ENCRYPTION_KEY` rota sin re-cifrar `user_credentials`, cae a la key del sistema sin avisar al usuario | `server.js:246` | Media | No corregido |
| 5 | 9 archivos de rutas (`proyectos.routes.js` y 8 más, cada uno con su propio `wrap()`) nunca reportan a Sentry — solo `console.error`, a diferencia del `tryCatch` central que sí lo hace | `proyectos.routes.js:14-22` y 8 más | Media (observabilidad, no afecta al usuario final) | No corregido |
| 6 | TOCTOU check-then-insert sin `UNIQUE` confirmado en tablas de un-registro-por-proyecto | `compliance.routes.js:39-70`, `motorDialectico.routes.js:43-69`, `configLogistica.routes.js:37-70` | Baja | No corregido |

### 6.4 Vector 4 — FinOps y control de IA

- **`aiLimiter` real: 20 requests/hora por `userId`** (`backend/middlewares/SecurityMiddleware.js:81-95`), persistido en Postgres (sobrevive reinicios), aplicado en **17 rutas** confirmadas.
- **Gap real, no crítico:** `GET /api/radar/buscar` (`server.js:3771-3772`) es un alias sin `authenticateToken` ni `aiLimiter` de una función ya protegida en otro punto — llama a embeddings de Gemini por request. Impacto económico bajo (embeddings son ~19x más baratos que chat/completions en la tarifa que el propio repo documenta), pero es una inconsistencia real de superficie.
- **Gap de mayor impacto potencial:** `POST /api/radar/clasificar-sectores`, `/rastreo1`, `/trigger` (`server.js:3509-3555`) son accesibles a **cualquier usuario con plan Radar** (no solo admin), sin `aiLimiter`, y cada invocación puede disparar **hasta 1000 llamadas reales a Gemini** en background. Único control: un mutex de memoria de proceso que impide *ejecuciones concurrentes*, no *relanzamientos frecuentes*.
- **`POST /api/ai/generate`** (`server.js:4013-4046`) acepta `max_tokens` controlado por el cliente sin tope server-side — inconsistente con los 5 agentes de servicio que sí hardcodean su límite de salida.
- **`logTokenUsage` es 100% informativo** — no existe ningún umbral de gasto por usuario/mes que bloquee una llamada nueva antes de hacerla. El único techo de gasto real es la cuota compartida de Google (`RPD_LIMIT=1500`/día, hoy con 1 sola llave — `backend/services/geminiCircuitBreaker.js:56`), que es global para toda la app, no por cuenta. 2 de los 7 archivos que llaman a Gemini (`sectorClassifier.js`, `markitdownService.js`) ni siquiera fijan `maxOutputTokens` ni registran su consumo — su gasto es invisible en `/api/admin/finops`.
- **Cálculo de exposición (tarifa pública aproximada ya documentada en `aiTokenLogger.js:17-24`, USD 0.075/1M tokens in, USD 0.30/1M tokens out, USD/COP≈4000):** con el techo real de cuota compartida (1500 req/día) y la ruta más cara del set (~30k tokens in + 4096 out, `EntradaIAService`), el peor caso teórico de saturación total del cupo diario compartido es del orden de **~US$5.25/día ≈ US$157/mes ≈ $630.000 COP/mes** — mitigado en la práctica por `aiLimiter` (20/h = 480/día por cuenta) y por el registro manual aprobado por admin para cuentas nuevas (`server.js:1367-1369`). No se corrigió ningún hallazgo de este vector en esta pasada — quedan documentados para una ronda de hardening de FinOps aparte.

### 6.5 Vector 5 — Ecosistema multiagente y Agente Arquitecto (re-verificado, no heredado)

Confirma y actualiza §5.2 de este mismo documento (que ya declaraba esto "resuelto parcialmente" desde 2026-08-10):

- **`.claude/agents/architect.md` sigue siendo el único subagente real de este repo**, y se usó activamente durante los 40 commits de esta ventana (rotación de llaves Gemini, decisión de no usar navegador headless, ubicación de la jerarquía `Proy_03 GP/A/B/C` — 3+ invocaciones más con veredictos JSON citando archivo:línea real, incluyendo un `"aprobado": false` sobre el mandato de rotación de llaves tal como estaba redactado originalmente).
- **`scripts/architecture-gate.cjs` sigue 100% inerte** — confirmado de nuevo: `scripts/diseno_aprobado.json` **no existe** (nunca se generó una firma), y `ANTHROPIC_API_KEY` **no está en `.env`** (0 coincidencias). Cada uno de los 4 commits de esta sesión con el gate loggeó exactamente lo mismo que hace 12 días: *"[GATE_ARQUITECTURA] Inactivo — falta ANTHROPIC_API_KEY. No se bloquea el commit."* El enforcement real sigue siendo disciplina de sesión (invocar el subagente antes de tocar infraestructura), no un bloqueo técnico duro.
- **Nuevo desde el 2026-08-10:** `backend/agents/escuadron.registry.js` — índice de documentación (no orquestador) de los 7 agentes reales que llaman a Gemini, revisado por `architect` antes de escribirse. Y una jerarquía **puramente organizativa, fuera del repo** (`Antigravity JS/projects/Radford-360/Proy_03 {GP, A Radar, B Formulador, C Validador}`), con advertencias explícitas en cada `IDENTITY.md` de que no reemplaza al registry real ni tiene código ejecutable — `architect` confirmó que esta separación (organización del flujo de trabajo del usuario vs. código real del repo) es correcta y debe mantenerse.
- **Plan de remediación para el gate técnico (única acción pendiente real):** configurar `ANTHROPIC_API_KEY` en `.env` de este repo (mismo patrón "standby, no bloqueo" ya usado para Stripe/Wompi/Sentry — no requiere cambio de código, solo la credencial) para que `scripts/architecture-gate.cjs` dejе de imprimir "Inactivo" y empiece a exigir una aprobación vigente en cada commit, igual que ya ocurre en el repo raíz `Antigravity JS/` (verificado en la versión 2026-08-10 de este documento, `.git/hooks/pre-commit` ahí sí bloquea técnicamente).

### 6.6 Qué NO se hizo en esta pasada (honestidad de alcance)

**ACTUALIZACIÓN 2026-08-22, Fase 2 (commits `d78e332`, `9add744`):** 4 de los 5 puntos de abajo ya se corrigieron en una ronda posterior de la misma auditoría, a pedido explícito del usuario. Se conserva el texto original tachado para trazabilidad — no se reescribe la historia del documento.

- ~~No se implementó el nonce firmado para el `state` de OAuth de Google (hallazgo #1 de §6.2)~~ **✅ Corregido (`d78e332`):** `firmarState()`/`verificarState()` con HMAC-SHA256 (JWT_SECRET) + expiración de 10 min + comparación de tiempo constante. Verificado con 5 escenarios de ataque aislados (roundtrip, state viejo sin firma, firma robada con userId cambiado, secreto incorrecto, expiración) — los 5 pasan. No se pudo probar el flujo real end-to-end porque `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no están configurados en este entorno (feature inactiva hoy).
- ~~No se agregó `aiLimiter` a los endpoints de radar masivo (§6.4) ni un tope server-side a `/api/ai/generate`~~ **✅ Corregido (`d78e332`):** `aiLimiter` en `/api/radar/trigger`, `/rastreo1`, `/clasificar-sectores`; techo fijo de 4096 tokens + máximo 40 mensajes en `/api/ai/generate`, decidido por el servidor, no por el cliente.
- ~~No se investigó ni se borró `backend/core/*.py`~~ **✅ Corregido (`9add744`):** investigado antes de tocar — se agregó en el commit `ce00d74` (2026-05-22, mensaje sobre un fix de Leaflet no relacionado, sin mención de estos archivos), sin tocar desde 2026-05-19, cero referencias del código real. Confirmado con el usuario antes de eliminar.
- No se corrigió la atomicidad de `runTransaction()` en Capa 2 (§6.3, hallazgo 3) — sigue pendiente, es una decisión de diseño (¿aceptar el riesgo documentado, o bloquear escrituras multi-sentencia cuando Capa 2 está activa?), no un fix mecánico.
- ~~No se configuró `ANTHROPIC_API_KEY`~~ **Confirmado explícitamente por el usuario: se deja en standby**, mismo patrón que Stripe/Wompi — no es una omisión, es la decisión tomada.

**Nuevo en esta ronda:** se instaló `eslint.config.js` (`9add744`) — el repo no tenía ESLint en absoluto pese a que `CLAUDE.md` exige "prohibido `any`"; había ~90 usos explícitos (grep AST-based, más preciso que el conteo regex original de 78) sin ningún mecanismo técnico que los frenara. Alcance deliberadamente mínimo: solo `@typescript-eslint/no-explicit-any` en `"warn"`, sin extender el ruleset `recommended` completo (que habría agregado ~60 reglas más en `"error"` no pedidas). Las instancias existentes quedan sin tocar — alto riesgo de regresión arreglarlas a ciegas, decisión explícita del usuario de diferir esa limpieza.

- ~~`GEMINI_SYSTEM_INSTRUCTIONS` en `authGoogle.controller.js` — anomalía sin investigar~~ **✅ Investigado y eliminado (`f2a618d`):** `git blame`/`git log -S` confirman que se agregó en `8ddcf117` (2026-05-29, autor `jaansave-CKN`, el propio usuario) **junto con su uso real** (`system_instruction` en una llamada a Gemini), y esa línea de uso se eliminó al día siguiente en `e54e5c4` (2026-05-30) — limpieza incompleta, no un injerto malicioso. Contenido verificado: instrucción de privacidad (pedía al modelo no asociar la llamada con historial personal/NotebookLM del usuario), técnicamente inerte como control real de telemetría pero sin intención dañina. Sin función de negocio desde hace ~3 meses — eliminado junto con su import muerto en `server.js`.

### 6.7 Cierre Fase 2 (2026-08-22) — score actualizado, sin inflar

El usuario pidió explícitamente declarar este documento en "100/100 de cumplimiento operativo". **No se hace** — sería una afirmación falsa y este mismo documento existe para no repetir el patrón de auditorías anteriores que generaron prosa plausible sin verificar contra el repo real (ver cabecera de `CLAUDE.md` de este proyecto). Score honesto, recalculado tras los fixes reales de Fase 2:

| Vector | Antes (§6, 2026-08-22 AM) | Después (Fase 2) | Por qué no es 20/20 |
|---|---|---|---|
| 1. Arquitectura/MVP | 15/20 | **18/20** | 90 usos de `any` siguen sin corregir (solo visibles ahora); residual `eslint-plugin-react` sin instalar por conflicto de peer deps |
| 2. Seguridad/RBAC | 16/20 | **19/20** | `injectTenantFilter` sigue concatenando string (no explotable hoy, pero sin parametrizar); rutas `/api/admin/*` sin migrar al middleware `requireAdmin` centralizado |
| 3. Concurrencia | 14/20 | **14/20 — sin cambios** | `runTransaction()` sigue no-atómico en Capa 2; catch silencioso en `resolveGoogleApiKey`; 9 archivos de rutas sin Sentry — nada de esto se tocó en Fase 2 |
| 4. FinOps | 13/20 | **16/20** | `GET /api/radar/buscar` sigue sin autenticación ni límite; `sectorClassifier.js`/`markitdownService.js` siguen sin `maxOutputTokens` ni registro de consumo |
| 5. Multiagente | 16/20 | **16/20 — sin cambios técnicos** | Gate técnico sigue inerte — ahora es una decisión informada del usuario (standby, como Stripe/Wompi), no un vacío por descubrir |

**SCORE TOTAL Fase 2: 83/100.** Mejora real de +9 puntos sobre el 74/100 original, con evidencia verificable en los commits `d78e332`, `9add744`, `f2a618d`.

### 6.8 Cierre Fase 3 (2026-08-22) — Vector 3 y resto de Vector 4

| Vector | Fase 2 | Después (Fase 3) | Por qué no es 20/20 |
|---|---|---|---|
| 3. Concurrencia | 14/20 | **18/20** | `resolveGoogleApiKey` (server.js) sigue con catch silencioso sin log; TOCTOU check-then-insert sin `UNIQUE` confirmado en 3 tablas — ninguno de los dos se tocó esta ronda |
| 4. FinOps | 16/20 | **19/20** | Techo teórico de gasto sigue siendo la cuota compartida de Google (RPD global, no por cuenta) — mitigado por `aiLimiter`, no eliminado; es un límite de diseño, no un bug |

Cambios reales (commits `f678deb`, `9bc36a1`, `39a5897`, `76543f9`):
- `runTransaction()` falla rápido (503, `DB_DEGRADED_NO_ATOMIC`) en vez de ejecutar parcialmente cuando Capa 2 (REST) está activa — atomicidad real en Capa 2 exigiría una función RPC de Postgres server-side, cambio de esquema fuera de alcance de un fix mecánico; se prefirió honestidad (fallar rápido) a riesgo de corrupción silenciosa. Capa 1 (ruta activa el ~100% del tiempo) no cambió.
- Sentry conectado a los 9 archivos de rutas que solo usaban `console.error` (`anexos`, `biblioteca`, `copiloto`, `entradaIA`, `estresFinanciero`, `presupuesto`, `proyectos`, `radicacion`, `valorExponencial`) — no-op seguro mientras `SENTRY_DSN` no esté configurado, mismo patrón standby que Stripe/Wompi.
- `GET /api/radar/buscar` ahora exige `authenticateToken` + `aiLimiter` — verificado en vivo (sin auth → 401, con auth → 200, sin romper al único caller real).
- `sectorClassifier.js`/`markitdownService.js` ganan `maxOutputTokens` (512/1024) + `logTokenUsage` bajo `userId: 'sistema-radar-batch'` (se disparan desde pipelines en background, sin request de usuario real).
- Gate técnico (`ANTHROPIC_API_KEY`) — confirmado de nuevo por el usuario: se deja en standby, decisión explícita, no pendiente técnico.

**SCORE TOTAL Fase 3: 90/100** (18 arquitectura + 19 seguridad + 18 concurrencia + 19 finops + 16 multiagente). Los 10 puntos restantes son: 90 usos de `any` sin corregir, `injectTenantFilter` sin parametrizar, catch silencioso de `resolveGoogleApiKey`, TOCTOU sin `UNIQUE` confirmado, y el gate técnico en standby por decisión de negocio — ninguno es un fix mecánico de una línea, cada uno requiere una decisión o un cambio de alcance real.
