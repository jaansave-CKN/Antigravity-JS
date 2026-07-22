-- =============================================================================
-- RadarFondos 360 — 014_projects_soft_delete_and_settings.sql
--
-- PROPÓSITO:
--   El Panel de Recuperación Administrativa (AdminRecoveryPanel.tsx) espera
--   GET /api/admin/deleted → { usuarios, proyectos, convocatorias } con
--   filas `deleted_at IS NOT NULL`. usuarios y convocatorias/grants ya tienen
--   esa columna (001/003) — projects NUNCA la tuvo. Esta migración la agrega
--   para poder implementar la papelera administrativa de proyectos con datos
--   reales en vez de un endpoint 501.
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 014_projects_soft_delete_and_settings.sql
-- =============================================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Índices parciales (patrón ya usado en 006_performance_indexes.sql para
-- convocatorias/grants): uno para el listado activo, otro para la papelera.
CREATE INDEX IF NOT EXISTS idx_projects_active
  ON projects (tenant_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_deleted
  ON projects (deleted_at) WHERE deleted_at IS NOT NULL;

-- La vista de compatibilidad 'proyectos' (003_schema_english_canonical.sql)
-- no seleccionaba deleted_at porque la columna no existía — se reemplaza
-- para exponerla también por ese nombre legacy.
CREATE OR REPLACE VIEW proyectos AS
  SELECT
    id, tenant_id, user_id, org_id,
    name AS nombre, status AS estado,
    bloqueo_razon, ficha_tecnica, presupuesto,
    crosscheck_sello, embedding, embedding_vec,
    payload_es, payload_en,
    created_at, updated_at, deleted_at
  FROM projects;

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE col_count INTEGER;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 014 ===';
  SELECT COUNT(*) INTO col_count FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'deleted_at';
  RAISE NOTICE '[projects] columna deleted_at instalada: %', (col_count = 1);
  RAISE NOTICE '=== FIN VERIFICACIÓN 014 ===';
END;
$$;
