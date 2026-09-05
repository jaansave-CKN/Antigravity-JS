-- =============================================================================
-- 055_rls_scoped_grants_fase1.sql
--
-- Prioridad Roja (2026-09-05) — Fase 1 de docs/ROADMAP_MIGRACION_TENANT_2026.md:
-- completar la migración a withTenant() de proyectos.routes.js y
-- anexos.routes.js (parcialmente migrados), más el hallazgo de
-- reporte.routes.js -> raciService.js encontrado por el agente `architect`
-- al fiscalizar este plan (agentId a446b192b8ceaf153, 2026-09-05).
--
-- HALLAZGO QUE ORIGINA ESTA MIGRACIÓN (verificado en vivo, no supuesto):
-- rf360_rls_scoped (053_rls_scoped_role.sql) solo tiene GRANT DML sobre 10
-- tablas: las 7 de 053 + raci_tareas/raci_roles/raci_asignaciones de 054.
-- proyectos.routes.js y anexos.routes.js tocan 6 tablas MÁS que ya tienen RLS
-- + política de 026_rls_policies_tenant_isolation.sql / 042_anexos_carpetas_
-- dinamicas.sql pero CERO grant al rol escopado — confirmado por grep de
-- "GRANT.*rf360_rls_scoped" en todo backend/migrations/*.sql:
--
--   usuarios                  -> RLS ya activo, política `id = app.org_id`
--                                 (026:32, "1 usuario = 1 organización",
--                                 diseño intencional, confirmado por el
--                                 architect — no requiere cambio de política).
--   project_version_hashes    -> RLS ya activo, política `tenant_id = app.org_id`
--                                 (026:36).
--   project_anexos            -> RLS ya activo, política `tenant_id = app.org_id`
--                                 (026:35).
--   project_anexos_carpetas   -> RLS + FORCE ya activos, política
--                                 `tenant_id = app.org_id` (042:38-43).
--   motor_dialectico          -> RLS ya activo, política `user_id = app.org_id`
--                                 (026:44).
--   logistica_tramos          -> RLS ya activo, política vía JOIN a
--                                 proyectos.org_id (026:51).
--
-- Sin el GRANT de abajo, envolver los call sites de estos 2+1 archivos en
-- withTenant()/withTenantRow()/withTenantRows()/withTenantRun() (backend/
-- config/database.config.js) falla con "permission denied for table X" en
-- vez de simplemente empezar a aislar por tenant — mismo patrón exacto ya
-- resuelto en 054 para las tablas RACI.
--
-- QUÉ NO HACE (restricción dura, igual que 053/054):
--   - NO toca el rol "postgres" ni las políticas RLS ya existentes (026/042) —
--     estas 6 tablas ya estaban correctamente protegidas por RLS desde antes,
--     el único gap es que NINGÚN rol sin BYPASSRLS podía usarlas (ni siquiera
--     su dueño real de negocio, rf360_rls_scoped).
--   - NO otorga GRANT de secuencias: verificado que las 6 tablas usan PK
--     UUID/TEXT con gen_random_uuid() (001_postgres_schema.sql, 009_project_
--     version_hashes.sql, 016_formulador_tablas_reales.sql, 042_anexos_
--     carpetas_dinamicas.sql) — sin SERIAL/BIGSERIAL, nada que otorgar.
--
-- Puramente aditivo, idempotente, transacción explícita con checkpoints y
-- verificación inline (mismo formato que 053/054).
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio — GRANT DML a rf360_rls_scoped sobre 6 tablas de Fase 1 (proyectos.routes.js / anexos.routes.js / reporte.routes.js).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  usuarios,
  project_version_hashes,
  project_anexos,
  project_anexos_carpetas,
  motor_dialectico,
  logistica_tramos
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre las 6 tablas.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
  v_tabla   TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['usuarios','project_version_hashes','project_anexos',
                                  'project_anexos_carpetas','motor_dialectico','logistica_tramos']
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

  -- Defensivo, no bloqueante: si alguna de las 6 tablas no tuviera RLS activo
  -- (no debería pasar, todas vienen de 026/042 ya aplicadas), avisar en vez
  -- de fallar silencioso — un GRANT sin RLS detrás sería un agujero real.
  FOREACH v_tabla IN ARRAY ARRAY['usuarios','project_version_hashes','project_anexos',
                                  'project_anexos_carpetas','motor_dialectico','logistica_tramos']
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = v_tabla) THEN
      RAISE WARNING '[CHECKPOINT 2/2] ATENCION: % tiene GRANT nuevo pero RLS NO esta activo — revisar antes de desplegar el codigo que usa withTenant() sobre esta tabla.', v_tabla;
    END IF;
  END LOOP;

  RAISE NOTICE '[CHECKPOINT 2/2] OK — GRANT DML completo y verificado en las 6 tablas de Fase 1.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Reporte final (una fila por tabla, OK/FALTA + estado RLS) ────────────────
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
  AND t.tablename IN ('usuarios','project_version_hashes','project_anexos',
                       'project_anexos_carpetas','motor_dialectico','logistica_tramos')
ORDER BY t.tablename;
