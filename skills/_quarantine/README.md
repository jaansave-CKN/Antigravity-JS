# Cuarentena de skills neutralizadas

## `Skill_integracion_formato_ascii.cjs.disabled`

**Motivo:** hallazgo de la auditoría del 2026-08-04 (`docs/AUDITORIA_MULTIAGENTE_2026-08-04.md`, sección 2.2). El script recorría de forma recursiva rutas absolutas hardcodeadas (`public/`, `proyectos/`) y **sobrescribía archivos `.html` en sitio** reemplazando tildes/ñ por ASCII, sin backup, sin dry-run, sin logging a bitácora y sin manejo de errores. Era ejecutable directamente con `node skills/Skill_integracion_formato_ascii.cjs` por cualquiera con acceso al repo.

**Neutralización aplicada:**
- Movido fuera de `skills/` (deja de aparecer en cualquier listado/registro que recorra esa carpeta).
- Renombrado con extensión `.disabled` — `node skill.cjs.disabled` no lo ejecuta por accidente; requiere un `mv`/`cp` explícito y consciente para reactivarlo.

**Requisitos antes de reactivar (no implementados aquí, pendientes si se necesita esta funcionalidad):**
1. Flag `--dry-run` que solo reporte qué archivos cambiarían, sin escribir.
2. Backup automático (copia `.bak`) antes de cada escritura.
3. Registro de cada archivo modificado en `Skill_Bitacora_Sistema.cjs`.
4. Eliminar las rutas absolutas hardcodeadas — recibir el directorio objetivo como parámetro.
5. Try/catch alrededor de `readFileSync`/`writeFileSync`.

## `2026-10-12/` — cuarentena de huérfanas (directiva PMUI, hallazgo R6)

**Motivo:** ninguna tenía invocador real (0 imports desde `src/`, `server.js`, `agents/*.cjs`, `scripts/`; ningún agente de `.claude/agents/` las cita) — solo existían en `skills/ag_skills_registry.json`. Cuatro además ejecutaban su lógica con un simple `require()`: `Skill_integracion_consultoria` generaba una carpeta `ENTREGA_*` con un `.docx` en el cwd, `Skill_datos_formulador_proyectos` escribía `PROYECTO_FORMULADO_BORRADOR.txt`, `Skill_datos_selector_metodologia` se caía (`toUpperCase` de `undefined`) y `skills/sync_registry.cjs` (sigue activo, no está aquí) reescribía `last_migration` con la fecha fija `2026-08-04`.

**Contenido:**
- `skills/` — 7 skills `.cjs` de `skills/` (renombradas `.cjs.disabled`). Las 3 que tenían efectos colaterales ya llevan guarda `require.main === module` y try/catch.
- `agents-skills-cjs/` — `Skill_Config_Honestidad`, `Skill_Config_Sistema`, `Skill_Sync_MCP` (antes en `agents/skills/`).
- `agents-skills-md/` — 15 carpetas `SKILL.md` de `agents/skills/` que ningún agente cita (queda activa solo `nodejs-best-practices`).

**Registro:** sección `cuarentena_2026_10_12` de `ag_skills_registry.json` — cada entrada guarda su ruta `origen` y su `seccion_origen`.

**Requisitos antes de reactivar cualquiera:** invocador real identificado; contrato tipado de entrada/salida validado en runtime; guarda `require.main === module` con try/catch y exit code ≠ 0; test que pruebe que requerirla no escribe archivos (`tests/gate/skills.test.cjs`).
