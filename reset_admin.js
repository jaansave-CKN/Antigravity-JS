import crypto from 'crypto';
import { runSql } from './backend/config/database.config.js';

// FIX (PROTOCOLO 5x5, 2026-08-24): este script tenía una contraseña real en
// texto plano hardcodeada (commit 2be96e7, 2026-07-27), sincronizada a
// propósito con hashPassword() de server.js — cualquiera con el repo
// clonado tenía una credencial funcional contra la cuenta real
// test@radar360.co (confirmada activa/aprobada en producción). Ahora exige
// email + password como argumentos explícitos, sin valor por defecto — ver
// docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md para el hallazgo completo.
// Pendiente manual (no lo hace este fix): rotar la password real de
// test@radar360.co en la BD de producción — no se hizo aquí porque cambia
// el acceso de una cuenta real y es una decisión del usuario, no del código.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hashed}`;
}

const [, , email, password] = process.argv;
if (!email || !password) {
  console.error('Uso: node reset_admin.js <email> <password-nueva>');
  process.exit(1);
}

(async () => {
  try {
    const hash = hashPassword(password);
    const result = await runSql('UPDATE usuarios SET password_hash = ? WHERE email = ?', [hash, email]);
    console.log(`Password actualizada para ${email}.`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();