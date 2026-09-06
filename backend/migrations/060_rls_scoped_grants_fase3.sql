-- =============================================================================
-- 060_rls_scoped_grants_fase3.sql
--
-- Fase 3 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06), lote inicial:
-- GRANT DML a rf360_rls_scoped sobre project_budgets, la única tabla de
-- presupuesto.routes.js/configLogistica.routes.js que aún no lo tenía.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 055/057/059):
--   project_budgets   -> tenant_isolation: org_id = app.org_id -- RLS activo,
--                        política real, CERO grant a rf360_rls_scoped.
--   config_logistica  -> ya tenía GRANT (059_rls_scoped_grants_fase2.sql).
--   logistica_tramos  -> ya tenía GRANT (055_rls_scoped_grants_fase1.sql).
--   proyectos         -> ya tenía GRANT (053_rls_scoped_role.sql).
--
-- EXCLUIDA A PROPÓSITO: catalogo_rendimientos. Verificado en vivo: tiene RLS
-- ACTIVO pero CERO políticas definidas -- en Postgres, RLS habilitado sin
-- ninguna política es deny-all para cualquier rol sin BYPASSRLS (el GRANT no
-- lo compensa: controla el permiso de intentar la operación, no qué filas se
-- ven). Tampoco tiene columna org_id/user_id/tenant_id -- es un catálogo de
-- referencia GLOBAL (rendimientos de obra), no datos por tenant, mismo
-- criterio que gemini_key_state/trial_sessions (sección 4 del roadmap).
-- Otorgarle GRANT no habría arreglado nada (seguiría devolviendo 0 filas por
-- la falta de política) y habría sido una señal falsa de "ya es tenant-safe"
-- sobre una tabla que nunca debe tener tenant.
--
-- No se otorga GRANT de secuencias: project_budgets usa `id TEXT` generado
-- en JS (crypto.randomUUID()), sin SERIAL/IDENTITY -- verificado en vivo
-- antes de escribir esta migración.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre project_budgets (Fase 3, lote presupuesto/logistica).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  project_budgets
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre project_budgets.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'project_budgets', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'project_budgets', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'project_budgets', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'project_budgets', 'DELETE')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en project_budgets';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en project_budgets.';
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
  AND t.tablename = 'project_budgets';
