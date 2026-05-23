import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

import { initSQL, getDb, closeDb, getRow, getRows, getCount, runSql, DB_PATH } from './server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'radarfondos_jwt_secret_key_change_in_production';
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

function initDb() {
  const db = getDb();
  try {
    runSql(db, `CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, nombre TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      subscription_type TEXT DEFAULT 'subscriber',
      is_approved INTEGER DEFAULT 1,
      created_at TEXT NOT NULL, last_login TEXT,
      is_active INTEGER DEFAULT 1, email_verificado INTEGER DEFAULT 0
    )`);
    runSql(db, `CREATE TABLE IF NOT EXISTS tokens_revocados (
      id TEXT PRIMARY KEY, token TEXT NOT NULL,
      usuario_id TEXT NOT NULL, revocado_en TEXT NOT NULL
    )`);
    runSql(db, `CREATE TABLE IF NOT EXISTS convocatorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL,
      sector TEXT DEFAULT '', tipo_financiamiento TEXT DEFAULT '',
      formato_formulacion TEXT DEFAULT '', monto REAL DEFAULT 0,
      url TEXT DEFAULT '', fecha_cierre TEXT DEFAULT '',
      entidad_id TEXT DEFAULT '', score REAL DEFAULT 50,
      estado TEXT DEFAULT 'pendiente', es_favorito INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    runSql(db, `CREATE TABLE IF NOT EXISTS entidades (
      id TEXT PRIMARY KEY, nombre TEXT, sigla TEXT, tipo TEXT,
      pais TEXT, bandera TEXT, sectores TEXT, sitio_web TEXT,
      url_convocatorias TEXT, contacto TEXT, email_contacto TEXT,
      convocatorias_activas INTEGER DEFAULT 0,
      monto_total REAL DEFAULT 0, moneda TEXT DEFAULT 'USD',
      frecuencia TEXT DEFAULT 'variable', ultima_convocatoria TEXT,
      notas TEXT, creado_en TEXT, actualizado_en TEXT,
      last_scraped TEXT, scrape_status TEXT DEFAULT 'pendiente',
      scrape_result TEXT
    )`);
    runSql(db, `CREATE TABLE IF NOT EXISTS entidades_indexadas (
      id TEXT PRIMARY KEY, org_id TEXT, titulo TEXT, donante TEXT,
      descripcion TEXT, url_convocatoria TEXT, url_fuente TEXT,
      fecha_publicacion TEXT, fecha_cierre TEXT,
      is_global INTEGER DEFAULT 0, target_country TEXT, local_region TEXT,
      funding_type TEXT, sectores TEXT, poblacion_objetivo TEXT,
      monto_min REAL, monto_max REAL, moneda TEXT DEFAULT 'USD',
      requisitos TEXT, tags TEXT, score_compatibilidad INTEGER DEFAULT 50,
      estado TEXT DEFAULT 'activa', origen TEXT, proyecto_id TEXT,
      fecha_indexacion TEXT
    )`);
    runSql(db, `CREATE TABLE IF NOT EXISTS predios (
      id TEXT PRIMARY KEY, lat REAL, lng REAL, direccion TEXT,
      area_m2 REAL, valor_catastral REAL, propietario TEXT, matricula TEXT
    )`);
    runSql(db, `CREATE TABLE IF NOT EXISTS organizaciones (
      id TEXT PRIMARY KEY, nombre TEXT, pais TEXT,
      email_admin TEXT, api_key_google TEXT,
      notebook_google TEXT, limite_prospectos INTEGER DEFAULT 300,
      activa INTEGER DEFAULT 1, plan TEXT DEFAULT 'basico',
      created_at TEXT, updated_at TEXT
    )`);
    console.log(`DB initialized at ${DB_PATH}`);
  } finally { closeDb(db); }
}

function getUser(userId) {
  const db = getDb();
  try {
    return getRow(db, 'SELECT id, email, nombre, role, created_at, last_login, is_active, subscription_type, is_approved FROM usuarios WHERE id = ?', [userId]);
  } finally { closeDb(db); }
}

async function start() {
  await initSQL();
  initDb();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'SIA Radar', timestamp: new Date().toISOString() });
  });

  app.post('/api/auth/register', express.json(), async (req, res) => {
    console.log("=== EJECUTANDO PARCHE DE REGISTRO EN CALIENTE ===");
    try {
      const email = req.body.email || req.body.correo;
      const password = req.body.password || req.body.contrasena;
      const nombre = req.body.nombre || req.body.nombreCompleto || "Usuario Base";
      const role = req.body.role || 'user';
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Faltan credenciales obligatorias (Email/Password)." });
      }
      const db = getDb();
      try {
        const existente = getRow(db, 'SELECT id FROM usuarios WHERE email = ?', [email]);
        if (existente) {
          return res.status(400).json({ success: false, message: "El correo ya esta registrado." });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();
        runSql(db, 'INSERT INTO usuarios (id, email, password_hash, nombre, role, created_at, is_active) VALUES (?,?,?,?,?,?,1)', [userId, email, salt + ':' + hash, nombre, role, now]);
        const token = generateToken(userId, email, role);
        return res.status(201).json({ success: true, message: "Registro exitoso", user: { id: userId, email, nombre, role, created_at: now, is_active: true }, token });
      } finally { closeDb(db); }
    } catch (error) {
      console.error("CRITICO - Fallo en el Hotfix:", error);
      return res.status(500).json({ success: false, message: "Error interno del servidor", error: error.message });
    }
  });

  app.post('/api/auth/login', express.json(), async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email y password son requeridos' });
      }
      const db = getDb();
      try {
        const row = getRow(db, 'SELECT * FROM usuarios WHERE email = ?', [email]);
        if (!row || !verifyPassword(password, row.password_hash)) {
          return res.status(401).json({ success: false, message: 'Credenciales invalidas' });
        }
        if (!row.is_active) {
          return res.status(403).json({ success: false, message: 'Usuario deshabilitado' });
        }
        const now = new Date().toISOString();
        runSql(db, 'UPDATE usuarios SET last_login = ? WHERE id = ?', [now, row.id]);
        const token = generateToken(row.id, row.email, row.role);
        res.json({ success: true, user: { id: row.id, email: row.email, nombre: row.nombre, role: row.role, created_at: row.created_at, is_active: true }, token });
      } finally { closeDb(db); }
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ success: false, message: error.message || 'Error interno del servidor' });
    }
  });

  app.get('/api/auth/verify', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Token requerido' });
      }
      const payload = verifyToken(auth.slice(7));
      if (!payload) {
        return res.status(401).json({ success: false, message: 'Token invalido o expirado' });
      }
      const user = getUser(payload.sub);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.json({ valid: true, user });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const db = getDb();
      try {
        runSql(db, 'INSERT INTO tokens_revocados (id, token, usuario_id, revocado_en) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), auth.slice(7), payload.sub, new Date().toISOString()]);
        res.json({ success: true, message: 'Sesion cerrada exitosamente' });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/auth/me', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const user = getUser(payload.sub);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.json(user);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.put('/api/auth/me', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const { nombre, email } = req.body;
      const db = getDb();
      try {
        if (nombre) runSql(db, 'UPDATE usuarios SET nombre = ? WHERE id = ?', [nombre, payload.sub]);
        if (email) runSql(db, 'UPDATE usuarios SET email = ? WHERE id = ?', [email, payload.sub]);
        res.json({ success: true, message: 'Usuario actualizado' });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/auth/change-password', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const { old_password, new_password } = req.body;
      if (!new_password || new_password.length < 8) return res.status(400).json({ success: false, message: 'La nueva contrasena debe tener al menos 8 caracteres' });
      const db = getDb();
      try {
        const row = getRow(db, 'SELECT password_hash FROM usuarios WHERE id = ?', [payload.sub]);
        if (!row || !verifyPassword(old_password, row.password_hash)) return res.status(400).json({ success: false, message: 'Contrasena actual incorrecta' });
        runSql(db, 'UPDATE usuarios SET password_hash = ? WHERE id = ?', [hashPassword(new_password), payload.sub]);
        res.json({ success: true, message: 'Contrasena actualizada' });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/auth/users', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const { role } = req.query;
      const db = getDb();
      try {
        let rows;
        if (role) rows = getRows(db, 'SELECT id, email, nombre, role, created_at, is_active, subscription_type FROM usuarios WHERE role = ?', [role]);
        else rows = getRows(db, 'SELECT id, email, nombre, role, created_at, is_active, subscription_type FROM usuarios');
        res.json(rows);
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.put('/api/auth/users/:userId/role', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const { role } = req.body;
      if (!role || !['admin', 'user'].includes(role)) return res.status(400).json({ success: false, message: 'Rol invalido' });
      const db = getDb();
      try { runSql(db, 'UPDATE usuarios SET role = ? WHERE id = ?', [role, req.params.userId]); res.json({ success: true }); } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/auth/admin/approve-user', (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const { userId, action } = req.body;
      if (!['approve', 'vip_free', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Accion invalida' });
      const statusMap = { approve: 'approved', vip_free: 'vip_free', reject: 'rejected' };
      const db = getDb();
      try {
        runSql(db, 'UPDATE usuarios SET status = ?, is_approved = ? WHERE id = ?', [statusMap[action], action === 'approve' ? 1 : 0, userId]);
        res.json({ success: true });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/convocatorias', (req, res) => {
    try {
      const { limit = '50', page = '1', estado } = req.query;
      const db = getDb();
      try {
        let where = '1=1';
        const params = [];
        if (estado) { where += ' AND estado = ?'; params.push(estado); }
        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const rows = getRows(db, `SELECT * FROM convocatorias WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit, 10), offset]);
        const total = getCount(db, `SELECT COUNT(*) as c FROM convocatorias WHERE ${where}`, params);
        res.json({ data: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/convocatorias', (req, res) => {
    try {
      const { titulo, sector, tipo_financiamiento, formato_formulacion, monto, url, fecha_cierre, entidad_id } = req.body;
      const db = getDb();
      try {
        runSql(db, 'INSERT INTO convocatorias (titulo, sector, tipo_financiamiento, formato_formulacion, monto, url, fecha_cierre, entidad_id) VALUES (?,?,?,?,?,?,?,?)',
          [titulo || '', sector || '', tipo_financiamiento || '', formato_formulacion || '', monto || 0, url || '', fecha_cierre || '', entidad_id || '']);
        const rows = getRows(db, 'SELECT last_insert_rowid() as id');
        res.json({ id: rows[0]?.id || 0, status: 'created' });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/estadisticas', (req, res) => {
    try {
      const db = getDb();
      try {
        const totalEntidades = getCount(db, 'SELECT COUNT(*) as c FROM entidades');
        const resultadosFound = getCount(db, 'SELECT COUNT(*) as c FROM convocatorias');
        const pendientesValid = getCount(db, "SELECT COUNT(*) as c FROM convocatorias WHERE estado='pendiente'");
        const aprobados = getCount(db, 'SELECT COUNT(*) as c FROM entidades_indexadas');
        res.json({ totalEntidades, resultadosFound, pendientesValid, aprobados });
      } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/entidades', (req, res) => {
    try {
      const db = getDb();
      try { res.json(getRows(db, 'SELECT * FROM entidades')); } finally { closeDb(db); }
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  const staticDir = path.join(__dirname, 'dist');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: '1h' }));
    app.get('/{*path}', (req, res) => { res.sendFile(path.join(staticDir, 'index.html')); });
    console.log(`Serving static files from ${staticDir}`);
  } else {
    console.log(`Static dir ${staticDir} not found, API only mode`);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(e => { console.error('FATAL:', e); process.exit(1); });
