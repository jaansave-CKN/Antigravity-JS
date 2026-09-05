-- =============================================================================
-- 054_rls_raci_gemini_trial.sql
--
-- 005_INGENIERO_BACKEND (2026-09-04, continuación) — cierra el hallazgo 4 de
-- docs/AUDITORIA_SEGURIDAD_2026-09-04.md: 5 tablas sin RLS
-- (gemini_key_state, trial_sessions, raci_asignaciones, raci_roles,
-- raci_tareas). El REVOKE a anon/authenticated (vector no autenticado) ya
-- se aplicó y verificó ese mismo día — esta migración es la parte que
-- quedó pendiente: aislamiento *entre tenants autenticados*.
--
-- ADVERTENCIA YA DOCUMENTADA EN LA AUDITORÍA (§6.1): "no asumir el mismo
-- patrón" que las 7 tablas de 026/053. Verificado en vivo antes de escribir
-- una sola política (CREATE TABLE real de cada una, no supuesto):
--
--   raci_tareas / raci_roles   -> tienen proyecto_id (FK a proyectos), NO
--                                 org_id directo. Aislamiento real: JOIN
--                                 contra proyectos.org_id.
--   raci_asignaciones          -> ni org_id ni proyecto_id directos, solo
--                                 tarea_id (FK a raci_tareas) + rol_id (FK a
--                                 raci_roles). Aislamiento real: JOIN de 2
--                                 saltos vía raci_tareas -> proyectos.org_id.
--   gemini_key_state           -> key_index (PK entero), sin ninguna columna
--                                 de tenant. Confirmado en el propio
--                                 comentario de 053_rls_scoped_role.sql:
--                                 "estado GLOBAL de rotación de llaves, no
--                                 dato por-tenant". No hay política de
--                                 tenant que escribir aquí -- no existe la
--                                 dimensión.
--   trial_sessions             -> session_id (PK uuid) + ip_hash, sin
--                                 org_id/user_id. Dato anónimo de sesión de
--                                 prueba, no multi-tenant por diseño (nadie
--                                 "posee" una trial session salvo la propia
--                                 sesión). Sin dimensión de tenant que aislar.
--
-- Para las 2 últimas, "RLS + política de tenant" no es la operación
-- correcta porque la premisa (existe una columna de tenant) es falsa. Lo que
-- SÍ es correcto y lo que hace esta migración: ENABLE ROW LEVEL SECURITY sin
-- ninguna política -- Postgres deniega por defecto a cualquier rol que no
-- sea el dueño ni tenga BYPASSRLS. Verificado que el único acceso real hoy a
-- estas 2 tablas es vía supabaseAdmin/service_role (gemini_key_state,
-- geminiCircuitBreaker.js:54,200,362 -- bypassa RLS por diseño de Supabase)
-- y que ningún código de producción usa withTenant() para ninguna de las 2
-- (grep confirmado) -- activar RLS sin política aquí es endurecimiento
-- puro, cero riesgo de romper una ruta real.
--
-- GAP ADICIONAL encontrado al verificar (no estaba en el alcance original de
-- esta migración, pero bloquearía en silencio el refactor de código que la
-- auditoría reporta como "ya completado"): raciService.js YA fue
-- refactorizado a withTenant() (confirmado, comentario propio del archivo
-- referencia esta migración 054 por nombre) pero rf360_rls_scoped NUNCA
-- recibió GRANT sobre raci_tareas/raci_roles/raci_asignaciones -- solo
-- cubre las 7 tablas de 053_rls_scoped_role.sql. Sin el GRANT de abajo,
-- activar RLS aquí haría que withTenant() fallara con "permission denied"
-- en vez de simplemente empezar a filtrar por tenant. Se agrega en el
-- Paso 0 antes de tocar RLS, mismo criterio aditivo de 053 (no toca
-- "postgres", no re-otorga privilegios que ya tenía el rol).
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline
-- (mismo formato de 009_idempotencia_fase1.sql / 053_rls_scoped_role.sql).
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/5] Inicio — GRANT DML a rf360_rls_scoped sobre raci_tareas/raci_roles/raci_asignaciones (gap no cubierto por 053).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE raci_tareas, raci_roles, raci_asignaciones
  TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/5] GRANT DML otorgado sobre las 3 tablas RACI.'; END $$;

-- ── raci_tareas / raci_roles — aislamiento vía JOIN a proyectos.org_id ───────
ALTER TABLE raci_tareas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raci_tareas;
CREATE POLICY tenant_isolation ON raci_tareas FOR ALL
  USING (proyecto_id IN (SELECT id FROM proyectos WHERE org_id = current_setting('app.org_id', true)))
  WITH CHECK (proyecto_id IN (SELECT id FROM proyectos WHERE org_id = current_setting('app.org_id', true)));

ALTER TABLE raci_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raci_roles;
CREATE POLICY tenant_isolation ON raci_roles FOR ALL
  USING (proyecto_id IN (SELECT id FROM proyectos WHERE org_id = current_setting('app.org_id', true)))
  WITH CHECK (proyecto_id IN (SELECT id FROM proyectos WHERE org_id = current_setting('app.org_id', true)));

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 2/5] RLS + política (JOIN proyecto_id->org_id) activa en raci_tareas y raci_roles.'; END $$;

-- ── raci_asignaciones — aislamiento vía JOIN de 2 saltos (tarea_id -> raci_tareas.proyecto_id -> proyectos.org_id) ──
ALTER TABLE raci_asignaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON raci_asignaciones;
CREATE POLICY tenant_isolation ON raci_asignaciones FOR ALL
  USING (tarea_id IN (
    SELECT rt.id FROM raci_tareas rt JOIN proyectos p ON p.id = rt.proyecto_id
    WHERE p.org_id = current_setting('app.org_id', true)
  ))
  WITH CHECK (tarea_id IN (
    SELECT rt.id FROM raci_tareas rt JOIN proyectos p ON p.id = rt.proyecto_id
    WHERE p.org_id = current_setting('app.org_id', true)
  ));

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 3/5] RLS + política (JOIN de 2 saltos) activa en raci_asignaciones.'; END $$;

-- ── gemini_key_state / trial_sessions — sin columna de tenant, RLS sin política (deny-all salvo bypass/owner) ──
ALTER TABLE gemini_key_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_sessions   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 4/5] RLS activado sin política en gemini_key_state y trial_sessions (no tienen columna de tenant -- deny-all correcto, sin impacto: único acceso real hoy es vía service_role/bypass).'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing TEXT := '';
  v_tabla   TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['raci_tareas','raci_roles','raci_asignaciones','gemini_key_state','trial_sessions']
  LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE relname = v_tabla) THEN
      v_missing := v_missing || v_tabla || ' ';
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION '[CHECKPOINT 5/5] FALLO: RLS no quedó activo en: %', v_missing;
  END IF;

  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'raci_tareas', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'raci_roles', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'raci_asignaciones', 'SELECT')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 5/5] FALLO: rf360_rls_scoped sin GRANT completo sobre las 3 tablas RACI.';
  END IF;

  RAISE NOTICE '[CHECKPOINT 5/5] OK — RLS activo en las 5 tablas, políticas de tenant en las 3 RACI, GRANT de rf360_rls_scoped verificado.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Reporte final ─────────────────────────────────────────────────────────
SELECT
  c.relname AS tabla,
  c.relrowsecurity AS rls_activo,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = c.relname) AS num_politicas,
  has_table_privilege('rf360_rls_scoped', c.relname, 'SELECT') AS rf360_puede_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relname IN ('raci_tareas','raci_roles','raci_asignaciones','gemini_key_state','trial_sessions')
ORDER BY c.relname;
