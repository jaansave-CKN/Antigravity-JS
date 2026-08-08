# Skills Radar Legacy — archivadas 2026-08-08

Estos 25 archivos (`skills_radar_legacy/`) implementan un pipeline Radar completo
alternativo (semáforo de riesgo, geo-recognizer, bridges a Firebase hacia
`antigravity-jairo-2026.web.app`, endpoints propios) que **no corresponde al
Radar real de producción** (`src/modules/radar/m1Pipeline.js`, Claude+Tavily+Supabase).

Confirmado antes de archivar (`docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §2.1`):
`Skill_Loader.cjs` es el único punto que los carga (`require()` + auto-ejecución
al importarse), y **nada en todo el árbol del proyecto importa `Skill_Loader.cjs`**
— verificado por grep. Cero riesgo de romper algo activo al moverlos aquí.

Se archivan en vez de eliminarse por si en el futuro se decide revivir esta
arquitectura Firebase-based del Radar — la decisión de implementar o borrar
definitivamente sigue pendiente, no se toma aquí. Mismo patrón ya usado en
`skills/_archivo_historico/` y `skills/_quarantine/` del proyecto.
