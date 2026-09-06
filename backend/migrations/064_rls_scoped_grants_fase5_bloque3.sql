-- =============================================================================
-- 064_rls_scoped_grants_fase5_bloque3.sql
--
-- Fase 5 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06), Bloque 3
-- (Módulo de Proyectos / Core de Negocio en server.js): GRANT DML a
-- rf360_rls_scoped sobre postulaciones_entidad y match_scores, las 2 tablas
-- de este lote que aún no lo tenían.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 059-063):
--   proyectos              -> ya tenía GRANT (053_rls_scoped_role.sql).
--   objetivos_arbol        -> ya tenía GRANT (política real vía EXISTS sobre proyectos.org_id).
--   project_indicators     -> ya tenía GRANT (061_rls_scoped_grants_fase3_lote2.sql).
--   project_change_theory  -> ya tenía GRANT (verificado en Fase 3 Lote 2).
--   postulaciones_entidad  -> RLS activo, política real (org_id = app.org_id),
--                             CERO grant a rf360_rls_scoped. <- esta migración.
--   match_scores           -> RLS activo, política real (org_id = app.org_id),
--                             CERO grant a rf360_rls_scoped. <- esta migración.
--
-- EXCLUIDA A PROPÓSITO, verificado en vivo (NO es deuda pendiente): convocatorias
-- tiene RLS ACTIVO pero CERO políticas definidas (deny-all para cualquier rol
-- sin BYPASSRLS, el GRANT no lo arregla) -- es un catálogo de oportunidades de
-- financiación GLOBAL/PÚBLICO (scrapeado por EntityScraper/DataIngestor, sin
-- org_id real en ninguna fila), no datos por tenant. Escoparla habría devuelto
-- 0 filas siempre en el pipeline de Match Score, rompiendo la funcionalidad
-- para todo el mundo. Se queda en el pool principal, mismo criterio que
-- catalogo_rendimientos/admin_audit_log/ai_token_logs.
--
-- HALLAZGO ADICIONAL para el código (no de esta migración SQL): la política de
-- match_scores exige org_id = app.org_id, pero el INSERT actual de
-- backend/pipeline/matchScore.js NO incluye la columna org_id (cae al default
-- ''::text) -- bajo el pool escopado esa fila NUNCA satisface la política y el
-- INSERT sería rechazado. Se corrige en el mismo commit de código añadiendo
-- org_id=tenantId explícito al INSERT.
--
-- No se otorga GRANT de secuencias: ambas tablas usan `id TEXT` generado en
-- JS (crypto.randomUUID()), column_default = NULL, sin SERIAL/IDENTITY --
-- verificado en vivo antes de escribir esta migración.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre postulaciones_entidad y match_scores (Fase 5, Bloque 3).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  postulaciones_entidad,
  match_scores
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre postulaciones_entidad y match_scores.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'postulaciones_entidad', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'postulaciones_entidad', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'postulaciones_entidad', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'postulaciones_entidad', 'DELETE') AND
    has_table_privilege('rf360_rls_scoped', 'match_scores', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'match_scores', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'match_scores', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'match_scores', 'DELETE')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en postulaciones_entidad/match_scores';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en postulaciones_entidad y match_scores.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Reporte final ─────────────────────────────────────────────────────────
SELECT
  t.tablename,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'SELECT') AS puede_select,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'INSERT') AS puede_insert,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'UPDATE') AS puede_update,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'DELETE') AS puede_delete,
  c.relrowsecurity AS rls_activo,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = t.tablename) AS num_politicas
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN ('postulaciones_entidad', 'match_scores');
