-- =============================================================================
-- RadarFondos 360 — AUDITORÍA FINAL DE SEGURIDAD RLS
-- 010_rls_complete_audit.sql
--
-- PROPÓSITO:
--   Cerrar toda brecha de exfiltración de datos multi-tenant.
--   Garantizar que NINGUNA tabla del schema público sea accesible
--   sin el contexto de tenant/usuario válido.
--
--   TABLAS CUBIERTAS:
--     · Todas las tablas de dominio (projects, proyectos, users, usuarios...)
--     · Tablas sensibles: stripe_events, trial_sessions (ya en 008, rereforzado aquí)
--     · Tablas del Formulador: objective_tree, project_budgets, logistic_config, etc.
--     · Tabla nueva: project_version_hashes (creada en 009)
--
--   PATRÓN ESTÁNDAR DE POLÍTICA:
--     USING (tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid())
--
--   REGLAS DE ORO:
--     · Si una tabla tiene org_id en lugar de tenant_id → política sobre org_id::UUID
--     · stripe_events y trial_sessions: REVOKE a todos los roles de usuario
--     · Admin bypasea RLS via BYPASSRLS (rol de BD) o service_role key (Supabase)
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 010_rls_complete_audit.sql
-- =============================================================================

-- Asegurar que las funciones helper de las migraciones anteriores existen
-- (idempotente — no falla si ya existen)
CREATE OR REPLACE FUNCTION current_tenant_uuid()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('app.tenant_id', TRUE);
  IF v IS NULL OR v = '' THEN
    v := current_setting('app.org_id', TRUE);
  END IF;
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::UUID;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION current_auth_uid()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN auth.uid();
EXCEPTION WHEN undefined_function THEN
  RETURN NULL;
END;
$$;

-- =============================================================================
-- MACRO: Crear política estándar de tenant isolation en una tabla
-- (No es una función — es un bloque DO que se llama para cada tabla)
-- =============================================================================

-- =============================================================================
-- 1. TABLA: users (canónica inglesa — migración 003)
-- =============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_rls   ON users;
DROP POLICY IF EXISTS users_self_access  ON users;

-- Un usuario solo puede ver su propio perfil O usuarios de su mismo tenant
CREATE POLICY users_tenant_rls ON users
  FOR ALL USING (
    id::UUID = current_auth_uid()
    OR tenant_id = current_tenant_uuid()
    OR id::UUID = current_tenant_uuid()
  );

-- =============================================================================
-- 2. TABLA: usuarios (legacy español)
-- =============================================================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_tenant_isolation ON usuarios;
DROP POLICY IF EXISTS usuarios_rls              ON usuarios;

CREATE POLICY usuarios_tenant_rls ON usuarios
  FOR ALL USING (
    COALESCE(tenant_id, org_id::UUID) = current_tenant_uuid()
    OR id::TEXT = current_setting('app.tenant_id', TRUE)
    OR id::UUID = current_auth_uid()
  );

-- =============================================================================
-- 3. TABLA: projects (canónica inglesa)
-- =============================================================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_tenant_rls ON projects;

CREATE POLICY projects_tenant_rls ON projects
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- 4. TABLA: proyectos (legacy español)
-- =============================================================================
ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proyectos_tenant_rls ON proyectos;

CREATE POLICY proyectos_tenant_rls ON proyectos
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR org_id::UUID = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- 5. TABLA: grants (convocatorias)
-- grants son datos públicos del ecosistema — acceso permitido a cualquier
-- usuario autenticado (no filtramos por tenant, pero bloqueamos anon).
-- =============================================================================
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grants_authenticated_read ON grants;

-- Cualquier usuario autenticado puede leer convocatorias (son datos públicos scrapeados)
CREATE POLICY grants_authenticated_read ON grants
  FOR SELECT USING (
    current_auth_uid() IS NOT NULL
    OR current_tenant_uuid() IS NOT NULL
  );

-- Solo admin puede INSERT/UPDATE/DELETE (no política de usuario → default deny)

-- =============================================================================
-- 6. TABLA: objective_tree (árbol de objetivos del Formulador)
-- =============================================================================
ALTER TABLE objective_tree ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_tree FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS objective_tree_tenant_rls ON objective_tree;

CREATE POLICY objective_tree_tenant_rls ON objective_tree
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- 7. TABLA: project_versions / project_version_hashes
-- =============================================================================
-- project_version_hashes ya tiene RLS de migración 009 — solo reforzar
ALTER TABLE project_version_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_version_hashes FORCE ROW LEVEL SECURITY;
-- Políticas ya definidas en 009 — DROP+CREATE para garantizar idempotencia
DROP POLICY IF EXISTS pvh_select ON project_version_hashes;
DROP POLICY IF EXISTS pvh_insert ON project_version_hashes;

CREATE POLICY pvh_select ON project_version_hashes
  FOR SELECT USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

CREATE POLICY pvh_insert ON project_version_hashes
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- 8. TABLA: logistic_config (config_logistica)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'logistic_config' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE logistic_config ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE logistic_config FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS logistic_config_tenant_rls ON logistic_config';
    EXECUTE 'CREATE POLICY logistic_config_tenant_rls ON logistic_config
      FOR ALL USING (
        tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid()
      )';
    RAISE NOTICE '[RLS] logistic_config: política aplicada';
  ELSE
    RAISE NOTICE '[RLS] logistic_config: tabla no existe aún, saltando';
  END IF;
END $$;

-- =============================================================================
-- 9. TABLA: dialectic_engine (motor_dialectico)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dialectic_engine' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE dialectic_engine ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE dialectic_engine FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS dialectic_engine_tenant_rls ON dialectic_engine';
    EXECUTE 'CREATE POLICY dialectic_engine_tenant_rls ON dialectic_engine
      FOR ALL USING (
        tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid()
      )';
    RAISE NOTICE '[RLS] dialectic_engine: política aplicada';
  ELSE
    RAISE NOTICE '[RLS] dialectic_engine: tabla no existe aún, saltando';
  END IF;
END $$;

-- =============================================================================
-- 10. TABLA: regulatory_framework (marco_normativo)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'regulatory_framework' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE regulatory_framework ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE regulatory_framework FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS regulatory_framework_tenant_rls ON regulatory_framework';
    EXECUTE 'CREATE POLICY regulatory_framework_tenant_rls ON regulatory_framework
      FOR ALL USING (
        tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid()
      )';
    RAISE NOTICE '[RLS] regulatory_framework: política aplicada';
  ELSE
    RAISE NOTICE '[RLS] regulatory_framework: tabla no existe aún, saltando';
  END IF;
END $$;

-- =============================================================================
-- 11. TABLA: project_budgets (presupuesto APU)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_budgets' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE project_budgets FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS project_budgets_tenant_rls ON project_budgets';
    EXECUTE 'CREATE POLICY project_budgets_tenant_rls ON project_budgets
      FOR ALL USING (
        tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid()
      )';
    RAISE NOTICE '[RLS] project_budgets: política aplicada';
  ELSE
    RAISE NOTICE '[RLS] project_budgets: tabla no existe aún, saltando';
  END IF;
END $$;

-- =============================================================================
-- 12. TABLA: land_parcels (predios)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'land_parcels' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE land_parcels ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE land_parcels FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS land_parcels_tenant_rls ON land_parcels';
    EXECUTE 'CREATE POLICY land_parcels_tenant_rls ON land_parcels
      FOR ALL USING (
        tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid()
      )';
    RAISE NOTICE '[RLS] land_parcels: política aplicada';
  ELSE
    RAISE NOTICE '[RLS] land_parcels: tabla no existe aún, saltando';
  END IF;
END $$;

-- =============================================================================
-- 13. TABLA: agent_registry (agentes_registro)
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_registry' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE agent_registry FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS agent_registry_tenant_rls ON agent_registry';
    EXECUTE 'CREATE POLICY agent_registry_tenant_rls ON agent_registry
      FOR ALL USING (
        tenant_id = current_tenant_uuid() OR tenant_id = current_auth_uid()
      )';
    RAISE NOTICE '[RLS] agent_registry: política aplicada';
  ELSE
    RAISE NOTICE '[RLS] agent_registry: tabla no existe aún, saltando';
  END IF;
END $$;

-- =============================================================================
-- 14. BLOQUEO EXPLÍCITO: stripe_events — solo service_role
--     NINGÚN usuario autenticado puede leer eventos de Stripe.
-- =============================================================================
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;

-- Revocar acceso directo de cualquier rol de usuario
REVOKE ALL ON stripe_events FROM PUBLIC;
REVOKE ALL ON stripe_events FROM anon;
REVOKE ALL ON stripe_events FROM authenticated;

-- Sin política de SELECT para authenticated → RLS bloquea todo por defecto (default deny)
-- El backend usa service_role/superuser que bypasea RLS

RAISE NOTICE '[RLS] stripe_events: REVOKE ALL para anon y authenticated — solo service_role';

-- =============================================================================
-- 15. BLOQUEO EXPLÍCITO: trial_sessions — aislamiento total por session_id
--     (políticas ya instaladas en migración 008, reforzamos REVOKEs)
-- =============================================================================
REVOKE ALL ON trial_sessions FROM PUBLIC;
REVOKE ALL ON trial_sessions FROM anon;
-- authenticated necesita poder hacer INSERT (para crear sesión trial)
-- pero RLS limita el SELECT/UPDATE/DELETE a su propio session_id

RAISE NOTICE '[RLS] trial_sessions: REVOKE para anon — authenticated limitado por RLS (session_id)';

-- =============================================================================
-- 16. TABLA: revoked_tokens — solo el sistema puede leer
-- =============================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'revoked_tokens' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE revoked_tokens ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE revoked_tokens FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS revoked_tokens_service_only ON revoked_tokens';
    -- Sin política de usuario → solo service_role puede operar
    RAISE NOTICE '[RLS] revoked_tokens: default deny para roles de usuario';
  END IF;
END $$;

-- =============================================================================
-- AUDITORÍA FINAL: Reporte de estado RLS de TODAS las tablas del schema public
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  tables_without_rls INTEGER := 0;
BEGIN
  RAISE NOTICE '=== AUDITORÍA RLS COMPLETA — 010_rls_complete_audit ===';
  RAISE NOTICE '%-40s | %-5s | %-5s | %s', 'TABLA', 'RLS', 'FORCE', 'POLÍTICAS';
  RAISE NOTICE '%s', REPEAT('-', 80);

  FOR r IN
    SELECT
      t.tablename,
      c.relrowsecurity   AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.tablename AND p.schemaname = 'public') AS policy_count
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE t.schemaname = 'public'
      AND t.tablename NOT LIKE 'pg_%'
    ORDER BY t.tablename
  LOOP
    RAISE NOTICE '%-40s | %-5s | %-5s | %s políticas',
      r.tablename,
      CASE WHEN r.rls_enabled  THEN '✓ ON' ELSE '✗ OFF' END,
      CASE WHEN r.rls_forced   THEN '✓ ON' ELSE '✗ OFF' END,
      r.policy_count;

    IF NOT r.rls_enabled THEN
      tables_without_rls := tables_without_rls + 1;
      RAISE WARNING '[SECURITY] Tabla sin RLS: %. Evaluar si necesita aislamiento de tenant.', r.tablename;
    END IF;
  END LOOP;

  RAISE NOTICE '%s', REPEAT('-', 80);
  IF tables_without_rls = 0 THEN
    RAISE NOTICE '✅ SISTEMA CERRADO: TODAS las tablas tienen RLS habilitado.';
  ELSE
    RAISE WARNING '⚠ % tabla(s) sin RLS detectadas. Revisar antes de producción.', tables_without_rls;
  END IF;

  RAISE NOTICE '=== FIN AUDITORÍA RLS ===';
END;
$$;
