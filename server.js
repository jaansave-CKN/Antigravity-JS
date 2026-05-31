import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadEnv } from './env-loader.js';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authLimiter, sanitizeAuthBody, COOKIE_OPTIONS } from './SecurityMiddleware.js';
import { seedDirectorio } from './DataIngestor.js';
import { startScheduler, runManualIngest } from './CronScheduler.js';
import { parseFileBuffer, importToDirectorio, importToConvocatorias } from './FileImporter.js';
import { encryptKey, decryptKey, maskKey } from './CryptoHelper.js';
import {
  registerGoogleAuthRoutes,
  getGoogleAccessToken,
  GEMINI_SYSTEM_INSTRUCTIONS,
} from './authGoogle.controller.js';

const require = createRequire(import.meta.url);

loadEnv();

import { getRow, getRows, getCount, runSql } from './db.js';
import { seedPredios } from './seed-predios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Recovery Log ─────────────────────────────────────────────────────────────
const LOGS_DIR = path.join(__dirname, 'logs');
const STATE_FILE = path.join(LOGS_DIR, 'server_state.json');
const RECOVERY_LOG = path.join(LOGS_DIR, 'recovery.log');

function ensureLogsDir() {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { }
}

function writeServerState(status, extra = {}) {
  ensureLogsDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status, updatedAt: new Date().toISOString(), ...extra }));
  } catch { }
}

function checkRecovery() {
  ensureLogsDir();
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (state?.status === 'running') {
      const msg = `[${new Date().toISOString()}] RECOVERY: Sistema recuperado de corte inesperado. Último heartbeat: ${state.updatedAt}\n`;
      fs.appendFileSync(RECOVERY_LOG, msg);
    }
  } catch { /* primera ejecución sin archivo previo */ }
}

checkRecovery();
writeServerState('running', { pid: process.pid });
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Set it in Render dashboard or .env.');
  process.exit(1);
}
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRATION_HOURS = 24;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hashed = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hashed}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hashed] = stored.split(':');
    const check = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hashed));
  } catch { return false; }
}

function generateToken(userId, email, role) {
  return jwt.sign({ sub: userId, email, role }, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: `${JWT_EXPIRATION_HOURS}h` });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }); }
  catch { return null; }
}

function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Token invalido o expirado' });
  }
  req.userId = payload.sub;
  req.userEmail = payload.email;
  req.userRole = payload.role;
  next();
}

async function initDb() {
  await runSql(`CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, nombre TEXT NOT NULL, tipoUsuario TEXT NOT NULL DEFAULT 'user', plan TEXT DEFAULT 'free', createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_approved INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1, deleted_at TIMESTAMP DEFAULT NULL)`);
  await runSql(`CREATE TABLE IF NOT EXISTS tokens_revocados (id TEXT PRIMARY KEY, token TEXT NOT NULL, usuario_id TEXT NOT NULL, revocado_en TIMESTAMP NOT NULL, deleted_at TIMESTAMP DEFAULT NULL)`);
  await runSql(`CREATE TABLE IF NOT EXISTS convocatorias (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, sector TEXT DEFAULT '', tipo_financiamiento TEXT DEFAULT '', formato_formulacion TEXT DEFAULT '', monto REAL DEFAULT 0, url TEXT DEFAULT '', fecha_cierre TEXT DEFAULT '', entidad_id TEXT DEFAULT '', score REAL DEFAULT 50, estado TEXT DEFAULT 'pendiente', es_favorito INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP DEFAULT NULL)`);
  await runSql(`CREATE TABLE IF NOT EXISTS directorio_entidades (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, sigla TEXT DEFAULT '', tipo TEXT DEFAULT 'PRIVADO', pais TEXT DEFAULT 'Colombia', sitio_web TEXT DEFAULT '', url_convocatorias TEXT DEFAULT '', telefono TEXT DEFAULT '', email TEXT DEFAULT '', alcance TEXT DEFAULT 'Nacional', validation_status TEXT DEFAULT 'VALIDACION_PENDIENTE', fuente TEXT DEFAULT 'manual', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMP DEFAULT NULL)`);
  await runSql(`CREATE TABLE IF NOT EXISTS user_credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, service TEXT NOT NULL, encrypted_key TEXT NOT NULL, label TEXT DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, service))`);
  await runSql(`CREATE TABLE IF NOT EXISTS user_favorites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, grant_id TEXT NOT NULL, grant_data TEXT NOT NULL, saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES usuarios(id), UNIQUE(user_id, grant_id))`);
  console.log('DB initialized');
}

async function getUser(userId) {
  return await getRow('SELECT id, email, nombre, tipoUsuario as role, plan, createdAt as created_at, is_active, is_approved, deleted_at FROM usuarios WHERE id = $1', [userId]);
}

async function start() {
  await initDb();
  await seedPredios();
  await seedDirectorio();

  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.set('etag', false);

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
  app.use('/api/', limiter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'SIA Radar', timestamp: new Date().toISOString() });
  });

  // ... (Tus rutas de auth, directorios, etc. se mantienen igual hasta llegar a favoritos)

  app.get('/api/favorites', authenticateToken, async (req, res) => {
    try {
      const rows = await getRows(
        'SELECT id, grant_id, grant_data, saved_at FROM user_favorites WHERE user_id = ? ORDER BY saved_at DESC',
        [req.userId]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Servir estáticos del build de React
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { etag: false, index: false }));
    // SPA Fallback: redirigir todo lo que no sea /api a index.html
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ── ESCUCHA CRÍTICA PARA RAILWAY ───────────────────────────────────────────
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor activo en puerto ${PORT}`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
