-- =============================================================================
-- RadarFondos 360 — 012_enforce_fks_and_rls.sql
--
-- PROPÓSITO:
--   1. Agregar integridad referencial explícita en match_scores.proyecto_id
--      (nunca declarada desde 001 — solo tenía UNIQUE(proyecto_id, convocatoria_id)).
--   2. Documentar por qué match_scores.convocatoria_id NO puede tener FK.
--   3. Cerrar el hueco de FORCE ROW LEVEL SECURITY en match_scores — la
--      auditoría de 010_rls_complete_audit.sql cubrió projects, project_budgets,
--      objective_tree, grants, etc. pero omitió match_scores por completo.
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 012_enforce_fks_and_rls.sql
-- =============================================================================

-- =============================================================================
-- 1. FK match_scores.proyecto_id → projects(id)
-- =============================================================================

-- Limpieza previa obligatoria: una FK no puede crearse si existen filas
-- huérfanas (proyecto_id que ya no existe en projects). Sin esta limpieza,
-- el ALTER TABLE de abajo fallaría con "insert or update on table violates
-- foreign key constraint". Se registra el conteo antes de borrar para
-- trazabilidad — estas filas ya eran basura no accesible por ningún join
-- válido (matchScore.js siempre inserta con un proyecto real vigente).
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM match_scores ms
  WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = ms.proyecto_id);

  IF orphan_count > 0 THEN
    RAISE WARNING '[012] % fila(s) huérfana(s) en match_scores.proyecto_id (sin proyecto asociado) — eliminando antes de aplicar FK.', orphan_count;
    DELETE FROM match_scores ms
    WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = ms.proyecto_id);
  ELSE
    RAISE NOTICE '[012] Sin filas huérfanas en match_scores.proyecto_id — limpieza no requerida.';
  END IF;
END;
$$;

ALTER TABLE match_scores
  DROP CONSTRAINT IF EXISTS fk_match_project;

ALTER TABLE match_scores
  ADD CONSTRAINT fk_match_project
  FOREIGN KEY (proyecto_id) REFERENCES projects(id) ON DELETE CASCADE;

-- =============================================================================
-- 2. match_scores.convocatoria_id — SIN FK, documentado explícitamente
--
-- RAZÓN (no es "tabla externa" — grants/convocatorias SÍ existe localmente):
--   match_scores.convocatoria_id es UUID (001_postgres_schema.sql:157).
--   grants.id (antes convocatorias.id) es TEXT — nunca fue migrado a UUID
--   en ningún archivo de backend/migrations/ (grants solo recibió RENAMEs
--   de columnas en 003, jamás un cambio de tipo de su PK).
--   PostgreSQL no permite una FK entre columnas de tipos incompatibles
--   (UUID vs TEXT) sin un CAST, y un CAST silencioso en una FK no es válido
--   en DDL — la única forma correcta de cerrar este hueco es una migración
--   de tipo separada (convertir grants.id a UUID, con el impacto que eso
--   tiene sobre EntityScraper.js/DataIngestor.js/FileImporter.js que generan
--   IDs de convocatoria como TEXT) o cambiar match_scores.convocatoria_id a
--   TEXT. Ambos cambios tocan código de ingesta en producción activa y NO
--   se incluyen en esta migración — quedan fuera de alcance de este fix.
-- =============================================================================
COMMENT ON COLUMN match_scores.convocatoria_id IS
  'Sin FK: tipo incompatible con grants.id (UUID vs TEXT). Ver comentario en 012_enforce_fks_and_rls.sql — requiere migración de tipo separada, no incluida aquí.';

-- =============================================================================
-- 3. FORCE ROW LEVEL SECURITY en match_scores (hueco no cubierto por 010)
-- =============================================================================
ALTER TABLE match_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_scores FORCE ROW LEVEL SECURITY;

-- Reemplaza la política legacy de 002 (current_tenant_id) por el patrón
-- dual current_tenant_uuid()/current_auth_uid() ya usado en projects,
-- project_budgets y project_version_hashes desde 010.
DROP POLICY IF EXISTS match_scores_tenant_isolation ON match_scores;
DROP POLICY IF EXISTS match_scores_tenant_rls        ON match_scores;

CREATE POLICY match_scores_tenant_rls ON match_scores
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE
  fk_count    INTEGER;
  rls_forced  BOOLEAN;
  policy_count INTEGER;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 012 ===';

  SELECT COUNT(*) INTO fk_count
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'match_scores' AND con.contype = 'f' AND con.conname = 'fk_match_project';
  RAISE NOTICE '[match_scores] fk_match_project instalada: %', (fk_count = 1);

  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'match_scores' AND n.nspname = 'public';
  RAISE NOTICE '[match_scores] RLS+FORCE habilitado: %', COALESCE(rls_forced, FALSE);

  SELECT COUNT(*) INTO policy_count FROM pg_policies
  WHERE tablename = 'match_scores' AND schemaname = 'public';
  RAISE NOTICE '[match_scores] políticas activas: %', policy_count;

  RAISE NOTICE '=== FIN VERIFICACIÓN 012 ===';
END;
$$;
