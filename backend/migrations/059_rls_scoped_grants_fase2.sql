-- =============================================================================
-- 059_rls_scoped_grants_fase2.sql
--
-- Fase 2 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06): GRANT DML a
-- rf360_rls_scoped sobre las 6 tablas que tocan biblioteca.routes.js,
-- fichaTecnica.routes.js y marcoNormativo.routes.js, migrados a withTenant()
-- en esta misma sesión.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 055/057):
-- las 6 tablas YA tienen RLS activo + política tenant_isolation real
-- (confirmado por pg_policies), pero CERO grant a rf360_rls_scoped —
-- envolver los call sites de estos 3 archivos en withTenant() fallaría con
-- "permission denied" sin este GRANT:
--   compliance_data              -> tenant_isolation: user_id = app.org_id
--   config_logistica             -> tenant_isolation: user_id = app.org_id
--   marco_normativo              -> tenant_isolation: user_id = app.org_id
--   versiones_proyecto           -> tenant_isolation: user_id = app.org_id
--   project_biblioteca           -> tenant_isolation: tenant_id = app.org_id (RLS FORCED)
--   project_biblioteca_carpetas  -> tenant_isolation: tenant_id = app.org_id (RLS FORCED)
--
-- Nota de columna: project_biblioteca/project_biblioteca_carpetas usan
-- `tenant_id`, las otras 4 usan `user_id` — inconsistencia de nombre de
-- columna en el esquema, sin efecto en el GRANT (ambas políticas comparan
-- contra la MISMA session var `app.org_id` que fija withTenant() via
-- set_config, columna aparte).
--
-- No se otorga GRANT de secuencias: las 6 tablas usan `id TEXT` sin default
-- (generado en JS, sin SERIAL/IDENTITY) — verificado en vivo contra
-- information_schema.columns antes de escribir esta migración.
--
-- compliance_data.routes.js / config_logistica.routes.js son Fase 3 (aún sin
-- migrar) pero fichaTecnica.routes.js SÍ lee/escribe esas 2 tablas
-- directamente (compilación de la Ficha Técnica) — el GRANT se otorga aquí
-- para desbloquear ESE acceso cruzado, no implica que compliance.routes.js/
-- configLogistica.routes.js completos ya estén migrados.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre 6 tablas de Fase 2 (biblioteca/fichaTecnica/marcoNormativo).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  compliance_data,
  config_logistica,
  marco_normativo,
  versiones_proyecto,
  project_biblioteca,
  project_biblioteca_carpetas
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre las 6 tablas.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
  v_tabla   TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['compliance_data','config_logistica','marco_normativo','versiones_proyecto','project_biblioteca','project_biblioteca_carpetas']
  LOOP
    IF NOT (
      has_table_privilege('rf360_rls_scoped', v_tabla, 'SELECT') AND
      has_table_privilege('rf360_rls_scoped', v_tabla, 'INSERT') AND
      has_table_privilege('rf360_rls_scoped', v_tabla, 'UPDATE') AND
      has_table_privilege('rf360_rls_scoped', v_tabla, 'DELETE')
    ) THEN
      v_missing := v_missing || v_tabla || ' ';
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en: %', v_missing;
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en las 6 tablas.';
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
  AND t.tablename IN ('compliance_data','config_logistica','marco_normativo','versiones_proyecto','project_biblioteca','project_biblioteca_carpetas')
ORDER BY t.tablename;
