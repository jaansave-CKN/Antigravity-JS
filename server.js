import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadEnv } from './backend/env-loader.js';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authLimiter, sanitizeAuthBody, COOKIE_OPTIONS, trialLimiter, aiLimiter } from './backend/middlewares/SecurityMiddleware.js';
import { seedDirectorio } from './backend/pipeline/DataIngestor.js';
import { startScheduler, runManualIngest } from './backend/pipeline/CronScheduler.js';
import { ingestDirectorioConvocatorias } from './backend/pipeline/EntityScraper.js';
import { parseFileBuffer, importToDirectorio, importToConvocatorias } from './backend/pipeline/FileImporter.js';
import { encryptKey, decryptKey } from './backend/pipeline/CryptoHelper.js';
import {
  registerGoogleAuthRoutes,
  getGoogleAccessToken,
  GEMINI_SYSTEM_INSTRUCTIONS,
} from './backend/routes/authGoogle.controller.js';
import { emailAdapter } from './backend/notifications/BrevoEmailAdapter.js';
import { pool, getRow, getRows, getCount, runSql } from './backend/db.js';
import { stripeWebhookHandler } from './backend/routes/stripe.webhook.js';
import { isRevoked, checkSessionValid, revokeToken, revokeUserSession } from './backend/middlewares/tokenBlacklist.js';
import { seedPredios } from './backend/pipeline/seed-predios.js';
import { rejectMaterialsInput } from './backend/middlewares/materialValidator.js';
import { logger } from './backend/utils/logger.js';
import { validateStructuralElements } from './backend/validators/structuralValidator.js';
import { generarArbolConIA } from './backend/agents/arbolObjetivosAgent.js';
import { runMatchPipeline } from './backend/pipeline/matchScore.js';
import { textToEmbedding, cosineSimilarity, deserializeEmbedding } from './backend/services/embeddingsService.js';
import { registerRadicacionRoutes } from './backend/routes/radicacion.routes.js';
import { registerProyectosRoutes } from './backend/routes/proyectos.routes.js';
import { registerReporteRoutes } from './backend/routes/reporte.routes.js';
import { registerPresupuestoRoutes } from './backend/routes/presupuesto.routes.js';
import { radarCacheMiddleware } from './backend/middlewares/radarCache.js';
import { RENDIMIENTOS_CATALOGO } from './backend/pipeline/apuEngine.js';
import { registerSubscriptionRoutes }    from './backend/routes/subscriptions.routes.js';
import { registerMotorDialecticoRoutes } from './backend/routes/motorDialectico.routes.js';
import { registerConfigLogisticaRoutes } from './backend/routes/configLogistica.routes.js';
import { registerMarcoNormativoRoutes }  from './backend/routes/marcoNormativo.routes.js';
import { registerComplianceRoutes }      from './backend/routes/compliance.routes.js';
import { registerFichaTecnicaRoutes }    from './backend/routes/fichaTecnica.routes.js';
import { registerScraperRoutes }         from './backend/routes/scraper.routes.js';

const require = createRequire(import.meta.url);
loadEnv();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Resiliencia del proceso — previene muertes silenciosas del servidor ────────
process.on('uncaughtException', (err) => console.error('[Fatal] Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('[Fatal] Unhandled Rejection:', reason));

// ── Configuración y Seguridad ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set.');
  process.exit(1);
}

// ── Hardening de variables de entorno en producción ──────────────────────────
function validateProductionEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  if (isProd) {
    // Bloqueos críticos (abortan el arranque)
    if (!process.env.DATABASE_URL) {
      errors.push('DATABASE_URL no configurada — en producción se requiere PostgreSQL. Configura en Render dashboard.');
    } else if (process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')) {
      errors.push('DATABASE_URL apunta a localhost en entorno de producción. Configura una BD remota.');
    }
    if (JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET demasiado corto (<32 chars). Genera uno seguro con: openssl rand -hex 32');
    }
    if (!process.env.ENCRYPTION_KEY) {
      errors.push('ENCRYPTION_KEY no configurada — requerida en producción para el cifrado de credenciales de usuario. Configura en el dashboard de despliegue.');
    }
    const frontendUrl = process.env.FRONTEND_URL || '';
    if (frontendUrl.includes('localhost') || frontendUrl.includes('127.0.0.1')) {
      errors.push(`FRONTEND_URL apunta a localhost (${frontendUrl}). Configura la URL de Firebase en producción.`);
    }

    // Advertencias (no abortan, pero se registran)
    if (!process.env.GOOGLE_API_KEY) warnings.push('GOOGLE_API_KEY no configurada — IA deshabilitada (árbol objetivos + match scoring usarán modo mock).');
    if (!process.env.BREVO_API_KEY)  warnings.push('BREVO_API_KEY no configurada — emails transaccionales deshabilitados.');
    if (!process.env.ERROR_WEBHOOK_URL) warnings.push('ERROR_WEBHOOK_URL no configurada — alertas de error solo en logs del servidor.');
    if (process.env.GOOGLE_CLIENT_ID?.includes('REEMPLAZAR')) warnings.push('GOOGLE_CLIENT_ID tiene valor placeholder — login con Google deshabilitado.');
  }

  if (errors.length > 0) {
    console.error('\n╔══════════════════════════════════════════════════════╗');
    console.error('║  PRODUCTION ENV ERROR — ARRANQUE ABORTADO            ║');
    console.error('╚══════════════════════════════════════════════════════╝');
    errors.forEach(e => console.error('  ✗', e));
    process.exit(1);
  }
  if (warnings.length > 0 && isProd) {
    console.warn('\n[ENV] Advertencias de configuración (no críticas):');
    warnings.forEach(w => console.warn('  ⚠', w));
  }
  if (isProd) {
    console.log('[ENV] ✓ Variables de producción validadas.');
  }
}
validateProductionEnv();

// ── Utilidades ───────────────────────────────────────────────────────────────
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); }
  catch (err) {
    if (err.name === 'TokenExpiredError') {
      logger.info('[auth] Token expirado', { exp: err.expiredAt });
    } else {
      logger.warn('[auth] Token inválido', { reason: err.message });
    }
    return null;
  }
}

async function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });

  // Sesión revocada: blacklist por-token (logout) o invalidación bulk (Stripe/admin)
  if (isRevoked(token) || !(await checkSessionValid(payload.sub, payload.iat, getRow))) {
    return res.status(401).json({ success: false, message: 'Sesión revocada' });
  }

  req.userId = payload.sub;
  req.userRole = payload.role;
  next();
}

function tryCatch(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      logger.error('[server] Error no controlado en ruta', { method: req.method, path: req.path, err: err.message });
      // Errores de IA por clave faltante → 503 con mensaje claro para el usuario
      if (err.message?.includes('EMBEDDINGS_ERROR') || err.message?.includes('GOOGLE_API_KEY')) {
        return res.status(503).json({
          success: false,
          code: 'IA_NO_DISPONIBLE',
          message: 'El módulo de inteligencia artificial no está disponible en este momento. Contacta al administrador para configurar el servicio.',
        });
      }
      res.status(500).json({ success: false, message: err.message || 'Error interno del servidor' });
    }
  };
}

// Resuelve la API key de IA: primero clave personal del usuario, luego clave del sistema
async function resolveGoogleApiKey(userId, getRow) {
  const systemKey = process.env.GOOGLE_API_KEY || '';
  const cred = await getRow('SELECT api_key_enc FROM user_credentials WHERE user_id = ?', [userId]);
  const enc  = process.env.ENCRYPTION_KEY || JWT_SECRET;
  if (cred?.api_key_enc) {
    try {
      const userKey = decryptKey(cred.api_key_enc, enc);
      if (userKey) return userKey;
    } catch {}
  }
  return systemKey;
}

// V8.0 RBAC: verifica suscripción por módulo (radar | formulador)
function requireAccess(module) {
  return tryCatch(async (req, res, next) => {
    if (req.userRole === 'admin') return next();
    const sub = await getRow(
      'SELECT access_radar, access_formulador FROM user_subscriptions WHERE user_id = ?',
      [req.userId]
    );
    if (module === 'radar' && !sub?.access_radar) {
      return res.status(403).json({
        success: false, code: 'NO_ACCESS_RADAR',
        message: 'Plan Radar requerido para acceder a esta función',
        upgrade_required: true, redirect_to: '/planes',
      });
    }
    if (module === 'formulador' && !sub?.access_formulador) {
      return res.status(403).json({
        success: false, code: 'NO_ACCESS_FORMULADOR',
        message: 'Plan Formulador requerido para acceder a esta función',
        upgrade_required: true, redirect_to: '/planes',
      });
    }
    next();
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex') === hash);
    });
  });
}

// ── Inicialización BD ────────────────────────────────────────────────────────
async function initDb() {
  // pgvector: habilitar extensión en PostgreSQL para similitud vectorial
  if (process.env.DATABASE_URL) {
    try {
      await runSql('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('[DB] pgvector: extensión vector activa');
    } catch (err) {
      console.warn('[DB] pgvector no disponible (continúa sin índice vectorial):', err.message);
    }
  }
  await runSql(`CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    tipoUsuario TEXT NOT NULL DEFAULT 'Usuario',
    plan TEXT DEFAULT 'free',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_approved INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    deleted_at TIMESTAMP DEFAULT NULL
  )`);
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
  await runSql(`CREATE TABLE IF NOT EXISTS convocatorias (
    id TEXT PRIMARY KEY,
    externo_id TEXT UNIQUE,
    titulo TEXT NOT NULL,
    donante TEXT DEFAULT '',
    fuente TEXT DEFAULT '',
    descripcion TEXT DEFAULT '',
    monto_min REAL DEFAULT 0,
    monto_max REAL DEFAULT 0,
    moneda TEXT DEFAULT 'USD',
    paises_elegibles TEXT DEFAULT '[]',
    sectores TEXT DEFAULT '[]',
    url_convocatoria TEXT DEFAULT '',
    url_fuente TEXT DEFAULT '',
    fecha_limite TEXT DEFAULT '',
    fecha_publicacion TEXT DEFAULT '',
    requisitos TEXT DEFAULT '[]',
    estado TEXT DEFAULT 'nueva',
    score_probabilidad REAL DEFAULT 70,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL
  )`);
  await runSql(`CREATE TABLE IF NOT EXISTS user_favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    grant_id TEXT NOT NULL,
    grant_data TEXT NOT NULL,
    saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES usuarios(id),
    UNIQUE(user_id, grant_id)
  )`);
  await runSql(`CREATE TABLE IF NOT EXISTS user_credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    api_key_enc TEXT DEFAULT NULL,
    notebook_key_enc TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await runSql(`CREATE TABLE IF NOT EXISTS objetivos_arbol (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('CENTRAL','ESPECIFICO','RESULTADO','ACTIVIDAD')),
    nivel INTEGER NOT NULL DEFAULT 0,
    texto TEXT NOT NULL,
    parent_id TEXT,
    generado_por_ia INTEGER DEFAULT 0,
    confirmado INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await runSql(`CREATE TABLE IF NOT EXISTS match_scores (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    convocatoria_id TEXT NOT NULL,
    score REAL NOT NULL CHECK(score BETWEEN 0 AND 100),
    breakdown TEXT NOT NULL,
    pipeline_version TEXT NOT NULL DEFAULT 'v1',
    calculado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proyecto_id, convocatoria_id)
  )`);
  await runSql(`CREATE TABLE IF NOT EXISTS agentes_registro (
    id TEXT PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    version TEXT NOT NULL DEFAULT 'v1',
    modulo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','DEPRECATED')),
    configuracion TEXT DEFAULT '{}',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  // Tabla de predios (seedPredios la necesita al arranque)
  await runSql(`CREATE TABLE IF NOT EXISTS predios (
    id TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    direccion TEXT NOT NULL,
    area_m2 REAL DEFAULT 0,
    valor_catastral REAL DEFAULT 0,
    propietario TEXT DEFAULT '',
    matricula TEXT DEFAULT ''
  )`);
   // Tabla de log de ejecuciones del cron/ingestor
   const idDef = process.env.DATABASE_URL ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
   await runSql(`CREATE TABLE IF NOT EXISTS crawl_log (
     id ${idDef},
     tipo TEXT NOT NULL,
     fuente TEXT NOT NULL,
     subvenciones_encontradas INTEGER DEFAULT 0,
     resultado TEXT DEFAULT '{}',
     ejecutada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`);
  // Tabla de organizaciones (spec v2.0 — multi-tenant real)
  await runSql(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await runSql(`CREATE TABLE IF NOT EXISTS proyectos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL DEFAULT '',
    nombre TEXT NOT NULL DEFAULT 'Sin nombre',
    estado TEXT NOT NULL DEFAULT 'Borrador'
      CHECK(estado IN ('Borrador','En_Validacion','Finalizado','BLOQUEADO')),
    bloqueo_razon TEXT,
    ficha_tecnica TEXT DEFAULT '{}',
    presupuesto TEXT DEFAULT '{}',
    crosscheck_sello TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
  )`);
  // Migraciones de proyectos: agrega columnas ausentes en versiones anteriores del esquema
  try { await runSql(`ALTER TABLE proyectos ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`); } catch {}
  try { await runSql(`ALTER TABLE proyectos ADD COLUMN org_id TEXT NOT NULL DEFAULT ''`); } catch {}
  // Backfill: registros anteriores heredan user_id como org_id
  try { await runSql(`UPDATE proyectos SET org_id = user_id WHERE org_id = ''`); } catch {}

  // Migraciones de integridad referencial Convocatorias ↔ Directorio
  try { await runSql(`ALTER TABLE convocatorias ADD COLUMN entidad_id TEXT`); } catch {}
  try { await runSql(`ALTER TABLE directorio_entidades ADD COLUMN status TEXT DEFAULT 'active'`); } catch {}
  // Backfill: enlaza convocatorias existentes a entidades por nombre exacto del donante
  try {
    await runSql(`
      UPDATE convocatorias SET entidad_id = (
        SELECT id FROM directorio_entidades
        WHERE LOWER(nombre) = LOWER(convocatorias.donante)
           OR LOWER(sigla)  = LOWER(convocatorias.donante)
        LIMIT 1
      )
      WHERE entidad_id IS NULL AND donante != ''
    `);
  } catch {}

  // M4 APU — catalogo de rendimientos (SQLite fallback)
  await runSql(`CREATE TABLE IF NOT EXISTS catalogo_rendimientos (
    id TEXT PRIMARY KEY, clave TEXT UNIQUE NOT NULL, descripcion TEXT NOT NULL,
    fase TEXT NOT NULL, unidad TEXT NOT NULL, valor REAL NOT NULL,
    fuente TEXT NOT NULL DEFAULT 'SENA-2024', activo INTEGER DEFAULT 1)`);

  // M4 APU — items de presupuesto calculados por proyecto
  await runSql(`CREATE TABLE IF NOT EXISTS project_budgets (
    id TEXT PRIMARY KEY, proyecto_id TEXT NOT NULL, org_id TEXT NOT NULL,
    fase TEXT NOT NULL, capitulo TEXT DEFAULT '', item TEXT DEFAULT '',
    unidad TEXT DEFAULT 'm2', cantidad REAL DEFAULT 0,
    rendimiento_std TEXT DEFAULT '', rendimiento_real REAL DEFAULT 0,
    rendimiento_ref REAL DEFAULT 0, costo_jornal_dia REAL DEFAULT 0,
    materiales TEXT DEFAULT '[]', equipos TEXT DEFAULT '[]',
    costo_mano_obra REAL DEFAULT 0, costo_materiales REAL DEFAULT 0,
    costo_equipos REAL DEFAULT 0, costo_directo REAL DEFAULT 0,
    aiu REAL DEFAULT 0.28, valor_total REAL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proyecto_id) REFERENCES proyectos(id))`);

  // V8.0 — M4: Motor Dialéctico (tono + listas)
  await runSql(`CREATE TABLE IF NOT EXISTS motor_dialectico (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    tono TEXT DEFAULT 'formal' CHECK(tono IN ('formal','tecnico','comunitario','academico','normativo')),
    lista_oro TEXT DEFAULT '[]',
    lista_negra TEXT DEFAULT '[]',
    enfasis TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proyecto_id, user_id)
  )`);

  // V8.0 — M5: Configuración Logística
  await runSql(`CREATE TABLE IF NOT EXISTS config_logistica (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    proponente_nombre TEXT DEFAULT '',
    proponente_nit TEXT DEFAULT '',
    tipo_entidad TEXT DEFAULT '',
    departamento TEXT DEFAULT '',
    municipio TEXT DEFAULT '',
    zona TEXT DEFAULT 'Urbana',
    fecha_inicio TEXT DEFAULT '',
    duracion_meses INTEGER DEFAULT 0,
    equipo_director TEXT DEFAULT '',
    equipo_coordinador TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proyecto_id, user_id)
  )`);

  // V8.0 — M8: Marco Normativo
  await runSql(`CREATE TABLE IF NOT EXISTS marco_normativo (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sector TEXT DEFAULT '',
    municipio TEXT DEFAULT '',
    normas_aplicables TEXT DEFAULT '[]',
    citas_bibliograficas TEXT DEFAULT '[]',
    notas_adicionales TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proyecto_id, user_id)
  )`);

  // V8.0 — M10: Compliance (Riesgos y Sostenibilidad)
  await runSql(`CREATE TABLE IF NOT EXISTS compliance_data (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    riesgos TEXT DEFAULT '[]',
    sostenibilidad_ambiental TEXT DEFAULT '',
    sostenibilidad_social TEXT DEFAULT '',
    ods_alineados TEXT DEFAULT '[]',
    enfoque_genero INTEGER DEFAULT 0,
    enfoque_genero_texto TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proyecto_id, user_id)
  )`);

  // V8.0 — M12: Versiones con sello SHA-256 (registro inmutable)
  await runSql(`CREATE TABLE IF NOT EXISTS versiones_proyecto (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version_num INTEGER NOT NULL DEFAULT 1,
    hash_sha256 TEXT NOT NULL,
    contenido_resumido TEXT DEFAULT '',
    firmado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (proyecto_id) REFERENCES proyectos(id)
  )`);
  // SECURITY: índice único previene race condition en numeración de versiones
  try { await runSql('CREATE UNIQUE INDEX IF NOT EXISTS idx_versiones_num ON versiones_proyecto(proyecto_id, version_num)'); } catch {}

  // Migraciones defensivas V8.0: agrega user_id si las tablas existen sin esa columna
  // (SQLite no soporta ADD COLUMN IF NOT EXISTS — el catch silencia "already exists")
  try { await runSql("ALTER TABLE motor_dialectico  ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await runSql("ALTER TABLE config_logistica  ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await runSql("ALTER TABLE marco_normativo   ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await runSql("ALTER TABLE compliance_data   ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await runSql("ALTER TABLE versiones_proyecto ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"); } catch {}
  try { await runSql("ALTER TABLE user_subscriptions ADD COLUMN access_radar INTEGER DEFAULT 0"); } catch {}
  try { await runSql("ALTER TABLE user_subscriptions ADD COLUMN access_formulador INTEGER DEFAULT 0"); } catch {}
  try { await runSql("ALTER TABLE user_subscriptions ADD COLUMN stripe_customer_id TEXT DEFAULT NULL"); } catch {}
  try { await runSql("ALTER TABLE user_subscriptions ADD COLUMN stripe_subscription_id TEXT DEFAULT NULL"); } catch {}
  try { await runSql("ALTER TABLE user_subscriptions ADD COLUMN current_period_end TIMESTAMP DEFAULT NULL"); } catch {}
  try { await runSql("ALTER TABLE user_subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0"); } catch {}
  try { await runSql("ALTER TABLE directorio_entidades ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
  // Tabla de idempotencia de webhooks Stripe
  await runSql(`CREATE TABLE IF NOT EXISTS stripe_events (
    stripe_event_id  TEXT        PRIMARY KEY,
    event_type       TEXT        NOT NULL,
    tenant_id        TEXT,
    processed_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    raw_payload      TEXT
  )`);
  try { await runSql("ALTER TABLE system_config ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); } catch {}
  try { await runSql("ALTER TABLE system_logs  ADD COLUMN nivel TEXT DEFAULT 'ERROR'"); } catch {}

  // V8.0 — Tabla de suscripciones por módulo (RBAC)
  await runSql(`CREATE TABLE IF NOT EXISTS user_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    plan TEXT DEFAULT 'free' CHECK(plan IN ('free','radar','formulador','suite')),
    access_radar INTEGER DEFAULT 0,
    access_formulador INTEGER DEFAULT 0,
    trial_expires_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
  )`);

  // lock_timeout global: evita que ALTER TABLE / CREATE INDEX queden bloqueados
  // por sesiones anteriores que no cerraron correctamente
  if (process.env.DATABASE_URL) {
    try { await runSql("SET lock_timeout = '5s'"); } catch {}
  }

  // Migraciones idempotentes para columnas nuevas
  try { await runSql('ALTER TABLE proyectos ADD COLUMN embedding TEXT DEFAULT NULL'); } catch {}
  try { await runSql('ALTER TABLE convocatorias ADD COLUMN embedding TEXT DEFAULT NULL'); } catch {}

  // pgvector: columnas vector(768) nativas e índices HNSW para búsqueda semántica (PostgreSQL only)
  if (process.env.DATABASE_URL) {
    try { await runSql('ALTER TABLE convocatorias ADD COLUMN embedding_vec vector(768)'); } catch {}
    try { await runSql('ALTER TABLE proyectos     ADD COLUMN embedding_vec vector(768)'); } catch {}
    // Índice HNSW: búsqueda aproximada por coseno (<10 ms en 100k registros)
    try { await runSql('CREATE INDEX IF NOT EXISTS idx_conv_emb_hnsw ON convocatorias USING hnsw(embedding_vec vector_cosine_ops)'); } catch {}
    try { await runSql('CREATE INDEX IF NOT EXISTS idx_proy_emb_hnsw ON proyectos     USING hnsw(embedding_vec vector_cosine_ops)'); } catch {}
    // Backfill: convertir embeddings TEXT ya almacenados → columna vector nativa
    try { await runSql("UPDATE convocatorias SET embedding_vec = embedding::vector WHERE embedding IS NOT NULL AND embedding_vec IS NULL"); } catch {}
    try { await runSql("UPDATE proyectos     SET embedding_vec = embedding::vector WHERE embedding IS NOT NULL AND embedding_vec IS NULL"); } catch {}
    console.log('[DB] pgvector: columnas vector(768) e índices HNSW listos');
  }
  // lock_timeout evita que las migraciones queden bloqueadas indefinidamente si hay locks activos
  try { await runSql("SET lock_timeout = '3s'"); } catch {}
  try { await runSql("ALTER TABLE match_scores ADD COLUMN org_id TEXT DEFAULT ''"); } catch {}
  // Migración Google OAuth: columnas faltantes en user_credentials
  try { await runSql("ALTER TABLE user_credentials ADD COLUMN service TEXT DEFAULT 'api_key'"); } catch {}
  try { await runSql('ALTER TABLE user_credentials ADD COLUMN encrypted_key TEXT DEFAULT NULL'); } catch {}
  try { await runSql("ALTER TABLE user_credentials ADD COLUMN label TEXT DEFAULT ''"); } catch {}
  // Migraciones proyectos: columnas que pueden faltar en radar.db de versiones anteriores
  try { await runSql("ALTER TABLE proyectos ADD COLUMN bloqueo_razon TEXT"); } catch {}
  try { await runSql("ALTER TABLE proyectos ADD COLUMN ficha_tecnica TEXT DEFAULT '{}'"); } catch {}
  try { await runSql("ALTER TABLE proyectos ADD COLUMN presupuesto TEXT DEFAULT '{}'"); } catch {}
  try { await runSql("ALTER TABLE proyectos ADD COLUMN crosscheck_sello TEXT DEFAULT NULL"); } catch {}
  try { await runSql("ALTER TABLE proyectos ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); } catch {}
  try { await runSql("ALTER TABLE proyectos ADD COLUMN location TEXT DEFAULT ''"); } catch {}
  try { await runSql("ALTER TABLE proyectos ADD COLUMN problem_statement TEXT DEFAULT ''"); } catch {}
  // Migración usuarios: rol granular (Formulador, Evaluador, Diseñador, Administrador, Usuario)
  try { await runSql("ALTER TABLE usuarios ADD COLUMN rol TEXT DEFAULT 'Usuario'"); } catch {}
  try { await runSql("ALTER TABLE usuarios ADD COLUMN org_id TEXT DEFAULT NULL"); } catch {}

  // Seed catalogo de rendimientos desde RENDIMIENTOS_CATALOGO (idempotente via UNIQUE)
  for (const [clave, r] of Object.entries(RENDIMIENTOS_CATALOGO)) {
    try {
      await runSql(
        'INSERT INTO catalogo_rendimientos (id,clave,descripcion,fase,unidad,valor) VALUES (?,?,?,?,?,?)',
        [crypto.randomUUID(), clave, r.descripcion || clave, r.fase, r.unidad, r.valor]
      );
    } catch {}
  }
  // Tabla de configuración del sistema (flags de producción)
  await runSql(`CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabla canónica de proyectos V8.0 (Formulador — multi-tenant, bilingüe)
  await runSql(`CREATE TABLE IF NOT EXISTS projects (
    id                TEXT        PRIMARY KEY,
    tenant_id         TEXT        NOT NULL,
    name              TEXT        NOT NULL DEFAULT '',
    status            TEXT        NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft','formulado','needs_human_review','archived')),
    translation_status TEXT       DEFAULT 'pending'
      CHECK(translation_status IN ('pending','processing','completed','failed','skipped')),
    payload_es        TEXT        DEFAULT NULL,
    payload_en        TEXT        DEFAULT NULL,
    ficha_tecnica     TEXT        DEFAULT '{}',
    embedding         TEXT        DEFAULT NULL,
    embedding_vec     vector(768) DEFAULT NULL,
    audit_cycles      INTEGER     DEFAULT 0,
    audit_approved_at TIMESTAMP   DEFAULT NULL,
    created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
  )`);

  // Tabla inmutable de hashes de versiones (ledger V8.0)
  await runSql(`CREATE TABLE IF NOT EXISTS project_version_hashes (
    id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    project_id        TEXT        NOT NULL,
    tenant_id         TEXT        NOT NULL,
    hash_value        TEXT        NOT NULL,
    payload_size_bytes INTEGER    DEFAULT 0,
    project_status    TEXT        DEFAULT 'unknown',
    triggered_by      TEXT        DEFAULT 'api_request',
    created_by_user   TEXT        DEFAULT NULL,
    metadata          TEXT        DEFAULT '{}',
    created_at        TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, hash_value)
  )`);

  // Tabla de auditoría de errores críticos del sistema
  await runSql(`CREATE TABLE IF NOT EXISTS system_logs (
    id TEXT PRIMARY KEY,
    origen TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    nivel TEXT DEFAULT 'ERROR' CHECK(nivel IN ('INFO','WARN','ERROR','CRITICAL')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Aviso de producción: PostgreSQL recomendado sobre SQLite
  if (!process.env.DATABASE_URL) {
    console.warn('[DB] AVISO: DATABASE_URL no definida — usando SQLite (solo desarrollo). En producción configura PostgreSQL.');
  }
  console.log('[DB] DB initialized at', new Date().toISOString());
}

// ── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  await seedPredios();
  await seedDirectorio();

  // Seed WePropel — idempotente (solo inserta si no existe)
  try {
    const existsWP = await getRow("SELECT id FROM directorio_entidades WHERE sigla = 'WePropel' AND deleted_at IS NULL");
    if (!existsWP) {
      const now = new Date().toISOString();
      await runSql(
        `INSERT INTO directorio_entidades
         (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias,
          telefono, email, alcance, validation_status, fuente, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          'seed-wepropel',
          'WePropel',
          'WePropel',
          'ONG',
          'Internacional',
          'https://www.wepropel.org',
          'https://www.wepropel.org/oportunidades',
          '', '',
          'Internacional',
          'VALIDADO',
          'seed',
          now, now,
        ]
      );
      console.log('[Seed] WePropel agregado al Directorio');
    }
  } catch (e) { console.warn('[Seed] WePropel:', e.message); }

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  // STRIPE WEBHOOK — debe ir ANTES de express.json() para recibir raw body
  // (la verificación de firma de Stripe falla si el body ya fue parseado)
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

  app.use(express.json());
  app.set('etag', false);

  // ── Aplicación Reglas Materiales (F4-01) ─────────────────────────────────
  app.use('/api/formulador', rejectMaterialsInput);
  app.use('/api/ia', rejectMaterialsInput);
  app.use('/api/modulo3b', rejectMaterialsInput);
  app.use('/api/radar/barrido-masivo', rejectMaterialsInput);

  // ── Health Check (plataformas: Railway, Render, K8s liveness probe) ─────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── Healthcheck ──────────────────────────────────────────────────────────
  app.get('/api/health', tryCatch(async (_req, res) => {
    const cfg = await getRow("SELECT value FROM system_config WHERE key = 'production_ready'");
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      production_ready: cfg?.value === 'true',
      version: '8.0',
    });
  }));

  // POST /api/system/production-ready — llamado por smokeTest.js tras checks exitosos
  app.post('/api/system/production-ready', tryCatch(async (req, res) => {
    const smokeToken = req.headers['x-smoke-token'];
    if (!smokeToken || smokeToken !== JWT_SECRET) {
      return res.status(403).json({ success: false, message: 'Token inválido' });
    }
    await runSql(
      `INSERT INTO system_config (key, value, updated_at) VALUES ('production_ready','true',CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value='true', updated_at=CURRENT_TIMESTAMP`
    );
    console.log('[System] ✓ BD marcada como PRODUCTION_READY —', new Date().toISOString());
    res.json({ success: true, message: 'Sistema marcado como Production Ready' });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // AUTH ROUTES
  // ════════════════════════════════════════════════════════════════════════════

  // POST /api/auth/register
  app.post('/api/auth/register', authLimiter, sanitizeAuthBody, tryCatch(async (req, res) => {
     const { email, password, nombre, role } = req.body;
     if (!email || !password || !nombre) {
       return res.status(400).json({ success: false, message: 'email, password y nombre son requeridos' });
     }
     const existing = await getRow('SELECT id FROM usuarios WHERE email = ?', [email.trim().toLowerCase()]);
     if (existing) return res.status(409).json({ success: false, message: 'El email ya está registrado' });
     const id = crypto.randomUUID();
     const password_hash = await hashPassword(password);
     const safeRole = role === 'admin' ? 'user' : (role || 'user'); // no permitir auto-admin
     await runSql(
       `INSERT INTO usuarios (id, email, password_hash, nombre, tipoUsuario, rol) VALUES (?, ?, ?, ?, ?, ?)`,
       [id, email.trim().toLowerCase(), password_hash, nombre.trim(), 'Usuario', safeRole]
     );
    // V8.0: auto-crear suscripción free al registrarse
    try {
      await runSql(
        `INSERT INTO user_subscriptions (id, user_id, plan, access_radar, access_formulador)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO NOTHING`,
        [crypto.randomUUID(), id, 'free', 0, 0]
      );
    } catch {}
    const token = jwt.sign({ sub: id, role: safeRole }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    res.status(201).json({
      success: true,
      message: 'Usuario registrado correctamente',
      token,
      user: { id, email: email.trim().toLowerCase(), nombre: nombre.trim(), role: safeRole, plan: 'free', created_at: new Date().toISOString(), is_active: true },
    });
  }));

  // POST /api/auth/login
  app.post('/api/auth/login', authLimiter, sanitizeAuthBody, tryCatch(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'email y password requeridos' });
    const user = await getRow('SELECT * FROM usuarios WHERE email = ? AND deleted_at IS NULL', [email.trim().toLowerCase()]);
    if (!user) return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    if (!user.is_active) return res.status(403).json({ success: false, message: 'Cuenta desactivada' });
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    const token = jwt.sign({ sub: user.id, role: user.tipoUsuario }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, nombre: user.nombre, role: user.tipoUsuario, plan: user.plan || 'free', created_at: user.createdAt, is_active: !!user.is_active },
    });
  }));

  // GET /api/auth/verify
  app.get('/api/auth/verify', authenticateToken, tryCatch(async (req, res) => {
    const user = await getRow('SELECT id, email, nombre, tipoUsuario, plan, createdAt, is_active FROM usuarios WHERE id = ? AND deleted_at IS NULL', [req.userId]);
    if (!user) return res.status(401).json({ valid: false });
    const sub = await getRow(
      'SELECT plan, access_radar, access_formulador FROM user_subscriptions WHERE user_id = ?',
      [req.userId]
    );
    res.json({
      valid: true,
      user: {
        id: user.id, email: user.email, nombre: user.nombre,
        role: user.tipoUsuario, plan: user.plan || 'free',
        created_at: user.createdAt, is_active: !!user.is_active,
        subscription: {
          plan: sub?.plan || 'free',
          access_radar: !!sub?.access_radar,
          access_formulador: !!sub?.access_formulador,
        },
      },
    });
  }));

  // POST /api/auth/trial — genera token temporal 24h (Modo Visitante V8.0)
  // trialLimiter: máx 3 tokens/hora por IP — previene bypass infinito
  app.post('/api/auth/trial', trialLimiter, tryCatch(async (req, res) => {
    const trialId = `trial-${crypto.randomUUID().slice(0, 8)}`;
    const token   = jwt.sign(
      { sub: trialId, role: 'trial', trial: true },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '24h' }
    );
    res.json({
      success: true,
      token,
      expires_in: 86400,
      user: {
        id: trialId, email: `${trialId}@trial.local`,
        nombre: 'Usuario Trial', role: 'trial',
        plan: 'free', is_trial: true,
        created_at: new Date().toISOString(), is_active: true,
      },
    });
  }));

  // POST /api/auth/logout
  // Triple garantía: blacklist individual + bulk timestamp + Clear-Site-Data al navegador
  app.post('/api/auth/logout', authenticateToken, tryCatch(async (req, res) => {
    const rawToken = req.headers.authorization.slice(7);

    // 1. Revocar token individual: añade al revokedSet (memoria O(1)) y persiste en BD
    const payload = jwt.decode(rawToken);
    const expiresAt = payload?.exp ?? Math.floor(Date.now() / 1000) + 3600;
    await revokeToken(rawToken, req.userId, expiresAt, runSql);

    // 2. Invalidación bulk: todos los tokens con iat < NOW() quedan rechazados
    await revokeUserSession(req.userId, runSql);

    // 3. Purgar datos de sesión en el navegador (cookies HTTP-only + Web Storage)
    res.setHeader('Clear-Site-Data', '"cookies", "storage"');
    res.json({ success: true, message: 'Sesión cerrada' });
  }));

   // POST /api/report-error
   app.post('/api/report-error', authenticateToken, tryCatch(async (req, res) => {
     const { message, url } = req.body;
     if (!message) {
       return res.status(400).json({ success: false, message: 'Message required' });
     }
     // In a real implementation, you would store this in a database or send it to a logging service
     console.error('[Error Report]', { userId: req.userId, message, url, timestamp: new Date().toISOString() });
     res.json({ success: true, message: 'Error report submitted' });
   }));

  // PUT /api/auth/me
  app.put('/api/auth/me', authenticateToken, tryCatch(async (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ success: false, message: 'nombre requerido' });
    await runSql('UPDATE usuarios SET nombre = ? WHERE id = ?', [nombre.trim(), req.userId]);
    res.json({ success: true, message: 'Perfil actualizado' });
  }));

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', authenticateToken, tryCatch(async (req, res) => {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password) return res.status(400).json({ success: false, message: 'Campos requeridos' });
    const user = await getRow('SELECT password_hash FROM usuarios WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    const valid = await verifyPassword(old_password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Contraseña actual incorrecta' });
    const newHash = await hashPassword(new_password);
    await runSql('UPDATE usuarios SET password_hash = ? WHERE id = ?', [newHash, req.userId]);
    await runSql('UPDATE usuarios SET tokens_invalidated_at = NOW() WHERE id = ?', [req.userId]);
    res.json({ success: true, message: 'Contraseña actualizada' });
  }));

  // POST /api/auth/forgot-password — envía email real si Brevo está configurado
  app.post('/api/auth/forgot-password', tryCatch(async (req, res) => {
    const { email } = req.body;
    // Respuesta idéntica exista o no el email (no revela enumeración de usuarios)
    res.json({ success: true, message: 'Si el email existe, recibirás un correo de recuperación' });
    if (!email) return;
    try {
      const user = await getRow('SELECT id, email FROM usuarios WHERE email = ? AND deleted_at IS NULL', [email.trim().toLowerCase()]);
      if (!user) return;
      // Token de reset = JWT de 1 hora
      const resetToken = jwt.sign({ sub: user.id, purpose: 'password_reset' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
      await emailAdapter.sendPasswordReset(user.email, resetLink);
    } catch (e) {
      console.error('[forgot-password] Error enviando email:', e.message);
    }
  }));

  // POST /api/auth/validate-action
  app.post('/api/auth/validate-action', authenticateToken, tryCatch(async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'Password requerido' });
    const user = await getRow('SELECT password_hash FROM usuarios WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'CREDENCIALES INVÁLIDAS · ACCESO DENEGADO.' });
    res.json({ success: true });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // CREDENTIALS
  // ════════════════════════════════════════════════════════════════════════════

  // GET /api/credentials/status
  app.get('/api/credentials/status', authenticateToken, tryCatch(async (req, res) => {
    const cred = await getRow('SELECT api_key_enc FROM user_credentials WHERE user_id = ?', [req.userId]);
    res.json({ success: true, hasCredentials: !!(cred?.api_key_enc) });
  }));

  // POST /api/credentials
  app.post('/api/credentials', authenticateToken, tryCatch(async (req, res) => {
    const { apiKey, notebookKey } = req.body;
    if (!apiKey) return res.status(400).json({ success: false, message: 'apiKey requerido' });
    const id = crypto.randomUUID();
    const enc = process.env.ENCRYPTION_KEY || JWT_SECRET;
    const apiKeyEnc = encryptKey(apiKey, enc);
    const nbKeyEnc = notebookKey ? encryptKey(notebookKey, enc) : null;
    const existing = await getRow('SELECT id FROM user_credentials WHERE user_id = ?', [req.userId]);
    if (existing) {
      await runSql('UPDATE user_credentials SET api_key_enc = ?, notebook_key_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [apiKeyEnc, nbKeyEnc, req.userId]);
    } else {
      await runSql('INSERT INTO user_credentials (id, user_id, api_key_enc, notebook_key_enc) VALUES (?, ?, ?, ?)', [id, req.userId, apiKeyEnc, nbKeyEnc]);
    }
    res.json({ success: true, message: 'Credenciales guardadas' });
  }));

  // DELETE /api/credentials/:servicio
  app.delete('/api/credentials/:servicio', authenticateToken, tryCatch(async (req, res) => {
    await runSql('DELETE FROM user_credentials WHERE user_id=? AND service=?', [req.userId, req.params.servicio]);
    res.json({ success: true });
  }));

  // GET /api/credenciales/validar (alias legacy)
  app.get('/api/credenciales/validar', authenticateToken, tryCatch(async (req, res) => {
    const cred = await getRow('SELECT api_key_enc FROM user_credentials WHERE user_id = ?', [req.userId]);
    res.json({ success: true, valid: !!(cred?.api_key_enc) });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // CONVOCATORIAS
  // ════════════════════════════════════════════════════════════════════════════

  // GET /api/convocatorias
  app.get('/api/convocatorias', radarCacheMiddleware, tryCatch(async (req, res) => {
    const { q, estado, sector, pais, entidad_id, rastreo, page = 1, limit = 50 } = req.query;

    // Construir cláusula WHERE compartida para datos y COUNT
    let where = 'WHERE c.deleted_at IS NULL';
    const params = [];
    if (rastreo === '1') { where += " AND c.fuente = 'RASTREO_DIRECTORIO'"; }
    if (rastreo === '2') { where += " AND c.fuente = 'RASTREO_WEB_EXTERNO'"; }
    if (q)          { where += ' AND (c.titulo ILIKE ? OR c.donante ILIKE ? OR c.descripcion ILIKE ?)'; const like = `%${q}%`; params.push(like, like, like); }
    if (entidad_id) { where += ' AND c.entidad_id = ?'; params.push(entidad_id); }
    // Siempre ocultar cerradas. Reglas:
    //   · Con fecha_limite: solo si no ha vencido
    //   · Sin fecha_limite: solo si fue ingresada en el último año (evita registros viejos sin fecha)
    const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const baseAbierta = ` AND c.estado = 'abierta' AND (
      (COALESCE(c.fecha_limite,'') != '' AND c.fecha_limite >= '${hoy}')
      OR
      (COALESCE(c.fecha_limite,'') = '' AND c.created_at >= NOW() - INTERVAL '1 year')
    )`;
    if (estado === 'nueva') {
      // Nueva = abierta + ingresada en los últimos 7 días
      where += baseAbierta + ` AND c.created_at >= NOW() - INTERVAL '7 days'`;
    } else {
      // 'abierta', 'todos' o sin estado → todas las abiertas no vencidas
      where += baseAbierta;
    }
    if (sector && sector !== 'Todos') {
      // Acepta un valor único o lista separada por comas (multi-selección)
      const sectorList = String(sector).split(',').map(s => s.trim()).filter(Boolean);
      if (sectorList.length === 1) {
        where += ' AND c.sectores ILIKE ?'; params.push(`%${sectorList[0]}%`);
      } else if (sectorList.length > 1) {
        where += ` AND (${sectorList.map(() => 'c.sectores ILIKE ?').join(' OR ')})`;
        sectorList.forEach(s => params.push(`%${s}%`));
      }
    }
    if (pais   && pais   !== 'Todos') { where += ' AND (c.paises_elegibles ILIKE ? OR de.pais ILIKE ?)'; params.push(`%${pais}%`, `%${pais}%`); }

    // COUNT total sin LIMIT
    const countSql = `SELECT COUNT(*) AS cnt FROM convocatorias c LEFT JOIN directorio_entidades de ON de.id = c.entidad_id ${where}`;
    const totalRow = await getRow(countSql, params);
    const total = Number(totalRow?.cnt ?? 0);

    // Query de datos con ORDER + LIMIT + OFFSET
    const dataSql = `SELECT c.*, de.nombre AS entidad_nombre, de.sigla AS entidad_sigla, de.tipo AS entidad_tipo, de.pais AS entidad_pais FROM convocatorias c LEFT JOIN directorio_entidades de ON de.id = c.entidad_id ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    const dataParams = [...params, Number(limit), (Number(page) - 1) * Number(limit)];
    const rows = await getRows(dataSql, dataParams);
    res.json({ success: true, data: rows, total, page: Number(page), limit: Number(limit) });
  }));

  // GET /api/convocatorias/meta — valores distintos de pais y sector para filtros
  app.get('/api/convocatorias/meta', tryCatch(async (req, res) => {
    const sectoresRows = await getRows(
      `SELECT DISTINCT sectores FROM convocatorias WHERE deleted_at IS NULL AND sectores != '[]' AND sectores != '' LIMIT 200`,
      []
    );
    const paisesRows = await getRows(
      `SELECT DISTINCT paises_elegibles FROM convocatorias WHERE deleted_at IS NULL AND paises_elegibles != '[]' AND paises_elegibles != '' LIMIT 200`,
      []
    );
    const sectoresSet = new Set();
    for (const r of sectoresRows) {
      try { for (const s of JSON.parse(r.sectores)) sectoresSet.add(String(s).trim()); } catch {}
    }
    const paisesSet = new Set();
    for (const r of paisesRows) {
      try { for (const p of JSON.parse(r.paises_elegibles)) paisesSet.add(String(p).trim()); } catch {}
    }
    res.json({
      success: true,
      sectores: [...sectoresSet].filter(Boolean).sort(),
      paises:   [...paisesSet].filter(Boolean).sort(),
    });
  }));

  // GET /api/estadisticas
  app.get('/api/estadisticas', tryCatch(async (req, res) => {
    const total = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE deleted_at IS NULL');
    const abiertas = await getCount("SELECT COUNT(*) as cnt FROM convocatorias WHERE estado = 'abierta' AND deleted_at IS NULL");
    const nuevas = await getCount("SELECT COUNT(*) as cnt FROM convocatorias WHERE estado = 'nueva' AND deleted_at IS NULL");
    const entidades = await getCount('SELECT COUNT(*) as cnt FROM directorio_entidades WHERE deleted_at IS NULL');
    res.json({ success: true, data: { total_convocatorias: total, convocatorias_abiertas: abiertas, convocatorias_nuevas: nuevas, total_entidades: entidades } });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // DIRECTORIO / ENTIDADES
  // ════════════════════════════════════════════════════════════════════════════

  // GET /api/entidades — incluye convocatorias_count por entidad
  app.get('/api/entidades', tryCatch(async (req, res) => {
    const { q, tipo, pais, page = 1, limit = 50 } = req.query;
    let sql = `SELECT de.*,
      (SELECT COUNT(*) FROM convocatorias c
       WHERE c.entidad_id = de.id AND c.deleted_at IS NULL) AS convocatorias_count
      FROM directorio_entidades de
      WHERE de.deleted_at IS NULL`;
    const params = [];
    if (q) { sql += ' AND (de.nombre LIKE ? OR de.sigla LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
    if (tipo) { sql += ' AND de.tipo = ?'; params.push(tipo); }
    if (pais) { sql += ' AND de.pais = ?'; params.push(pais); }
    sql += ' ORDER BY de.nombre ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));
    const rows = await getRows(sql, params);
    res.json({ success: true, data: rows });
  }));

  // DELETE /api/entidades/:id — soft-delete (preserva historial)
  app.delete('/api/entidades/:id', authenticateToken, tryCatch(async (req, res) => {
    const { id } = req.params;
    const result = await runSql(
      "UPDATE directorio_entidades SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    res.json({ success: true });
  }));

  // GET /api/entidades/:id/convocatorias — convocatorias vinculadas a una entidad
  app.get('/api/entidades/:id/convocatorias', tryCatch(async (req, res) => {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const rows = await getRows(
      `SELECT c.*, de.nombre AS entidad_nombre, de.sigla AS entidad_sigla
       FROM convocatorias c
       LEFT JOIN directorio_entidades de ON de.id = c.entidad_id
       WHERE c.entidad_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [id, Number(limit), (Number(page) - 1) * Number(limit)]
    );
    const total = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE entidad_id = ? AND deleted_at IS NULL', [id]);
    res.json({ success: true, data: rows, total });
  }));

  // POST /api/entidades/:id/rastrear — vincula convocatorias existentes y dispara ingesta (sin auth — ruta pública)
  app.post('/api/entidades/:id/rastrear', tryCatch(async (req, res) => {
    const { id } = req.params;
    const entidad = await getRow('SELECT * FROM directorio_entidades WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!entidad) return res.status(404).json({ success: false, message: 'Entidad no encontrada' });

    // Vincula convocatorias existentes sin entidad_id que coincidan por donante
    let vinculadas = 0;
    if (entidad.nombre) {
      const r1 = await runSql(
        `UPDATE convocatorias SET entidad_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE entidad_id IS NULL AND deleted_at IS NULL
           AND (LOWER(donante) LIKE ? OR LOWER(donante) = LOWER(?))`,
        [id, `%${entidad.nombre.toLowerCase()}%`, entidad.nombre]
      );
      vinculadas += r1?.changes || 0;
    }
    if (entidad.sigla) {
      const r2 = await runSql(
        `UPDATE convocatorias SET entidad_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE entidad_id IS NULL AND deleted_at IS NULL
           AND LOWER(donante) = LOWER(?)`,
        [id, entidad.sigla]
      );
      vinculadas += r2?.changes || 0;
    }

    // Dispara ingesta global en background (no bloquea)
    runManualIngest().catch(e => console.error('[Rastrear] ingesta:', e.message));

    const total = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE entidad_id = ? AND deleted_at IS NULL', [id]);
    res.json({ success: true, message: 'Rastreo iniciado', entidad_id: id, convocatorias_count: total, nuevas_vinculadas: vinculadas });
  }));

  // PATCH /api/entidades/:id/status — activa o deshabilita una entidad
  app.patch('/api/entidades/:id/status', authenticateToken, tryCatch(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({ success: false, message: 'status debe ser "active" o "disabled"' });
    }
    await runSql(
      "UPDATE directorio_entidades SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
      [status, id]
    );
    res.json({ success: true, status });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // FAVORITES
  // ════════════════════════════════════════════════════════════════════════════

  // GET /api/favorites
  app.get('/api/favorites', authenticateToken, tryCatch(async (req, res) => {
    const rows = await getRows('SELECT id, grant_id, grant_data, saved_at FROM user_favorites WHERE user_id = ? ORDER BY saved_at DESC', [req.userId]);
    res.json({ success: true, data: rows });
  }));

  // POST /api/favorites
  app.post('/api/favorites', authenticateToken, tryCatch(async (req, res) => {
    const { grant_id, grant_data } = req.body;
    if (!grant_id) return res.status(400).json({ success: false, message: 'grant_id requerido' });
    const id = crypto.randomUUID();
    try {
      await runSql(
        'INSERT INTO user_favorites (id, user_id, grant_id, grant_data) VALUES (?, ?, ?, ?)',
        [id, req.userId, grant_id, JSON.stringify(grant_data || {})]
      );
      res.status(201).json({ success: true, message: 'Guardado en favoritos', id });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ success: false, message: 'Ya está en favoritos' });
      throw err;
    }
  }));

   // DELETE /api/favorites/:grantId
   app.delete('/api/favorites/:grantId', authenticateToken, tryCatch(async (req, res) => {
     await runSql('DELETE FROM user_favorites WHERE user_id = ? AND grant_id = ?', [req.userId, req.params.grantId]);
     res.json({ success: true, message: 'Eliminado de favoritos' });
   }));

   // POST /api/convocatorias/:id/favorito - Toggle favorite status for a convocatoria
   app.post('/api/convocatorias/:id/favorito', authenticateToken, tryCatch(async (req, res) => {
     const convocatoriaId = req.params.id;
     const userId = req.userId;

     // Check if already in favorites
     const existing = await getRow('SELECT id FROM user_favorites WHERE user_id = ? AND grant_id = ?', [userId, convocatoriaId]);

     let isFavorito = false;
     if (existing) {
       // Remove from favorites
       await runSql('DELETE FROM user_favorites WHERE user_id = ? AND grant_id = ?', [userId, convocatoriaId]);
       isFavorito = false;
     } else {
       // Add to favorites
       const grantData = JSON.stringify({ tipo: 'convocatoria', id: convocatoriaId });
       await runSql(
         'INSERT INTO user_favorites (id, user_id, grant_id, grant_data) VALUES (?, ?, ?, ?)',
         [crypto.randomUUID(), userId, convocatoriaId, grantData]
       );
       isFavorito = true;
     }

     res.json({ success: true, favorito: isFavorito });
   }));

  // ════════════════════════════════════════════════════════════════════════════
  // IMPORT (subida de archivos)
  // ════════════════════════════════════════════════════════════════════════════
  const multer = (await import('multer')).default;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  app.post('/api/importar', authenticateToken, upload.single('file'), tryCatch(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Archivo requerido' });
    const { tipo = 'convocatorias' } = req.body;
    const rows = await parseFileBuffer(req.file.buffer, req.file.originalname);
    let imported = 0;
    if (tipo === 'directorio') {
      imported = await importToDirectorio(rows);
    } else {
      imported = await importToConvocatorias(rows);
    }
    res.json({ success: true, message: `${imported} registros importados`, count: imported });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEDULER / ADMIN STUBS (responden 200 para no crashear el frontend)
  // ════════════════════════════════════════════════════════════════════════════

  app.post('/api/scheduler/now', authenticateToken, tryCatch(async (req, res) => {
    try { await runManualIngest(); } catch {}
    res.json({ success: true, message: 'Ingesta iniciada' });
  }));

  app.get('/api/radar/status', authenticateToken, tryCatch(async (_req, res) => {
    const usePg = !!process.env.DATABASE_URL;
    let vectorStats = { enabled: false, convocatorias_total: 0, convocatorias_indexadas: 0, proyectos_indexados: 0, cobertura_pct: 0 };
    if (usePg) {
      try {
        const extRow  = await getRow("SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'");
        const cTotal  = await getCount('SELECT COUNT(*) AS cnt FROM convocatorias WHERE deleted_at IS NULL');
        const cIdx    = await getCount('SELECT COUNT(*) AS cnt FROM convocatorias WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL');
        const pIdx    = await getCount('SELECT COUNT(*) AS cnt FROM proyectos WHERE embedding_vec IS NOT NULL');
        vectorStats   = { enabled: !!extRow, convocatorias_total: cTotal, convocatorias_indexadas: cIdx, proyectos_indexados: pIdx, cobertura_pct: cTotal > 0 ? Math.round((cIdx / cTotal) * 100) : 0 };
      } catch {}
    }
    res.json({
      success: true, active: usePg && vectorStats.enabled,
      infraestructura: {
        motor_db:          usePg ? 'PostgreSQL (Neon) + pgvector' : 'SQLite (desarrollo local)',
        embeddings_model:  'Google Gemini text-embedding-004 · 768 dims',
        google_api_activa: !!process.env.GOOGLE_API_KEY,
        busqueda_vectorial: vectorStats,
      },
    });
  }));
  app.post('/api/radar/start',   authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Scheduler de radar no implementado en esta versión.' }));
  app.post('/api/radar/stop',    authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Scheduler de radar no implementado en esta versión.' }));
  app.post('/api/radar/trigger', tryCatch(async (req, res) => {
    runManualIngest().catch(e => console.error('[Radar/trigger]', e.message));
    res.json({ success: true, message: 'Rastreo 2 iniciado — portales web externos al Directorio. Los resultados aparecerán en segundos.' });
  }));

  // Rastreo 1: escaneo de convocatorias desde cada entidad del Directorio
  app.post('/api/radar/rastreo1', tryCatch(async (req, res) => {
    ingestDirectorioConvocatorias().catch(e => console.error('[Radar/rastreo1]', e.message));
    res.json({ success: true, message: 'Rastreo 1 iniciado — visitando entidades del Directorio. Los resultados aparecerán en segundos.' });
  }));

  app.post('/api/radar/barrido', authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Usa POST /api/radar/barrido-masivo con { texto } para búsqueda vectorial.' }));
  app.post('/api/radar/buscar-masivo', authenticateToken, requireAccess('radar'), aiLimiter, tryCatch(async (req, res) => {
    const { texto, limit = 20, threshold = 0.30 } = req.body;
    if (!texto?.trim()) return res.status(400).json({ success: false, message: 'texto requerido' });
    const qVec   = await textToEmbedding(texto.trim());
    const vecStr = JSON.stringify(qVec); // "[0.1,-0.45,...]" — compatible con pgvector
    const usePg  = !!process.env.DATABASE_URL;
    const lim    = Math.min(Number(limit) || 20, 50);
    const thr    = Number(threshold) || 0.30;
    let resultados = [];
    if (usePg) {
      resultados = await getRows(
        `SELECT id, titulo, donante, descripcion, monto_min, monto_max, fecha_limite, estado,
                round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
         WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL AND estado != 'cerrada'
           AND (1 - (embedding_vec <=> $1::vector)) >= $2
         ORDER BY embedding_vec <=> $1::vector
         LIMIT $3`,
        [vecStr, thr, lim]
      );
    } else {
      const convs = await getRows("SELECT id, titulo, donante, descripcion, monto_min, monto_max, fecha_limite, estado, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL AND estado != 'cerrada'", []);
      resultados = convs
        .map(c => ({ ...c, embedding: undefined, similitud: Math.round(cosineSimilarity(qVec, deserializeEmbedding(c.embedding)) * 10000) / 10000 }))
        .filter(c => c.similitud >= thr)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, lim);
    }
    res.json({ success: true, resultados, total: resultados.length, motor: usePg ? 'pgvector·HNSW' : 'js-coseno' });
  }));
  app.get('/api/radar/buscar', (req, res) => res.status(501).json({ success: false, message: 'No implementado' }));
  app.get('/api/buscar', (req, res) => res.status(501).json({ success: false, message: 'No implementado' }));
  app.get('/api/fuentes', (req, res) => res.status(501).json({ success: false, message: 'No implementado' }));
  app.get('/api/scraped-results', (req, res) => res.status(501).json({ success: false, message: 'No implementado' }));
  app.post('/api/entidades/scrape-async', authenticateToken, (req, res) => res.status(501).json({ success: false, message: 'No implementado' }));
  app.post('/api/entidades/indexadas', authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Indexación manual de entidades no implementada.' }));
  app.get('/api/cola-validacion',      authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Cola de validación no implementada en esta versión.' }));
  app.post('/api/cola-validacion/:id/aprobar',   authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Cola de validación no implementada.' }));
  app.post('/api/cola-validacion/:id/descartar', authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Cola de validación no implementada.' }));
  // Proyectos (GET/POST/PATCH/:id gestionados por proyectos.routes.js)
  app.get('/api/admin/deleted',             authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Papelera administrativa no implementada.' }));
  app.post('/api/admin/restore/:tipo/:id',  authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Restauración administrativa no implementada.' }));
  app.post('/api/ia/chat', (req, res) => res.json({ success: true, response: 'IA no disponible en este plan.' }));
  app.post('/api/ia/busqueda-semantica', authenticateToken, aiLimiter, tryCatch(async (req, res) => {
    const { texto, limit = 10, threshold = 0.25 } = req.body;
    if (!texto?.trim()) return res.status(400).json({ success: false, message: 'texto requerido' });
    const qVec   = await textToEmbedding(texto.trim());
    const vecStr = JSON.stringify(qVec);
    const usePg  = !!process.env.DATABASE_URL;
    const lim    = Math.min(Number(limit) || 10, 20);
    const thr    = Number(threshold) || 0.25;
    let data = [];
    if (usePg) {
      data = await getRows(
        `SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado,
                round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
         WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL
           AND (1 - (embedding_vec <=> $1::vector)) >= $2
         ORDER BY embedding_vec <=> $1::vector LIMIT $3`,
        [vecStr, thr, lim]
      );
    } else {
      const convs = await getRows("SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL", []);
      data = convs
        .map(c => ({ ...c, embedding: undefined, similitud: Math.round(cosineSimilarity(qVec, deserializeEmbedding(c.embedding)) * 10000) / 10000 }))
        .filter(c => c.similitud >= thr)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, lim);
    }
    res.json({ success: true, data, total: data.length, motor: usePg ? 'pgvector' : 'js-coseno' });
  }));
  app.post('/api/ia/buscar',                (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Usa POST /api/ia/busqueda-semantica.' }));
  app.post('/api/ai/convocatoria-analyze',  (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Análisis de convocatoria no implementado.' }));
  app.post('/api/triggers/run-with-context', authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Triggers contextuales no implementados.' }));
  app.post('/api/configuracion/guardar',    authenticateToken, (req, res) => res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'Configuración persistente no implementada.' }));
  app.post('/api/radar/barrido-masivo', authenticateToken, requireAccess('radar'), aiLimiter, tryCatch(async (req, res) => {
    const { texto, proyectoId, limit = 50, threshold = 0.25 } = req.body;
    if (!texto?.trim() && !proyectoId) return res.status(400).json({ success: false, message: 'texto o proyectoId requerido' });
    let qVec;
    if (proyectoId) {
      const proy = await getRow('SELECT embedding FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, req.userId]);
      if (!proy) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
      qVec = proy.embedding ? deserializeEmbedding(proy.embedding) : null;
    }
    if (!qVec) {
      if (!texto?.trim()) return res.status(400).json({ success: false, message: 'El proyecto no tiene embeddings calculados — provee texto de búsqueda' });
      qVec = await textToEmbedding(texto.trim());
    }
    const vecStr = JSON.stringify(qVec);
    const usePg  = !!process.env.DATABASE_URL;
    const lim    = Math.min(Number(limit) || 50, 500);
    const thr    = Number(threshold) || 0.25;
    let resultados = [];
    if (usePg) {
      resultados = await getRows(
        `SELECT id, titulo, donante, descripcion, monto_min, monto_max, fecha_limite, estado, url_convocatoria,
                round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
         WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL AND estado != 'cerrada'
           AND (1 - (embedding_vec <=> $1::vector)) >= $2
         ORDER BY embedding_vec <=> $1::vector
         LIMIT $3`,
        [vecStr, thr, lim]
      );
    } else {
      const convs = await getRows("SELECT id, titulo, donante, descripcion, monto_min, monto_max, fecha_limite, estado, url_convocatoria, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL AND estado != 'cerrada'", []);
      resultados = convs
        .map(c => ({ ...c, embedding: undefined, similitud: Math.round(cosineSimilarity(qVec, deserializeEmbedding(c.embedding)) * 10000) / 10000 }))
        .filter(c => c.similitud >= thr)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, lim);
    }
    res.json({ success: true, resultados, total: resultados.length, motor: usePg ? 'pgvector·HNSW' : 'js-coseno' });
  }));
  app.post('/api/convocatorias/filtros', (req, res) => res.json({ success: true, data: [] }));
  app.put('/api/convocatorias/:id/estado', authenticateToken, tryCatch(async (req, res) => {
    const { estado } = req.body;
    await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ success: true });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // ORQUESTACIÓN IA Y REGLAS DE NEGOCIO (FASE 4)
  // ════════════════════════════════════════════════════════════════════════════

  // F4-02: CRITICAL_DESIGN_EXCEPTION
  app.post('/api/formulador/validar-estructura', authenticateToken, rejectMaterialsInput, tryCatch(async (req, res) => {
    const { proyectoId, elementos } = req.body;
    if (!proyectoId || !Array.isArray(elementos)) {
      return res.status(400).json({ success: false, message: 'proyectoId y elementos[] requeridos' });
    }
    const { valid, exceptions } = validateStructuralElements(elementos, proyectoId);
    if (!valid) {
      // Stub para tabla proyectos no existente
      try {
        await runSql(
          "UPDATE proyectos SET estado = 'BLOQUEADO', bloqueo_razon = ? WHERE id = ?",
          ['CRITICAL_DESIGN_EXCEPTION: columnas en zonas de circulación', proyectoId]
        );
      } catch (e) { if (!e.message?.includes('does not exist')) logger.warn('[Bloqueo] error inesperado', { err: e.message }); }
      
      return res.status(422).json({
        success: false,
        code: 'CRITICAL_DESIGN_EXCEPTION',
        message: 'Se detectaron columnas en zonas de circulación. El pipeline está suspendido hasta resolución manual.',
        exceptions,
      });
    }
    res.json({ success: true, message: 'Validación estructural aprobada', proyectoId });
  }));

  // F4-03: Módulo 3b - Árbol de Objetivos (usa la API key del usuario o la del sistema)
  app.post('/api/modulo3b/arbol/generar', authenticateToken, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const { proyectoId, objetivoCentral } = req.body;
    if (!proyectoId || !objetivoCentral) return res.status(400).json({ success: false, message: 'proyectoId y objetivoCentral requeridos' });
    const apiKey = await resolveGoogleApiKey(req.userId, getRow);
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        code: 'IA_NO_DISPONIBLE',
        message: 'El módulo de inteligencia artificial no está disponible. Configura tu API key en Ajustes o contacta al administrador.',
      });
    }
    const nodos = await generarArbolConIA(objetivoCentral, apiKey);
    res.json({ success: true, data: nodos });
  }));
  app.post('/api/modulo3b/arbol/:proyectoId/confirmar', authenticateToken, tryCatch(async (req, res) => {
    await runSql('UPDATE objetivos_arbol SET confirmado = 1 WHERE proyecto_id = ?', [req.params.proyectoId]);
    res.json({ success: true });
  }));

  // F4-04: Módulo 7 - Match Score Pipeline (requiere plan formulador + GOOGLE_API_KEY)
  app.post('/api/modulo7/match/:proyectoId', authenticateToken, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const apiKey = await resolveGoogleApiKey(req.userId, getRow);
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        code: 'IA_NO_DISPONIBLE',
        message: 'El módulo de Match Score requiere Google API Key. Configura tu clave en Ajustes o contacta al administrador.',
      });
    }
    // SECURITY FIX: verificar ownership antes de pasar al pipeline
    const ownerCheck = await getRow(
      'SELECT id FROM proyectos WHERE id = ? AND org_id = ?',
      [req.params.proyectoId, req.userId]
    );
    if (!ownerCheck) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    try {
      const results = await runMatchPipeline(req.params.proyectoId, getRow, getRows, runSql);
      res.json({ success: true, data: results });
    } catch (err) {
      if (err.message.includes('PIPELINE_BLOCKED')) {
        return res.status(409).json({ success: false, message: err.message });
      }
      throw err;
    }
  }));

  // F4-05: Módulo 8 - Modularidad y Registro
  app.get('/api/modulo8/agentes', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(401).json({ success: false });
    const agentes = await getRows('SELECT * FROM agentes_registro');
    res.json({ success: true, data: agentes });
  }));
  app.put('/api/modulo8/agentes/:nombre/status', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(401).json({ success: false });
    const { status } = req.body;
    const IMMUTABLE_AGENTS = ['validacion-estructural-v1', 'materials-filter-v1', 'crosscheck-validator-v1'];
    if (IMMUTABLE_AGENTS.includes(req.params.nombre) && status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        code: 'AGENT_IMMUTABLE',
        message: 'Este agente implementa una regla de negocio inmutable y no puede desactivarse.',
      });
    }
    await runSql('UPDATE agentes_registro SET status = ?, actualizado_en = CURRENT_TIMESTAMP WHERE nombre = ?', [status, req.params.nombre]);
    res.json({ success: true });
  }));

  // V8.0 — Suscripciones y Puente M2
  registerSubscriptionRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M4 Motor Dialéctico
  registerMotorDialecticoRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M5 Configuración Logística
  registerConfigLogisticaRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M8 Marco Normativo
  registerMarcoNormativoRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M10 Compliance
  registerComplianceRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M12 Ficha Técnica Maestra (Hash SHA-256)
  registerFichaTecnicaRoutes(app, { authenticateToken, runSql, getRow, getRows, tryCatch });

  // Scraping portales oficiales (Minciencias, etc.)
  registerScraperRoutes(app, authenticateToken);

  // Proyectos CRUD con RLS por org_id
  registerProyectosRoutes(app, { authenticateToken, runSql, getRow, getRows });

  // M4: Presupuesto APU por proyecto
  registerPresupuestoRoutes(app, { authenticateToken, runSql, getRow, getRows });

  // F5-01: Módulo 9 — Cross-Check Pipeline & Radicación
  registerRadicacionRoutes(app, { authenticateToken, runSql, getRow });

  // F5-02: Módulo 9 — Exportación Certificada (reporte PDF SSR)
  registerReporteRoutes(app, { authenticateToken, getRow });

  // Google Auth routes
  registerGoogleAuthRoutes(app, { authenticateToken, runSql, getRow, encryptKey, JWT_SECRET });

  // ════════════════════════════════════════════════════════════════════════════
  // FRONTEND ESTÁTICO — DEBE IR AL FINAL (Express 5: '/{*path}')
  // ════════════════════════════════════════════════════════════════════════════
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { etag: false, index: false }));
    // Express 5 requiere '/{*path}' — NO usar '*' (ver AGENTS.md commit 1dd5bfd)
    app.get('/{*path}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    console.warn('[server] dist/ no encontrado — solo API disponible');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Activo en puerto ${PORT}`);
    // Activar cron de actualización diaria de convocatorias (02:00 COT)
    try { startScheduler(); } catch (e) { console.error('[server] startScheduler error:', e.message); }
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
