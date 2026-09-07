-- =============================================================================
-- 065_rls_scoped_grants_fase5_bloque4.sql
--
-- Fase 5 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06), Bloque 4
-- (Módulo Radar / Módulo IA-Copiloto): GRANT DML a rf360_rls_scoped sobre
-- tenant_audit_logs, la única tabla de este lote que aún no lo tenía.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 059-064):
--   usuarios           -> ya tenía GRANT (053_rls_scoped_role.sql).
--   proyectos          -> ya tenía GRANT (053_rls_scoped_role.sql).
--   user_gemini_keys   -> ya tenía GRANT (verificado en Fase 5 Bloque 2).
--   tenant_audit_logs  -> RLS activo, política real (user_id = app.org_id),
--                         CERO grant a rf360_rls_scoped. <- esta migración.
--                         Usada por byokService.js::guardarLlaveUsuario() para
--                         registrar auditoría de guardado de llaves Gemini.
--
-- EXCLUIDAS A PROPÓSITO, verificado en vivo (NO son deuda pendiente -- son
-- catálogos/config GLOBALES por diseño, sin ningún concepto de tenant):
--   convocatorias     -> RLS ACTIVO, CERO políticas, y NO TIENE columna org_id
--                        en absoluto (verificado con information_schema.columns
--                        -- ni siquiera existe la columna, no solo está vacía).
--                        Catálogo público único de oportunidades de financiación,
--                        el mismo para todos los tenants. Todo el Módulo Radar
--                        que solo toca convocatorias (status/start/stop/trigger/
--                        rastreo1/expirar/cerrar-ids/reparar-fuente/buscar*/
--                        barrido-gemini/persistir-barrido) se queda en el pool
--                        principal -- no hay "org_id equivocado" posible porque
--                        no existe org_id que asignar.
--   app_settings      -> RLS ACTIVO, CERO políticas. Config global de la app
--                        (radar_scheduler_enabled, radar_keywords) -- el propio
--                        código ya lo documentaba como "no por-tenant" antes de
--                        esta migración.
--   agentes_registro  -> RLS ACTIVO, CERO políticas, sin ninguna columna de
--                        tenant (id/nombre/version/modulo/status/configuracion).
--                        Registro global de agentes IA del sistema.
--   ai_token_logs     -> ya excluida en Fase 5 Bloque 2 (RLS sin política,
--                        reporte agregado GLOBAL de consumo de IA).
--
-- No se otorga GRANT de secuencias: tenant_audit_logs usa `id TEXT` generado
-- en JS (crypto.randomUUID()), column_default = NULL, sin SERIAL/IDENTITY --
-- verificado en vivo antes de escribir esta migración.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre tenant_audit_logs (Fase 5, Bloque 4).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  tenant_audit_logs
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre tenant_audit_logs.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'tenant_audit_logs', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'tenant_audit_logs', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'tenant_audit_logs', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'tenant_audit_logs', 'DELETE')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en tenant_audit_logs';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en tenant_audit_logs.';
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
  AND t.tablename = 'tenant_audit_logs';
