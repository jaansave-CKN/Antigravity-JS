-- 025_usuarios_email_verified.sql
-- Double Opt-In: no se agregan columnas de token — el token de verificación
-- es un JWT firmado (purpose: 'email_verification', 24h), mismo patrón ya
-- real y en uso para password_reset (server.js /api/auth/forgot-password).
-- Autoexpira solo, sin necesidad de limpiar tokens vencidos en BD.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
