-- 028_account_lockout.sql
-- Blindaje: bloqueo por CUENTA tras intentos fallidos de login, no solo por
-- IP. authLimiter (5/15min) ya protege por IP, pero un atacante distribuido
-- (muchas IPs) podia forzar bruta una sola cuenta sin activar ese limite.
-- 5 intentos fallidos -> bloqueo de 15 minutos, contador se reinicia solo
-- (locked_until vence) o al iniciar sesion correctamente.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ NULL;
