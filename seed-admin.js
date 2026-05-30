/**
 * seed-admin.js
 * Crea o actualiza el usuario administrador con contraseña segura.
 * Usa PBKDF2-SHA256 — idéntico a server.js hashPassword para que el login funcione.
 *
 * Uso:  node seed-admin.js
 */
import crypto from 'crypto';
import { loadEnv } from './env-loader.js';
import { getRow, runSql } from './db.js';

loadEnv();

// ── Credenciales del administrador ────────────────────────────────────────────
const ADMIN = {
  email:    'admin@radar360.com',
  password: 'AdminSeguro2026!',
  nombre:   'Administrador Radar Fondos',
  role:     'admin',
};

// Usuario inseguro previo que hay que retirar / actualizar
const OLD_EMAIL = 'admin@test.com';

function hashPassword(password) {
  const salt   = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.pbkdf2Sync(password, salt, 100_000, 32, 'sha256').toString('hex');
  return `${salt}:${hashed}`;
}

async function seed() {
  // 1. Desactivar cuenta insegura antigua si existe
  const old = await getRow('SELECT id FROM usuarios WHERE email = ?', [OLD_EMAIL]);
  if (old) {
    await runSql(
      'UPDATE usuarios SET is_active = 0, deleted_at = ? WHERE email = ?',
      [new Date().toISOString(), OLD_EMAIL]
    );
    console.log(`⚠️   Cuenta insegura desactivada: ${OLD_EMAIL}`);
  }

  // 2. Verificar si el nuevo admin ya existe
  const existing = await getRow('SELECT id FROM usuarios WHERE email = ?', [ADMIN.email]);
  if (existing) {
    // Actualizar contraseña y reactivar
    const password_hash = hashPassword(ADMIN.password);
    await runSql(
      'UPDATE usuarios SET password_hash = ?, is_active = 1, deleted_at = NULL WHERE email = ?',
      [password_hash, ADMIN.email]
    );
    console.log(`🔄  Contraseña actualizada para: ${ADMIN.email}`);
  } else {
    // Crear nuevo admin
    const id            = crypto.randomUUID();
    const password_hash = hashPassword(ADMIN.password);
    const now           = new Date().toISOString();
    await runSql(
      `INSERT INTO usuarios (id, email, password_hash, nombre, tipoUsuario, createdAt, is_approved, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
      [id, ADMIN.email, password_hash, ADMIN.nombre, ADMIN.role, now]
    );
    console.log(`✅  Nuevo administrador creado (id: ${id})`);
  }

  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('  CREDENCIALES DE ACCESO (guarda esto)');
  console.log('════════════════════════════════════════════');
  console.log(`  Email    : ${ADMIN.email}`);
  console.log(`  Password : ${ADMIN.password}`);
  console.log(`  Rol      : ${ADMIN.role}`);
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log('👉  http://localhost:3000/login');
}

seed().catch(err => {
  console.error('[seed-admin] ERROR:', err.message);
  process.exit(1);
});
