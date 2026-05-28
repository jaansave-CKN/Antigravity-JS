import crypto from 'crypto';
import { runSql } from './db.js';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hashed}`;
}

(async () => {
  try {
    const hash = hashPassword('Radar2026!');
    await runSql("UPDATE usuarios SET password_hash = $1 WHERE email = 'admin@sistema.com'", [hash]);
    console.log("Password updated successfully.");
  } catch (e) {
    console.error(e);
  }
})();