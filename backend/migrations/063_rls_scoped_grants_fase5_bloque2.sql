-- =============================================================================
-- 063_rls_scoped_grants_fase5_bloque2.sql
--
-- Fase 5 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06), Bloque 2
-- (Administración de Usuarios en server.js): GRANT DML a rf360_rls_scoped
-- sobre user_favorites, la única tabla de este bloque que aún no lo tenía.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 059-062):
--   usuarios            -> ya tenía GRANT (053_rls_scoped_role.sql).
--   proyectos           -> ya tenía GRANT (053_rls_scoped_role.sql).
--   versiones_proyecto  -> ya tenía GRANT (055_rls_scoped_grants_fase1.sql).
--   project_budgets     -> ya tenía GRANT (060_rls_scoped_grants_fase3.sql).
--   user_subscriptions  -> ya tenía GRANT (062_rls_scoped_grants_fase4.sql).
--   user_gemini_keys    -> ya tenía GRANT (verificado en vivo, política real:
--                          user_id = app.org_id).
--   user_favorites      -> RLS activo, política real (user_id = app.org_id),
--                          CERO grant a rf360_rls_scoped. <- esta migración.
--
-- EXCLUIDAS A PROPÓSITO, verificado en vivo (no son deuda pendiente, son
-- vistas de admin genuinamente GLOBALES/cross-tenant por diseño):
--   admin_audit_log -> RLS ACTIVO pero CERO políticas definidas (deny-all
--                      para cualquier rol sin BYPASSRLS, el GRANT no lo
--                      arregla) -- además es un log de auditoría cruzado por
--                      NATURALEZA (un admin revisa acciones sobre TODOS los
--                      tenants, no solo el propio) -- RLS no puede expresar
--                      "todas las filas de todos los tenants", solo "las
--                      filas de UN tenant". Se queda en el pool principal,
--                      protegido por el chequeo req.userRole==='admin', no
--                      por RLS.
--   ai_token_logs    -> mismo hallazgo: RLS activo sin política, y GET
--                      /api/admin/finops es un reporte agregado GLOBAL
--                      (suma de costos de TODOS los usuarios) -- escoparlo
--                      por un solo tenant rompería el propósito mismo del
--                      reporte.
--
-- No se otorga GRANT de secuencias: user_favorites usa `id TEXT` generado en
-- JS, column_default = NULL, sin SERIAL/IDENTITY -- verificado en vivo antes
-- de escribir esta migración.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre user_favorites (Fase 5, Bloque 2).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  user_favorites
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre user_favorites.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'user_favorites', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'user_favorites', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'user_favorites', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'user_favorites', 'DELETE')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en user_favorites';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en user_favorites.';
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
  AND t.tablename = 'user_favorites';
