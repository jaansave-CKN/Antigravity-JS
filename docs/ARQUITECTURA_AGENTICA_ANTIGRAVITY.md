# ARQUITECTURA AGÉNTICA ANTIGRAVITY — Auditoría Forense 360° Multiagente + Sistema Completo
**Fecha:** 2026-08-08 (documento consolidado — fusiona la auditoría agéntica del 2026-08-08 con la radiografía de sistema del 2026-08-07, actualizado tras la Operación Exterminio Final del mismo día)
**Auditor:** Chief AI Architect / Auditor Forense de Sistemas Multiagente / DevSecOps Lead / Chief Software Auditor / System Architect
**Alcance:** proyecto raíz `c:\2026 AI EGIOC5\Antigravity JS`. `proyectos/` queda fuera (repos git independientes, `.gitignore:19-24`).
**Regla de evidencia:** cero suposiciones — cada hallazgo cita archivo real. Donde el volumen hizo impracticable la lectura línea-por-línea de decenas de archivos (los skills de `agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/`), se declara el muestreo usado.
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

Lo que **no** cambió y sigue vigente tal cual: los 25 skills legacy (ahora en `agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/`, huérfanos, sin consumidor), la brecha IDENTITY.md-vs-ejecución en 052/056, la ausencia de panel `/admin`, y los 4 sistemas de agentes coexistentes (A/B/C/E).

---

## 0-B. SEGUNDA RONDA (2026-08-08, misma jornada) — reparación de un renombramiento a medias iniciado por Gemini

Otra sesión (Gemini, según reportó el usuario) comenzó a renumerar el Escuadrón Élite de 5 a 8 roles y se cortó a mitad de camino por límite de tokens, dejando 2 archivos modificados sin commitear y en contradicción directa entre sí: `AGENTS.md` (nueva topología, 8 roles, refería al rol nuevo como `008_AUDITOR_DE_CODIGO`) y `.claude/agents/architect.md` (mismo rol, pero como `006_AUDITOR_DE_CODIGO`, dos veces). Detectado con `git status`/`git diff` en frío antes de tocar nada — ninguna carpeta física de `agents/` había sido tocada todavía.

El usuario eligió completar el esquema de Gemini tal cual (001-008), asumiendo `008` como el número correcto. Esto exigía renumerar carpetas reales que colisionaban con los nuevos IDs de rol — un paso que Gemini nunca llegó a proponer ni ejecutar.

**Trabajo completado esta ronda:**
- 5 carpetas renombradas (`git mv`, historial preservado): `000_ORQUESTADOR`→`001_ORQUESTADOR_MAESTRO`, `001_gestor_datos`→`009_gestor_datos`, `002_redactor_tecnico`→`010_redactor_tecnico`, `005_Radar1_minero`→`011_Radar1_minero`, `006_Radar2_Estratega`→`012_Radar2_Estratega`.
- `ESCUADRON_ELITE` en `architecture-gate.cjs` reescrito completo: 8 roles, subordinados reales reasignados por función (ej. los 7 subordinados del antiguo `002_INGENIERIA_TOTAL` pasan a `005_INGENIERO_BACKEND`, ninguno calificaba como frontend).
- Contradicción 006/008 resuelta en `architect.md` (ganó 008, coincide con `AGENTS.md`).
- **Hallazgo adicional durante la reparación, no relacionado con Gemini:** `skills/ag_skills_registry.json` ya tenía 25 rutas rotas desde el archivado de la ronda anterior de hoy (nunca se actualizó ese registro al mover los skills a `_archivo_historico/`) — reparado en la misma pasada, con las skills archivadas ahora marcadas explícitamente como tales (`skills_archivadas_2026-08-08`, separadas del único skill real que vivía en la misma lista, `Skill_Protocolo_Fuente_Unica`).
- `sync_registry.cjs` ahora excluye `_archivo_historico/` de su escaneo — sin esto, redescubriría las 25 skills archivadas como "nuevas" en cada corrida.
- `ANTHROPIC_MODEL` hardcodeado por tercera vez en `architecture-gate.cjs` (se había centralizado en `server.js` y `m1Pipeline.js`, se pasó por alto este) — corregido a `process.env.PRIMARY_AI_MODEL`.
- `IDENTITY.md` de 050/052/056 y del propio `001_ORQUESTADOR_MAESTRO` actualizados (referencias cruzadas a las carpetas renombradas).
- `AGENTS.md` §IV-B corregida: los agentes `06X` que Gemini clasificó como "Agentes de Apoyo" del Escuadrón Élite en realidad viven en `.agent/agents/` (Sistema B, scaffold genérico de terceros) — no son parte de este sistema en absoluto.

---

## 0-C. TERCERA RONDA (2026-08-08, misma jornada) — auditoría de calidad real de los 12 skills activos + de los 8 roles del Escuadrón Élite en sí mismos

Pedido explícito del usuario: no solo confirmar que los skills existen (§0/§0-B ya lo hizo), sino leer su contenido y juzgar si están a la altura de un "Escuadrón Élite". Se leyeron íntegros los 12 archivos de skill activos (no archivados) más los 3 scripts Python de `011_Radar1_minero`. Resultado en detalle en §2.3 (skills) y §1.4 (los 8 roles como entidades, sin sus subordinados).

**Bugs propios encontrados y corregidos durante esta lectura (no relacionados con Gemini, míos de la ronda anterior):**
- `agents/011_Radar1_minero/radar_oficial.py:8-9` seguía escribiendo a `agents/005_Radar1_minero/...` (nombre viejo) — el barrido de referencias de §0-B solo cubrió `.js/.cjs/.json/.md`, nunca `.py`.
- `agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py:10-11` — mismo patrón, seguía apuntando a `agents/000_ORQUESTADOR/...`.
- `agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py:17` — `ALLOWED_SCRIPTS` (allowlist de seguridad del daemon) seguía aceptando `000_Orquestador.cjs`, el nombre retirado en §0-B — corregido a `architecture-gate.cjs`. Sin este fix, el daemon habría rechazado el script legítimo mientras técnicamente seguía "permitiendo" uno que ya no existe.

**Hallazgo nuevo — "Protocolo Titán" (rol `008_AUDITOR_DE_CODIGO`) es un término huérfano:** buscado en todo el proyecto (`*.md`, `*.cjs`, `*.js`) — aparece exactamente 2 veces, ambas la misma frase de una línea (`AGENTS.md` y su espejo en `architecture-gate.cjs`). No hay ningún documento, skill o lógica que lo defina. Es un nombre sin contenido detrás, acuñado por Gemini.

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

**Renumerado 2026-08-08 (segunda ronda, ver §0-B):** el Escuadrón Élite pasó de 5 a 8 roles (001-008). Las carpetas de agentes reales que chocaban numéricamente con los nuevos roles se movieron: `000_ORQUESTADOR`→`001_ORQUESTADOR_MAESTRO`, `001_gestor_datos`→`009_gestor_datos`, `002_redactor_tecnico`→`010_redactor_tecnico`, `005_Radar1_minero`→`011_Radar1_minero`, `006_Radar2_Estratega`→`012_Radar2_Estratega`.

```
001_ORQUESTADOR_MAESTRO  (Enrutador Central — IDENTITY.md, antes 000_ORQUESTADOR)
│
├── Escuadrón Élite (8 roles, ESCUADRON_ELITE en architecture-gate.cjs)
│   ├── 002_ARQUITECTO_DE_SOFTWARE — sin carpeta propia: .claude/agents/architect.md
│   ├── 003_ESP_DISENO_STITCH      — sin carpeta propia, subordinados: []
│   ├── 004_INGENIERO_FRONTEND     — subordinados: [] (rol declarado, sin implementación)
│   ├── 005_INGENIERO_BACKEND      — 009_gestor_datos, 011_Radar1_minero,
│   │                                012_Radar2_Estratega, 050_Formulador_proy,
│   │                                051_Form_Lluvia_de_ideas, 07-ing-concreto_GFRC,
│   │                                08-estratega-neuromarketing
│   ├── 006_DEVSECOPS_INFRAESTRUCTURA — 03-analista-secop, 052_Form_Administrativo,
│   │                                054_Form_Gestion_de_riesgos, 056_Form_Evaluador,
│   │                                14-analista-comportamiento, 015_intelligence-core
│   ├── 007_DOCUMENTADOR_AS_BUILD  — 010_redactor_tecnico
│   └── 008_AUDITOR_DE_CODIGO      — subordinados: [] (rol nuevo, sin implementación;
│                                     architect.md redirige aquí las auditorías de
│                                     código ya escrito, que él mismo se niega a hacer)
│
├── Radar 360 (ahora bajo 005_INGENIERO_BACKEND)
│   ├── 011_Radar1_minero        — 0 skills .cjs, solo .py sueltos
│   ├── 012_Radar2_Estratega     — solo IDENTITY.md
│   └── [huérfano en 001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/:
│        25 skills de un Radar legacy Firebase-based, archivadas — ver §2.1]
│
├── Formulador 360 (bajo 005_INGENIERO_BACKEND / 006_DEVSECOPS_INFRAESTRUCTURA / 007_DOCUMENTADOR_AS_BUILD)
│   ├── 050_Formulador_proy, 051_Form_Lluvia_de_ideas,
│   │   052_Form_Administrativo, 054_Form_Gestion_de_riesgos,
│   │   056_Form_Evaluador, 010_redactor_tecnico
│   │   (1-3 skills reales c/u; 052/056 con brecha IDENTITY.md-vs-código, §10)
│
├── Soporte: 009_gestor_datos, 015_intelligence-core, 03-analista-secop
│
├── Fantasmas en IDENTITY.md, ausentes en disco (sin cambios)
│   ├── 100_reparador_codigo     — IDENTITY.md:30, carpeta NO existe
│   └── 09-legal-licitaciones    — IDENTITY.md:23, carpeta NO existe
│
├── Fuera de dominio: 07-ing-concreto_GFRC, 08-estratega-neuromarketing,
│                      14-analista-comportamiento (0 skills c/u)
│
└── Utilidades sueltas en agents/ (14 archivos)
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

### 1.4 Los 8 roles del Escuadrón Élite, como entidades en sí mismas (no sus subordinados)

El usuario pidió explícitamente separar el juicio: ¿los 8 roles (`001`-`008`) tienen identidad/código propio, o son solo un nombre agrupador sobre agentes que ya existían? Confirmado a partir de `agents/architecture-gate.cjs` (objeto `ESCUADRON_ELITE`) y de si cada uno tiene carpeta/`IDENTITY.md` propios en `agents/`.

| Rol | ¿Carpeta/IDENTITY.md/código propio? | Veredicto |
|---|---|---|
| `001_ORQUESTADOR_MAESTRO` | Sí — `IDENTITY.md` (tabla de ruteo) + `ejecutarTodosLosAgentes()` en código | 🟠 El código real es un batch runner crudo (sin ruteo condicional, sin reintentos); y el propio `IDENTITY.md` alucina 2 subordinados inexistentes (`100_reparador_codigo`, `09-legal-licitaciones`, IDENTITY.md:30,23) |
| `002_ARQUITECTO_DE_SOFTWARE` | Sí — `.claude/agents/architect.md`, gate real | 🟢 Único genuinamente de alto nivel — verificado 3 veces con razonamiento real distinto según el diff |
| `003_ESP_DISENO_STITCH` | No | 🔴 Solo una línea `rol`+`mandato` en el objeto. Cero conexión con las herramientas MCP de Stitch que sí existen en el proyecto |
| `004_INGENIERO_FRONTEND` | No — ni siquiera `mandato` con contenido | 🔴 No existe como agente. El SPA React real no tiene ningún agente detrás |
| `005_INGENIERO_BACKEND` | No — etiqueta agrupadora sobre 7 carpetas preexistentes | 🟠 Sin `IDENTITY.md`, sin código propio, sin criterio de ingeniería definido en ningún lado |
| `006_DEVSECOPS_INFRAESTRUCTURA` | No — mismo patrón | 🔴 Su propio `rol` dice "Despliegues a producción, servidores" — ninguno de sus 6 subordinados hace eso (son agentes de Formulador y compliance) |
| `007_DOCUMENTADOR_AS_BUILD` | Parcial — `carpetaSalida` real, genera acta en `docs/as-build/` | 🟡 Segundo más real de los 8 — único con un artefacto de código tangible propio, no prestado de un subordinado |
| `008_AUDITOR_DE_CODIGO` | No — cero subordinados, cero código | 🔴 Cita "Protocolo Titán" (ver §0-C, término sin definición en ningún lado). `architect.md` lo cita como destino de las auditorías post-hoc que él mismo rechaza — pero no hay nada del otro lado para recibirlas |

**Conclusión de §1.4:** de 8 roles, solo 1 es de nivel élite real (`002`) y 1 más tiene un artefacto propio tangible (`007`). Los otros 6 no son agentes en ningún sentido operativo — o son una frase suelta dentro de un objeto JavaScript, o una etiqueta nueva sobre agentes preexistentes sin lógica ni identidad propia. Dos de ellos (`001`, `006`) tienen algo peor que estar vacíos: su propia descripción es falsa.

---

## 2. AUDITORÍA FORENSE DE SKILLS

### 2.1 El "Radar legacy" — 25 skills en `agents/001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/`, sin cambios desde la auditoría previa

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

### 2.3 Auditoría anatómica de los 12 skills activos de negocio — leídos íntegros, no solo inventariados

Metodología: lectura completa (no muestreo) de los 12 archivos `.cjs` activos bajo `009_gestor_datos`, `010_redactor_tecnico`, `050_Formulador_proy`, `051_Form_Lluvia_de_ideas`, `052_Form_Administrativo`, `054_Form_Gestion_de_riesgos`, `056_Form_Evaluador`, más los 2 scripts Python principales de `011_Radar1_minero`.

| Skill | Función real (I/O) | Manejo de errores | Veredicto |
|---|---|---|---|
| `009_gestor_datos/Skill_001_Gestor_Directorios.cjs` | Crea estructura de carpetas (`process.argv` → `fs.mkdirSync` en cascada) | Ninguno — sin try/catch | 🟢 Real, funcional, sin blindaje |
| `009_gestor_datos/Skill_001_Fix_Encoding.cjs` | Corrige acentos rotos a entidades HTML en archivo/directorio | `try/catch` presente, retorna `false` en error | 🟢 Real, funcional |
| `009_gestor_datos/Skill_001_Gestor_Encoding.cjs` | Igual que el anterior, + modo `check` | Parcial | 🟠 **Riesgo real:** incluye `execSync('firebase deploy --only hosting')` activable con flag `--deploy` — un "arreglador de encoding" con capacidad de desplegar a producción, sin ningún gate de confirmación |
| `009_gestor_datos/Skill_001_OCR_Soporte.cjs` | Lee **solo la extensión** del archivo y arma metadata (`.pdf`→"Documento PDF") | N/A | 🔴 **Nombre engañoso** — cero OCR real, no extrae texto de nada pese al nombre |
| `010_redactor_tecnico/Skill_002_Redactor_Propuestas.cjs` | Genera un `.docx` real vía librería `docx` (Document/Paragraph/TextRun) | Ninguno | 🟢 El más sofisticado del lote — pero contenido de plantilla fija, 5 campos interpolados, no redacción adaptativa |
| `010_redactor_tecnico/Skill_002_Generador_Anexos.cjs` | Escribe `.txt` con texto fijo, un parámetro interpolado | Ninguno | 🟠 Mínimo — casi no varía por proyecto |
| `010_redactor_tecnico/Skill_Soporte_Automatico.cjs` | Lee `./.agents` (con "s") cada 5 min, cuenta carpetas, escribe `estado_antigravity.json` | `try/catch` que **oculta el error real** | 🔴 **Roto y engañoso** — esa ruta nunca ha existido en este proyecto (confirmado en auditorías previas); falla en bucle infinito imprimiendo "Reintentando conexión con la base de datos", un mensaje que no tiene relación con el bug real (es un path equivocado, no una DB) |
| `050_Formulador_proy/Skill_050_Formulador_Proyecto.cjs` | **No formula nada** — es un generador de plantillas boilerplate para *otros* skills | N/A | 🔴 Lista interna cita `Skill_057_Interventor`, un rol que no existe en la numeración actual — desactualizado incluso consigo mismo |
| `051_Form_Lluvia_de_ideas/Skill_051_Lluvia_Ideas.cjs` | `{status:'ok', resultado:{}}` | N/A | 🔴 Stub puro, generado por la plantilla de 050 |
| `052_Form_Administrativo/Skill_052_Metodologia_Maestra.cjs` | Constante con 4 frases sobre metodología MGA | N/A | 🟠 No es un skill ejecutable — es una tabla de referencia (`module.exports` de un objeto estático) |
| `054_Form_Gestion_de_riesgos/Skill_054_Gestion_Riesgos.cjs` | `{status:'ok', resultado:{}}` | N/A | 🔴 Stub puro — su propio campo `notas` admite *"Solo registra, no analiza"* |
| `056_Form_Evaluador/Skill_056_Evaluador.cjs` | `{status:'ok', resultado:{}}` | N/A | 🔴 Stub puro — sin ningún criterio real de evaluación pese al nombre |
| `011_Radar1_minero/radar_oficial.py` + `test_fuentes.py` | Scraping real (`requests`+`BeautifulSoup`), regex para extraer presupuesto/fecha de HTML | `try/except` presente en puntos clave | 🟡 El más sofisticado técnicamente de los 12 — pero rastrea **Costa Rica, Chile, Argentina, Uruguay, Paraguay, Panamá**, no Colombia. Choca con el Axioma II.2 de `AGENTS.md` (todo en COP, foco nacional). Tenía además 2 rutas rotas por el rename de §0-B, corregidas en §0-C |

**Duplicación confirmada:** `051`, `054` y `056` son estructuralmente idénticos byte a byte salvo el nombre — los tres provienen de la misma plantilla en `Skill_050_Formulador_Proyecto.cjs`, no de una implementación pensada para cada dominio.

**Conclusión de §2.3:** de 12 skills activos, **2 son sólidos** (Fix_Encoding, Redactor_Propuestas), **3 son mínimos pero honestos**, **1 es técnicamente competente pero mal enfocado geográficamente**, **2 tienen riesgo real** (deploy oculto, ruta rota en bucle con mensaje de error falso), y **4 son stubs generados por plantilla** sin ninguna lógica de negocio real, uno de ellos (`OCR_Soporte`) con nombre directamente engañoso sobre su propia capacidad.

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

`agents/001_ORQUESTADOR_MAESTRO/puente_ejecutor.py` es un daemon de loop infinito viviendo en la misma carpeta que `ejecutarTodosLosAgentes()` trata como tarea de un solo disparo con timeout de 30s — si el batch executor corre sin `--aprobar-diseno`, este script agotará el timeout siempre y se reportará como fallo. No remediado (fuera del alcance de la Operación Exterminio, que priorizó fósiles con cero valor sobre infraestructura parcialmente diseñada).

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
| 25 skills "Radar legacy" en `001_ORQUESTADOR_MAESTRO/_archivo_historico/skills_radar_legacy/` | 🟠 INCOMPLETO — huérfanas, sin decisión tomada |
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
| 7 | 25 skills Radar legacy sin consumidor | 🟠 Media | ✅ Archivadas (`_archivo_historico/skills_radar_legacy/`) — decisión de implementar vs. borrar definitivamente sigue abierta |
| 8 | `puente_ejecutor.py` incompatible con timeout del batch executor | 🟠 Media | ✅ Resuelto — `001_ORQUESTADOR_MAESTRO` excluido de `listarCarpetasAgentes()` vía `CARPETAS_EXCLUIDAS_DEL_BATCH` |
| 9 | Brecha IDENTITY.md 052/056 vs. código real | 🟡 Media-baja | ✅ Documentada explícitamente en el propio archivo (nota de estado real) — la decisión de construir el motor completo o recortar el spec sigue abierta, correctamente, como decisión de producto |
| 10 | Gate de arquitectura opt-in, no hook obligatorio | 🟡 Media | ✅ Resuelto — `.git/hooks/pre-commit` + modo `--check-gate` (sin costo de API por commit), verificado en 3 commits reales |
| 11 | Naming colisionado (3 "000/orquestador") | 🟢 Baja | ✅ Resuelto — `agents/000_Orquestador.cjs` renombrado a `agents/architecture-gate.cjs` (`git mv`, auto-referencias y hook pre-commit actualizados, gate re-verificado) |
| 12 | `.agent/` (Sistema B) sigue en disco | 🟢 Baja | Pendiente — decisión de conservar o borrar |
| 13 | 4 referencias a rutas viejas en `.py` sin cubrir por el barrido de §0-B | 🟠 Media | ✅ Resuelto (§0-C) — `radar_oficial.py`, `puente_ejecutor.py` (×2, incluida la allowlist de seguridad) |
| 14 | `Skill_001_Gestor_Encoding.cjs` dispara `firebase deploy` sin gate de confirmación | 🔴 Alta | Pendiente — retirar el disparador de despliegue de un skill de encoding, o exigir aprobación explícita antes de ejecutarlo |
| 15 | `Skill_001_OCR_Soporte.cjs` no hace OCR pese al nombre | 🟠 Media | Pendiente — renombrar o implementar OCR real (el proyecto ya tiene `paddleocr-text-recognition` como skill hermano en la misma carpeta) |
| 16 | `Skill_Soporte_Automatico.cjs` falla en bucle cada 5 min leyendo una ruta (`./.agents`) que nunca ha existido, con mensaje de error engañoso | 🟠 Media | Pendiente — corregir la ruta o retirar el script |
| 17 | `051`/`054`/`056` son stubs idénticos generados por plantilla, sin lógica de negocio | 🟠 Media | Pendiente — decisión de producto: implementar de verdad o archivar como se hizo con el Radar legacy |
| 18 | `011_Radar1_minero` técnicamente competente pero rastrea 6 países no-Colombia, contradice Axioma II.2 de `AGENTS.md` | 🟡 Media-baja | Pendiente — decisión de alcance: ¿expandir el mandato del Radar a LATAM, o recortar el script a fuentes colombianas? |
| 19 | `008_AUDITOR_DE_CODIGO` citado activamente por `architect.md` como destino de auditorías post-hoc, pero sin ninguna implementación del otro lado | 🔴 Alta | Pendiente — ver §13-B, diseño propuesto |
| 20 | `IDENTITY.md` de `001_ORQUESTADOR_MAESTRO` alucina 2 subordinados inexistentes (`100_reparador_codigo`, `09-legal-licitaciones`) | 🟠 Media | Pendiente — purgar esas 2 líneas del documento |
| 21 | `006_DEVSECOPS_INFRAESTRUCTURA` — su `rol` declarado no coincide con lo que agrupa (dice "despliegues a producción", ninguno de sus 6 subordinados hace eso) | 🟡 Media-baja | Pendiente — reescribir el `rol` para reflejar la realidad, o darle trabajo real de DevSecOps (dueño natural del propio hook de pre-commit, de `npm audit`) |

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

**Lo que falta para blindaje real:**
1. ✅ Resuelto — `.git/hooks/pre-commit` + `--check-gate` lo vuelve obligatorio, no `.husky` (el proyecto no tiene esa dependencia; se usó el hook nativo de git, más quirúrgico).
2. El prompt de `architect.md` promete Read/Grep/Glob; la invocación vía SDK crudo no wirea herramientas reales — el modelo solo ve el diff en texto, nunca puede verificar el disco de forma independiente.
3. La firma cubre `agents/`+`src/`, no `public/`, `skills/`, `config/`.

---

## 13-B. DISEÑO DE `008_AUDITOR_DE_CODIGO` — esta sí es la pieza que falta de verdad

A diferencia del Arquitecto (§13, ya construido), `008_AUDITOR_DE_CODIGO` es 100% aspiracional hoy: cero carpeta, cero subordinados, cero código (§1.4). Y no es un hueco pasivo — `architect.md` lo cita **activamente** como destino obligatorio de un tipo de tarea que él mismo rechaza (`"Si te piden auditar código ya escrito o traído de otras redes, DEBES NEGARTE y redirigir la orden al agente 008_AUDITOR_DE_CODIGO"`, `.claude/agents/architect.md:8`). Hoy esa redirección cae al vacío.

**Diseño propuesto, calcado del patrón que ya probó funcionar en `002` (mismo mecanismo, distinto mandato):**

```
┌─────────────────────────────────────────────────────────────┐
│  .claude/agents/auditor.md  (NUEVO — segundo subagente)      │
│  tools: Read, Grep, Glob, Edit  (a diferencia del Arquitecto,│
│  SÍ puede escribir — su trabajo es corregir código ya        │
│  existente, no bloquear código por escribir)                 │
│  mandato: audita código ya escrito o traído de otro origen — │
│  exactamente lo que el Arquitecto rechaza hacer               │
│  salida obligatoria: {"hallazgos":[...], "corregido": bool}  │
└─────────────────────────────────────────────────────────────┘
```

**Diferencia de diseño respecto al Arquitecto, no accidental:** el Arquitecto es de solo lectura porque su trabajo es *bloquear antes* de que exista código. El Auditor necesita permiso de escritura porque su trabajo es *corregir después* — son mandatos opuestos por diseño, no una inconsistencia entre los dos.

Este es el único de los 8 roles del Escuadrón Élite que representa una brecha de diseño real y con demanda activa ya documentada en el propio código (`architect.md`) — no una etiqueta vacía sin consumidor, como `003`/`004`.

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
| SPOF `puente_ejecutor.py` vs. timeout del batch executor | 🟠 | ✅ Resuelto (`001_ORQUESTADOR_MAESTRO` excluido del loop) |
| Gate de arquitectura opt-in | 🟡 | ✅ Obligatorio ahora — `.git/hooks/pre-commit` bloquea commits sin aprobación vigente, cero costo de API por commit |
| Bug de truncamiento del gate (max_tokens 1500) | 🔴 (recién descubierto) | ✅ Corregido (4096 + instrucción de concisión), verificado con veredicto real completo |
| Brecha IDENTITY.md 052/056 vs. código real | 🟡 | 🟡 Documentada explícitamente en el propio archivo (no resuelta — es decisión de alcance de producto, no un bug) |
| **JWT legacy `service_role` de Supabase** | 🔴 CRÍTICO | 🔴 **Sigue activo — revocación manual en dashboard, fuera de mi alcance** |
| **Key huérfana Supabase + Render vieja** | 🔴 | 🔴 **Sigue activo — revocación manual, fuera de mi alcance** |
| `.agent/` (Sistema B) en disco | 🟢 | 🟢 Sin cambios — decisión pendiente de conservar/borrar, no urgente |
| Naming colisionado (3 "000/orquestador") | 🟢 | ✅ Resuelto — archivo renombrado a `architecture-gate.cjs`, carpeta renombrada a `001_ORQUESTADOR_MAESTRO/` (renumeración completa §0-B); queda solo `.agent/agents/000_orquestador.md` del Sistema B, sin relación funcional con este sistema |

**Puntaje:** 10/12 hallazgos accionables por código, resueltos hoy. 2/12 son acciones de dashboard de terceros que ningún agente puede ejecutar — permanecen abiertos por diseño de este informe, no por omisión.

**Verificación end-to-end ejecutada, no solo afirmada:** `npm run build` (exit 0) → servidor arrancado → `/api/health` → `healthy`, ping real → gate de arquitectura real invocado con el diff completo de esta cirugía → **aprobado con veredicto razonado y verificable** (firma `088891863832…`) → `--check-gate` (modo sin costo) confirma la aprobación vigente, listo para el hook de pre-commit.

---

## REPORTE CONSOLIDADO — Top 5 fallas estructurales vigentes (actualizado tras auditoría de calidad §0-C)

- **De los 8 roles del Escuadrón Élite, solo 2 tienen sustancia real** (`002_ARQUITECTO_DE_SOFTWARE` y `007_DOCUMENTADOR_AS_BUILD`) — los otros 6 son una frase suelta en un objeto JavaScript o una etiqueta nueva sobre agentes preexistentes, y 2 de ellos (`001`, `006`) tienen su propia descripción **falsa** (subordinados que no existen, funciones que ningún subordinado real cumple). Ver §1.4.
- **`Skill_001_Gestor_Encoding.cjs` dispara `firebase deploy --only hosting` sin ningún gate de confirmación** — un skill etiquetado como arreglador de encoding con capacidad oculta de desplegar a producción. Ver §2.3.
- **`008_AUDITOR_DE_CODIGO` es una brecha con demanda activa, no una etiqueta vacía más** — `.claude/agents/architect.md` ya lo cita como destino obligatorio de las auditorías de código que él mismo rechaza hacer, y no hay absolutamente nada del otro lado para recibirlas. Diseño propuesto en §13-B.
- **JWT legacy `service_role` de Supabase, sin fecha de expiración práctica y con bypass total de RLS, sigue sin revocar** — único hallazgo puramente humano que queda abierto; requiere el dashboard de Supabase, no código.
- **4 de 12 skills de negocio activos (`051`, `054`, `056`, y el generador `050`) son stubs idénticos producidos por una plantilla, sin ninguna lógica real** — cuentan como "agentes definidos" en el inventario automático, pero no ejecutan nada más allá de `{status:'ok', resultado:{}}`.

**Documento consolidado, actualizado 3 veces en la misma jornada (§0/§0-B/§0-C), guardado en disco:** `docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md` ✅
