-- =============================================================================
-- 057_rls_scoped_grants_byok_viabilidad.sql
--
-- Prioridad Roja (2026-09-05), Punto 1 del plan: GRANT DML a rf360_rls_scoped
-- sobre las 3 tablas que tocan los últimos 2 puntos ciegos del flujo de
-- proyectos — recolectarContextoViabilidad() (viabilidadAgent.js) y
-- resolverContextoBYOK()/esExento() (byokService.js), migrados a withTenant()
-- en esta misma sesión.
--
-- HALLAZGO (verificado en vivo, no supuesto — mismo método que 055):
-- las 3 tablas ya tienen RLS + política tenant_isolation real (confirmado por
-- pg_policies), pero CERO grant a rf360_rls_scoped:
--   objetivos_arbol        -> política via JOIN a proyectos.org_id (igual
--                             patrón que logistica_tramos, ya probado en la
--                             prueba de aislamiento de la migración 055).
--   project_change_theory  -> política directa org_id = app.org_id.
--   user_gemini_keys       -> política directa user_id = app.org_id.
-- (tenant_audit_logs tiene el mismo gap pero NO se otorga aquí — solo la
-- toca guardarLlaveUsuario()/byokCredentials.routes.js, fuera del alcance de
-- este pase: no se migra código que no se está tocando en esta sesión.)
--
-- Sin este GRANT, envolver recolectarContextoViabilidad()/resolverContextoBYOK()
-- en withTenant() fallaría con "permission denied" — mismo patrón ya resuelto
-- en 053/054/055.
--
-- No se otorga GRANT de secuencias: las 3 tablas usan PK TEXT/UUID con
-- gen_random_uuid() o generadas en JS (crypto.randomUUID()), sin SERIAL.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio — GRANT DML a rf360_rls_scoped sobre objetivos_arbol, project_change_theory, user_gemini_keys.'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  objetivos_arbol,
  project_change_theory,
  user_gemini_keys
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre las 3 tablas.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
  v_tabla   TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['objetivos_arbol','project_change_theory','user_gemini_keys']
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

  RAISE NOTICE '[CHECKPOINT 2/2] OK — GRANT DML completo y verificado en las 3 tablas.';
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
  AND t.tablename IN ('objetivos_arbol','project_change_theory','user_gemini_keys')
ORDER BY t.tablename;
