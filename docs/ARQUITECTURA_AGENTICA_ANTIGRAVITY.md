# ARQUITECTURA AGÉNTICA ANTIGRAVITY — Auditoría Forense del Ecosistema Multiagente
**Fecha:** 2026-08-08 · **Auditor:** Chief AI Architect / Auditor Principal de Sistemas Multiagente / DevSecOps
**Alcance:** los 4 árboles de definición de agentes en el proyecto raíz — `agents/`, `.agent/`, `.claude/`, `skills/` — más los registros (`ag_skills_registry.json`, `skills-lock.json`) y scripts de orquestación. Los subproyectos de `proyectos/` tienen sus propios árboles de agentes (`.agents`, `.claude`, `.clinerules`, `.kilo`) independientes y con su propio repo git — quedan fuera de este documento por el mismo criterio de aislamiento ya aplicado en las radiografías previas (`.gitignore:19-24`).
**Regla de evidencia:** cada hallazgo cita el archivo real en disco. Donde el volumen de archivos hizo impracticable leer el 100% línea por línea (ej. los 25 skills de `agents/000_ORQUESTADOR/skills/`), se declara el método de muestreo usado — nunca se generaliza sin evidencia directa.

---

## 0. EL HALLAZGO MARCO — cuatro sistemas de agentes coexisten, sin saberlo entre sí

Antes de listar agentes individuales, hay que establecer el hecho estructural que explica casi todos los hallazgos posteriores. El propio repositorio ya lo tenía documentado — `skills/ag_skills_registry.json:5` dice textualmente:

> *"4 sistemas de agentes coexisten (A=agents/, B=.agent/, C=.claude/agents/, E=opencode.json); solo A es ejecutado por este registro."*

Verificado en disco, cada sistema es de un origen y propósito distinto:

| Sistema | Ruta | Origen | Naturaleza | ¿Se ejecuta hoy? |
|---|---|---|---|---|
| **A** | `agents/` | Autoría propia (Antigravity OS) | 15 agentes de negocio (Radar/Formulador, IDs 000-057) + scripts de orquestación | Parcial — ver §3 |
| **B** | `.agent/` | Scaffold de terceros ("Antigravity Kit", `.agent/ARCHITECTURE.md:1-14`) | 21 agentes y 36 skills **genéricos** de desarrollo web/mobile, sin ninguna referencia a Radar/Formulador/COP | No — nunca importado por `server.js` ni `src/` |
| **C** | `.claude/` | Claude Code (nativo) | 1 subagente real (`architect.md`) + 12 skill-packs oficiales de Firebase (`firebase/agent-skills`, hash-lockeados en `skills-lock.json`) | **Sí** — `architect.md` es el gate de arquitectura real, verificado en vivo hoy (ver `docs/INFORME_RECONCILIACION_CIERRE_2026-08-07.md`) |
| **E** | `opencode.json` | Herramienta de terceros (OpenCode CLI) | Config de un asistente de código distinto, con su propio modelo por defecto (`google/gemini-2.0-flash-lite` vía OpenRouter) | No — herramienta de IDE personal, gitignoreada (`.gitignore:16`) |

**Por qué importa:** el Sistema B (`.agent/`) es un *injerto completo* — un kit genérico de terceros, sin ninguna adaptación al dominio real del proyecto (ni una mención a MGA, SGR, COP, Radar o Formulador en sus 21 agentes), que además **estuvo trackeado en git por error** hasta la corrección de hoy (`.gitignore` tenía `/.agents/` con "s", nunca coincidía con la carpeta real `.agent/` sin "s" — ver `docs/INFORME_RECONCILIACION_CIERRE_2026-08-07.md §0`). Su sola presencia en el repo, indistinguible a primera vista del Sistema A por comparten el prefijo "agent", es la causa raíz de la confusión de nombres que seguirá apareciendo en este documento.

---

## 1. INVENTARIO TOTAL Y ORGANIGRAMA JERÁRQUICO

### 1.1 Sistema A — `agents/` (agentes de negocio, autoría propia)

**Clasificación transversal vs. específico:**
- **Transversales (usados por más de un agente de negocio):** `agents/skills/*` (3 `.cjs`: `Skill_Sync_MCP`, `Skill_Config_Sistema`, `Skill_Config_Honestidad`, más 16 skills en formato `SKILL.md` de propósito genérico — docx, browser-automation, stitch-design, etc.) y `skills/` en la raíz del repo (`Skill_Bitacora_Sistema.cjs`, `Skill_integracion_auditoria_pro.cjs`, `arquitectura/*.cjs`, `seguridad/Skill_Protocolo_Fuente_Unica.cjs` — esta última **sí está en uso real**, importada por `src/modules/radar/m1Pipeline.js:11`).
- **Específicos de proyecto (Radar Formulador 360):** las 15 carpetas numeradas `000`-`057`.

```
000_ORQUESTADOR  (Coordinador General — IDENTITY.md)
│
├── Radar 360 (Ecosistema Prioritario, IDENTITY.md §"Ecosistema Prioritario")
│   ├── 005_Radar1_minero        — rastreo/minería (0 skills .cjs, solo .py sueltos)
│   ├── 006_Radar2_Estratega     — semáforo/estrategia (0 skills, solo IDENTITY.md)
│   └── [huérfano en 000_ORQUESTADOR/skills/: Radar_Master, Radar_Supervisor,
│        Coordinador_Radar, Geo_Recognizer, Matriz_Sectores — ver §2.2, NO conectado
│        a 005/006 actuales]
│
├── Formulador 360 (Serie 300, IDENTITY.md §"Matriz de Ruteo")
│   ├── 050_Formulador_proy      — ficha MGA (1 skill real)
│   ├── 051_Form_Lluvia_de_ideas — viabilidad conceptual (1 skill real)
│   ├── 052_Form_Administrativo  — SECOP/RUP/BPIN (1 skill real; IDENTITY.md mucho
│   │                              más elaborado que la implementación — ver §4)
│   ├── 054_Form_Gestion_de_riesgos — riesgos/POT (1 skill real)
│   ├── 056_Form_Evaluador       — motor SIV + Red Team (1 skill real; IDENTITY.md
│   │                              describe un motor de certificación adversarial de
│   │                              6 pilares que NO existe en el código — ver §4)
│   └── 002_redactor_tecnico     — documento final (3 skills reales)
│
├── Soporte transversal
│   ├── 001_gestor_datos         — OCR/inventarios (5 skills, incluye paddleocr real)
│   ├── 015_intelligence-core    — 5 scripts .ps1 (gatekeeper, maestro_forense,
│   │                              processor, project_manager, war_room) — sin
│   │                              relación con ningún endpoint de server.js
│   └── 03-analista-secop        — compliance (0 skills, solo IDENTITY.md)
│
├── Agentes referenciados en IDENTITY.md pero AUSENTES en disco (fantasmas)
│   ├── 100_reparador_codigo     — "opera 24/7... acceso GLOBAL a todos los proyectos"
│   │                              (IDENTITY.md:30) — carpeta `agents/100_*` NO EXISTE
│   └── 09-legal-licitaciones    — (IDENTITY.md:23) — carpeta `agents/09-*` NO EXISTE
│
├── Agentes fuera del dominio Radar/Formulador (mezcla de dominio)
│   ├── 07-ing-concreto_GFRC        — ingeniería de concreto (0 skills)
│   ├── 08-estratega-neuromarketing — marketing (0 skills)
│   └── 14-analista-comportamiento  — comportamiento (0 skills)
│
└── Scripts de orquestación sueltos en la raíz de agents/ (NO son agentes,
    son herramientas de proceso — inventariados en detalle en §2.3)
    ├── 000_Orquestador.cjs   — REAL, gate de arquitectura + batch executor
    ├── 000_VERIFICADOR.cjs   — diagnóstico mínimo (3 checks hardcoded)
    ├── index.js              — MUERTO (importa ./config.js, eliminado)
    ├── ContextManager.js     — MUERTO (referencia proyecto purgado)
    ├── Agente001/050/051/052.js — MUERTOS (solo importados por index.js)
    ├── skill-dispatcher.cjs  — ROTO (schema de registry obsoleto)
    ├── auditor-integridad.cjs — FÓSIL (checa archivos que nunca existieron así)
    ├── bridge-server.cjs     — HUÉRFANO (2° servidor Express, puerto 3001)
    ├── extractor-pro.cjs, generar_reporte.cjs, vision-engine.cjs,
    │   check_image.cjs, clean_excel.cjs, fetch_municipios.cjs,
    │   read_excel.cjs, read_image.cjs — utilidades CLI puntuales, no auditadas
    │   individualmente en este documento (fuera del foco "sistema multiagente")
```

### 1.2 Sistema B — `.agent/` (scaffold genérico, 21 agentes / 36 skills / 11 workflows)

Inventario íntegro según su propio `ARCHITECTURE.md` (no requiere lectura archivo-por-archivo porque el propio sistema se autodocumenta completo en un único índice):

`000_orquestador` (¡nombre colisiona con Sistema A!), `orchestrator`, `project-planner`, `frontend-specialist`, `backend-specialist`, `database-architect`, `mobile-developer`, `game-developer`, `devops-engineer`, `security-auditor`, `penetration-tester`, `test-engineer`, `debugger`, `performance-optimizer`, `seo-specialist`, `documentation-writer`, `product-manager`, `product-owner`, `qa-automation-engineer`, `code-archaeologist`, `explorer-agent`. Ninguno menciona MGA, Radar, Formulador, COP ni ningún término del dominio real del producto — son personas genéricas de un kit de desarrollo, no agentes de este proyecto.

### 1.3 Sistema C — `.claude/` (Claude Code nativo, el único con gate real)

- `agents/architect.md` — **el único subagente de todo el ecosistema con implementación completa y verificada en producción hoy**: solo lectura (`tools: Read, Grep, Glob`), veredicto JSON obligatorio, invocado por `agents/000_Orquestador.cjs:pedirVeredictoArquitecto()` vía API real de Anthropic. Ver §3.1 para el flujo completo.
- `skills/*` (12 carpetas) — paquetes oficiales de Firebase (`firebase-basics`, `firebase-auth-basics`, `firebase-firestore-*`, `firebase-data-connect`, `firestore-security-rules-auditor`, `developing-genkit-{js,go,dart}`, etc.), descargados con hash de integridad en `skills-lock.json` desde el repo `firebase/agent-skills`. Documentación de referencia, no ejecutables — no hay hallazgos de anomalía aquí, es la parte más prolija del ecosistema.

### 1.4 Sistema E — `opencode.json`

Un único archivo de configuración: modelo por defecto `google/gemini-2.0-flash-lite` vía OpenRouter, MCP habilitado. Herramienta de IDE del desarrollador, no del producto — gitignoreada correctamente.

### 1.5 Desalineaciones de rol detectadas

- **¿Falta un nodo orquestador central?** No — hay **demasiados**: `agents/000_Orquestador.cjs` (real), la carpeta `agents/000_ORQUESTADOR/` (con su propio daemon `puente_ejecutor.py`), y `.agent/agents/000_orquestador.md` (Sistema B, genérico). Tres entidades con el mismo nombre, dos de ellas sin relación funcional entre sí.
- **¿Hay agentes ejecutores sin validación previa?** Sí, en el sentido de que `ejecutarTodosLosAgentes()` (`agents/000_Orquestador.cjs:294-302`) exige un `diseno_aprobado.json` vigente para correr — pero ese archivo solo se refresca corriendo `--aprobar-diseno` manualmente (nadie lo dispara automáticamente antes de una sesión de trabajo). El gate existe, pero no es un bloqueo automático de commit — ver Plan de Remediación §5.2.

---

## 2. AUDITORÍA ANATÓMICA Y FORENSE DE SKILLS

### 2.1 Metodología de muestreo

`agents/` contiene más de 60 archivos de skill entre `.cjs`/`.js`/`.py`/`.md` (confirmado por `skills/ag_skills_registry.json`, que ya cataloga la mayoría). Se leyeron íntegramente los scripts de orquestación de nivel raíz (los que determinan qué se ejecuta y cuándo) y se muestrearon representativamente los skills de negocio de mayor riesgo (los del "Radar legacy" en `000_ORQUESTADOR/skills/`, por ser los más numerosos y menos documentados). Los 16 skills transversales en formato `SKILL.md` (prompts/documentación, no código ejecutable) no se auditan a nivel de I/O porque no tienen I/O de programa — son instrucciones para un LLM.

### 2.2 El "Radar legacy" en `agents/000_ORQUESTADOR/skills/` — 25 skills, arquitectura completa y abandonada

Los nombres, descripciones y flujo de estos 25 archivos (documentados con precisión quirúrgica en el propio `Skill_Loader.cjs:8-134`, que mantiene metadata predefinida para cada uno) describen un **pipeline Radar completo alternativo** al que hoy corre en producción:

| Skill | Qué hace (según su propio código/metadata) | I/O |
|---|---|---|
| `Skill_Radar_Master.cjs` | `calcularSemaforo(snapshot)`: puntúa dificultad 1-10 por palabras clave en texto (ej. "póliza de cumplimiento 100%" = +3). `shakerIdeas(ideas, idsBloqueados)`: filtra ideas ancladas vs. regenerables | Entrada: string/array en memoria. Salida: número/objeto. Sin persistencia, sin red. |
| `Skill_Geo_Recognizer.cjs` | Normaliza países/regiones para `Radar1_minero` | No leído línea a línea (muestreo) — metadata confirma propósito |
| `Skill_Firebase_Bridge.cjs` / `Skill_Bridge_Produccion.cjs` | Sincronizan con `antigravity-jairo-2026.web.app` (Firebase Hosting) — **el mismo proyecto Firebase que usa la app actual** (`config/serviceAccountKey.json`, proyecto `antigravity-jairo-2026`), pero por una ruta de integración completamente distinta a `src/shared/infrastructure/FirebaseAdmin.js` | Según metadata: HTTP/Firestore hacia la web app en producción |
| `Skill_API_Alertas.cjs` / `Skill_Contexto_Dinamico.cjs` / `Skill_Upload_Contexto.cjs` | Definen endpoints propios (`/alertas`, `/api/v1/context`, `/api/v1/upload-context`) — **ningún de estos existe en `server.js`**, que solo expone las rutas ya auditadas (`/api/chat`, `/api/radar/*`, `/api/formulador/*`, etc.) | Endpoints HTTP declarados en el nombre/metadata, sin backend Express que los sirva hoy |

**Hallazgo de anomalía — "injerto" confirmado:** `Skill_Loader.cjs:160-204` (`cargarSkills()`) hace `require()` de cada uno de estos 25 archivos y se autoejecuta al final del módulo (`cargarSkills();`, línea 256) — es decir, **si algo alguna vez importara `Skill_Loader.cjs`, cargaría y ejecutaría los 25 skills legacy de una sola vez**. Verificado por grep en todo el árbol (`.js/.jsx/.cjs/.html`): **nada lo importa hoy**. Es un subsistema completo, funcional en aislamiento, con cero consumidores — la definición exacta de código huérfano.

**Manejo de errores:** `Skill_Loader.cjs:191-193` sí envuelve `modulo.init()` en `try/catch` silencioso (`catch(e) {}` — traga el error sin loguearlo, lo cual es en sí mismo una anomalía menor: un fallo de inicialización de skill desaparece sin rastro). El resto de los 25 skills muestreados (`Skill_Radar_Master.cjs`) no tiene ningún manejo de excepciones — son funciones puras sin validación de entrada (`snapshot.toLowerCase()` explota si `snapshot` no es string).

### 2.3 Scripts de orquestación de la raíz de `agents/` — anatomía uno por uno

| Archivo | Qué hace | Estado real | Evidencia |
|---|---|---|---|
| `agents/000_Orquestador.cjs` | Gate de arquitectura (`--aprobar-diseno`, real, corregido y verificado hoy) + batch executor (`ejecutarTodosLosAgentes()`, ejecuta 1 script por carpeta `\d{2,3}[_-]*`) | 🟢 Parcialmente real | Ver §3.1 |
| `agents/000_VERIFICADOR.cjs` | Verifica que existan 3 rutas hardcodeadas (`000_Orquestador.cjs`, `skills/Skill_Sync_MCP.cjs`, `skills/IDENTITY.md`) | 🟢 Trivialmente correcto hoy, pero de valor mínimo — no verifica contenido ni comportamiento | Las 3 rutas existen, confirmado |
| `agents/000_VERIFICADOR.cjs` vs. `agents/auditor-integridad.cjs` | Dos scripts con el mismo propósito declarado ("auditoría de integridad") | 🟠 Duplicación de responsabilidad | Ambos "verifican archivos existen", con listas de archivos completamente distintas e incompatibles entre sí |
| `agents/auditor-integridad.cjs` | Verifica 11 rutas hardcodeadas: `bridge-server.cjs`/`index.html`/`package.json` en raíz; `skills/consultor-pro.cjs`, `cost-analyst.cjs`, `gestor-carpetas.cjs`, `redactor-universal.cjs`, `selector-metodologia.cjs`; `agents/000_orquestador_maestro.cjs`, `054-gestion-riesgos.cjs`, `055-analista-financiero.cjs` | 🔴 **Fósil — ninguna de las 11 rutas coincide con la estructura real actual.** `index.html` no existe en raíz (vive en `public/`/`dist/`); ninguno de los 5 nombres de skill existe en `skills/`; `000_orquestador_maestro.cjs` no existe (el real es `000_Orquestador.cjs`, otro nombre/casing); `055-analista-financiero` referencia un agente que `052_Form_Administrativo/IDENTITY.md` documenta explícitamente como **eliminado** ("Los agentes 053 y 055 fueron eliminados") | Ejecutar este script hoy reportaría ~10/11 archivos "FALTANTE" |
| `agents/bridge-server.cjs` | Segundo servidor Express, **puerto 3001** (el real es 5000/10000), expone `POST /orquestar` que ejecuta `node agents/000_Orquestador.cjs "<sector>" "<ubicacion>" "<problema>" "<presupuesto>" "<enfoque>" "<formato>"` | 🔴 **Contrato de API roto** — `000_Orquestador.cjs` actual no lee `process.argv` para nada de esto (solo revisa `--aprobar-diseno`); los 6 argumentos posicionales se ignoran en silencio. Nunca se arranca desde `package.json` ni desde `server.js`. | `package.json:6-14` no tiene ningún script que invoque `bridge-server.cjs` |
| `agents/skill-dispatcher.cjs` | Rutea archivos (`.pdf/.docx/.xlsx` → `doc_intelligence`; `.jpg/.png` → `vision_engine`) buscando en `registry.available_skills` | 🔴 **Roto** — el registro actual (`skills/ag_skills_registry.json`, v3.0.0) no tiene la clave `available_skills` en ningún nivel; `find()` sobre `undefined` lanza excepción no capturada | Comparar schema real vs. lo que el script espera |
| `agents/index.js` | Bootstrap de agentes para navegador (`window.AGENTS = {...}`) | 🔴 **Import roto** — `import { FLAGS, AGENT_CONFIGS } from "./config.js"` — `agents/config.js` fue eliminado (`AGENTS.md` §VI, "Registro de Saneamiento 2026-08-05": *"agents/config.js` (esquema de IDs 050-057 en colisión con esta topología) eliminado"*) | Confirmado por grep: 0 archivos vivos lo importan (fuera de sí mismo y del código muerto que arrastra) |
| `agents/ContextManager.js` | Actualiza el `<title>` del navegador y un `<div id="project-display-name">` con el proyecto activo, hardcodeado a `{id: "PROY_01", name: "Donaciones_Cantagallo"}` | 🔴 **Referencia a proyecto purgado** — `Proy_01_Donaciones` fue eliminado del disco (`AGENTS.md` §VI). El elemento DOM que actualiza (`project-display-name`) no existe en ningún componente de `public/src/*` (React SPA actual) | Grep de `project-display-name` en `public/src/` → 0 resultados |

**Conclusión de §2.3:** de 9 scripts de orquestación sueltos en la raíz de `agents/`, **1 es real y funcional** (`000_Orquestador.cjs`), **1 es trivial pero correcto** (`000_VERIFICADOR.cjs`), y **los otros 7 están rotos, son fósiles, o son huérfanos sin ningún consumidor** — todos, sin excepción, generados en una etapa anterior del proyecto y nunca retirados cuando la arquitectura cambió debajo de ellos.

---

## 3. MAPA DE INTEGRACIONES, FLUJOS Y COMUNICACIONES

### 3.1 El único flujo agéntico real y verificado end-to-end

```
Usuario/sesión de código
      │
      ├─ node agents/000_Orquestador.cjs --aprobar-diseno
      │        │
      │        ├─ lee .claude/agents/architect.md (system prompt)
      │        ├─ lee `git diff HEAD` (contexto, texto plano — SIN tool-use real)
      │        ├─ llama Anthropic API (claude-sonnet-4-6)
      │        └─ veredicto JSON {aprobado, razones} → agents/diseno_aprobado.json
      │
      └─ node agents/000_Orquestador.cjs   (sin flag)
               │
               ├─ valida diseno_aprobado.json (hash de agents/ + src/)
               │     └─ si no coincide → BLOQUEA (correcto, verificado hoy)
               │
               └─ ejecutarTodosLosAgentes(): por cada carpeta \d{2,3}[_-]*,
                  ejecuta 1 archivo (.js/.cjs/.py/.ps1) con timeout 30s
                  └─ para 000_ORQUESTADOR: encuentra puente_ejecutor.py
                     (daemon de loop infinito) → SIEMPRE agota el timeout
                     de 30s → SIEMPRE se reporta como "fallo" — ver §4
```

**Cuello de botella / SPOF de orquestación:** `puente_ejecutor.py` en sí mismo tiene un diseño de seguridad razonable (allowlist estricta de intérprete+script, validación de que el script resuelto viva dentro de `agents/`, `shell=False`), pero está pensado para correr como **proceso persistente independiente**, no como una de las N tareas de un batch con timeout de 30s. Nadie lo arranca hoy de la forma correcta (no hay entrada en `package.json`, ni en `render.yaml`, ni documentación de cómo lanzarlo standalone) — es infraestructura construida y nunca conectada a un punto de entrada real.

### 3.2 Comunicación con el backend real (Supabase, Express, APIs externas)

Los agentes de negocio (`agents/050`-`056`) **no tienen ninguna comunicación directa con Supabase, Express ni con ningún endpoint HTTP**. Sus `IDENTITY.md` son prompts de sistema pensados para ser interpretados por un LLM (probablemente Claude Code mismo, en una sesión interactiva) — no hay ningún código que los cargue como system prompt de una llamada API, a diferencia de `.claude/agents/architect.md`, que sí tiene ese wiring completo. Es decir: **`architect.md` es el único agente de todo el ecosistema con un puente de código real hacia la API de Anthropic** (`agents/000_Orquestador.cjs:pedirVeredictoArquitecto()`); los demás (`052`, `056`, etc.) son documentación de referencia para un operador humano o para Claude Code interactivo, no agentes que "corren" en el sentido de proceso.

### 3.3 Pérdida de contexto en transiciones de sesión

- `agents/diseno_aprobado.json` es el único artefacto de persistencia entre sesiones del gate de arquitectura — y su validez depende de un hash de `agents/` + `src/` que se invalida ante *cualquier* cambio en esos árboles, incluyendo cambios de `git rm --cached` que no tocan contenido de archivo (ver el rechazo real que produjo el Agente Arquitecto hoy sobre el diff de `.agent/.shared/ui-ux-pro-max/*.csv`, documentado en la sesión de esta misma jornada) — el hash no distingue "se borró de verdad" de "se dejó de trackear en git".
- No existe ningún mecanismo de memoria/contexto compartido entre invocaciones de los agentes `050`-`056` — cada `IDENTITY.md` se lee de cero en cada sesión; el "traspaso" entre agentes (`050 → 056 → 002_redactor_tecnico`) depende enteramente de que el operador humano (o Claude Code) copie el resultado de un agente al prompt del siguiente. No hay cola, ni base de datos de estado intermedio, ni orquestador de proceso que lo automatice.

### 3.4 Brecha donde el sistema permite escribir código sin estructuración aprobada

El gate (`--aprobar-diseno`) es **opt-in**, no un hook automático. Nada impide que Claude Code (o cualquier operador) edite código directamente sin correr el gate primero — de hecho, así se ejecutó gran parte del trabajo de la sesión de hoy (las correcciones de la Operación Exterminio se aplicaron y solo *después* se corrió el gate como verificación de cierre, no como bloqueo de entrada). Esta es la brecha estructural más importante del punto de vista de "cero código sin diseño aprobado" — ver Plan de Remediación §5.2.

---

## 4. ANÁLISIS DE LÍMITES, BLOQUEOS Y GAPS (EXPECTATIVA VS. REALIDAD)

Esta es la comparación más reveladora del documento: lo que los `IDENTITY.md` de los agentes de Formulador **prometen** contra lo que `src/orchestrator-engine.js` (el único motor que de verdad corre en producción, auditado línea por línea en la radiografía del 2026-08-07) **ejecuta**.

| Agente | Promesa en `IDENTITY.md` | Realidad en `orchestrator-engine.js` | Brecha |
|---|---|---|---|
| **052 — Administrativo** | Motor de 7 checks de elegibilidad (CHECK_1-7), genera 16 tipos de documento distintos (DOC-01 a DOC-16) según sea fuente nacional/internacional/SECOP, con formato de Estudios Previos completo (`052_Form_Administrativo/IDENTITY.md:21-90`) | `AgentAdministrativo.process()` (`orchestrator-engine.js:83-129`): genera **un párrafo de justificación legal de máx. 120 palabras** vía una sola llamada a Claude, con fallback a plantilla fija si falla | 🔴 **Enorme.** La implementación real cubre ~5% de lo que el `IDENTITY.md` describe como su rol |
| **056 — Evaluador** | Motor SIV de 6 pilares ponderados + Factor de Riesgo + 6 Hard Constraints + Fase 2 "Red Team" adversarial (simula evaluador de BID/USAID/ONU, calcula Tasa de Supervivencia) + detección "Elephant White" de proyectos infladados (`056_Form_Evaluador/IDENTITY.md`, 253 líneas de especificación) | `AgentEvaluador.evaluate()` (`orchestrator-engine.js:216-286`): **checklist de 8 reglas booleanas** (¿existe sector?, ¿existe municipio?, ¿hay indicadores SMART?, etc.), aprobación por umbral simple de 75% | 🔴 **Enorme.** Cero de las 6 fórmulas, cero Red Team, cero Elephant White están implementados |
| **053 / 055** | — | — | Estos agentes están **documentados como eliminados** dentro del propio `052_Form_Administrativo/IDENTITY.md` ("Los agentes 053 y 055 fueron eliminados") — coherente, sin brecha aquí, pero confirma que la topología de agentes ha cambiado de forma no reflejada en `AGENTS.md` raíz (que nunca menciona 053/055 en absoluto, ni su eliminación) |
| **054 — Riesgos** | `IDENTITY.md` no leído en detalle en esta pasada (fuera del muestreo por tiempo) — pendiente de verificación anatómica completa en una próxima ronda | `AgentRiesgos.process()`: **4 riesgos hardcodeados** con probabilidad condicionada por 2-3 flags booleanos (`orchestrator-engine.js:157-210`) | 🟡 Verosímil que exista brecha similar — no confirmado con la misma evidencia que 052/056 |

**Regla de negocio COP — sí se respeta:** el Axioma II.2 de `AGENTS.md` ("Soberanía Financiera Absoluta... exclusivamente en Pesos Colombianos") **sí se cumple en el único cálculo financiero real que existe**: `AgentOperativo.process()` calcula AIU 25% + IVA 19% sin ninguna conversión de divisa (`orchestrator-engine.js:134-151`). No hay evidencia de ningún cálculo en USD/EUR en el código ejecutable — los formatos en USD que aparecen en `052_Form_Administrativo/IDENTITY.md:57` ("Budget breakdown (USD/EUR)") son parte de la especificación no implementada, no código real que viole la regla.

**Aislamiento de estado por usuario — parcialmente respetado:** ya auditado en profundidad en la radiografía del 07-08 (guardrail RLS agregado ese mismo día en `supabaseClient.js:rpc()`). Ningún agente de `agents/050`-`056` toca directamente Supabase — el aislamiento multi-tenant es responsabilidad exclusiva de `FormuladorPgController.js`, fuera del alcance de este documento de agentes.

---

## 5. PLAN DE REMEDIACIÓN Y BLINDAJE ESTRUCTURAL

### 5.1 Tabla de triaje

| # | Hallazgo | Criticidad | Acción recomendada | Esfuerzo |
|---|---|---|---|---|
| 1 | `agents/auditor-integridad.cjs` fósil (11/11 rutas no coinciden con la realidad) | 🔴 Alta | Eliminar o reescribir contra la estructura real. Mientras exista, cualquiera que lo ejecute recibe un falso reporte de sistema roto | Baja |
| 2 | `agents/bridge-server.cjs` — 2° servidor Express en puerto 3001, contrato de API con `000_Orquestador.cjs` roto | 🔴 Alta | Eliminar (nada lo arranca) o, si se quiere conservar la idea de un endpoint HTTP para disparar el orquestador, reescribirlo contra la API real de `000_Orquestador.cjs` de hoy | Media |
| 3 | `agents/skill-dispatcher.cjs` — referencia `registry.available_skills`, clave inexistente en el schema v3.0.0 actual | 🔴 Alta | Eliminar o migrar al schema real (`agent_mappings`/`global_skills`) | Baja |
| 4 | `agents/index.js` + `ContextManager.js` + `Agente001/050/051/052.js` — import roto a `config.js` eliminado, referencia a proyecto purgado | 🟠 Media | Eliminar el árbol completo — es UI vanilla-JS pre-React, sin relación con el SPA actual (`public/src/*`) | Baja |
| 5 | 25 skills de `agents/000_ORQUESTADOR/skills/` (Radar legacy) + `Skill_Loader.cjs` sin consumidor | 🟠 Media | Decisión de producto, no solo higiene: archivar en `skills/_archivo_historico/` (patrón ya usado en el proyecto) o confirmar explícitamente que están retirados. Mientras sigan en `skills/` activo, un futuro `require()` accidental revive 25 archivos de una arquitectura Firebase/Radar abandonada | Media (requiere decisión del usuario) |
| 6 | `puente_ejecutor.py` incompatible con el timeout de 30s de `ejecutarTodosLosAgentes()` | 🟠 Media | Mover fuera de `agents/000_ORQUESTADOR/` (para que el batch executor no lo recoja) o excluir explícitamente esa carpeta del loop de ejecución | Baja |
| 7 | Brecha IDENTITY.md vs. `orchestrator-engine.js` en agentes 052/056 (y probablemente 054) | 🟡 Media-Baja | No es un bug — es una decisión de alcance pendiente: ¿se construye el motor SIV/Red Team real, o se recorta `IDENTITY.md` para reflejar el MVP actual? Cualquiera de las dos cierra la brecha; dejarla abierta es lo único incorrecto | Alta (si se decide construir) / Baja (si se decide recortar el spec) |
| 8 | Gate de arquitectura no es un hook automático de commit | 🟡 Media | Ya recomendado en `docs/INFORME_RECONCILIACION_CIERRE_2026-08-07.md §4.2` — enganchar `.claude/agents/architect.md` a `.husky/pre-commit` | Media |
| 9 | Naming colisionado: 3 entidades "000/orquestador" distintas | 🟢 Baja | Renombrar `agents/000_Orquestador.cjs` a un nombre que declare su función real de dev-tool (ya recomendado en el informe de reconciliación §4.1) | Baja |
| 10 | `.agent/` (Sistema B) sigue en disco, 119 archivos, sin uso real | 🟢 Baja | Ya gitignoreado correctamente hoy; decisión pendiente (no urgente) de si se borra del disco o se conserva como herramienta local del IDE | Baja |

### 5.2 Diseño técnico del Agente de Arquitectura — ya construido, este es su estado real

El documento original que motivó esta auditoría pedía "diseñar" un Agente Arquitecto faltante. **Corrección importante basada en evidencia de hoy: ya no falta.** Fue construido y verificado end-to-end en la sesión del 2026-08-07 (ver `docs/INFORME_RECONCILIACION_CIERRE_2026-08-07.md`, secciones 0 y 1). Su diseño real:

```
┌─────────────────────────────────────────────────────────────┐
│  .claude/agents/architect.md                                │
│  - tools: Read, Grep, Glob (solo lectura, sin mutación)      │
│  - Mandato: NO escribe código, NO ejecuta nada que mute      │
│  - Salida obligatoria: {"aprobado": bool, "razones": [...]}  │
└───────────────────────┬───────────────────────────────────────┘
                         │ system prompt
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  agents/000_Orquestador.cjs :: pedirVeredictoArquitecto()    │
│  - input: git diff HEAD (texto, hasta 60k chars)             │
│  - Anthropic API real (claude-sonnet-4-6)                    │
│  - parseo estricto de JSON; falla honesto si no hay veredicto│
│  - firma = SHA-256(agents/ + src/) — se autoinvalida si algo │
│    cambia después de aprobar                                 │
└───────────────────────┬───────────────────────────────────────┘
                         │ solo si aprobado:true
                         ▼
              agents/diseno_aprobado.json (firma vigente)
                         │
                         ▼
          ejecutarTodosLosAgentes() puede correr
```

**Lo que falta para que sea un blindaje real (no solo disponible):**
1. Convertirlo de opt-in a obligatorio — hook de pre-commit (§5.1 ítem 8).
2. Dar acceso real a herramientas — hoy el prompt de `architect.md` promete Read/Grep/Glob, pero la invocación vía SDK crudo (`pedirVeredictoArquitecto()`) no wirea ninguna herramienta real; el modelo solo ve el diff en texto. Esto ya causó una alucinación de tool-call corregida hoy (ver informe de reconciliación §0) instruyendo explícitamente "no tienes tool-use aquí" — funciona, pero es una limitación de diseño: el arquitecto nunca puede verificar nada fuera del diff mismo (ej. no puede confirmar que un archivo "eliminado" en el diff sigue vivo en disco por un `git rm --cached`, como pasó hoy).
3. Cobertura: hoy el hash de firma cubre `agents/` + `src/` — no cubre `public/`, `skills/`, ni `config/`. Un cambio en `public/src/RadarApp.jsx` (código de producción real) no invalida la aprobación vigente.

---

## REPORTE CONSOLIDADO — Top 5 bloqueos/fallas estructurales más graves

- **Cuatro sistemas de agentes distintos coexisten sin saberlo entre sí** (`agents/`, `.agent/` de un kit genérico de terceros, `.claude/` nativo de Claude Code, `opencode.json` de otra herramienta) — comparten nombres (tres "000_orquestador" distintos) y hasta hace unas horas uno de ellos (`.agent/`) estaba trackeado en git por un bug de `.gitignore`.
- **7 de 9 scripts de orquestación en la raíz de `agents/` están rotos, son fósiles o son huérfanos**: `bridge-server.cjs` es un segundo servidor Express (puerto 3001) con un contrato de API que `000_Orquestador.cjs` ya no implementa; `auditor-integridad.cjs` verifica 11 rutas que no coinciden con la estructura real; `skill-dispatcher.cjs` referencia una clave (`available_skills`) que no existe en el registro actual; `index.js`/`ContextManager.js`/`Agente0XX.js` son UI pre-React con un import a un archivo (`config.js`) ya eliminado.
- **Los `IDENTITY.md` de los agentes 052 y 056 describen un sistema de certificación (SIV de 6 pilares, Red Team adversarial, detección Elephant White) que no existe en el código real** — `orchestrator-engine.js` implementa una fracción mínima (una plantilla legal de 120 palabras; un checklist de 8 booleanos). La brecha entre especificación y ejecución es la más grande de todo el ecosistema.
- **El gate de arquitectura real (`.claude/agents/architect.md`) es la única pieza sólida del sistema, pero es opt-in, no obligatorio** — nada impide escribir y aplicar código sin correrlo primero, y de hecho así se trabajó hoy mismo (el gate se corrió al final, como verificación, no como bloqueo de entrada).
- **25 skills de un "Radar legacy" (`agents/000_ORQUESTADOR/skills/`) — arquitectura Firebase/geo/semáforo completa y funcional en aislamiento, con cero consumidores** — coexisten sin conflicto aparente con el Radar real de producción (`m1Pipeline.js`, Claude+Tavily+Supabase) solo porque nada las invoca, pero representan una duplicación completa de esfuerzo de una etapa arquitectónica abandonada.

**Documento maestro creado y guardado en disco:** `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` ✅
