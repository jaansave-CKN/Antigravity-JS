-- =============================================================================
-- 068_audit_logs_append_only.sql
--
-- F-12 (auditoría V3, 2026-09-23): de las tablas de trazabilidad solo
-- project_version_hashes era realmente inalterable (triggers de 058). En
-- tenant_audit_logs el rol rf360_rls_scoped tenía UPDATE/DELETE y no había
-- ningún trigger; admin_audit_log tampoco tenía trigger (solo el pool
-- principal le escribe, pero nada impedía un UPDATE/DELETE desde ahí).
--
-- Verificado en vivo antes de escribir esto: ninguna FK apunta a estas tablas
-- ni sale de ellas (la purga de cuenta por Habeas Data, server.js, NO las
-- toca: tenant_audit_logs sobrevive a propósito), y ningún código hace
-- UPDATE/DELETE sobre ellas (grep en server.js y backend/).
--
-- Límite honesto: el dueño de la tabla (postgres) puede deshabilitar o
-- borrar un trigger. Esto bloquea cualquier modificación desde la app y
-- desde cualquier rol de aplicación; no sustituye un log externo WORM.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION rf360_audit_append_only() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: % es append-only (operación % bloqueada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$function$;

DROP TRIGGER IF EXISTS trg_tal_no_update_delete ON tenant_audit_logs;
CREATE TRIGGER trg_tal_no_update_delete BEFORE UPDATE OR DELETE ON tenant_audit_logs
  FOR EACH ROW EXECUTE FUNCTION rf360_audit_append_only();
DROP TRIGGER IF EXISTS trg_tal_no_truncate ON tenant_audit_logs;
CREATE TRIGGER trg_tal_no_truncate BEFORE TRUNCATE ON tenant_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION rf360_audit_append_only();

DROP TRIGGER IF EXISTS trg_aal_no_update_delete ON admin_audit_log;
CREATE TRIGGER trg_aal_no_update_delete BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION rf360_audit_append_only();
DROP TRIGGER IF EXISTS trg_aal_no_truncate ON admin_audit_log;
CREATE TRIGGER trg_aal_no_truncate BEFORE TRUNCATE ON admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION rf360_audit_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON tenant_audit_logs FROM rf360_rls_scoped;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
        AND tgname IN ('trg_tal_no_update_delete','trg_tal_no_truncate','trg_aal_no_update_delete','trg_aal_no_truncate')) <> 4 THEN
    RAISE EXCEPTION '068: no quedaron los 4 triggers — transacción abortada';
  END IF;
  IF has_table_privilege('rf360_rls_scoped', 'public.tenant_audit_logs', 'UPDATE')
     OR has_table_privilege('rf360_rls_scoped', 'public.tenant_audit_logs', 'DELETE') THEN
    RAISE EXCEPTION '068: rf360_rls_scoped conserva UPDATE/DELETE — transacción abortada';
  END IF;
END $$;

COMMIT;
