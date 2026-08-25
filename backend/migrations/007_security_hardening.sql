-- =============================================================================
-- RadarFondos 360 — FASE SEGUNDA: SECURITY HARDENING
-- 007_security_hardening.sql
--
-- TABLAS Y COLUMNAS:
--   1. trial_sessions        — Modo Visitante en PostgreSQL (elimina RAM volátil)
--   2. stripe_events         — Idempotencia de webhooks de Stripe
--   3. tokens_invalidated_at — Revocación bulk de sesiones (Stripe cancellation)
--   4. audit_columns         — Columnas de trazabilidad para el circuit breaker M9
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 007_security_hardening.sql
-- =============================================================================

-- =============================================================================
-- 1. TABLA: trial_sessions
--    Reemplaza Map() en memoria — elimina riesgo OOM/DoS con pliegos pesados.
--
--    GARANTÍAS:
--      · Tamaño máximo por sesión: 2 MB (CHECK en data JSONB)
--      · TTL: 30 minutos desde created_at (expires_at automático)
--      · Limpieza automática: función cleanup_trial_sessions() + pg_cron
--      · RLS: cada sesión solo visible por su session_id (no es multi-tenant real,
--        pero las claves de sesión son UUID no adivinables)
-- =============================================================================
CREATE TABLE IF NOT EXISTS trial_sessions (
  session_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  data         JSONB       NOT NULL    DEFAULT '{}',
  size_bytes   INTEGER     GENERATED ALWAYS AS (octet_length(data::TEXT)) STORED,
  created_at   TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  -- FIX (2026-08-24, verificado en vivo — este archivo nunca se había
  -- ejecutado con éxito): la suma timestamptz + interval en Postgres está
  -- marcada STABLE, no IMMUTABLE (depende del timezone de sesión) — ninguna
  -- variante de esta expresión sirve dentro de GENERATED ALWAYS ... STORED,
  -- ni siquiera referenciando una columna ya almacenada (se probó en vivo:
  -- "generation expression is not immutable" persiste). DEFAULT sí acepta
  -- expresiones STABLE/VOLATILE — cambiado de GENERATED a DEFAULT, mismo
  -- efecto práctico (se fija una sola vez, al insertar).
  expires_at   TIMESTAMPTZ NOT NULL    DEFAULT (NOW() + INTERVAL '30 minutes'),
  ip_hash      TEXT,                  -- SHA-256 de IP del visitante (para rate limiting)
  user_agent   TEXT
);

-- Índice para limpieza eficiente por expiración
CREATE INDEX IF NOT EXISTS idx_trial_sessions_expires_at
  ON trial_sessions (expires_at);

-- Índice para lookups por ip_hash (detectar abusos)
CREATE INDEX IF NOT EXISTS idx_trial_sessions_ip_hash
  ON trial_sessions (ip_hash)
  WHERE ip_hash IS NOT NULL;

-- Restricción de tamaño: máximo 2 MB por sesión trial
-- (2 097 152 bytes = 2 * 1024 * 1024)
ALTER TABLE trial_sessions
  ADD CONSTRAINT chk_trial_data_size
  CHECK (octet_length(data::TEXT) <= 2097152);

-- ── Función de limpieza automática ────────────────────────────────────────────
-- Elimina sesiones expiradas. Ejecutar via pg_cron cada 5 minutos.
CREATE OR REPLACE FUNCTION cleanup_trial_sessions()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM trial_sessions WHERE expires_at <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ── Activar pg_cron para limpieza automática cada 5 minutos ──────────────────
-- Requiere la extensión pg_cron (disponible en Neon, Supabase, Railway Pro).
-- Si pg_cron no está disponible, el servidor Node.js llama a cleanup manualmente.
DO $$
BEGIN
  -- Solo instalar si pg_cron está disponible
  IF EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- Evitar duplicado si ya existe el job. FIX (2026-08-24, verificado en
    -- vivo): cron.unschedule() de pg_cron lanza error real ("could not find
    -- valid entry for job") si el job NO existe todavía — pasaba siempre en
    -- la primera corrida de este archivo, nunca se había probado en vivo.
    BEGIN
      PERFORM cron.unschedule('cleanup-trial-sessions');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- primera corrida: el job todavía no existe, se ignora
    END;
    PERFORM cron.schedule(
      'cleanup-trial-sessions',
      '*/5 * * * *',
      'SELECT cleanup_trial_sessions()'
    );
    RAISE NOTICE '[pg_cron] Job cleanup-trial-sessions instalado (cada 5 min).';
  ELSE
    RAISE NOTICE '[pg_cron] No disponible — limpieza manual via Node.js.';
  END IF;
END;
$$;

-- =============================================================================
-- 2. TABLA: stripe_events
--    Control de idempotencia para webhooks de Stripe.
--    Previene procesamiento duplicado en reintentos por cold start o timeout.
--
--    GARANTÍAS:
--      · stripe_event_id es PRIMARY KEY → UNIQUE por diseño de BD
--      · ON CONFLICT DO NOTHING en todos los INSERTs del webhook handler
--      · raw_payload JSONB para auditoría y replay manual
-- =============================================================================
CREATE TABLE IF NOT EXISTS stripe_events (
  stripe_event_id  TEXT        PRIMARY KEY,
  event_type       TEXT        NOT NULL,
  tenant_id        TEXT,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload      JSONB
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_tenant_id
  ON stripe_events (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_events_event_type
  ON stripe_events (event_type);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
  ON stripe_events (processed_at DESC);

-- Retención de 90 días (eventos viejos no son necesarios para idempotencia)
-- Ejecutar mensualmente o via pg_cron:
--   DELETE FROM stripe_events WHERE processed_at < NOW() - INTERVAL '90 days';

-- =============================================================================
-- 3. COLUMNA: tokens_invalidated_at en tabla usuarios
--    Permite revocación bulk instantánea de TODAS las sesiones de un usuario.
--    Usada por: cancelación de Stripe, kick de admin, cambio de contraseña.
--
--    MECANISMO:
--      Al cancelar: UPDATE usuarios SET tokens_invalidated_at = NOW()
--      En auth:     si token.iat < tokens_invalidated_at → RECHAZADO (401)
-- =============================================================================
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS tokens_invalidated_at TIMESTAMPTZ DEFAULT NULL;

-- Aplica también a tabla canonical 'users' (migración 003) — FIX (2026-08-24,
-- verificado en vivo): la tabla 'users' NO existe en esta BD real (solo
-- existen 'usuarios'/'proyectos', las legacy en español — migración 003
-- describe un plan que nunca se aplicó tal cual). Envuelto en DO/IF EXISTS
-- para que esta línea no rompa el resto del archivo si 'users' sigue sin
-- existir, y se active sola si algún día sí se crea.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_invalidated_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END;
$$;

-- Índice: solo usuarios con revocación activa (parcial, bajo overhead)
CREATE INDEX IF NOT EXISTS idx_usuarios_tokens_invalidated
  ON usuarios (id, tokens_invalidated_at)
  WHERE tokens_invalidated_at IS NOT NULL;

-- =============================================================================
-- 4. COLUMNAS DE TRAZABILIDAD: circuit breaker M9 en tabla projects
--    Permite saber cuántos ciclos de corrección M6↔M9 se ejecutaron,
--    cuándo se bloqueó, y cuál fue el score final de auditoría.
-- =============================================================================

-- Tabla 'projects' (canónica inglesa — migración 003) — FIX (2026-08-24,
-- verificado en vivo): igual que 'users' arriba, 'projects' NO existe en
-- esta BD real (solo 'proyectos'). Todo este bloque envuelto en IF EXISTS
-- para no romper el resto del archivo; se activa solo si algún día se crea.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='projects') THEN
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS audit_score       NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS audit_cycles      SMALLINT    DEFAULT 0,
      ADD COLUMN IF NOT EXISTS audit_result      JSONB,
      ADD COLUMN IF NOT EXISTS audit_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS audit_blocked_at  TIMESTAMPTZ;

    BEGIN
      ALTER TABLE projects
        ADD CONSTRAINT chk_projects_status_extended
        CHECK (status IN ('Borrador','En_Validacion','Finalizado','BLOQUEADO',
                          'in_review','formulado','needs_human_review',
                          'processing','draft'));
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- Ya existe, no falla
    END;
  END IF;
END;
$$;

-- Tabla 'proyectos' (legacy español — sigue activa en Bloque B)
ALTER TABLE proyectos
  ADD COLUMN IF NOT EXISTS audit_score       NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS audit_cycles      SMALLINT    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audit_result      JSONB,
  ADD COLUMN IF NOT EXISTS audit_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_blocked_at  TIMESTAMPTZ;

-- =============================================================================
-- 5. TABLA: revoked_tokens — Fix de sintaxis PostgreSQL
--    La versión original usaba CREATE TABLE con TIMESTAMP (sin TZ).
--    Garantiza que el esquema sea idempotente y correcto.
-- =============================================================================
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash   TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL,
  revoked_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user_id
  ON revoked_tokens (user_id);

-- FIX (2026-08-24, verificado en vivo): "functions in index predicate must
-- be marked IMMUTABLE" — NOW() tampoco es válido en el predicado de un
-- índice parcial. Índice simple (sin filtro parcial) en vez de partial index.
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
  ON revoked_tokens (expires_at);

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 007 ===';

  -- trial_sessions
  SELECT COUNT(*) INTO r FROM information_schema.tables
  WHERE table_name = 'trial_sessions' AND table_schema = 'public';
  RAISE NOTICE '[trial_sessions] existe: %', (r.count > 0);

  -- stripe_events
  SELECT COUNT(*) INTO r FROM information_schema.tables
  WHERE table_name = 'stripe_events' AND table_schema = 'public';
  RAISE NOTICE '[stripe_events] existe: %', (r.count > 0);

  -- tokens_invalidated_at en usuarios
  SELECT COUNT(*) INTO r FROM information_schema.columns
  WHERE table_name = 'usuarios' AND column_name = 'tokens_invalidated_at';
  RAISE NOTICE '[usuarios.tokens_invalidated_at] existe: %', (r.count > 0);

  -- audit columns en projects
  SELECT COUNT(*) INTO r FROM information_schema.columns
  WHERE table_name = 'projects' AND column_name = 'audit_score';
  RAISE NOTICE '[projects.audit_score] existe: %', (r.count > 0);

  RAISE NOTICE '=== FIN VERIFICACIÓN ===';
END;
$$;
