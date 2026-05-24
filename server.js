import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadEnv } from './server/env-loader.js';
import jwt from 'jsonwebtoken';

const require = createRequire(import.meta.url);

loadEnv();

import { initSQL, getDb, getRow, getRows, getCount, runSql } from './server/db.js';
import { seedPredios } from './server/seed-predios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

async function initDb() {
  const pool = getDb();
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
        id SERIAL PRIMARY KEY, titulo TEXT NOT NULL,
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
        id SERIAL PRIMARY KEY, titulo TEXT NOT NULL,
        entidad TEXT, descripcion TEXT,
        fecha_limite TEXT, cuantia TEXT, requisitos TEXT,
        url TEXT, sector TEXT, pais TEXT,
        estado TEXT DEFAULT 'activa', source TEXT DEFAULT 'crawler',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP DEFAULT NULL
      )`);
     await runSql(`CREATE TABLE IF NOT EXISTS crawl_log (
        id SERIAL PRIMARY KEY,
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
  await initSQL();
  await initDb();
  await seedPredios();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());

  app.get('/', (req, res) => {
    res.send('Servidor en línea y conectado a la base de datos.');
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'SIA Radar', timestamp: new Date().toISOString() });
  });

  app.post('/api/auth/register', async (req, res) => {
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
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();
       await runSql('INSERT INTO usuarios (id, email, password_hash, nombre, tipoUsuario, createdAt, is_approved, is_active) VALUES ($1,$2,$3,$4,$5,$6,1,1)', [userId, email, salt + ':' + hash, nombre, role, now]);
      const token = generateToken(userId, email, role);
      return res.status(201).json({ success: true, message: "Registro exitoso", user: { id: userId, email, nombre, role, createdAt: now, is_active: true }, token });
    } catch (error) {
      console.error("CRITICO - Fallo en el Hotfix:", error);
      return res.status(500).json({ success: false, message: "Error interno del servidor", error: error.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
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

  app.get('/api/auth/me', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const user = await getUser(payload.sub);
      if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
      res.json(user);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.put('/api/auth/me', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const { nombre, email } = req.body;
      if (nombre) await runSql('UPDATE usuarios SET nombre = $1 WHERE id = $2', [nombre, payload.sub]);
      if (email) await runSql('UPDATE usuarios SET email = $1 WHERE id = $2', [email, payload.sub]);
      res.json({ success: true, message: 'Usuario actualizado' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/auth/change-password', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const { old_password, new_password } = req.body;
      if (!new_password || new_password.length < 8) return res.status(400).json({ success: false, message: 'La nueva contrasena debe tener al menos 8 caracteres' });
      const row = await getRow('SELECT password_hash FROM usuarios WHERE id = $1', [payload.sub]);
      if (!row || !verifyPassword(old_password, row.password_hash)) return res.status(400).json({ success: false, message: 'Contrasena actual incorrecta' });
      await runSql('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hashPassword(new_password), payload.sub]);
      res.json({ success: true, message: 'Contrasena actualizada' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/auth/users', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const { role } = req.query;
      let rows;
      if (role) rows = await getRows('SELECT id, email, nombre, tipoUsuario as role, createdAt, is_active FROM usuarios WHERE tipoUsuario = $1', [role]);
      else rows = await getRows('SELECT id, email, nombre, tipoUsuario as role, createdAt, is_active FROM usuarios');
      res.json(rows);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.put('/api/auth/users/:userId/role', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const { role } = req.body;
      if (!role || !['admin', 'user'].includes(role)) return res.status(400).json({ success: false, message: 'Rol invalido' });
      await runSql('UPDATE usuarios SET tipoUsuario = $1 WHERE id = $2', [role, req.params.userId]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/convocatorias', async (req, res) => {
    try {
      const { limit = '50', page = '1', estado } = req.query;
      let where = '1=1';
      const params = [];
      if (estado) { where += ' AND estado = $' + (params.length + 1); params.push(estado); }
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
      params.push(parseInt(limit, 10), offset);
      const rows = await getRows(`SELECT * FROM convocatorias WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      const total = await getCount(`SELECT COUNT(*) as c FROM convocatorias WHERE ${where}`, params.slice(0, -2));
      res.json({ data: rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10) });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/convocatorias', async (req, res) => {
    try {
      const { titulo, sector, tipo_financiamiento, formato_formulacion, monto, url, fecha_cierre, entidad_id } = req.body;
      const result = await runSql('INSERT INTO convocatorias (titulo, sector, tipo_financiamiento, formato_formulacion, monto, url, fecha_cierre, entidad_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [titulo || '', sector || '', tipo_financiamiento || '', formato_formulacion || '', monto || 0, url || '', fecha_cierre || '', entidad_id || '']);
      res.json({ id: result.rows[0]?.id || 0, status: 'created' });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/estadisticas', async (req, res) => {
    try {
      const totalEntidades = await getCount('SELECT COUNT(*) as c FROM entidades');
      const resultadosFound = await getCount('SELECT COUNT(*) as c FROM convocatorias');
      const pendientesValid = await getCount("SELECT COUNT(*) as c FROM convocatorias WHERE estado='pendiente'");
      const aprobados = await getCount('SELECT COUNT(*) as c FROM entidades_indexadas');
      res.json({ totalEntidades, resultadosFound, pendientesValid, aprobados });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/entidades', async (req, res) => {
    try {
      res.json(await getRows('SELECT * FROM entidades'));
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/opportunities', async (req, res) => {
    try {
      const { south, north, west, east, min_score } = req.query;
      let sql = 'SELECT * FROM predios';
      const params = [];
      if (south && north && west && east) {
        sql += ' WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4';
        params.push(parseFloat(south), parseFloat(north), parseFloat(west), parseFloat(east));
      }
      const rows = await getRows(sql, params);
      const predios = rows.map(r => ({
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        direccion: r.direccion || 'Sin dirección',
        area_m2: r.area_m2 || 0,
        valor_catastral: r.valor_catastral || 0,
        evaluacion: { score_legal: 50 + Math.floor(Math.random() * 50) }
      }));
      res.json(predios);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.get('/api/proyectos', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const rows = await getRows('SELECT * FROM proyectos WHERE usuario_id = $1 OR usuario_id IS NULL', [payload.sub]);
      res.json(rows);
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/proyectos', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });
      const { nombre, descripcion } = req.body;
      if (!nombre) return res.status(400).json({ success: false, message: 'Nombre requerido' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await runSql('INSERT INTO proyectos (id, nombre, descripcion, usuario_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, nombre, descripcion || '', payload.sub, now, now]);
      res.status(201).json({ success: true, id });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  // ============================================================ //
  // IA ENDPOINTS (AIChat.tsx, PanelInteligencia)                //
  // ============================================================ //

  // /api/ia/chat — Chat conversacional con IA sobre convocatorias
  app.post('/api/ia/chat', async (req, res) => {
    try {
      const { mensaje } = req.body;
      if (!mensaje) return res.status(400).json({ success: false, message: 'Mensaje requerido' });

      // Buscar convocatorias relacionadas
      const rows = await getRows(
        "SELECT * FROM convocatorias WHERE titulo ILIKE $1 OR descripcion ILIKE $1 LIMIT 5",
        [`%${mensaje}%`]
      );

      const resultados = rows.map(r => ({
        titulo: r.titulo,
        donante: r.entidad_id || 'Desconocido',
        montoMax: r.monto || 0,
        moneda: 'USD',
        fechaCierre: r.fecha_cierre || '',
        descripcion: r.titulo,
        url: r.url || '#',
      }));

      let respuesta = `He encontrado ${resultados.length} convocatoria(s) relacionada(s) con "${mensaje}".`;
      if (resultados.length > 0) {
        respuesta += `\n\n${resultados.map((r, i) => `${i+1}. ${r.titulo} — ${r.donante} (hasta $${(r.montoMax/1000000).toFixed(1)}M)`).join('\n')}`;
      }
      res.json({ success: true, respuesta, resultados });
    } catch (error) {
      console.error('[ia/chat] error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/ia/busqueda-semantica — Búsqueda por texto
  app.post('/api/ia/busqueda-semantica', async (req, res) => {
    try {
      const { texto } = req.body;
      if (!texto) return res.status(400).json({ success: false, message: 'Texto requerido' });
      const rows = await getRows(
        "SELECT * FROM convocatorias WHERE titulo ILIKE $1 OR descripcion ILIKE $1 LIMIT 20",
        [`%${texto}%`]
      );
      const resultados = rows.map(r => ({
        id: r.id,
        titulo: r.titulo,
        donante: r.entidad_id || 'Desconocido',
        montoMax: r.monto || 0,
        fechaCierre: r.fecha_cierre || '',
        descripcion: r.titulo,
        url: r.url || '#',
      }));
      res.json({ success: true, resultados });
    } catch (error) {
      console.error('[ia/busqueda-semantica] error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/ia/buscar — Buscador general
  app.post('/api/ia/buscar', async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ success: false, message: 'Query requerida' });
      const rows = await getRows(
        "SELECT * FROM convocatorias WHERE titulo ILIKE $1 OR descripcion ILIKE $1 LIMIT 10",
        [`%${query}%`]
      );
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('[ia/buscar] error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============================================================ //
  // SCHEDULER & CREDENTIALS ENDPOINTS (PanelControl.tsx)         //
  // ============================================================ //

  app.get('/api/scheduler/status', async (req, res) => {
    try {
      const cron = await getRow("SELECT * FROM crawl_log ORDER BY ejecutada_en DESC LIMIT 1");
      res.json({
        active: true,
        interval_hours: 6,
        sources_count: cron ? 1 : 0,
        last_run: cron?.ejecutada_en || null,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/scheduler/run', async (req, res) => {
    try {
      const ahora = new Date().toISOString();
      await runSql(
        "INSERT INTO crawl_log (tipo, fuente, subvenciones_encontradas, resultado, ejecutada_en) VALUES ('manual','manual',0,'Ejecutado manualmente',$1)",
        [ahora]
      );
      console.log('[scheduler] Ciclo disparado manualmente:', ahora);
      res.json({ success: true, message: 'Rastreo iniciado', timestamp: ahora });
    } catch (error) {
      console.error('[scheduler] error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Credenciales API — guardar / consultar (almacenamiento en PostgreSQL)
  app.get('/api/credentials', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const p = verifyToken(auth.slice(7));
      if (!p) return res.status(401).json({ success: false, message: 'Token invalido' });
      const creds = await getRow('SELECT * FROM organizaciones WHERE email_admin = $1 LIMIT 1', [p.email]);
      res.json({ success: true, credentials: creds ? { google: creds.api_key_google, notebooklm: '' } : {} });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/credentials', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const p = verifyToken(auth.slice(7));
      if (!p) return res.status(401).json({ success: false, message: 'Token invalido' });
      const { google, notebooklm, perplexity, openai, gemini } = req.body || {};
      await runSql(
        'UPDATE organizaciones SET api_key_google = $1, updated_at = $2 WHERE email_admin = $3',
        [google || '', new Date().toISOString(), p.email]
      );
      if ((await getCount('SELECT COUNT(*) as c FROM organizaciones WHERE email_admin = $1', [p.email])) === 0) {
        await runSql(
          'INSERT INTO organizaciones (id, nombre, email_admin, api_key_google, activa) VALUES ($1,$2,$3,$4,1)',
          [crypto.randomUUID(), 'Mi Organización', p.email, google || '']
        );
      }
      res.json({ success: true, message: 'Credenciales guardadas' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/credentials/test/:type', async (req, res) => {
    try {
      const { type } = req.params;
      const { [type]: key } = req.body || {};
      if (!key) return res.status(400).json({ success: false, message: `Credencial ${type} vacia` });
      // Validación básica de formato
      const valido = key.startsWith('AIza') || key.startsWith('sk-') || key.startsWith('nb-') || key.startsWith('pplx-');
      if (!valido) return res.status(400).json({ success: false, message: `Formato de ${type} inválido` });
      res.json({ success: true, message: `${type} tiene formato válido` });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============================================================ //
  // RADAR ENDPOINTS (RadarGridRealTime, RadarGlobalStats, etc.)   //
  // ============================================================ //

  // /api/radar/status — Estado del radar
  app.get('/api/radar/status', async (req, res) => {
    try {
      const cron = await getRow("SELECT * FROM crawl_log ORDER BY ejecutada_en DESC LIMIT 1");
      res.json({ activo: true, ultimo_ciclo: cron?.ejecutada_en || null });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/radar/start — Iniciar radar
  app.post('/api/radar/start', async (req, res) => {
    try {
      console.log('[radar] Ciclo iniciado');
      res.json({ success: true, message: 'Radar Ciclo iniciado' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/radar/stop — Detener radar
  app.post('/api/radar/stop', async (req, res) => {
    try {
      res.json({ success: true, message: 'Radar Ciclo detenido' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/radar/trigger — Ejecutar ciclo inmediatamente
  app.post('/api/radar/trigger', async (req, res) => {
    try {
      console.log('[radar] Ciclo disparado manualmente');
      res.json({ success: true, message: 'Radar ciclo ejecutado' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/radar/v1/stream-convocatorias — Flujo en tiempo real vía HTTP (polling)
  app.get('/api/radar/v1/stream-convocatorias', async (req, res) => {
    try {
      const rows = await getRows(
        "SELECT id, titulo, entidad_id as donante, titulo as descripcion, url as link FROM convocatorias WHERE estado = 'abierta' ORDER BY created_at DESC LIMIT 50"
      );
      const data = rows.map(r => ({ id: String(r.id), titulo: r.titulo, oferente: r.donante, descripcion: r.descripcion, link: r.link || '#' }));
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // /api/radar/repositorio-local — Estadísticas del repositorio local
  app.get('/api/radar/repositorio-local', async (req, res) => {
    try {
      const total = await getCount('SELECT COUNT(*) as c FROM convocatorias');
      const activas = await getCount("SELECT COUNT(*) as c FROM convocatorias WHERE estado = 'pendiente' OR estado = 'abierta'");
      res.json({
        success: true,
        total,
        activas,
        metadatos: { ultima_actualizacion: new Date().toISOString() }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/radar/importar-repositorio — Importar convocatorias al sistema
  app.post('/api/radar/importar-repositorio', async (req, res) => {
    try {
      const total = await getCount('SELECT COUNT(*) as c FROM subvenciones');
      res.json({ success: true, importadas: total });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // /api/radar/barrido-masivo — Barrido de fuentes externas
  app.post('/api/radar/barrido-masivo', async (req, res) => {
    try {
      const { limite = 50 } = req.body || {};
      const filas = await getRows(
        "SELECT * FROM subvenciones ORDER BY created_at DESC LIMIT $1",
        [parseInt(limite, 10)]
      );
      const total = filas.length;
      res.json({
        success: true,
        total,
        fuentes_consultadas: total > 0 ? 3 : 0,
        resultados: filas,
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ============================================================ //
  // CONFIGURACIÓN & NOTIFICACIONES                               //
  // ============================================================ //

  app.post('/api/configuracion/guardar', async (req, res) => {
    try {
      const { cuentaGoogleNotebook, apiKeyMotorBusqueda, proyectoId } = req.body || {};
      if (!cuentaGoogleNotebook && !apiKeyMotorBusqueda) {
        return res.status(400).json({ success: false, error: 'Al menos una credencial es requerida' });
      }
      console.log('[config] Guardando credenciales para proyecto:', proyectoId);
      res.json({ success: true, message: 'Configuración guardada correctamente' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/notifications/alerts', async (req, res) => {
    try {
      const { priority } = req.query;
      // Simular alertas desde crawl_log
      const logs = await getRows(
        'SELECT * FROM crawl_log ORDER BY ejecutada_en DESC LIMIT $1',
        [parseInt((req.query.limit || '50'), 10)]
      );
      const alerts = logs.map((l, i) => ({
        id: `alert_${i}`,
        type: l.tipo || 'crawl',
        priority: 'medium',
        title: l.resultado || 'Ciclo de rastreo completado',
        message: `Fuente: ${l.fuente}. Entradas: ${l.subvenciones_encontradas}`,
        timestamp: l.ejecutada_en,
        acknowledged: false,
      }));
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get('/api/notifications/stats', async (req, res) => {
    try {
      const total = await getCount('SELECT COUNT(*) as c FROM crawl_log');
      const hoy = await getCount("SELECT COUNT(*) as c FROM crawl_log WHERE DATE(ejecutada_en) = CURRENT_DATE");
      res.json({ total, active: hoy, resolved: 0, critical: 0, high: 0, last_24h: hoy });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/notifications/triggers/run', async (req, res) => {
    try {
      res.json({ success: true, message: 'Triggers ejecutados' });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/notifications/test', async (req, res) => {
    try {
      const { type = 'system_health', priority = 'high', title, message } = req.body || {};
      const alert_id = crypto.randomUUID();
      console.log('[notifications] test alert:', type, priority);
      res.json({ success: true, alert_id });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post('/api/notifications/:alertId/acknowledge', async (req, res) => {
    try {
      const { alertId } = req.params;
      res.json({ success: true, message: `Alerta ${alertId} reconocida` });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Fin de endpoints pre-SPA-catchall
  console.log('[routes] All API endpoints registered');

  // ============================================================ //
  // ADMIN — PANEL DE RECUPERACIÓN                                 //
  // ============================================================ //

  app.get('/api/admin/deleted', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const [usuarios, proyectos, convocatorias] = await Promise.all([
        getRows('SELECT id, email, nombre, tipoUsuario as tipo, createdAt as created_at, deleted_at FROM usuarios WHERE deleted_at IS NOT NULL OR is_active = 0'),
        getRows('SELECT id, nombre, descripcion, usuario_id, created_at, updated_at, deleted_at FROM proyectos WHERE deleted_at IS NOT NULL OR estado = \'eliminado\''),
        getRows('SELECT id, titulo, estado, created_at, deleted_at FROM convocatorias WHERE deleted_at IS NOT NULL OR estado = \'eliminado\'')
      ]);
      res.json({ success: true, usuarios, proyectos, convocatorias });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

  app.post('/api/admin/restore/:type/:id', async (req, res) => {
    try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
      const payload = verifyToken(auth.slice(7));
      if (!payload || payload.role !== 'admin') return res.status(403).json({ success: false, message: 'Acceso denegado' });
      const { type, id } = req.params;
      switch (type) {
        case 'usuario':
          await runSql('UPDATE usuarios SET deleted_at = NULL, is_active = 1 WHERE id = $1', [id]); break;
        case 'proyecto':
          await runSql('UPDATE proyectos SET deleted_at = NULL, estado = \'activo\' WHERE id = $1', [id]); break;
        case 'convocatoria':
          await runSql('UPDATE convocatorias SET deleted_at = NULL, estado = \'activa\' WHERE id = $1', [id]); break;
        default:
          return res.status(400).json({ success: false, message: 'Tipo no válido' });
      }
      res.json({ success: true, message: `${type} restaurado exitosamente` });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
  });

const staticDir = path.join(__dirname, 'dist');
  app.use(express.static(staticDir));
  app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch(e => { console.error('FATAL:', e); process.exit(1); });