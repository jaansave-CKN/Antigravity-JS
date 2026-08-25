-- 045_byok_gemini_por_usuario.sql
--
-- Modelo BYOK (Bring Your Own Key) obligatorio para las 7 acciones
-- interactivas de IA (Entrada, Co-Piloto, árbol de objetivos, viabilidad
-- ×2, enfoque de entidad ×2) — el usuario real (jaansave@hotmail.com)
-- queda exento (sigue usando la llave compartida del servidor); cualquier
-- otro usuario debe configurar su propia llave de Gemini antes de usarlas.
--
-- Tabla NUEVA y separada de user_credentials a propósito — verificado que
-- user_credentials tiene un bug real (UNIQUE(user_id) de una sola columna
-- pero código que asume UNIQUE(user_id, service)) y mezcla sin discriminar
-- el par api_key_enc/notebook_key_enc con las credenciales de OAuth de
-- Google. No se toca ni se corrige en esta migración (0 filas hoy, nunca
-- se disparó) — queda documentado como deuda aparte.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS byok_exento BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE usuarios SET byok_exento = TRUE WHERE email = 'jaansave@hotmail.com';

-- id/user_id como TEXT — convención real de este esquema (usuarios.id es
-- TEXT PRIMARY KEY, no UUID nativo de Postgres, ver server.js).
CREATE TABLE IF NOT EXISTS user_gemini_keys (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  key_slot           INTEGER NOT NULL CHECK (key_slot IN (1, 2, 3)),
  encrypted_key      TEXT NOT NULL,
  label              TEXT NOT NULL DEFAULT '',
  is_valid           BOOLEAN,
  last_validated_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key_slot)
);
CREATE INDEX IF NOT EXISTS idx_user_gemini_keys_user_id ON user_gemini_keys(user_id);

ALTER TABLE user_gemini_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_gemini_keys
  FOR ALL USING (user_id = current_setting('app.org_id', true))
  WITH CHECK (user_id = current_setting('app.org_id', true));

-- Auditoría del pre-flight (guardado/validación de llave) — pedida
-- explícitamente por el usuario para trazabilidad de cambios de credencial.
CREATE TABLE IF NOT EXISTS tenant_audit_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  ip          TEXT,
  accion      TEXT NOT NULL,
  resultado   TEXT NOT NULL,
  detalle     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_logs_user_id ON tenant_audit_logs(user_id);

ALTER TABLE tenant_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_audit_logs
  FOR ALL USING (user_id = current_setting('app.org_id', true))
  WITH CHECK (user_id = current_setting('app.org_id', true));
