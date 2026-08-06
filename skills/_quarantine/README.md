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
