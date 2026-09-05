-- =============================================================================
-- 056_rls_pvh_fix_policy.sql
--
-- Prioridad Roja (2026-09-05), Punto 2 del plan: corrige la política RLS de
-- `project_version_hashes`, encontrada en la auditoría de la migración 055
-- (introspección en vivo de pg_policies, no documentada en ningún archivo de
-- este repo — el nombre `pvh_provisional_open` no aparece en ningún .sql
-- versionado, se creó directo contra la BD, probablemente vía el SQL Editor
-- de Supabase, fuera del control de versiones).
--
-- HALLAZGO (verificado en vivo, no supuesto):
--   SELECT policyname, qual FROM pg_policies WHERE tablename='project_version_hashes';
--   -> {"policyname":"pvh_provisional_open","qual":"true"}
-- RLS está ENABLED en la tabla, pero la política permite CUALQUIER fila a
-- CUALQUIER rol sin BYPASSRLS — equivalente a no tener RLS en absoluto. El
-- GRANT DML a rf360_rls_scoped ya se aplicó en 055_rls_scoped_grants_fase1.sql;
-- esta migración solo reemplaza la política, no toca permisos.
--
-- La protección real de esta tabla hoy es EXCLUSIVAMENTE el filtro manual
-- `WHERE tenant_id = ?` que ya usan GET /api/proyectos/:id/hash y
-- .../hash/verify/:hash (proyectos.routes.js, migrados a withTenantRow()) —
-- correcto por diseño de la ruta, pero sin respaldo real de RLS detrás.
--
-- VERIFICADO ANTES DE ESCRIBIR ESTA MIGRACIÓN (no supuesto):
--   - `tenant_id` es NOT NULL, tipo uuid (información_schema.columns).
--   - 2/2 filas reales de la tabla tienen tenant_id poblado (0 NULLs) — el
--     cambio de política no puede dejar filas huérfanas invisibles para su
--     propio dueño.
--   - `current_setting('app.org_id', true)::uuid` no lanza error ni sin
--     SET LOCAL (devuelve NULL, la fila simplemente no matchea) ni con un
--     UUID válido (probado en vivo contra esta misma BD) — el cast es seguro.
--     Se castea el SETTING a uuid (no la columna a text) porque `usuarios.id`
--     (el valor real que viaja en app.org_id) es TEXT con formato UUID, y
--     `tenant_id` en ESTA tabla específica es uuid nativo (a diferencia de
--     proyectos/usuarios, que son TEXT heredado del bootstrap SQLite) —
--     confirmado por introspección, no supuesto por analogía con otras tablas.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline
-- (mismo formato que 053/054/055).
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio — reemplazando pvh_provisional_open (qual=true) por aislamiento real por tenant_id.'; END $$;

DROP POLICY IF EXISTS pvh_provisional_open ON project_version_hashes;

CREATE POLICY tenant_isolation ON project_version_hashes FOR ALL
  USING (tenant_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.org_id', true)::uuid);

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] Política tenant_isolation creada (USING/WITH CHECK por tenant_id).'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
DECLARE
  v_qual TEXT;
  v_name TEXT;
BEGIN
  SELECT policyname, qual INTO v_name, v_qual
  FROM pg_policies WHERE tablename = 'project_version_hashes';

  IF v_name IS NULL THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: ninguna política quedó activa en project_version_hashes.';
  END IF;
  IF v_name = 'pvh_provisional_open' THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: la política vieja (abierta) sigue activa.';
  END IF;
  IF v_qual = 'true' THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: la política nueva sigue siendo qual=true (abierta) — no se corrigió nada real.';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK — política activa: % / qual: %', v_name, v_qual;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Reporte final ─────────────────────────────────────────────────────────
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activo,
       p.policyname, p.qual,
       has_table_privilege('rf360_rls_scoped', c.relname, 'SELECT') AS rf360_puede_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_policies p ON p.tablename = c.relname
WHERE c.relname = 'project_version_hashes';
