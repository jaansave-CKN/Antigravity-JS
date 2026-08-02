-- 030_mfa_totp.sql
-- Blindaje: MFA real (TOTP, compatible con Google Authenticator/Authy/etc.)
-- Se activa por cuenta (mfa_enabled) -- no se fuerza retroactivamente sobre
-- cuentas admin ya existentes sin setup previo (bloquearlas de un dia para
-- otro sin ruta de recuperacion las dejaria fuera de su propia cuenta, sin
-- codigos de respaldo todavia). Queda "obligatorio" en el sentido real: una
-- vez activado, el login exige el codigo si o si, sin excepcion ni bypass.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secret TEXT NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
