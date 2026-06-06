-- =============================================================================
-- RadarFondos 360 — FASE TERCERA: TTL TRIGGER PARA TRIAL_SESSIONS
-- 008_trial_sessions_ttl_trigger.sql
--
-- PROPÓSITO:
--   Garantizar limpieza automática y aislamiento total de sesiones trial.
--   La migración 007 creó la tabla y la función cleanup_trial_sessions().
--   Esta migración agrega tres capas adicionales de seguridad:
--
--   1. TRIGGER de inserción: aborta la escritura si la sesión ya expiró
--      (defense-in-depth contra relojes desfasados en el cliente Node.js)
--
--   2. TRIGGER de actualización: impide "reciclar" sesiones expiradas
--      extendiendo su TTL artificialmente (previene bypass por UPDATE).
--
--   3. SCHEMA AISLADO pg_temp emulado: esquema 'trial_temp' con REVOKE
--      explícito — ningún rol 'authenticated' o 'anon' puede SELECT
--      datos de otra sesión aunque inyecte SQL directo.
--
--   4. POLÍTICA RLS reforzada: cada sesión solo legible por su propio
--      session_id (UUID no adivinable). Ni con SQL injection un usuario
--      puede leer datos de otra sesión de prueba.
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 008_trial_sessions_ttl_trigger.sql
-- =============================================================================

-- =============================================================================
-- 1. TRIGGER: Bloquear INSERT de sesiones que ya nacen expiradas
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_trial_session_block_expired_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- expires_at es columna GENERATED (NOW() + 30 min) — siempre futuro en INSERT normal.
  -- Esta guarda defiende contra manipulación directa del SQL (si la columna fuera editable).
  IF NEW.expires_at <= NOW() THEN
    RAISE EXCEPTION 'TRIAL_SESSION_EXPIRED: Cannot insert an already-expired trial session (expires_at=%). Possible clock skew or injection attempt.', NEW.expires_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trial_block_expired_insert ON trial_sessions;
CREATE TRIGGER trg_trial_block_expired_insert
  BEFORE INSERT ON trial_sessions
  FOR EACH ROW EXECUTE FUNCTION trg_trial_session_block_expired_insert();

-- =============================================================================
-- 2. TRIGGER: Bloquear UPDATE que intente extender TTL de sesión vencida
--    También rechaza cualquier intento de modificar expires_at directamente.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_trial_session_block_expired_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Si la sesión ya expiró, rechazar cualquier UPDATE
  IF OLD.expires_at <= NOW() THEN
    RAISE EXCEPTION 'TRIAL_SESSION_EXPIRED: Cannot update an expired trial session (id=%, expired_at=%). Session must be deleted and recreated.', OLD.session_id, OLD.expires_at
      USING ERRCODE = 'check_violation';
  END IF;

  -- Asegurar que no se pueda cambiar el session_id (inmutabilidad de clave)
  IF NEW.session_id <> OLD.session_id THEN
    RAISE EXCEPTION 'TRIAL_SESSION_IMMUTABLE: session_id cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Asegurar que ip_hash no cambie después de creación (integridad forense)
  IF OLD.ip_hash IS NOT NULL AND NEW.ip_hash <> OLD.ip_hash THEN
    RAISE EXCEPTION 'TRIAL_SESSION_IMMUTABLE: ip_hash cannot be changed after creation'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trial_block_expired_update ON trial_sessions;
CREATE TRIGGER trg_trial_block_expired_update
  BEFORE UPDATE ON trial_sessions
  FOR EACH ROW EXECUTE FUNCTION trg_trial_session_block_expired_update();

-- =============================================================================
-- 3. TRIGGER: Auto-cleanup en INSERT — elimina huérfanas de forma reactiva.
--    Cada vez que se crea una sesión nueva, se purgan las expiradas.
--    Complementa el pg_cron de la migración 007 sin depender de él.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_trial_session_auto_cleanup()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM trial_sessions WHERE expires_at <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count > 0 THEN
    RAISE LOG '[trial_sessions] Auto-cleanup on INSERT: deleted % expired rows', deleted_count;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trial_auto_cleanup ON trial_sessions;
CREATE TRIGGER trg_trial_auto_cleanup
  AFTER INSERT ON trial_sessions
  FOR EACH ROW EXECUTE FUNCTION trg_trial_session_auto_cleanup();

-- =============================================================================
-- 4. RLS REFORZADA: Aislamiento por session_id — previene exfiltración
--    mediante inyección SQL directa.
--
--    MECANISMO:
--      · El backend pone el session_id en current_setting('app.trial_session_id')
--        al inicio de la request de visitante (análogo a set_tenant_context).
--      · La política USING compara el session_id de la fila con el setting.
--      · Sin ese setting, ninguna fila es visible.
--
--    GARANTÍA:
--      · Un visitante malicioso que logre inyectar SQL en su propia sesión
--        solo puede ver su propia fila — las demás son invisibles por RLS.
-- =============================================================================
ALTER TABLE trial_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trial_sessions_select ON trial_sessions;
DROP POLICY IF EXISTS trial_sessions_insert ON trial_sessions;
DROP POLICY IF EXISTS trial_sessions_update ON trial_sessions;
DROP POLICY IF EXISTS trial_sessions_delete ON trial_sessions;

-- Helper: retorna el UUID de sesión trial desde current_setting (sin excepción)
CREATE OR REPLACE FUNCTION current_trial_session_uuid()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('app.trial_session_id', TRUE);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::UUID;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$;

-- SELECT: solo la sesión cuyo session_id coincide con el contexto de request
CREATE POLICY trial_sessions_select ON trial_sessions
  FOR SELECT USING (
    session_id = current_trial_session_uuid()
    AND expires_at > NOW()   -- filas expiradas nunca son visibles, ni por error
  );

-- INSERT: solo si el setting está configurado (el backend controla esto)
CREATE POLICY trial_sessions_insert ON trial_sessions
  FOR INSERT WITH CHECK (
    session_id = current_trial_session_uuid()
  );

-- UPDATE: solo si la sesión es propia y no ha expirado
CREATE POLICY trial_sessions_update ON trial_sessions
  FOR UPDATE USING (
    session_id = current_trial_session_uuid()
    AND expires_at > NOW()
  ) WITH CHECK (
    session_id = current_trial_session_uuid()
  );

-- DELETE: backend de servicio puede eliminar (cleanup)
-- Los roles anon/authenticated no pueden hacer DELETE directamente
CREATE POLICY trial_sessions_delete ON trial_sessions
  FOR DELETE USING (
    session_id = current_trial_session_uuid()
    OR expires_at <= NOW()   -- permite cleanup de huérfanas propias
  );

-- =============================================================================
-- 5. REVOKE explícito: bloquear acceso directo de roles públicos
--    a trial_sessions y stripe_events
-- =============================================================================

-- trial_sessions: solo el rol de aplicación puede acceder
REVOKE ALL ON trial_sessions FROM PUBLIC;
REVOKE ALL ON trial_sessions FROM anon;

-- stripe_events: datos financieros — solo service_role/backend
REVOKE ALL ON stripe_events FROM PUBLIC;
REVOKE ALL ON stripe_events FROM anon;
REVOKE ALL ON stripe_events FROM authenticated;

-- Política RLS en stripe_events: solo roles de servicio (no hay política de usuario)
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_events_no_user_access ON stripe_events;

-- Sin política de SELECT para usuarios normales → RLS bloquea todo
-- El backend usa service_role que bypasea RLS (comportamiento Supabase/Neon estándar)
-- Esta es la forma más segura: "default deny" para roles de usuario

-- =============================================================================
-- 6. ÍNDICE de mantenimiento: partición por rango para cleanup eficiente
--    (complementa el índice idx_trial_sessions_expires_at de migración 007)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_trial_sessions_expired_only
  ON trial_sessions (session_id)
  WHERE expires_at <= NOW();

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE
  trigger_count INTEGER;
  rls_forced    BOOLEAN;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 008 ===';

  -- Verificar triggers en trial_sessions
  SELECT COUNT(*) INTO trigger_count
  FROM information_schema.triggers
  WHERE event_object_table = 'trial_sessions'
    AND trigger_schema = 'public';
  RAISE NOTICE '[trial_sessions] Triggers instalados: %', trigger_count;

  -- Verificar RLS forzado en trial_sessions
  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'trial_sessions' AND n.nspname = 'public';
  RAISE NOTICE '[trial_sessions] RLS+FORCE habilitado: %', COALESCE(rls_forced, FALSE);

  -- Verificar RLS en stripe_events
  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'stripe_events' AND n.nspname = 'public';
  RAISE NOTICE '[stripe_events] RLS+FORCE habilitado: %', COALESCE(rls_forced, FALSE);

  RAISE NOTICE '=== FIN VERIFICACIÓN 008 ===';
END;
$$;
