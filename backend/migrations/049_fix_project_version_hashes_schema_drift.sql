-- =============================================================================
-- 049_fix_project_version_hashes_schema_drift.sql
--
-- Corrige drift fuera de banda: la tabla real en producción tiene columna
-- `proyecto_id` con FK a `formulador_proyectos(id)` (tabla huérfana, 0
-- referencias de código en todo el repo) y SIN unique constraint sobre
-- (project_id, hash_value) — pese a que la migración 009 original, el
-- bootstrap de server.js y docs/DISENO_FLUJO_DELTA_VERSION_N+1.md siempre
-- asumieron `project_id` + UNIQUE(project_id, hash_value) + sin FK.
-- Tabla con 0 filas — sin riesgo de pérdida de datos. Diseño verificado por
-- `architect` (agentId a5faf7761c6a6ecef, 2026-08-24).
-- =============================================================================

BEGIN;

-- 1. Quitar la FK errónea hacia la tabla huérfana formulador_proyectos.
ALTER TABLE project_version_hashes
  DROP CONSTRAINT IF EXISTS project_version_hashes_proyecto_id_fkey;

-- 2. Renombrar proyecto_id → project_id (solo si aún existe con ese nombre;
--    idempotente para poder re-ejecutar sin error).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_version_hashes' AND column_name = 'proyecto_id'
  ) THEN
    ALTER TABLE project_version_hashes RENAME COLUMN proyecto_id TO project_id;
  END IF;
END $$;

-- 3. Normalizar el tipo a TEXT (mismo tipo que proyectos.id, heredado del
--    bootstrap SQLite original — migración 016 línea 14). USING funciona
--    igual si la columna ya era uuid o ya era text.
ALTER TABLE project_version_hashes
  ALTER COLUMN project_id TYPE TEXT USING project_id::text;

-- 4. FK correcta hacia la única tabla activa real.
ALTER TABLE project_version_hashes
  ADD CONSTRAINT project_version_hashes_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES proyectos(id) ON DELETE CASCADE;

-- 5. Restaurar el UNIQUE INDEX que el ON CONFLICT del controlador exige y que
--    ya estaba especificado en la migración 009 original.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pvh_unique_hash
  ON project_version_hashes (project_id, hash_value);

COMMIT;

-- Verificación post-migración (mismo patrón que 009/016)
DO $$
DECLARE fk_count INTEGER; idx_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fk_count FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'project_version_hashes'
      AND con.conname = 'project_version_hashes_project_id_fkey';
  RAISE NOTICE '[project_version_hashes] FK a proyectos(id) instalada: %', (fk_count = 1);

  SELECT COUNT(*) INTO idx_count FROM pg_indexes
    WHERE tablename = 'project_version_hashes' AND indexname = 'idx_pvh_unique_hash';
  RAISE NOTICE '[project_version_hashes] UNIQUE(project_id, hash_value) instalado: %', (idx_count = 1);
END $$;
