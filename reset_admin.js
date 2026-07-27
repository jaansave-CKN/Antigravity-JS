import crypto from 'crypto';
import { runSql } from './backend/config/database.config.js';

// Debe coincidir exactamente con hashPassword() de server.js (pbkdf2 sha512, 64 bytes)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hashed}`;
}

(async () => {
  try {
    const hash = hashPassword('Cantagallo2026!');
    await runSql("UPDATE usuarios SET password_hash = ? WHERE email = 'test@radar360.co'", [hash]);
    console.log("Password updated successfully.");
  } catch (e) {
    console.error(e);
  }
})();