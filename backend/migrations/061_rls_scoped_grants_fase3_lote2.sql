-- =============================================================================
-- 061_rls_scoped_grants_fase3_lote2.sql
--
-- Fase 3 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06), Lote 2:
-- GRANT DML a rf360_rls_scoped sobre project_indicators y user_credentials,
-- las 2 únicas tablas de este lote (radicacion.routes.js, motorDialectico.routes.js,
-- exportacion.routes.js, authGoogle.controller.js) que aún no lo tenían.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 059/060):
--   proyectos              -> ya tenía GRANT (053_rls_scoped_role.sql).
--   compliance_data        -> ya tenía GRANT (059_rls_scoped_grants_fase2.sql).
--   config_logistica       -> ya tenía GRANT (059_rls_scoped_grants_fase2.sql).
--   motor_dialectico       -> ya tenía GRANT (verificado en vivo, política
--                              tenant_isolation: user_id = app.org_id).
--   objetivos_arbol        -> ya tenía GRANT (política tenant_isolation vía
--                              EXISTS sobre proyectos.org_id).
--   project_change_theory  -> ya tenía GRANT (política tenant_isolation:
--                              org_id = app.org_id).
--   project_indicators     -> RLS activo, política real (org_id = app.org_id),
--                              CERO grant a rf360_rls_scoped. <- esta migración.
--   user_credentials       -> RLS activo, política real (user_id = app.org_id),
--                              CERO grant a rf360_rls_scoped. <- esta migración.
--
-- No se otorga GRANT de secuencias: ambas tablas usan `id TEXT` generado en
-- JS (crypto.randomUUID()), column_default = NULL, sin SERIAL/IDENTITY --
-- verificado en vivo antes de escribir esta migración.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre project_indicators y user_credentials (Fase 3, Lote 2).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  project_indicators,
  user_credentials
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre project_indicators y user_credentials.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'project_indicators', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'project_indicators', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'project_indicators', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'project_indicators', 'DELETE') AND
    has_table_privilege('rf360_rls_scoped', 'user_credentials', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'user_credentials', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'user_credentials', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'user_credentials', 'DELETE')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en project_indicators/user_credentials';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en project_indicators y user_credentials.';
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
  AND t.tablename IN ('project_indicators', 'user_credentials');
