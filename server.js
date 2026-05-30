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
const LOGS_DIR      = path.join(__dirname, 'logs');
const STATE_FILE    = path.join(LOGS_DIR, 'server_state.json');
const RECOVERY_LOG  = path.join(LOGS_DIR, 'recovery.log');
const ERROR_REPORTS = path.join(LOGS_DIR, 'error-reports.txt');

function ensureLogsDir() {
  try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch {}
}

function writeServerState(status, extra = {}) {
  ensureLogsDir();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status, updatedAt: new Date().toISOString(), ...extra }));
  } catch {}
}

function checkRecovery() {
  ensureLogsDir();
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (state?.status === 'running') {
      const msg = `[${new Date().toISOString()}] RECOVERY: Sistema recuperado de corte inesperado. Último heartbeat: ${state.updatedAt}\n`;
      fs.appendFileSync(RECOVERY_LOG, msg);
      console.log(`\x1b[33m[RECOVERY] ⚡ Sistema recuperado de corte inesperado. Último estado conocido: ${state.updatedAt}. Estado consolidado.\x1b[0m`);
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

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Token invalido o expirado' });
  }
  // Attach user info to request for use in route handlers
  req.userId = payload.sub;
  req.userEmail = payload.email;
  req.userRole = payload.role;
  next();
}

async function initDb() {
  try {
    await runSql(`CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, nombre TEXT NOT NULL,
      tipoUsuario TEXT NOT NULL DEFAULT 'user',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_approved INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1,
      deleted_at TIMESTAMP DEFAULT NULL
    )`);
    await runSql(`CREATE TABLE IF NOT EXISTS tokens_revocados (
      id TEXT PRIMARY KEY, token TEXT NOT NULL,
      usuario_id TEXT NOT NULL, revocado_en TIMESTAMP NOT NULL,
      deleted_at TIMESTAMP DEFAULT NULL
    )`);
    await runSql(`CREATE TABLE IF NOT EXISTS convocatorias (
       id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL,
       sector TEXT DEFAULT '', tipo_financiamiento TEXT DEFAULT '',
       formato_formulacion TEXT DEFAULT '', monto REAL DEFAULT 0,
       url TEXT DEFAULT '', fecha_cierre TEXT DEFAULT '',
       entidad_id TEXT DEFAULT '', score REAL DEFAULT 50,
       estado TEXT DEFAULT 'pendiente', es_favorito INTEGER DEFAULT 0,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       deleted_at TIMESTAMP DEFAULT NULL
     )`);
    await runSql(`CREATE TABLE IF NOT EXISTS entidades (
        id TEXT PRIMARY KEY, nombre TEXT, sigla TEXT, tipo TEXT,
        pais TEXT, bandera TEXT, sectores TEXT, sitio_web TEXT,
        url_convocatorias TEXT, contacto TEXT, email_contacto TEXT,
        convocatorias_activas INTEGER DEFAULT 0,
        monto_total REAL DEFAULT 0, moneda TEXT DEFAULT 'USD',
        frecuencia TEXT DEFAULT 'variable', ultima_convocatoria TEXT,
        notas TEXT, creado_en TIMESTAMP, actualizado_en TIMESTAMP,
        last_scraped TIMESTAMP, scrape_status TEXT DEFAULT 'pendiente',
        scrape_result TEXT,
        deleted_at TIMESTAMP DEFAULT NULL
      )`);
    await runSql(`CREATE TABLE IF NOT EXISTS entidades_indexadas (
        id TEXT PRIMARY KEY, org_id TEXT, titulo TEXT, donante TEXT,
        descripcion TEXT, url_convocatoria TEXT, url_fuente TEXT,
        fecha_publicacion TIMESTAMP, fecha_cierre TIMESTAMP,
        is_global INTEGER DEFAULT 0, target_country TEXT, local_region TEXT,
        funding_type TEXT, sectores TEXT, poblacion_objetivo TEXT,
        monto_min REAL, monto_max REAL, moneda TEXT DEFAULT 'USD',
        requisitos TEXT, tags TEXT, score_compatibilidad INTEGER DEFAULT 50,
        estado TEXT DEFAULT 'activa', origen TEXT, proyecto_id TEXT,
        fecha_indexacion TIMESTAMP,
        deleted_at TIMESTAMP DEFAULT NULL
      )`);
    await runSql(`CREATE TABLE IF NOT EXISTS predios (
        id TEXT PRIMARY KEY, lat REAL, lng REAL, direccion TEXT,
        area_m2 REAL, valor_catastral REAL, propietario TEXT, matricula TEXT,
        deleted_at TIMESTAMP DEFAULT NULL
      )`);
    await runSql(`CREATE TABLE IF NOT EXISTS organizaciones (
        id TEXT PRIMARY KEY, nombre TEXT, pais TEXT,
        email_admin TEXT, api_key_google TEXT,
        notebook_google TEXT, limite_prospectos INTEGER DEFAULT 300,
        activa INTEGER DEFAULT 1, plan TEXT DEFAULT 'basico',
        created_at TIMESTAMP, updated_at TIMESTAMP,
        deleted_at TIMESTAMP DEFAULT NULL
      )`);
    await runSql(`CREATE TABLE IF NOT EXISTS subvenciones (
         id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL,
         entidad TEXT, descripcion TEXT,
         fecha_limite TEXT, cuantia TEXT, requisitos TEXT,
         url TEXT, sector TEXT, pais TEXT,
         estado TEXT DEFAULT 'activa', source TEXT DEFAULT 'crawler',
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         deleted_at TIMESTAMP DEFAULT NULL
       )`);
    // Tabla de directorio de entidades (datos reales, reemplaza mock)
    await runSql(`CREATE TABLE IF NOT EXISTS directorio_entidades (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      sigla TEXT DEFAULT '',
      tipo TEXT DEFAULT 'PRIVADO',
      pais TEXT DEFAULT 'Colombia',
      sitio_web TEXT DEFAULT '',
      url_convocatorias TEXT DEFAULT '',
      telefono TEXT DEFAULT '',
      email TEXT DEFAULT '',
      alcance TEXT DEFAULT 'Nacional',
      validation_status TEXT DEFAULT 'VALIDACION_PENDIENTE',
      fuente TEXT DEFAULT 'manual',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP DEFAULT NULL
    )`);
    // Migraciones: columnas OAuth2 en usuarios (idempotentes)
    try { await runSql(`ALTER TABLE usuarios ADD COLUMN google_oauth_token TEXT DEFAULT NULL`); } catch {}
    try { await runSql(`ALTER TABLE usuarios ADD COLUMN google_refresh_token TEXT DEFAULT NULL`); } catch {}
    try { await runSql(`ALTER TABLE usuarios ADD COLUMN google_token_expires_at TEXT DEFAULT NULL`); } catch {}

    // Migraciones: agregar columnas nuevas a convocatorias si no existen
    try { await runSql(`ALTER TABLE convocatorias ADD COLUMN source TEXT DEFAULT 'manual'`); } catch {}
    try { await runSql(`ALTER TABLE convocatorias ADD COLUMN validation_status TEXT DEFAULT 'VALIDACION_PENDIENTE'`); } catch {}
    try { await runSql(`ALTER TABLE convocatorias ADD COLUMN source_url TEXT DEFAULT ''`); } catch {}
    try { await runSql(`ALTER TABLE convocatorias ADD COLUMN last_verified TIMESTAMP`); } catch {}

    await runSql(`CREATE TABLE IF NOT EXISTS crawl_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         tipo TEXT, fuente TEXT,
         subvenciones_encontradas INTEGER DEFAULT 0,
         resultado TEXT, ejecutada_en TIMESTAMP,
         deleted_at TIMESTAMP DEFAULT NULL
       )`);
    await runSql(`CREATE TABLE IF NOT EXISTS proyectos (
        id TEXT PRIMARY KEY, nombre TEXT NOT NULL,
        descripcion TEXT, usuario_id TEXT,
        created_at TIMESTAMP, updated_at TIMESTAMP,
        estado TEXT DEFAULT 'activo',
        metadata TEXT,
        deleted_at TIMESTAMP DEFAULT NULL
      )`);
    // Credenciales de usuario cifradas con AES-256-GCM
    await runSql(`CREATE TABLE IF NOT EXISTS user_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      label TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, service)
    )`);
    // Favoritos por usuario — persistencia dura de convocatorias guardadas
    await runSql(`CREATE TABLE IF NOT EXISTS user_favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      grant_id TEXT NOT NULL,
      grant_data TEXT NOT NULL,
      saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES usuarios(id),
      UNIQUE(user_id, grant_id)
    )`);
    console.log('DB initialized');
  } catch (error) {
    console.error('DB init error:', error);
    throw error;
  }
}

async function getUser(userId) {
  return await getRow('SELECT id, email, nombre, tipoUsuario as role, created_at, is_active, is_approved, deleted_at FROM usuarios WHERE id = $1', [userId]);
}

async function start() {
  await initDb();
  await seedPredios();
  await seedDirectorio();

  const app = express();

  // DIRECTIVA OMEGA V6.1: BLINDAJE DE SEGURIDAD Y RENDIMIENTO
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  // Deshabilitar ETag global → res.send() no agregará Cache-Control automático
  app.set('etag', false);

  // DIRECTIVA OMEGA V6.1: RATE LIMITING
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
  app.use('/api/', limiter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'SIA Radar', timestamp: new Date().toISOString() });
  });

  app.post('/api/auth/register', authLimiter, sanitizeAuthBody, async (req, res) => {
    try {
      const email = req.body.email || req.body.correo;
      const password = req.body.password || req.body.contrasena;
      const nombre = req.body.nombre || req.body.nombreCompleto || "Usuario Base";
      const role = req.body.role || 'user';
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Faltan credenciales obligatorias (Email/Password)." });
      }
      const existente = await getRow('SELECT id FROM usuarios WHERE email = $1', [email]);
      if (existente) {
        return res.status(400).json({ success: false, message: "El correo ya esta registrado." });
      }

      const passwordHash = hashPassword(password);
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();
      await runSql('INSERT INTO usuarios (id, email, password_hash, nombre, tipoUsuario, createdAt, is_approved, is_active) VALUES ($1,$2,$3,$4,$5,$6,1,1)', [userId, email, passwordHash, nombre, role, now]);
      const token = generateToken(userId, email, role);
      return res.status(201).json({ success: true, message: "Registro exitoso", user: { id: userId, email, nombre, role, createdAt: now, is_active: true }, token });
    } catch (error) {
      console.error("CRITICO - Fallo en el Hotfix:", error);
      return res.status(500).json({ success: false, message: "Error interno del servidor", error: error.message });
    }
  });

  app.post('/api/auth/login', authLimiter, sanitizeAuthBody, async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email y password son requeridos' });
      }
      const row = await getRow('SELECT * FROM usuarios WHERE email = $1', [email]);
      if (!row || !verifyPassword(password, row.password_hash)) {
        return res.status(401).json({ success: false, message: 'Credenciales invalidas' });
      }
      if (!row.is_active) {
        return res.status(403).json({ success: false, message: 'Usuario deshabilitado' });
      }
      const now = new Date().toISOString();
      await runSql('UPDATE usuarios SET last_login = $1 WHERE id = $2', [now, row.id]);
      const token = generateToken(row.id, row.email, row.tipoUsuario || 'user');
      res.cookie('auth_session', token, COOKIE_OPTIONS);
      res.json({ success: true, user: { id: row.id, email: row.email, nombre: row.nombre, role: row.tipoUsuario || 'user', createdAt: row.createdAt || now, is_active: true }, token });
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ success: false, message: error.message || 'Error interno del servidor' });
    }
  });

  app.get('/api/auth/verify', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Token requerido' });
      }
      const payload = verifyToken(auth.slice(7));
      if (!payload) {
        return res.status(401).json({ success: false, message: 'Token invalido o expirado' });
      }
      const user = await getUser(payload.sub);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.json({ valid: true, user });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      await runSql('INSERT INTO tokens_revocados (id, token, usuario_id, revocado_en) VALUES ($1, $2, $3, $4)', [crypto.randomUUID(), auth.slice(7), payload.sub, new Date().toISOString()]);
      res.json({ success: true, message: 'Sesion cerrada exitosamente' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  // ── Validación de sesión administrativa para operaciones sensibles (SIE toggles) ─
  app.post('/api/auth/validate-action', authLimiter, sanitizeAuthBody, authenticateToken, async (req, res) => {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          code: 'INSUFFICIENT_PRIVILEGES',
          message: 'ACCESO DENEGADO: Se requiere nivel de autorización ADMINISTRADOR.',
        });
      }
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ success: false, message: 'Clave de autenticación requerida.' });
      }
      const row = await getRow(
        'SELECT password_hash FROM usuarios WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL',
        [req.userId]
      );
      if (!row || !verifyPassword(password, row.password_hash)) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: 'CREDENCIALES INVÁLIDAS · SESIÓN ADMINISTRATIVA NO AUTORIZADA.',
        });
      }
      // Token de acción de corta duración (10 min, scope restringido)
      const actionToken = jwt.sign(
        { sub: req.userId, email: req.userEmail, role: req.userRole, scope: 'sie-toggle' },
        JWT_SECRET,
        { algorithm: JWT_ALGORITHM, expiresIn: '10m' }
      );
      return res.json({
        success: true,
        actionToken,
        expiresIn: 600,
        message: 'SESIÓN ADMINISTRATIVA VALIDADA · ACCESO SIE HABILITADO POR 10 MINUTOS.',
      });
    } catch (error) {
      console.error('[validate-action] Error:', error);
      return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
  });

  // Recuperación de contraseña — simulado en dev, listo para Brevo/Nodemailer en prod
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const email = (req.body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ success: false, message: 'Email requerido' });

      // En producción: generar token seguro, guardar en DB y enviar email real
      // Por ahora: respuesta 200 inmediata sin efectos secundarios
      const userExists = await getRow('SELECT id FROM usuarios WHERE email = ?', [email]);
      if (process.env.NODE_ENV !== 'production' || userExists) {
        // TODO producción: await sendResetEmail(email, token)
        return res.json({ success: true, message: 'Si el correo existe, recibirás el enlace en breve.' });
      }
      // Siempre 200 para no revelar qué emails existen
      return res.json({ success: true, message: 'Si el correo existe, recibirás el enlace en breve.' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const user = await getUser(payload.sub);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.json({ success: true, user });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

   // Servir estáticos del build de React
   const distPath = path.join(__dirname, 'dist');
   if (fs.existsSync(distPath)) {
     // Assets con hash (JS/CSS): cacheable 1 año — sus nombres cambian con cada build
     app.use('/assets', express.static(path.join(distPath, 'assets'), {
       maxAge: '1y',
       immutable: true,
       etag: false,
       index: false,
     }));
     // Resto de estáticos (vite.svg, etc.) sin caché automático
     app.use(express.static(distPath, { etag: false, index: false }));
   }

  // ── ENDPOINTS DE NEGOCIO (mock de alta fidelidad) ──────────────
  app.get('/api/opportunities', async (req, res) => {
    try {
      const mockOpportunities = [
        { id: '1', direccion: 'Saneamiento Básico Rural - Cantagallo', lat: 7.376, lng: -73.794, area_m2: 1200, valor_catastral: 1200000000, propietario: 'MinVivienda', matricula: 'CAT-001', evaluacion: { score_legal: 85, alertas: [], recomendaciones: ['Alta compatibilidad'] } },
        { id: '2', direccion: 'Optimización de Acueducto Rural - San Pablo', lat: 7.478, lng: -73.812, area_m2: 850, valor_catastral: 850000000, propietario: 'Gobernación', matricula: 'CAT-002', evaluacion: { score_legal: 72, alertas: [], recomendaciones: ['Media compatibilidad'] } },
        { id: '3', direccion: 'Infraestructura Comunitaria - Sur de Bolívar', lat: 8.012, lng: -73.923, area_m2: 2100, valor_catastral: 2100000000, propietario: 'Fondo de Inversión', matricula: 'CAT-003', evaluacion: { score_legal: 92, alertas: [], recomendaciones: ['Excelente oportunidad'] } }
      ];
      const rows = await getRows('SELECT * FROM predios WHERE deleted_at IS NULL');
      res.json(rows.length > 0 ? rows : mockOpportunities);
    } catch (error) {
      console.error('Error en /api/opportunities:', error);
      res.json([{ id: '1', direccion: 'Saneamiento Básico Rural - Cantagallo', lat: 7.376, lng: -73.794, area_m2: 1200, valor_catastral: 1200000000, propietario: 'MinVivienda', matricula: 'CAT-001', evaluacion: { score_legal: 85, alertas: [], recomendaciones: ['Alta compatibilidad'] } }]);
    }
  });

   app.get('/api/estadisticas', authenticateToken, async (req, res) => {
     try {
       // Get total convocatorias count
       const convocatoriasCount = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE deleted_at IS NULL');
       
       // Get total fondos (sum of monto from convocatorias)
       const fondosResult = await getRow('SELECT SUM(monto) as total FROM convocatorias WHERE deleted_at IS NULL');
       const totalFondos = fondosResult?.total || 0;
       
       // Get activos proyectos count
       const proyectosActivos = await getCount('SELECT COUNT(*) as cnt FROM proyectos WHERE estado = \"activo\" AND deleted_at IS NULL');
       
       // Get alertas de impacto (simplified - could be from a separate table or calculated)
       const alertasImpacto = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE score > 80 AND deleted_at IS NULL');
       
       res.json({ 
         status: 'success', 
         data: { 
           totalConvocatorias: convocatoriasCount, 
           totalFondos: `COP ${totalFondos.toLocaleString()}M`, 
           proyectosActivos, 
           alertasImpacto 
         } 
       });
     } catch (error) {
       console.error('Error en /api/estadisticas:', error);
       res.status(500).json({ success: false, message: 'Error interno del servidor' });
     }
   });

   app.get('/api/convocatorias', authenticateToken, async (req, res) => {
     try {
       const convocatorias = await getRows('SELECT * FROM convocatorias WHERE deleted_at IS NULL ORDER BY created_at DESC');
       res.json({ status: 'success', data: convocatorias });
     } catch (error) {
       console.error('Error en /api/convocatorias:', error);
       res.status(500).json({ success: false, message: 'Error interno del servidor' });
     }
   });

  app.get('/api/scraped-results', (req, res) => {
    res.json({ status: 'success', data: [] });
  });

  // ── Configurar multer para importación de archivos (memoria, no disco) ────────
  const multer = require('multer');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // máx 10 MB
    fileFilter: (_req, file, cb) => {
      const allowed = ['text/csv', 'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain'];
      const allowedExt = ['.csv', '.xlsx', '.xls'];
      const ext = '.' + file.originalname.split('.').pop().toLowerCase();
      if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('FORMATO NO PERMITIDO: Solo CSV, XLSX o XLS.'));
      }
    },
  });

  // ── GET /api/directory — Directorio de entidades (datos reales) ──────────────
  app.get('/api/directory', authenticateToken, async (req, res) => {
    try {
      const rows = await getRows(
        `SELECT * FROM directorio_entidades WHERE deleted_at IS NULL ORDER BY validation_status ASC, nombre ASC`
      );
      res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error al cargar directorio.' });
    }
  });

  // ── POST /api/directory/import — Importación CSV/Excel (admin) ───────────────
  app.post('/api/directory/import', authenticateToken, upload.single('file'), async (req, res) => {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({ success: false, message: 'ACCESO DENEGADO: Se requiere rol ADMINISTRADOR.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Archivo requerido (CSV, XLSX o XLS).' });
      }
      const tipo = (req.body?.tipo || 'directorio').toLowerCase();
      const records = await parseFileBuffer(req.file.buffer, req.file.originalname);
      if (!records.length) {
        return res.status(422).json({ success: false, message: 'El archivo no contiene filas válidas.' });
      }
      const report = tipo === 'convocatorias'
        ? await importToConvocatorias(records)
        : await importToDirectorio(records);

      res.json({
        success: true,
        message: `IMPORTACIÓN COMPLETADA: ${report.inserted} registros nuevos, ${report.skipped} omitidos, ${report.errors} errores.`,
        report,
        totalRows: records.length,
      });
    } catch (err) {
      console.error('[Import] Error:', err.message);
      res.status(500).json({ success: false, message: err.message || 'Error interno en importación.' });
    }
  });

  // ── POST /api/convocatorias/refresh — Ingesta manual (admin) ─────────────────
  app.post('/api/convocatorias/refresh', authenticateToken, async (req, res) => {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'ACCESO DENEGADO: Requiere ADMINISTRADOR.' });
    }
    try {
      const result = await runManualIngest();
      const total = (result?.secop?.inserted || 0) + (result?.worldbank?.inserted || 0);
      res.json({ success: true, message: `INGESTA COMPLETADA: ${total} convocatorias nuevas.`, report: result });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── DELETE /api/directory/:id — Eliminar entidad del directorio (admin) ───────
  app.delete('/api/directory/:id', authenticateToken, async (req, res) => {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'ACCESO DENEGADO.' });
    }
    try {
      await runSql(
        'UPDATE directorio_entidades SET deleted_at = ? WHERE id = ?',
        [new Date().toISOString(), req.params.id]
      );
      res.json({ success: true, message: 'Entidad eliminada del directorio.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── PATCH /api/directory/:id/status — Habilitar/deshabilitar entidad ─────────
  app.patch('/api/directory/:id/status', authenticateToken, async (req, res) => {
    const { status } = req.body || {};
    if (!status || !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Estado inválido (active|disabled).' });
    }
    try {
      await runSql(
        'UPDATE directorio_entidades SET deleted_at = ? WHERE id = ?',
        [status === 'disabled' ? new Date().toISOString() : null, req.params.id]
      );
      res.json({ success: true, status });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── GET /api/credentials/status — Verificar si usuario tiene credenciales ────
  app.get('/api/credentials/status', authenticateToken, async (req, res) => {
    try {
      const rows = await getRows(
        'SELECT service FROM user_credentials WHERE user_id = ?',
        [req.userId]
      );
      const configured = rows.map(r => r.service);
      res.json({ success: true, hasCredentials: configured.length > 0, configured });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── GET /api/credentials — Listar credenciales del usuario (enmascaradas) ────
  app.get('/api/credentials', authenticateToken, async (req, res) => {
    try {
      const rows = await getRows(
        'SELECT id, service, label, created_at, updated_at FROM user_credentials WHERE user_id = ?',
        [req.userId]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── POST /api/credentials — Guardar/actualizar credencial cifrada ─────────────
  app.post('/api/credentials', authenticateToken, async (req, res) => {
    const { service, apiKey, label } = req.body || {};
    if (!service || !apiKey) {
      return res.status(400).json({ success: false, message: 'service y apiKey son requeridos.' });
    }
    const VALID_SERVICES = ['gemini', 'perplexity', 'serper', 'openai', 'groq', 'notebooklm'];
    if (!VALID_SERVICES.includes(service)) {
      return res.status(400).json({ success: false, message: `Servicio no reconocido. Válidos: ${VALID_SERVICES.join(', ')}` });
    }
    try {
      const encrypted = encryptKey(apiKey, JWT_SECRET);
      const masked    = maskKey(apiKey);
      const now       = new Date().toISOString();
      const id        = crypto.randomUUID();
      await runSql(
        `INSERT INTO user_credentials (id, user_id, service, encrypted_key, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, service) DO UPDATE SET encrypted_key=excluded.encrypted_key, label=excluded.label, updated_at=excluded.updated_at`,
        [id, req.userId, service, encrypted, label || service, now, now]
      );
      res.json({ success: true, message: `Credencial '${service}' guardada correctamente.`, masked });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── DELETE /api/credentials/:service — Eliminar credencial ──────────────────
  app.delete('/api/credentials/:service', authenticateToken, async (req, res) => {
    try {
      await runSql(
        'DELETE FROM user_credentials WHERE user_id = ? AND service = ?',
        [req.userId, req.params.service]
      );
      res.json({ success: true, message: `Credencial '${req.params.service}' eliminada.` });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── GET /api/favorites — Favoritos del usuario autenticado ──────────────────
  app.get('/api/favorites', authenticateToken, async (req, res) => {
    try {
      const rows = await getRows(
        'SELECT id, grant_id, grant_data, saved_at FROM user_favorites WHERE user_id = ? ORDER BY saved_at DESC',
        [req.userId]
      );
      const data = rows.map(r => {
        let grant_data = {};
        try { grant_data = JSON.parse(r.grant_data); } catch {}
        return { id: r.id, grant_id: r.grant_id, grant_data, saved_at: r.saved_at };
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error('[favorites] GET error:', error);
      res.status(500).json({ success: false, message: 'Error al cargar favoritos' });
    }
  });

  // ── POST /api/favorites — Guardar convocatoria como favorito ─────────────────
  app.post('/api/favorites', authenticateToken, async (req, res) => {
    const { grant_id, grant_data } = req.body || {};
    if (!grant_id || !grant_data) {
      return res.status(400).json({ success: false, message: 'grant_id y grant_data son requeridos' });
    }
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await runSql(
        'INSERT INTO user_favorites (id, user_id, grant_id, grant_data, saved_at) VALUES (?, ?, ?, ?, ?)',
        [id, req.userId, String(grant_id), JSON.stringify(grant_data), now]
      );
      res.status(201).json({ success: true, data: { id, grant_id: String(grant_id), saved_at: now } });
    } catch (error) {
      if (error.message?.includes('UNIQUE')) {
        return res.status(409).json({ success: false, message: 'Esta convocatoria ya está en favoritos' });
      }
      console.error('[favorites] POST error:', error);
      res.status(500).json({ success: false, message: 'Error al guardar en la base de datos. Tu selección NO fue guardada.' });
    }
  });

  // ── DELETE /api/favorites/:id — Eliminar favorito (solo si es del usuario) ───
  app.delete('/api/favorites/:id', authenticateToken, async (req, res) => {
    try {
      const row = await getRow(
        'SELECT id FROM user_favorites WHERE id = ? AND user_id = ?',
        [req.params.id, req.userId]
      );
      if (!row) {
        return res.status(404).json({ success: false, message: 'Favorito no encontrado o no autorizado' });
      }
      await runSql('DELETE FROM user_favorites WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
      res.json({ success: true, message: 'Favorito eliminado' });
    } catch (error) {
      console.error('[favorites] DELETE error:', error);
      res.status(500).json({ success: false, message: 'Error al eliminar favorito' });
    }
  });

  // ── Google OAuth2 — rutas gestionadas por el controlador ────────────────────
  registerGoogleAuthRoutes(app, { authenticateToken, runSql, getRow, encryptKey, JWT_SECRET });

  // ── POST /api/ai/convocatoria-analyze — Extracción IA con contexto aislado ───
  app.post('/api/ai/convocatoria-analyze', authenticateToken, async (req, res) => {
    const { prompt, context } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ success: false, message: 'El campo "prompt" es requerido.' });
    }
    const accessToken = await getGoogleAccessToken(
      req.userId,
      { getRow, runSql, encryptKey, decryptKey, JWT_SECRET }
    );
    if (!accessToken) {
      return res.status(403).json({
        success: false,
        message: 'Google OAuth no vinculado. Sincroniza tu IA desde /apis primero.',
      });
    }
    try {
      const body = JSON.stringify({
        system_instruction: { parts: [{ text: GEMINI_SYSTEM_INSTRUCTIONS }] },
        contents: [{
          parts: [{ text: context ? `${context}\n\n${prompt}` : prompt }],
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      });
      const geminiRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body,
        }
      );
      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        return res.status(502).json({ success: false, message: `Gemini API: ${errText}` });
      }
      const data = await geminiRes.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      res.json({ success: true, result: text });
    } catch (err) {
      console.error('[gemini-analyze]', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── SPA catch-all — SIEMPRE AL FINAL, después de todas las rutas /api/* ──────
  // res.writeHead + res.end (Node.js puro) — Express no toca estos headers.
  // Así Cache-Control: no-store llega al browser sin ser sobreescrito.
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  const indexBuf  = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : null;

  app.get('/{*path}', (_req, res) => {
    if (!indexBuf) {
      return res.status(404).json({ success: false, message: 'Frontend no encontrado. Ejecuta npm run build.' });
    }
    res.writeHead(200, {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma':        'no-cache',
      'Expires':       '0',
      'Content-Length': indexBuf.length,
    });
    res.end(indexBuf);
  });

  // ── POST /api/report-error — Botón "Reportar Error" de testers ──────────────
  app.post('/api/report-error', authenticateToken, async (req, res) => {
    const { message, context, url, userAgent } = req.body || {};
    if (!message) return res.status(400).json({ success: false, message: 'message es requerido.' });
    try {
      ensureLogsDir();
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        userId: req.userId,
        email: req.userEmail,
        message: String(message).slice(0, 1000),
        context: context ? String(context).slice(0, 500) : undefined,
        url: url ? String(url).slice(0, 300) : undefined,
        userAgent: userAgent ? String(userAgent).slice(0, 200) : undefined,
      });
      fs.appendFileSync(ERROR_REPORTS, entry + '\n');
      res.json({ success: true, message: 'Reporte recibido. Gracias por el feedback.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.listen(PORT, () => {
    startScheduler();
    console.log(`[RASTREO] Sistema activo 24/7 en puerto ${PORT}`);
    console.log(`[Seguridad] Rate limiting: /api/auth → 5 req/15min | /api/ → 200 req/15min`);
    console.log(`[Seguridad] Cookies: HttpOnly=true, SameSite=strict, Secure=${process.env.NODE_ENV === 'production'}`);
  });
}

// ── Shutdown limpio: marca estado para recovery log ──────────────────────────
function gracefulShutdown(signal) {
  writeServerState('clean_shutdown', { signal });
  console.log(`[Shutdown] Cierre limpio por ${signal}. Estado guardado.`);
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  writeServerState('crashed', { error: err.message });
  console.error('[CRASH]', err);
  process.exit(1);
});

start().catch(err => {
  writeServerState('start_failed', { error: err.message });
  console.error('Fatal error:', err);
  process.exit(1);
});
