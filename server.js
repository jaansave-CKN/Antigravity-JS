import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'radarfondos_jwt_secret_key_change_in_production';
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRATION_HOURS = 24;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const DB_PATH = path.join(__dirname, 'backend', 'radar.db');

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
  return jwt.sign(
    { sub: userId, email, role },
    JWT_SECRET,
    { algorithm: JWT_ALGORITHM, expiresIn: `${JWT_EXPIRATION_HOURS}h` }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] }); }
  catch { return null; }
}

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function initDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      subscription_type TEXT DEFAULT 'subscriber',
      is_approved INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      last_login TEXT,
      is_active INTEGER DEFAULT 1,
      email_verificado INTEGER DEFAULT 0
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens_revocados (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      usuario_id TEXT NOT NULL,
      revocado_en TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS convocatorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      sector TEXT DEFAULT '',
      tipo_financiamiento TEXT DEFAULT '',
      formato_formulacion TEXT DEFAULT '',
      monto REAL DEFAULT 0,
      url TEXT DEFAULT '',
      fecha_cierre TEXT DEFAULT '',
      entidad_id TEXT DEFAULT '',
      score REAL DEFAULT 50,
      estado TEXT DEFAULT 'pendiente',
      es_favorito INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entidades (
      id TEXT PRIMARY KEY,
      nombre TEXT,
      sigla TEXT, tipo TEXT,
      pais TEXT, bandera TEXT, sectores TEXT,
      sitio_web TEXT, url_convocatorias TEXT,
      contacto TEXT, email_contacto TEXT,
      convocatorias_activas INTEGER DEFAULT 0,
      monto_total REAL DEFAULT 0, moneda TEXT DEFAULT 'USD',
      frecuencia TEXT DEFAULT 'variable',
      ultima_convocatoria TEXT, notas TEXT,
      creado_en TEXT, actualizado_en TEXT,
      last_scraped TEXT, scrape_status TEXT DEFAULT 'pendiente',
      scrape_result TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS entidades_indexadas (
      id TEXT PRIMARY KEY, org_id TEXT, titulo TEXT, donante TEXT,
      descripcion TEXT, url_convocatoria TEXT, url_fuente TEXT,
      fecha_publicacion TEXT, fecha_cierre TEXT,
      is_global INTEGER DEFAULT 0, target_country TEXT, local_region TEXT,
      funding_type TEXT, sectores TEXT, poblacion_objetivo TEXT,
      monto_min REAL, monto_max REAL, moneda TEXT DEFAULT 'USD',
      requisitos TEXT, tags TEXT,
      score_compatibilidad INTEGER DEFAULT 50,
      estado TEXT DEFAULT 'activa',
      origen TEXT, proyecto_id TEXT,
      fecha_indexacion TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS predios (
      id TEXT PRIMARY KEY,
      lat REAL, lng REAL, direccion TEXT,
      area_m2 REAL, valor_catastral REAL,
      propietario TEXT, matricula TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizaciones (
      id TEXT PRIMARY KEY, nombre TEXT, pais TEXT,
      email_admin TEXT, api_key_google TEXT,
      notebook_google TEXT, limite_prospectos INTEGER DEFAULT 300,
      activa INTEGER DEFAULT 1, plan TEXT DEFAULT 'basico',
      created_at TEXT, updated_at TEXT
    )
  `);
  db.close();
  console.log(`DB initialized at ${DB_PATH}`);
}

function getUser(userId) {
  const db = getDb();
  try {
    const row = db.prepare(
      `SELECT id, email, nombre, role, created_at, last_login, is_active, subscription_type, is_approved
       FROM usuarios WHERE id = ?`
    ).get(userId);
    return row || null;
  } finally { db.close(); }
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ success: false, message: 'Token invalido o expirado' });
  }
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Acceso denegado: se requiere rol de administrador' });
  }
  next();
}

function tryCatch(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      console.error('Error en servidor:', error);
      res.status(500).json({ success: false, message: error.message || 'Error interno del servidor' });
    }
  };
}

initDb();

try {
  const _testDb = getDb();
  _testDb.exec("CREATE TABLE IF NOT EXISTS _diag (id INTEGER PRIMARY KEY)");
  _testDb.exec("INSERT INTO _diag VALUES (1)");
  const _row = _testDb.prepare("SELECT id FROM _diag WHERE id = 1").get();
  if (_row && _row.id === 1) {
    _testDb.exec("DROP TABLE _diag");
    console.log("SQLite OK: escritura/lectura verificada en", DB_PATH);
  }
  _testDb.close();
} catch (e) {
  console.error("CRÍTICO: SQLite no puede escribir en", DB_PATH, e);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SIA Radar', timestamp: new Date().toISOString() });
});

app.use('/api/auth/register', (req, res, next) => {
  console.log("=== API DEBUG REGISTRO ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body recibido:", JSON.stringify(req.body, null, 2));
  if (!req.body || Object.keys(req.body).length === 0) {
    console.error("CRITICO: El body llego vacio. ¿Falta express.json() arriba?");
  }
  next();
});

app.post('/api/auth/register', express.json(), tryCatch(async (req, res) => {
  const { email, password, nombre, role } = req.body;
  if (!email || !password || !nombre) {
    return res.status(400).json({ success: false, message: 'Email, password y nombre son requeridos' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'La contrasena debe tener al menos 8 caracteres' });
  }
  const userRole = role === 'admin' ? 'admin' : 'user';
  const db = getDb();
  try {
    const existing = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existing) {
      return res.status(400).json({ success: false, message: 'El email ya esta registrado' });
    }
    const userId = crypto.randomUUID();
    const passHash = hashPassword(password);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO usuarios (id, email, password_hash, nombre, role, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(userId, email, passHash, nombre, userRole, now);
    const token = generateToken(userId, email, userRole);
    res.json({
      success: true,
      user: { id: userId, email, nombre, role: userRole, created_at: now, is_active: true },
      token
    });
  } finally { db.close(); }
}));

app.post('/api/auth/login', express.json(), tryCatch(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email y password son requeridos' });
  }
  const db = getDb();
  try {
    const row = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ success: false, message: 'Credenciales invalidas' });
    }
    if (!row.is_active) {
      return res.status(403).json({ success: false, message: 'Usuario deshabilitado' });
    }
    const now = new Date().toISOString();
    db.prepare('UPDATE usuarios SET last_login = ? WHERE id = ?').run(now, row.id);
    const token = generateToken(row.id, row.email, row.role);
    res.json({
      success: true,
      user: { id: row.id, email: row.email, nombre: row.nombre, role: row.role, created_at: row.created_at, is_active: true },
      token
    });
  } finally { db.close(); }
}));

app.get('/api/auth/verify', authenticate, tryCatch(async (req, res) => {
  const user = getUser(req.user.sub);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  }
  res.json({ valid: true, user });
}));

app.post('/api/auth/logout', authenticate, tryCatch(async (req, res) => {
  const token = req.headers.authorization.slice(7);
  const db = getDb();
  try {
    db.prepare(
      'INSERT INTO tokens_revocados (id, token, usuario_id, revocado_en) VALUES (?, ?, ?, ?)'
    ).run(crypto.randomUUID(), token, req.user.sub, new Date().toISOString());
    res.json({ success: true, message: 'Sesion cerrada exitosamente' });
  } finally { db.close(); }
}));

app.get('/api/auth/me', authenticate, tryCatch(async (req, res) => {
  const user = getUser(req.user.sub);
  if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  res.json(user);
}));

app.put('/api/auth/me', authenticate, tryCatch(async (req, res) => {
  const { nombre, email } = req.body;
  const db = getDb();
  try {
    if (nombre) db.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?').run(nombre, req.user.sub);
    if (email) db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(email, req.user.sub);
    res.json({ success: true, message: 'Usuario actualizado' });
  } finally { db.close(); }
}));

app.post('/api/auth/change-password', authenticate, tryCatch(async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ success: false, message: 'La nueva contrasena debe tener al menos 8 caracteres' });
  }
  const db = getDb();
  try {
    const row = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(req.user.sub);
    if (!row || !verifyPassword(old_password, row.password_hash)) {
      return res.status(400).json({ success: false, message: 'Contrasena actual incorrecta' });
    }
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.sub);
    res.json({ success: true, message: 'Contrasena actualizada' });
  } finally { db.close(); }
}));

app.get('/api/auth/users', authenticate, requireAdmin, tryCatch(async (req, res) => {
  const { role } = req.query;
  const db = getDb();
  try {
    let rows;
    if (role) {
      rows = db.prepare(
        'SELECT id, email, nombre, role, created_at, is_active, subscription_type FROM usuarios WHERE role = ?'
      ).all(role);
    } else {
      rows = db.prepare(
        'SELECT id, email, nombre, role, created_at, is_active, subscription_type FROM usuarios'
      ).all();
    }
    res.json(rows);
  } finally { db.close(); }
}));

app.put('/api/auth/users/:userId/role', authenticate, requireAdmin, tryCatch(async (req, res) => {
  const { role } = req.body;
  if (!role || !['admin', 'user'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Rol invalido' });
  }
  const db = getDb();
  try {
    db.prepare('UPDATE usuarios SET role = ? WHERE id = ?').run(role, req.params.userId);
    res.json({ success: true, message: `Rol actualizado a ${role}` });
  } finally { db.close(); }
}));

app.post('/api/auth/admin/approve-user', authenticate, requireAdmin, tryCatch(async (req, res) => {
  const { userId, action } = req.body;
  if (!['approve', 'vip_free', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Accion invalida' });
  }
  const statusMap = { approve: 'approved', vip_free: 'vip_free', reject: 'rejected' };
  const db = getDb();
  try {
    db.prepare('UPDATE usuarios SET status = ?, is_approved = ? WHERE id = ?').run(
      statusMap[action], action === 'approve' ? 1 : 0, userId
    );
    res.json({ success: true, message: `Usuario ${userId} actualizado a ${action}` });
  } finally { db.close(); }
}));

app.get('/api/convocatorias', tryCatch(async (req, res) => {
  const { limit = '50', page = '1', estado } = req.query;
  const db = getDb();
  try {
    let where = '1=1';
    const params = [];
    if (estado) { where += ' AND estado = ?'; params.push(estado); }
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const rows = db.prepare(
      `SELECT * FROM convocatorias WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit, 10), offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM convocatorias WHERE ${where}`).get(...params).count;
    res.json({ data: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } finally { db.close(); }
}));

app.post('/api/convocatorias', tryCatch(async (req, res) => {
  const { titulo, sector, tipo_financiamiento, formato_formulacion, monto, url, fecha_cierre, entidad_id } = req.body;
  const db = getDb();
  try {
    const result = db.prepare(
      `INSERT INTO convocatorias (titulo, sector, tipo_financiamiento, formato_formulacion, monto, url, fecha_cierre, entidad_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(titulo || '', sector || '', tipo_financiamiento || '', formato_formulacion || '',
          monto || 0, url || '', fecha_cierre || '', entidad_id || '');
    res.json({ id: result.lastInsertRowid, status: 'created' });
  } finally { db.close(); }
}));

app.get('/api/estadisticas', tryCatch(async (req, res) => {
  const db = getDb();
  try {
    const totalEntidades = db.prepare('SELECT COUNT(*) as c FROM entidades').get().c;
    const resultadosFound = db.prepare('SELECT COUNT(*) as c FROM convocatorias').get().c;
    const pendientesValid = db.prepare("SELECT COUNT(*) as c FROM convocatorias WHERE estado='pendiente'").get().c;
    const aprobados = db.prepare('SELECT COUNT(*) as c FROM entidades_indexadas').get().c;
    res.json({ totalEntidades, resultadosFound, pendientesValid, aprobados });
  } finally { db.close(); }
}));

app.get('/api/entidades', tryCatch(async (req, res) => {
  const db = getDb();
  try {
    res.json(db.prepare('SELECT * FROM entidades').all());
  } finally { db.close(); }
}));

const staticDir = path.join(__dirname, 'dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, { maxAge: '1h' }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
  console.log(`Serving static files from ${staticDir}`);
} else {
  console.log(`Static dir ${staticDir} not found, API only mode`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
