-- =============================================================================
-- RadarFondos 360 — FASE 2: RLS SAAS HARDENING
-- 005_rls_saas_hardening.sql
-- Aislamiento legal multi-tenant: cada empresa solo ve sus propios datos.
--
-- TABLAS PROTEGIDAS:
--   · user_subscriptions  — datos de plan y acceso por usuario/tenant
--   · user_favorites      — favoritos individuales (alias: favoritos)
--   · proyectos_formulados — proyectos del Bloque B (Formulador)
--
-- ESTRATEGIA DE POLÍTICA DUAL:
--   · Supabase Auth: auth.uid() retorna el UUID del usuario autenticado
--   · JWT local / set_rls_context: current_setting('app.org_id', TRUE)
--   Ambas rutas son aceptadas — la que no aplica retorna NULL (no falla).
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 005_rls_saas_hardening.sql
-- =============================================================================

-- ── Helper: UUID seguro desde current_setting ─────────────────────────────────
-- Retorna NULL si el setting no está definido (no lanza excepción).
CREATE OR REPLACE FUNCTION current_tenant_uuid()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('app.org_id', TRUE);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::UUID;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- ── Helper: UUID del usuario autenticado (Supabase) ───────────────────────────
-- Retorna auth.uid() si está disponible; NULL si se usa JWT local.
CREATE OR REPLACE FUNCTION current_auth_uid()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN auth.uid();
EXCEPTION WHEN undefined_function THEN
  RETURN NULL;
END;
$$;

-- =============================================================================
-- TABLA: user_subscriptions
-- Política: un tenant solo lee/modifica su propia suscripción.
-- user_id vincula al usuario; tenant_id vincula a la organización.
-- =============================================================================

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions FORCE ROW LEVEL SECURITY;

-- Eliminar políticas anteriores si existen (idempotente)
DROP POLICY IF EXISTS subs_select  ON user_subscriptions;
DROP POLICY IF EXISTS subs_insert  ON user_subscriptions;
DROP POLICY IF EXISTS subs_update  ON user_subscriptions;
DROP POLICY IF EXISTS subs_delete  ON user_subscriptions;

-- SELECT: el usuario ve solo su suscripción
CREATE POLICY subs_select ON user_subscriptions
  FOR SELECT USING (
    user_id = current_auth_uid()
    OR user_id = current_tenant_uuid()
    OR tenant_id = current_tenant_uuid()
  );

-- INSERT: solo puede insertar para sí mismo
CREATE POLICY subs_insert ON user_subscriptions
  FOR INSERT WITH CHECK (
    user_id = current_auth_uid()
    OR user_id = current_tenant_uuid()
  );

-- UPDATE: solo puede actualizar su propia fila
CREATE POLICY subs_update ON user_subscriptions
  FOR UPDATE USING (
    user_id = current_auth_uid()
    OR user_id = current_tenant_uuid()
    OR tenant_id = current_tenant_uuid()
  ) WITH CHECK (
    user_id = current_auth_uid()
    OR user_id = current_tenant_uuid()
  );

-- DELETE: solo puede eliminar su propia suscripción
CREATE POLICY subs_delete ON user_subscriptions
  FOR DELETE USING (
    user_id = current_auth_uid()
    OR user_id = current_tenant_uuid()
  );

-- =============================================================================
-- TABLA: user_favorites  (alias 'favoritos' en especificación V8.0)
-- Política: favoritos son estrictamente personales (user_id).
-- =============================================================================

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS favs_select ON user_favorites;
DROP POLICY IF EXISTS favs_insert ON user_favorites;
DROP POLICY IF EXISTS favs_update ON user_favorites;
DROP POLICY IF EXISTS favs_delete ON user_favorites;

CREATE POLICY favs_select ON user_favorites
  FOR SELECT USING (
    user_id::TEXT = current_setting('app.org_id', TRUE)
    OR user_id::UUID = current_auth_uid()
  );

CREATE POLICY favs_insert ON user_favorites
  FOR INSERT WITH CHECK (
    user_id::TEXT = current_setting('app.org_id', TRUE)
    OR user_id::UUID = current_auth_uid()
  );

CREATE POLICY favs_update ON user_favorites
  FOR UPDATE USING (
    user_id::TEXT = current_setting('app.org_id', TRUE)
    OR user_id::UUID = current_auth_uid()
  ) WITH CHECK (
    user_id::TEXT = current_setting('app.org_id', TRUE)
    OR user_id::UUID = current_auth_uid()
  );

CREATE POLICY favs_delete ON user_favorites
  FOR DELETE USING (
    user_id::TEXT = current_setting('app.org_id', TRUE)
    OR user_id::UUID = current_auth_uid()
  );

-- =============================================================================
-- TABLA: proyectos_formulados  (Bloque B — Formulador)
-- Política: aislamiento organizacional por tenant_id / org_id.
-- Cada empresa ve ÚNICAMENTE sus proyectos formulados.
-- =============================================================================

-- Crear tabla si no existe (con estructura canónica esperada)
CREATE TABLE IF NOT EXISTS proyectos_formulados (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL,
  tenant_id       UUID        NOT NULL,
  nombre          TEXT        NOT NULL DEFAULT 'Sin nombre',
  estado          TEXT        NOT NULL DEFAULT 'borrador',
  payload_es      JSONB       NOT NULL DEFAULT '{}',
  payload_en      JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE proyectos_formulados ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos_formulados FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pf_select ON proyectos_formulados;
DROP POLICY IF EXISTS pf_insert ON proyectos_formulados;
DROP POLICY IF EXISTS pf_update ON proyectos_formulados;
DROP POLICY IF EXISTS pf_delete ON proyectos_formulados;

CREATE POLICY pf_select ON proyectos_formulados
  FOR SELECT USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

CREATE POLICY pf_insert ON proyectos_formulados
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

CREATE POLICY pf_update ON proyectos_formulados
  FOR UPDATE USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  ) WITH CHECK (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

CREATE POLICY pf_delete ON proyectos_formulados
  FOR DELETE USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_pf_updated_at ON proyectos_formulados;
CREATE TRIGGER trg_pf_updated_at
  BEFORE UPDATE ON proyectos_formulados
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- EXCEPCIÓN PARA ROL DE SERVICIO (bypass de RLS para el backend)
-- El rol de servicio de Supabase / Railway omite RLS por defecto.
-- Si se usa un rol de aplicación específico, añadir aquí:
--   ALTER TABLE user_subscriptions  FORCE ROW LEVEL SECURITY;
--   GRANT ALL ON user_subscriptions TO authenticator;
-- =============================================================================

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, rowsecurity, forcerowsecurity
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE t.tablename IN ('user_subscriptions', 'user_favorites', 'proyectos_formulados')
      AND t.schemaname = 'public'
  LOOP
    RAISE NOTICE '[RLS CHECK] %: RLS=% FORCE=%', r.tablename, r.rowsecurity, r.forcerowsecurity;
  END LOOP;
END;
$$;
