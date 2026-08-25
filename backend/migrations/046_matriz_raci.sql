-- =============================================================================
-- RadarFondos 360 — 046_matriz_raci.sql
--
-- PROPÓSITO:
--   Módulo NUEVO "Matriz RACI" (client/src/pages/MatrizRaciPage.tsx, ruta
--   /matriz-raci) — hasta hoy 100% maqueta sin backend (confirmado: cero
--   fetch/useEffect en el archivo, comentario propio de cabecera lo admite).
--   Diseño revisado y aprobado por el subagente architect (2026-08-24) antes
--   de escribir código, según exige CLAUDE.md para módulos nuevos.
--
--   Esquema RELACIONAL de 3 tablas (no JSONB-en-columna como
--   motor_dialectico.lista_oro) porque Resumen RACI necesita COUNT/GROUP BY
--   reales (¿cuántas tareas sin "A"? ¿qué rol no tiene ninguna asignación?)
--   — un blob JSON obligaría a reimplementar esa lógica de conteo en cada
--   consumidor (Resumen, Ficha Técnica, PDF), con riesgo de divergencia.
--
--   Sin columna user_id/org_id propia en las 3 tablas — mismo criterio que
--   logistica_tramos (016_formulador_tablas_reales.sql): la propiedad se
--   resuelve transitivamente vía proyecto_id + checkOwnership() en la ruta
--   contra la tabla padre `proyectos`.
--
--   raci_tareas/raci_roles usan CRUD por fila con id estable (NO el patrón
--   DELETE-ALL+INSERT-ALL de logistica_tramos) — son tablas PADRE
--   referenciadas por FK desde raci_asignaciones; regenerar sus ids en cada
--   guardado borraría en cascada toda la matriz. raci_asignaciones se
--   actualiza celda por celda (upsert por tarea_id+rol_id), nunca como
--   reemplazo del grid completo — mismo criterio anti-condición-de-carrera
--   que el fix de guardado por fila de Anexos/Biblioteca (2026-08-17).
--
--   TEXT para ids (heredado del bootstrap SQLite original, misma convención
--   que toda tabla de este proyecto desde la migración 016). Sin RLS: Capa 2
--   corre con service_role (bypasea RLS), agregar políticas sería falsa
--   sensación de seguridad.
--
-- APLICAR CON:
--   Pegar el contenido completo en el SQL Editor del dashboard de Supabase
--   y ejecutar. Es idempotente (seguro de re-ejecutar).
-- =============================================================================

-- =============================================================================
-- 1. raci_tareas — filas de la matriz (catálogo de tareas/actividades del
--    proyecto, capturado en la pestaña "REGISTROS" de MatrizRaciPage.tsx).
-- =============================================================================
CREATE TABLE IF NOT EXISTS raci_tareas (
  id          TEXT      PRIMARY KEY,
  proyecto_id TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  nombre      TEXT      NOT NULL,
  descripcion TEXT      DEFAULT '',
  orden       INTEGER   DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_raci_tareas_proyecto ON raci_tareas (proyecto_id);

-- =============================================================================
-- 2. raci_roles — columnas de la matriz (roles/personas del proyecto, sin
--    catálogo reutilizable en el resto del sistema — verificado: ni
--    stakeholders ni config_logistica.equipo_director/equipo_coordinador son
--    tablas estructuradas, son texto libre o strings sueltos de UI).
-- =============================================================================
CREATE TABLE IF NOT EXISTS raci_roles (
  id          TEXT      PRIMARY KEY,
  proyecto_id TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  nombre      TEXT      NOT NULL,
  orden       INTEGER   DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_raci_roles_proyecto ON raci_roles (proyecto_id);

-- =============================================================================
-- 3. raci_asignaciones — celda de la matriz (tarea × rol → sigla). PK
--    compuesta (tarea_id, rol_id) — como mucho una sigla por celda, upsert
--    natural con ON CONFLICT. Ausencia de fila = celda vacía (no CHECK NULL).
-- =============================================================================
CREATE TABLE IF NOT EXISTS raci_asignaciones (
  tarea_id   TEXT      NOT NULL REFERENCES raci_tareas(id) ON DELETE CASCADE,
  rol_id     TEXT      NOT NULL REFERENCES raci_roles(id) ON DELETE CASCADE,
  sigla      TEXT      NOT NULL CHECK (sigla IN ('R','A','C','I','V','IA')),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tarea_id, rol_id)
);

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 046 ===';
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename IN ('raci_tareas','raci_roles','raci_asignaciones')
    ORDER BY tablename
  LOOP
    RAISE NOTICE '[%] tabla creada OK', r.tablename;
  END LOOP;
  RAISE NOTICE '=== FIN VERIFICACIÓN 046 ===';
END;
$$;
