-- =============================================================================
-- RadarFondos 360 — Migración SaaS Multi-Tenant v2
-- 002_multitenant_saas.sql
-- Estandariza tenant_id (UUID NOT NULL) en TODAS las tablas del schema principal
-- Migra org_id → tenant_id y refuerza RLS con current_tenant_id()
-- Requiere: 001_postgres_schema.sql ejecutado previamente
-- =============================================================================

-- ── Función RLS unificada ─────────────────────────────────────────────────────
-- Reemplaza set_rls_context de 001. Compatible backward: acepta ambos nombres.
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id, TRUE);
  PERFORM set_config('app.org_id',    p_tenant_id, TRUE);  -- compat. legacy
END;
$$;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_raw TEXT;
BEGIN
  v_raw := current_setting('app.tenant_id', TRUE);
  IF v_raw IS NULL OR v_raw = '' THEN
    v_raw := current_setting('app.org_id', TRUE);
  END IF;
  RETURN v_raw::UUID;
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- =============================================================================
-- TABLA: usuarios
-- =============================================================================
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE usuarios SET tenant_id = org_id WHERE tenant_id IS NULL;

ALTER TABLE usuarios
  ALTER COLUMN tenant_id SET NOT NULL;

DROP POLICY IF EXISTS usuarios_rls ON usuarios;
CREATE POLICY usuarios_tenant_isolation ON usuarios
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_usuarios_tenant_id ON usuarios (tenant_id);

-- =============================================================================
-- TABLA: proyectos
-- =============================================================================
ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE proyectos SET tenant_id = org_id::UUID WHERE tenant_id IS NULL;

ALTER TABLE proyectos
  ALTER COLUMN tenant_id SET NOT NULL;

DROP POLICY IF EXISTS proyectos_rls ON proyectos;
CREATE POLICY proyectos_tenant_isolation ON proyectos
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_proyectos_tenant_id ON proyectos (tenant_id);

-- =============================================================================
-- TABLA: project_budgets  (Módulo 4 — APU)
-- =============================================================================
ALTER TABLE project_budgets
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE project_budgets SET tenant_id = org_id WHERE tenant_id IS NULL;

ALTER TABLE project_budgets
  ALTER COLUMN tenant_id SET NOT NULL;

DROP POLICY IF EXISTS budgets_rls ON project_budgets;
CREATE POLICY budgets_tenant_isolation ON project_budgets
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_budgets_tenant_id ON project_budgets (tenant_id);

-- =============================================================================
-- TABLA: convocatorias
-- Las públicas (tenant_id IS NULL) son visibles a todos los tenants.
-- =============================================================================
ALTER TABLE convocatorias
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

DROP POLICY IF EXISTS convocatorias_rls ON convocatorias;
CREATE POLICY convocatorias_tenant_isolation ON convocatorias
  AS PERMISSIVE FOR ALL
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_convocatorias_tenant_id ON convocatorias (tenant_id);

-- =============================================================================
-- TABLA: match_scores
-- =============================================================================
ALTER TABLE match_scores
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE match_scores SET tenant_id = org_id::UUID WHERE tenant_id IS NULL AND org_id IS NOT NULL;

ALTER TABLE match_scores
  ALTER COLUMN tenant_id SET NOT NULL;

DROP POLICY IF EXISTS match_scores_rls ON match_scores;
CREATE POLICY match_scores_tenant_isolation ON match_scores
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_match_tenant_id ON match_scores (tenant_id);

-- =============================================================================
-- TABLA: user_favorites
-- =============================================================================
ALTER TABLE user_favorites
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

UPDATE user_favorites uf
  SET tenant_id = u.tenant_id
  FROM usuarios u
  WHERE uf.user_id = u.id AND uf.tenant_id IS NULL;

ALTER TABLE user_favorites
  ALTER COLUMN tenant_id SET NOT NULL;

DROP POLICY IF EXISTS favorites_rls ON user_favorites;
CREATE POLICY favorites_tenant_isolation ON user_favorites
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_favorites_tenant_id ON user_favorites (tenant_id);

-- =============================================================================
-- TABLA: objetivos_arbol
-- =============================================================================
ALTER TABLE objetivos_arbol
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

DROP POLICY IF EXISTS arbol_rls ON objetivos_arbol;
CREATE POLICY arbol_tenant_isolation ON objetivos_arbol
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_arbol_tenant_id ON objetivos_arbol (tenant_id);

-- =============================================================================
-- TABLA: motor_dialectico
-- =============================================================================
ALTER TABLE motor_dialectico
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_motor_dialectico_tenant ON motor_dialectico (tenant_id);

ALTER TABLE motor_dialectico ENABLE ROW LEVEL SECURITY;
CREATE POLICY motor_dialectico_tenant_isolation ON motor_dialectico
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- =============================================================================
-- TABLA: config_logistica
-- =============================================================================
ALTER TABLE config_logistica
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

ALTER TABLE config_logistica ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_logistica_tenant_isolation ON config_logistica
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_config_logistica_tenant ON config_logistica (tenant_id);

-- =============================================================================
-- TABLA: marco_normativo
-- =============================================================================
ALTER TABLE marco_normativo
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

ALTER TABLE marco_normativo ENABLE ROW LEVEL SECURITY;
CREATE POLICY marco_normativo_tenant_isolation ON marco_normativo
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_marco_normativo_tenant ON marco_normativo (tenant_id);

-- =============================================================================
-- TABLA: compliance_data
-- =============================================================================
ALTER TABLE compliance_data
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

ALTER TABLE compliance_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY compliance_data_tenant_isolation ON compliance_data
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_compliance_data_tenant ON compliance_data (tenant_id);

-- =============================================================================
-- TABLA: versiones_proyecto
-- =============================================================================
ALTER TABLE versiones_proyecto
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

ALTER TABLE versiones_proyecto ENABLE ROW LEVEL SECURITY;
CREATE POLICY versiones_proyecto_tenant_isolation ON versiones_proyecto
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_versiones_proyecto_tenant ON versiones_proyecto (tenant_id);

-- =============================================================================
-- TABLA: user_subscriptions
-- Aquí tenant_id = user's org_id (una suscripción por organización)
-- =============================================================================
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS stripe_customer_id   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS current_period_end   TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_subscriptions_tenant_isolation ON user_subscriptions
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tenant ON user_subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe
  ON user_subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- =============================================================================
-- TABLA: organizations (normalizada con tenant metadata)
-- =============================================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS tenant_id        UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_expires_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seats_limit      INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS domain           TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_tenant_id
  ON organizations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_organizations_stripe
  ON organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- =============================================================================
-- VISTA: tenant_summary  (dashboard de administración)
-- =============================================================================
CREATE OR REPLACE VIEW tenant_summary AS
SELECT
  o.tenant_id,
  o.name               AS org_name,
  o.plan,
  o.plan_expires_at,
  o.seats_limit,
  o.stripe_customer_id,
  COUNT(DISTINCT u.id) AS total_usuarios,
  COUNT(DISTINCT p.id) AS total_proyectos,
  o.created_at
FROM organizations o
LEFT JOIN usuarios u       ON u.tenant_id = o.tenant_id
LEFT JOIN proyectos p      ON p.tenant_id = o.tenant_id
GROUP BY o.tenant_id, o.name, o.plan, o.plan_expires_at,
         o.seats_limit, o.stripe_customer_id, o.created_at;

-- =============================================================================
-- NOTA OPERACIONAL:
-- En cada request de la API, antes de cualquier query:
--   await pgPool.query("SELECT set_tenant_context($1)", [user.tenantId]);
-- El tenantId debe provenir del JWT (Supabase/Clerk) verificado.
-- Con RLS activo, PostgreSQL rechaza automáticamente cualquier acceso
-- a datos de otro tenant — NO se requiere WHERE tenant_id = ? en cada query.
-- =============================================================================
