import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { loadEnv } from './backend/env-loader.js';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { authLimiter, sanitizeAuthBody, COOKIE_OPTIONS, trialLimiter, aiLimiter, slowDown, financialPipelineLimiter } from './backend/middlewares/SecurityMiddleware.js';
import { authenticateToken, requireAdmin } from './backend/middlewares/auth.middleware.js';
import { seedDirectorio } from './backend/pipeline/DataIngestor.js';
import { startScheduler, runManualIngest, pauseScheduler, resumeScheduler } from './backend/pipeline/CronScheduler.js';
import { classifySectors } from './backend/services/sectorClassifier.js';
import { ingestDirectorioConvocatorias } from './backend/pipeline/EntityScraper.js';
import { parseFileBuffer, importToDirectorio, importToConvocatorias } from './backend/pipeline/FileImporter.js';
import { encryptKey, decryptKey } from './backend/pipeline/CryptoHelper.js';
import {
  registerGoogleAuthRoutes,
  getGoogleAccessToken,
  GEMINI_SYSTEM_INSTRUCTIONS,
} from './backend/routes/authGoogle.controller.js';
import { emailAdapter } from './backend/notifications/BrevoEmailAdapter.js';
import { pool, getRow, getRows, getCount, runSql, runTransaction } from './backend/db.js';
import { dbStatus, withTenant } from './backend/config/database.config.js';
import { getApexDomain, extractRootDomain } from './backend/utils/domainUtils.js';
import { fetchResiliente } from './backend/utils/resilientFetch.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiCB, isQuotaError, AI_LIMIT_EXCEEDED_RESPONSE } from './backend/services/geminiCircuitBreaker.js';
import { stripeWebhookHandler } from './backend/routes/stripe.webhook.js';
import { wompiWebhookHandler } from './backend/routes/wompi.webhook.js';
import { isRevoked, checkSessionValid, checkAccountStatus, revokeToken, revokeUserSession, initBlacklist, purgeExpiredTokens } from './backend/middlewares/tokenBlacklist.js';
import { seedPredios } from './backend/pipeline/seed-predios.js';
import { rejectMaterialsInput } from './backend/middlewares/materialValidator.js';
import { logger } from './backend/utils/logger.js';
import { validateStructuralElements } from './backend/validators/structuralValidator.js';
import { generarArbolConIA } from './backend/agents/arbolObjetivosAgent.js';
import { runMatchPipeline } from './backend/pipeline/matchScore.js';
import { calcularScoringDinamico } from './backend/services/scoringDinamico.js';
import { calcularViabilidadIA, recolectarContextoViabilidad } from './backend/services/viabilidadAgent.js';
import { generarEnfoqueEntidad } from './backend/services/enfoqueEntidadAgent.js';
import { textToEmbedding, cosineSimilarity, deserializeEmbedding } from './backend/services/embeddingsService.js';
import { registerRadicacionRoutes } from './backend/routes/radicacion.routes.js';
import { registerProyectosRoutes } from './backend/routes/proyectos.routes.js';
import { registerReporteRoutes } from './backend/routes/reporte.routes.js';
import { registerPresupuestoRoutes } from './backend/routes/presupuesto.routes.js';
import { registerAnexosRoutes } from './backend/routes/anexos.routes.js';
import { registerBibliotecaRoutes } from './backend/routes/biblioteca.routes.js';
import { registerEstresFinancieroRoutes } from './backend/routes/estresFinanciero.routes.js';
import { registerValorExponencialRoutes } from './backend/routes/valorExponencial.routes.js';
import { registerCopilotoRoutes } from './backend/routes/copiloto.routes.js';
import { registerEntradaIARoutes } from './backend/routes/entradaIA.routes.js';
import { radarCacheMiddleware, invalidateRadarCache } from './backend/middlewares/radarCache.js';
import { RENDIMIENTOS_CATALOGO } from './backend/pipeline/apuEngine.js';
import { registerSubscriptionRoutes }    from './backend/routes/subscriptions.routes.js';
import { registerMotorDialecticoRoutes } from './backend/routes/motorDialectico.routes.js';
import { registerConfigLogisticaRoutes } from './backend/routes/configLogistica.routes.js';
import { registerMarcoNormativoRoutes }  from './backend/routes/marcoNormativo.routes.js';
import { registerComplianceRoutes }      from './backend/routes/compliance.routes.js';
import { registerFichaTecnicaRoutes }    from './backend/routes/fichaTecnica.routes.js';
import { registerExportacionRoutes }     from './backend/routes/exportacion.routes.js';
import { registerScraperRoutes }         from './backend/routes/scraper.routes.js';
import { sweepEndsWith }                  from './backend/services/sweepService.js';

const require = createRequire(import.meta.url);
loadEnv();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import dinámico + init explícito: debe correr DESPUÉS de loadEnv() para que
// SENTRY_DSN ya esté disponible en process.env (ver comentario en el propio
// archivo — un import estático aquí arriba se evaluaría antes de loadEnv()).
const { initSentry, captureError: sentryCaptureError } = await import('./backend/config/sentry.config.js');
initSentry();

// ── Resiliencia del proceso — previene muertes silenciosas del servidor ────────
process.on('uncaughtException', (err) => { console.error('[Fatal] Uncaught Exception:', err); sentryCaptureError(err); });
process.on('unhandledRejection', (reason) => { console.error('[Fatal] Unhandled Rejection:', reason); sentryCaptureError(reason); });

// ── Configuración y Seguridad ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET;

// Usuario de desarrollo para 'demo-mode-token' (solo NODE_ENV !== 'production').
// UUID fijo y reconocible (todo ceros salvo el último dígito) — nunca debe
// existir con este id en una base de datos de producción real. Sembrado en
// 015_seed_dev_user.sql y en el bootstrap de abajo (gateado a no-producción).
const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

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

    if ((process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase() === 'wompi') {
      if (!process.env.WOMPI_PUBLIC_KEY)      warnings.push('PAYMENT_PROVIDER=wompi pero WOMPI_PUBLIC_KEY no configurada — el checkout no se puede generar.');
      if (!process.env.WOMPI_INTEGRITY_SECRET) warnings.push('PAYMENT_PROVIDER=wompi pero WOMPI_INTEGRITY_SECRET no configurada — el checkout no se puede firmar.');
      if (!process.env.WOMPI_EVENTS_SECRET)    warnings.push('PAYMENT_PROVIDER=wompi pero WOMPI_EVENTS_SECRET no configurada — el webhook /api/wompi/webhook rechazará todos los eventos.');
    }
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
// authenticateToken (y su helper verifyToken) vivían aquí inline — extraídos a
// backend/middlewares/auth.middleware.js (Operación Bisturí, Grupo Elite,
// 2026-08-06). Import arriba, junto al resto de middlewares.

// Bug real encontrado por tests/e2e/formulador-financiero.spec.ts (2026-08-08):
// AuthContextNew.tsx:234 desestructura `data.subscription` de la respuesta de
// /api/auth/login para decidir a dónde redirigir tras el login
// (LoginPage.tsx:240-252, redirigirTrasLogin) — pero ni /api/auth/login ni
// /api/auth/mfa/challenge la enviaban nunca. Resultado: TODOS los usuarios
// caían al último `else` (SelectionPage) sin importar su plan real, en vez de
// ir directo a /checklist o /radar. Sin fila en user_subscriptions (usuario
// nuevo antes de que el trigger/registro la cree), plan 'free' con ambos
// accesos en false es el resultado correcto — igual que GET /api/subscription.
async function getLoginSubscription(userId, getRowFn) {
  const sub = await getRowFn('SELECT plan, access_radar, access_formulador FROM user_subscriptions WHERE user_id = ?', [userId]);
  return sub
    ? { plan: sub.plan, access_radar: !!sub.access_radar, access_formulador: !!sub.access_formulador }
    : { plan: 'free', access_radar: false, access_formulador: false };
}

// ── setTenantContext ──────────────────────────────────────────────────────────
// Defensa en profundidad para RLS. El JWT actual solo firma `sub` (userId) y
// `role` — no lleva tenant_id/org_id como claim — así que el tenant se resuelve
// aquí a partir del userId ya validado por authenticateToken (nunca de un valor
// enviado por el cliente). Debe encadenarse DESPUÉS de authenticateToken:
//
//   app.post('/ruta', authenticateToken, setTenantContext, tryCatch(async (req, res) => {
//     await req.withTenant(client => client.query('UPDATE projects SET ... WHERE id = $1', [id]));
//   }));
//
// req.withTenant(callback) delega en withTenant() de database.config.js, que
// abre una transacción dedicada y ejecuta `SELECT set_config('app.org_id', $1, TRUE)`
// (equivalente a SET LOCAL) antes de correr el callback — así projects_tenant_rls /
// match_scores_tenant_rls / budgets_tenant_isolation quedan activas para esa
// transacción sin importar si el rol de conexión también tiene privilegios amplios.
//
// LÍMITE CONOCIDO: los helpers compartidos getRow/getRows/runSql (database.config.js)
// usan un pool sin cliente fijo por request, por lo que NO heredan este contexto
// automáticamente. Para quedar protegidas por RLS de verdad, las queries deben
// pasar por req.withTenant(...) en vez de esos helpers globales. Se aplica aquí
// a las rutas que tocan projects/match_scores directamente (validar-estructura,
// modulo7/match); extenderlo al resto de backend/routes/*.js es el siguiente
// paso natural de este endurecimiento, no cubierto por este cambio.
async function setTenantContext(req, res, next) {
  if (!req.userId) return next(); // sin usuario autenticado — nada que fijar

  try {
    const user = await getRow('SELECT tenant_id FROM usuarios WHERE id = ?', [req.userId]);
    req.tenantId = user?.tenant_id || req.userId; // fallback: modelo single-tenant-per-user
  } catch {
    req.tenantId = req.userId; // degradado — nunca bloquear la request por esto
  }

  req.withTenant = (callback) => withTenant(req.tenantId, callback);
  next();
}

function tryCatch(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      logger.error('[server] Error no controlado en ruta', { method: req.method, path: req.path, err: err.message });
      // Sentry solo cubría process.on('uncaughtException'/'unhandledRejection')
      // (crashes fatales) — un error de BD/cálculo atrapado aquí adentro nunca
      // llegaba a ese nivel y quedaba invisible fuera del log local.
      sentryCaptureError(err, { method: req.method, path: req.path, userId: req.userId });
      // Errores de IA por clave faltante → 503 con mensaje claro para el usuario
      if (err.message?.includes('EMBEDDINGS_ERROR') || err.message?.includes('GOOGLE_API_KEY')) {
        return res.status(503).json({
          success: false,
          code: 'IA_NO_DISPONIBLE',
          message: 'El módulo de inteligencia artificial no está disponible en este momento. Contacta al administrador para configurar el servicio.',
        });
      }
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): antes se
      // devolvía err.message crudo al cliente en cualquier error no
      // controlado — confirmado en vivo que un error de tipo Postgres llega
      // íntegro (nombres de constraint, tipos de columna). El logger.error/
      // Sentry de arriba ya capturan el mensaje completo del lado servidor.
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

// Resuelve la API key de IA: primero clave personal del usuario, luego clave del sistema
async function resolveGoogleApiKey(userId, getRow) {
  const systemKey = process.env.GOOGLE_API_KEY || '';
  const cred = await getRow('SELECT api_key_enc FROM user_credentials WHERE user_id = ?', [userId]);
  const enc  = process.env.ENCRYPTION_KEY;
  if (!enc) throw new Error('ENCRYPTION_KEY no configurada — credenciales de usuario no disponibles');
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

// Validación real de fuerza de contraseña — el `minLength={8}` del formulario
// es solo HTML, se salta con una llamada directa a la API. Esta es la que
// de verdad se aplica. Umbral mínimo razonable, sin exigir composición
// específica (mayúscula/símbolo obligatorios generan contraseñas más
// predecibles en la práctica — la longitud importa más).
function validarFortalezaPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (password.length > 128) {
    return 'La contraseña no puede superar los 128 caracteres.';
  }
  return null;
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
      if (err) return reject(err);
      // Comparación de tiempo constante — timingSafeEqual exige buffers del
      // mismo largo; un hash corrupto/con formato distinto ya es inválido
      // por definición, así que ese caso corto-circuita a false sin llegar
      // a comparar (no hay nada secreto que filtrar en esa longitud: viene
      // de datos ya almacenados, no de la entrada del atacante).
      const hashBuf = Buffer.from(hash || '', 'hex');
      const keyBuf  = key;
      if (hashBuf.length !== keyBuf.length) return resolve(false);
      resolve(crypto.timingSafeEqual(keyBuf, hashBuf));
    });
  });
}

// ── Inicialización BD ────────────────────────────────────────────────────────
// FIX (auditoría 2026-08-17, "se cae la red en local"): decenas de líneas
// más abajo hacen "ALTER TABLE x ADD COLUMN y" sin IF NOT EXISTS y confían
// en un try/catch para tragarse el error una vez que la columna ya existe
// (ver nota histórica en la migración de user_id, más abajo: SQLite no
// soporta "ADD COLUMN IF NOT EXISTS", por eso no se usó desde el inicio).
// Confirmado en backend.err.log: cada una de esas ~34 líneas falla en CADA
// arranque con "column X already exists", y cada fallo escala a un
// reintento vía REST (Capa 2, más lento) antes de descartarse — sumando
// ~15-25s reales al arranque (RootIndicator muestra "ROOT OFFLINE" mientras
// tanto). Postgres SÍ soporta IF NOT EXISTS — se usa aquí cuando
// DATABASE_URL está configurado (mismo criterio que USE_PG en otros
// archivos de este repo), preservando el comportamiento original en SQLite.
const PG_ACTIVE_INITDB = !!process.env.DATABASE_URL;
async function addColumnSafe(sql) {
  const finalSql = PG_ACTIVE_INITDB ? sql.replace(/ADD COLUMN\s+/i, 'ADD COLUMN IF NOT EXISTS ') : sql;
  try { await runSql(finalSql); } catch {}
}

async function initDb() {
  // pgvector: habilitar extensión en PostgreSQL para similitud vectorial
  if (process.env.DATABASE_URL) {
    try {
      await runSql('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('[DB] pgvector: extensión vector activa');
    } catch (err) {
      console.warn('[DB] pgvector no disponible (continúa sin índice vectorial):', err.message);
    }
    try {
      await runSql('CREATE EXTENSION IF NOT EXISTS unaccent');
      console.log('[DB] unaccent: extensión activa (búsqueda sin tildes)');
    } catch (err) {
      console.warn('[DB] unaccent no disponible — búsqueda ignorará tildes vía normalización JS:', err.message);
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
    tipo_nodo TEXT CHECK(tipo_nodo IN ('PROBLEMA_CENTRAL','CAUSA','EFECTO','OBJETIVO_GENERAL','OBJETIVO_ESPECIFICO')),
    nivel INTEGER NOT NULL DEFAULT 0,
    texto TEXT NOT NULL,
    parent_id TEXT,
    generado_por_ia INTEGER DEFAULT 0,
    confirmado INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  // Formalización de 'Problema' (013): tabla ya existente antes de esta columna
  await addColumnSafe(`ALTER TABLE objetivos_arbol ADD COLUMN tipo_nodo TEXT CHECK(tipo_nodo IN ('PROBLEMA_CENTRAL','CAUSA','EFECTO','OBJETIVO_GENERAL','OBJETIVO_ESPECIFICO'))`);

  // Anexos externos del proyecto (013) — antes solo en localStorage del cliente
  await runSql(`CREATE TABLE IF NOT EXISTS project_anexos (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    ruta_storage TEXT NOT NULL,
    tipo_mime TEXT NOT NULL,
    tamano_bytes INTEGER NOT NULL DEFAULT 0,
    categoria TEXT CHECK(categoria IN ('legal','financiero','tecnico','institucional','otro')) DEFAULT 'otro',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Indicadores MGA/BPIN estructurados (013) — antes texto libre en ficha_tecnica
  await runSql(`CREATE TABLE IF NOT EXISTS project_indicators (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('Producto','Resultado','Impacto','Gestión')),
    linea_base REAL DEFAULT 0,
    meta_total REAL NOT NULL,
    unidad_medida TEXT NOT NULL,
    fuente_verificacion TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Teoría del Cambio 1:1 con el proyecto (013) — antes campo D_alineacion sin persistir
  await runSql(`CREATE TABLE IF NOT EXISTS project_change_theory (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    tenant_id TEXT NOT NULL,
    insumos TEXT NOT NULL DEFAULT '[]',
    actividades TEXT NOT NULL DEFAULT '[]',
    productos TEXT NOT NULL DEFAULT '[]',
    resultados_corto_plazo TEXT NOT NULL DEFAULT '[]',
    impacto_largo_plazo TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await runSql(`CREATE TABLE IF NOT EXISTS match_scores (
    id TEXT PRIMARY KEY,
    proyecto_id TEXT NOT NULL,
    convocatoria_id TEXT NOT NULL,
    score REAL NOT NULL CHECK(score BETWEEN 0 AND 1),
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
    estado TEXT NOT NULL DEFAULT 'draft'
      CHECK(estado IN ('draft','in_review','needs_human_review','processing',
                        'formulado','Finalizado','BLOQUEADO','archived')),
    bloqueo_razon TEXT,
    -- ficha_tecnica es JSONB nativo desde 037_ficha_tecnica_a_jsonb.sql (antes
    -- TEXT — este CREATE TABLE es lo que realmente enforceaba TEXT en cada
    -- arranque, no 001_postgres_schema.sql; ver esa migración para el porqué).
    -- presupuesto queda TEXT deliberadamente — fuera de alcance de esa migración.
    ficha_tecnica JSONB DEFAULT '{}'::jsonb,
    presupuesto TEXT DEFAULT '{}',
    crosscheck_sello TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES usuarios(id)
  )`);
  // Migraciones de proyectos: agrega columnas ausentes en versiones anteriores del esquema
  await addColumnSafe(`ALTER TABLE proyectos ADD COLUMN user_id TEXT NOT NULL DEFAULT ''`);
  await addColumnSafe(`ALTER TABLE proyectos ADD COLUMN org_id TEXT NOT NULL DEFAULT ''`);
  await addColumnSafe(`ALTER TABLE proyectos ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL`);
  // Backfill: registros anteriores heredan user_id como org_id
  try { await runSql(`UPDATE proyectos SET org_id = user_id WHERE org_id = ''`); } catch {}

  // Migraciones de integridad referencial Convocatorias ↔ Directorio
  await addColumnSafe(`ALTER TABLE convocatorias ADD COLUMN entidad_id TEXT`);
  await addColumnSafe(`ALTER TABLE directorio_entidades ADD COLUMN status TEXT DEFAULT 'active'`);
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

  // FinOps — consumo de tokens/costo por request de IA (backend/services/aiTokenLogger.js).
  // Sin FK a usuarios(id) a propósito, mismo criterio que admin_audit_log:
  // el historial de consumo debe sobrevivir a una purga de cuenta (Habeas Data).
  await runSql(`CREATE TABLE IF NOT EXISTS ai_token_logs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_name TEXT NOT NULL,
    tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
    cost_cop_estimated NUMERIC(12,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);

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
  await addColumnSafe("ALTER TABLE motor_dialectico  ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  await addColumnSafe("ALTER TABLE config_logistica  ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  await addColumnSafe("ALTER TABLE marco_normativo   ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  await addColumnSafe("ALTER TABLE compliance_data   ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  // Soft-Lock predial (F-Legal-01): 'condicionado' NO bloquea la formulación
  // técnica en paralelo — solo 'despejado' habilita el Hard-Lock final de
  // certificación (ver POST /api/m12/ficha/:proyectoId y
  // POST /api/modulo9/radicar/:proyectoId).
  await addColumnSafe("ALTER TABLE compliance_data ADD COLUMN estado_legal TEXT NOT NULL DEFAULT 'sin_evaluar'");
  try { await runSql("ALTER TABLE compliance_data ADD CONSTRAINT compliance_data_estado_legal_check CHECK (estado_legal IN ('sin_evaluar','condicionado','despejado'))"); } catch {}
  await addColumnSafe("ALTER TABLE versiones_proyecto ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN access_radar INTEGER DEFAULT 0");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN access_formulador INTEGER DEFAULT 0");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN stripe_customer_id TEXT DEFAULT NULL");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN stripe_subscription_id TEXT DEFAULT NULL");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN current_period_end TIMESTAMP DEFAULT NULL");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0");
  await addColumnSafe("ALTER TABLE user_subscriptions ADD COLUMN expires_at TIMESTAMPTZ DEFAULT NULL");
  await addColumnSafe("ALTER TABLE directorio_entidades ADD COLUMN status TEXT DEFAULT 'active'");
  // root_domain — llave relacional normalizada (funding.wellcome.org → wellcome.org)
  await addColumnSafe("ALTER TABLE directorio_entidades ADD COLUMN root_domain TEXT DEFAULT NULL");
  await addColumnSafe("ALTER TABLE convocatorias ADD COLUMN root_domain TEXT DEFAULT NULL");
  // Tabla de idempotencia de webhooks Stripe
  await runSql(`CREATE TABLE IF NOT EXISTS stripe_events (
    stripe_event_id  TEXT        PRIMARY KEY,
    event_type       TEXT        NOT NULL,
    tenant_id        TEXT,
    processed_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    raw_payload      TEXT
  )`);
  await addColumnSafe("ALTER TABLE system_config ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
  await addColumnSafe("ALTER TABLE system_logs  ADD COLUMN nivel TEXT DEFAULT 'ERROR'");
  // Configuración global de la aplicación (clave-valor)
  await runSql(`CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT      PRIMARY KEY,
    value      TEXT      NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  // ELIMINADO 2026-08-02: este DELETE corría en CADA arranque del backend
  // (no era una migración de un solo uso), borrando de forma permanente y
  // sin soft-delete cualquier entidad cuyo id empezara con "funder-" — sin
  // importar si el usuario ya la había validado manualmente en el Directorio,
  // porque validar solo actualiza validation_status, no el id. Con los
  // múltiples reinicios de esta sesión (pm2 restart), esto borró entidades
  // reales y validadas de forma irrecuperable (no hay auditoría de acciones
  // sobre directorio_entidades, solo sobre usuarios). Confirmado: la tabla
  // ya no tiene ninguna fila con id "funder-%" — no queda nada que limpiar,
  // y dejar la línea viva era una mina para cualquier futura colisión de id.
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
  await addColumnSafe('ALTER TABLE proyectos ADD COLUMN embedding TEXT DEFAULT NULL');
  await addColumnSafe('ALTER TABLE convocatorias ADD COLUMN embedding TEXT DEFAULT NULL');

  // pgvector: columnas vector(768) nativas e índices HNSW para búsqueda semántica (PostgreSQL only)
  if (process.env.DATABASE_URL) {
    await addColumnSafe('ALTER TABLE convocatorias ADD COLUMN embedding_vec vector(768)');
    await addColumnSafe('ALTER TABLE proyectos     ADD COLUMN embedding_vec vector(768)');
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
  await addColumnSafe("ALTER TABLE match_scores ADD COLUMN org_id TEXT DEFAULT ''");
  // Migración Google OAuth: columnas faltantes en user_credentials
  await addColumnSafe("ALTER TABLE user_credentials ADD COLUMN service TEXT DEFAULT 'api_key'");
  await addColumnSafe('ALTER TABLE user_credentials ADD COLUMN encrypted_key TEXT DEFAULT NULL');
  await addColumnSafe("ALTER TABLE user_credentials ADD COLUMN label TEXT DEFAULT ''");
  // Migraciones proyectos: columnas que pueden faltar en radar.db de versiones anteriores
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN bloqueo_razon TEXT");
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN ficha_tecnica JSONB DEFAULT '{}'::jsonb");
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN presupuesto TEXT DEFAULT '{}'");
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN crosscheck_sello TEXT DEFAULT NULL");
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN location TEXT DEFAULT ''");
  await addColumnSafe("ALTER TABLE proyectos ADD COLUMN problem_statement TEXT DEFAULT ''");
  // Migración usuarios: rol granular (Formulador, Evaluador, Diseñador, Administrador, Usuario)
  await addColumnSafe("ALTER TABLE usuarios ADD COLUMN rol TEXT DEFAULT 'Usuario'");
  await addColumnSafe("ALTER TABLE usuarios ADD COLUMN org_id TEXT DEFAULT NULL");
  await addColumnSafe("ALTER TABLE usuarios ADD COLUMN tokens_invalidated_at TIMESTAMP DEFAULT NULL");

  // Seed catalogo de rendimientos desde RENDIMIENTOS_CATALOGO.
  // FIX (auditoría 2026-08-17, "se cae la red en local"): antes reintentaba
  // las 24 INSERT en CADA arranque sin pre-chequeo — tras el primer boot
  // exitoso, las 24 SIEMPRE fallan por UNIQUE(clave), y cada fallo de pg
  // escala a un reintento vía REST (Capa 2, más lento) — confirmado en
  // backend.err.log como "duplicate key value violates unique constraint
  // catalogo_rendimientos_clave_key" repetido 24 veces en cada arranque.
  // Hasta 48 round-trips de red desperdiciados por boot, contribuyendo
  // directamente a la ventana de ~50s en la que /api/health no responde
  // (RootIndicator la reporta como "ROOT OFFLINE"). Mismo patrón de
  // pre-chequeo ya usado más abajo para el seed de directorio_entidades
  // (existsWP/existsDI) — solo se inserta lo que realmente falta.
  const clavesExistentes = new Set((await getRows('SELECT clave FROM catalogo_rendimientos')).map(r => r.clave));
  for (const [clave, r] of Object.entries(RENDIMIENTOS_CATALOGO)) {
    if (clavesExistentes.has(clave)) continue;
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

  // Índices de rendimiento — evitan full table scan en las queries principales
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_conv_estado    ON convocatorias(estado)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_conv_deleted   ON convocatorias(deleted_at)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_conv_entidad   ON convocatorias(entidad_id)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_conv_created   ON convocatorias(created_at DESC)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_conv_root      ON convocatorias(root_domain)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_de_deleted     ON directorio_entidades(deleted_at)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_de_root        ON directorio_entidades(root_domain)'); } catch {}
  try { await runSql('CREATE INDEX IF NOT EXISTS idx_de_status      ON directorio_entidades(status)'); } catch {}

  // Aviso de producción: PostgreSQL recomendado sobre SQLite
  if (!process.env.DATABASE_URL) {
    console.warn('[DB] AVISO: DATABASE_URL no definida — usando SQLite (solo desarrollo). En producción configura PostgreSQL.');
  }
  console.log('[DB] DB initialized at', new Date().toISOString());
}

// ── Reparación de fuente vía PostgREST directo (sin SQL translator) ───────────
const R2_DONANTES = [
  'MacArthur Foundation',
  'International Development Research Centre',
  'Inter-American Foundation',
  'Wellcome Trust',
  'Ford Foundation',
  'Open Society Foundations',
];
const SB_ADMIN_URL  = process.env.SUPABASE_URL  || 'https://ozivmsvxbdtjkzleqbcy.supabase.co';
const SB_ADMIN_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const PGREST_HEADERS = {
  'Content-Type': 'application/json',
  'apikey':        SB_ADMIN_KEY,
  'Authorization': `Bearer ${SB_ADMIN_KEY}`,
  'Prefer':        'return=minimal',
};

async function repararFuenteConvocatorias() {
  if (!SB_ADMIN_KEY) return { error: 'SUPABASE_SERVICE_KEY no configurada' };
  let r2Count = 0;
  // R2: un PATCH por donante (evita problemas de CSV con espacios en PostgREST in.())
  for (const donante of R2_DONANTES) {
    const r = await fetch(
      `${SB_ADMIN_URL}/rest/v1/convocatorias?donante=eq.${encodeURIComponent(donante)}`,
      { method: 'PATCH', headers: PGREST_HEADERS, body: JSON.stringify({ fuente: 'RASTREO_WEB_EXTERNO' }) }
    );
    if (!r.ok) {
      const errText = await r.text();
      console.warn(`[reparar-fuente] PATCH R2 failed for ${donante}: ${r.status} ${errText}`);
    } else {
      r2Count++;
    }
  }
  // R1: todo lo que no es R2 → RASTREO_DIRECTORIO (usa not.in. con valores sin espacios es menos confiable)
  // En su lugar: primero seteamos todos a DIRECTORIO, luego R2 a WEB_EXTERNO (segunda pasada)
  const r1all = await fetch(
    `${SB_ADMIN_URL}/rest/v1/convocatorias?fuente=neq.RASTREO_WEB_EXTERNO`,
    { method: 'PATCH', headers: PGREST_HEADERS, body: JSON.stringify({ fuente: 'RASTREO_DIRECTORIO' }) }
  );
  if (!r1all.ok) {
    const errText = await r1all.text();
    return { error: `R1 PATCH failed: ${r1all.status} ${errText}` };
  }
  // Segunda pasada R2 (por si fuente estaba ya en 'RASTREO_DIRECTORIO' después del primer paso)
  for (const donante of R2_DONANTES) {
    await fetch(
      `${SB_ADMIN_URL}/rest/v1/convocatorias?donante=eq.${encodeURIComponent(donante)}`,
      { method: 'PATCH', headers: PGREST_HEADERS, body: JSON.stringify({ fuente: 'RASTREO_WEB_EXTERNO' }) }
    ).catch(() => {});
  }
  return { success: true, r2Donantes: r2Count };
}

// ── Clasificación masiva de sectores en background ────────────────────────────
// Frases de navegación/UI que indican que el registro no es una convocatoria real
const GARBAGE_TITLE_RE = /^(saltar al|ir al|pasar al|menú|volver a|retour à|retour a|télécharger|telecharger|consulter le|aller au|acceder al|accéder au|skip to|go to main|learn more|read more|see more|sign in|log in|register|subscribe|click here|apply now|find out more)/i;
function isGarbageTitle(title) {
  if (!title || title.length < 5) return true;
  if (title.length < 18) return true; // titulos muy cortos no son convocatorias
  return GARBAGE_TITLE_RE.test(title.trim());
}

// ── Enriquecedor de montos (regex sin Gemini) ────────────────────────────────
const MONTO_ENRICH_RE = /(?:up\s+to|hasta|m[aá]ximo|maximum|prize(?:\s+of)?|award(?:\s+of)?|funding\s+of|total\s+de?|value\s+of|por\s+valor\s+de|subsidio\s+de|grant\s+of|monto\s+m[aá]ximo|monto\s+de)\s*:?\s*(?:USD|EUR|COP|GBP|CAD|\$|€|£)\s*([\d,. ]+)\s*(M(?:illion)?|B(?:illion)?|K)?|(?:USD|EUR|COP|GBP|CAD|\$|€|£)\s*([\d,. ]+)\s*(M(?:illion)?|B(?:illion)?|K)?(?:\s*(?:USD|EUR|COP|GBP))?\b|([\d,. ]+)\s*(M(?:illion)?|B(?:illion)?|K)?\s+(?:USD|EUR|COP|GBP|CAD|d[oó]lares?|dollars?|euros?|pesos?)/i;

function parseMontoFromHtml(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 80_000);
  const m = text.match(MONTO_ENRICH_RE);
  if (!m) return null;
  let currency = 'USD';
  const sym = m[0].match(/EUR|COP|GBP|CAD|USD|€|£|\$/i)?.[0] || '';
  if (/EUR|€/.test(sym)) currency = 'EUR';
  else if (/GBP|£/.test(sym)) currency = 'GBP';
  else if (/COP/.test(sym)) currency = 'COP';
  else if (/CAD/.test(sym)) currency = 'CAD';
  const numRaw = (m[1] || m[3] || m[5] || '').replace(/\s/g, '').replace(/,/g, '');
  const num = parseFloat(numRaw);
  if (!num || isNaN(num) || num <= 0 || num > 1e13) return null;
  const suffix = (m[2] || m[4] || m[6] || '').toUpperCase();
  const mult = suffix.startsWith('B') ? 1e9 : suffix.startsWith('M') ? 1e6 : suffix.startsWith('K') ? 1e3 : 1;
  return { value: Math.round(num * mult), currency };
}

let _enrichingMontos = false;
async function enriquecerMontosBatch(limit = 300) {
  if (_enrichingMontos) return;
  _enrichingMontos = true;
  let procesadas = 0, actualizadas = 0, errores = 0;
  console.log(`[Montos] Iniciando enriquecimiento de montos — hasta ${limit} convocatorias...`);
  try {
    const rows = await getRows(
      `SELECT id, url_convocatoria, moneda FROM convocatorias
       WHERE deleted_at IS NULL AND monto_max = 0 AND url_convocatoria IS NOT NULL AND url_convocatoria != ''
       ORDER BY created_at DESC LIMIT ${Math.min(limit, 1000)}`
    );
    console.log(`[Montos] ${rows.length} convocatorias con monto_max=0 y URL encontradas.`);
    for (const row of rows) {
      try {
        const resp = await fetch(row.url_convocatoria, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', Accept: 'text/html' },
        });
        if (!resp.ok) { procesadas++; continue; }
        const html = await resp.text();
        const found = parseMontoFromHtml(html);
        if (found && found.value > 0) {
          await runSql(
            'UPDATE convocatorias SET monto_max = $1, moneda = $2 WHERE id = $3',
            [found.value, found.currency, row.id]
          );
          actualizadas++;
        }
        procesadas++;
        if (procesadas % 20 === 0) {
          console.log(`[Montos] ${procesadas}/${rows.length} procesadas — ${actualizadas} actualizadas...`);
          await new Promise(r => setTimeout(r, 300));
        }
      } catch { errores++; procesadas++; }
    }
    console.log(`[Montos] Completado — ${actualizadas} montos actualizados, ${errores} errores de ${procesadas} procesadas.`);
  } finally {
    _enrichingMontos = false;
  }
}

let _clasificandoSectores = false;
async function clasificarSectoresEnBatch(limit = 200) {
  if (_clasificandoSectores) {
    console.log('[Sectores] Clasificación ya en curso — ignorando solicitud duplicada.');
    return;
  }
  _clasificandoSectores = true;
  console.log(`[Sectores] Iniciando clasificación masiva — hasta ${limit} convocatorias sin sector...`);
  let procesadas = 0, actualizadas = 0, eliminadas = 0, errores = 0;
  try {
    const rows = await getRows(
      `SELECT id, titulo, descripcion, donante FROM convocatorias
       WHERE deleted_at IS NULL AND (sectores IS NULL OR sectores = '[]')
       LIMIT ${Math.min(limit, 1000)}`
    );
    console.log(`[Sectores] ${rows.length} convocatorias sin sector encontradas.`);
    const now = new Date().toISOString();
    for (const row of rows) {
      try {
        if (isGarbageTitle(row.titulo)) {
          await runSql('UPDATE convocatorias SET deleted_at = $1 WHERE id = $2', [now, row.id]);
          eliminadas++;
          procesadas++;
          continue;
        }
        const sectores = await classifySectors(row.titulo, row.descripcion || '', row.donante || '');
        if (sectores.length > 0) {
          await runSql('UPDATE convocatorias SET sectores = $1 WHERE id = $2', [JSON.stringify(sectores), row.id]);
          actualizadas++;
        }
        procesadas++;
        if (procesadas % 10 === 0) {
          console.log(`[Sectores] ${procesadas}/${rows.length} procesadas — ${actualizadas} clasificadas, ${eliminadas} garbage eliminadas...`);
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e) {
        errores++;
        if (errores <= 3) console.warn('[Sectores] Error en convocatoria', row.id, e.message?.slice(0, 80));
      }
    }
    console.log(`[Sectores] Completado — ${actualizadas} clasificadas, ${eliminadas} garbage eliminadas, ${errores} errores de ${procesadas} procesadas.`);
  } finally {
    _clasificandoSectores = false;
  }
}

// ── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb();
  } catch (err) {
    console.warn('⚠️  [DB] initDb no-fatal — el servidor arranca en modo degradado REST.');
    console.warn('    Causa:', err.message.substring(0, 120));
    console.warn('    Para activar pg Pool: habilita Connection Pooling en https://supabase.com/dashboard/project/ozivmsvxbdtjkzleqbcy/settings/database');
  }
  // C-1: Inicializar blacklist — crea tabla revoked_tokens y carga Set en memoria
  await initBlacklist(runSql, getRows);
  // A-1: Purgar tokens expirados cada hora (Set + tabla revoked_tokens)
  setInterval(() => purgeExpiredTokens(runSql).catch(e => console.warn('[blacklist] purge error:', e.message)), 60 * 60_000);
  await seedPredios();
  await seedDirectorio();

  // Seed del usuario dev (demo-mode-token) — NUNCA en producción. Idempotente
  // vía pre-check, NO vía "ON CONFLICT DO NOTHING": restInsert() en
  // database.config.js hace un POST plano a PostgREST y no traduce ON
  // CONFLICT — bajo el fallback REST esa cláusula se ignora en silencio y
  // cada reinicio reintentaba el INSERT completo, generando el "duplicate
  // key" que se veía en los logs.
  // Ver también backend/migrations/015_seed_dev_user.sql (misma fila, aplicable
  // manualmente vía psql si el bootstrap corre en modo degradado sin DDL real).
  if (process.env.NODE_ENV !== 'production') {
    try {
      const existsDevUser = await getRow('SELECT id FROM usuarios WHERE id = ?', [DEV_USER_ID]);
      if (!existsDevUser) {
        // IMPORTANTE: todo valor va como placeholder ?, ninguno como literal en
        // VALUES() — en Capa 2 (REST) el mapeo columna↔parámetro es puramente
        // posicional (ver restInsert en database.config.js); un literal mezclado
        // entre placeholders desalinea todos los parámetros posteriores.
        //
        // Columna en minúsculas y SIN tenant_id: verificado empíricamente contra
        // la BD real (SELECT * de un usuario existente) que esta instancia nunca
        // recibió las migraciones formales 001-010 — el esquema realmente activo
        // es el que crea este mismo bootstrap con el identificador SIN comillas,
        // que Postgres pliega a minúsculas ("tipousuario"); org_id es TEXT
        // nullable y tenant_id no existe en esta tabla. El traductor REST de
        // Capa 2 no simula el case-folding de Postgres — el texto SQL debe usar
        // la casing real de la columna, no la que aparece en el CREATE TABLE.
        await runSql(
          `INSERT INTO usuarios
             (id, email, password_hash, nombre, tipousuario, plan, org_id, is_approved, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            DEV_USER_ID,
            'dev-user-001@radarfondos.local',
            '848ee624f012a8bb30c27eed7384e692:d9c84fda6e8840d09dff5b16080c46d6407e42beaf2693cea7be047952ea99948f9c377a75155f7812cb004db2c91fb25424be8b34f5fdd1da68f0aa793f809e',
            'Usuario de Desarrollo', 'admin', 'free',
            DEV_USER_ID, 1, 1,
          ]
        );
      }
    } catch (e) {
      console.warn('[seedDevUser] No se pudo sembrar el usuario dev:', e.message?.slice(0, 150));
    }
  }

  // Seed WePropel — idempotente (solo inserta si no existe)
  try {
    // Chequeo por id (la PK real que colisiona), no por sigla+deleted_at:
    // una fila soft-deleted sigue ocupando el id y un INSERT nuevo con el
    // mismo id violaría directorio_entidades_pkey igual.
    const existsWP = await getRow("SELECT id FROM directorio_entidades WHERE id = 'seed-wepropel'");
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

  // Seed Darwin Initiative — idempotente (solo inserta si no existe)
  try {
    const existsDI = await getRow("SELECT id FROM directorio_entidades WHERE id = 'seed-darwin-initiative'");
    if (!existsDI) {
      const now = new Date().toISOString();
      await runSql(
        `INSERT INTO directorio_entidades
         (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias,
          telefono, email, alcance, validation_status, fuente, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          'seed-darwin-initiative',
          'Darwin Initiative',
          'DI',
          'Gobierno',
          'Reino Unido',
          'https://www.darwininitiative.org.uk',
          'https://www.darwininitiative.org.uk/apply/',
          '',
          'BCF-Darwin@niras.com',
          'Internacional',
          'VALIDADO',
          'seed',
          now, now,
        ]
      );
      console.log('[Seed] Darwin Initiative agregado al Directorio');
    }
  } catch (e) { console.warn('[Seed] Darwin Initiative:', e.message); }

  // ── Seed bloque extra — 15 financiadores de alta productividad ────────────
  const NUEVAS_ENTIDADES = [
    { id:'seed-giz', nombre:'Deutsche Gesellschaft für Internationale Zusammenarbeit', sigla:'GIZ', tipo:'Gobierno', pais:'Alemania', sitio_web:'https://www.giz.de', url_convocatorias:'https://www.giz.de/en/jobs/jobs_tender.html', alcance:'Internacional' },
    { id:'seed-minciencias', nombre:'Ministerio de Ciencia, Tecnología e Innovación', sigla:'Minciencias', tipo:'Gobierno', pais:'Colombia', sitio_web:'https://minciencias.gov.co', url_convocatorias:'https://minciencias.gov.co/convocatorias', alcance:'Nacional' },
    { id:'seed-caf', nombre:'CAF – Banco de Desarrollo de América Latina', sigla:'CAF', tipo:'Multilateral', pais:'Venezuela', sitio_web:'https://www.caf.com', url_convocatorias:'https://www.caf.com/es/conocimiento/convocatorias/', alcance:'Regional' },
    { id:'seed-rockefeller', nombre:'Rockefeller Foundation', sigla:'RF', tipo:'Fundación', pais:'Estados Unidos', sitio_web:'https://www.rockefellerfoundation.org', url_convocatorias:'https://www.rockefellerfoundation.org/grants/', alcance:'Internacional' },
    { id:'seed-ukri', nombre:'UK Research and Innovation', sigla:'UKRI', tipo:'Gobierno', pais:'Reino Unido', sitio_web:'https://www.ukri.org', url_convocatorias:'https://www.ukri.org/opportunity/', alcance:'Internacional' },
    { id:'seed-gef', nombre:'Global Environment Facility', sigla:'GEF', tipo:'Multilateral', pais:'Internacional', sitio_web:'https://www.thegef.org', url_convocatorias:'https://www.thegef.org/grants-and-projects', alcance:'Internacional' },
    { id:'seed-undp', nombre:'United Nations Development Programme', sigla:'PNUD', tipo:'ONU', pais:'Internacional', sitio_web:'https://www.undp.org', url_convocatorias:'https://www.undp.org/funding/calls-for-proposals', alcance:'Internacional' },
    { id:'seed-gates', nombre:'Bill & Melinda Gates Foundation', sigla:'Gates', tipo:'Fundación', pais:'Estados Unidos', sitio_web:'https://www.gatesfoundation.org', url_convocatorias:'https://www.gatesfoundation.org/about/committed-grants', alcance:'Internacional' },
    { id:'seed-usaid', nombre:'U.S. Agency for International Development', sigla:'USAID', tipo:'Gobierno', pais:'Estados Unidos', sitio_web:'https://www.usaid.gov', url_convocatorias:'https://www.usaid.gov/partner-with-us/funding-opportunities', alcance:'Internacional' },
    { id:'seed-erc', nombre:'European Research Council', sigla:'ERC', tipo:'Gobierno', pais:'Europa', sitio_web:'https://erc.europa.eu', url_convocatorias:'https://erc.europa.eu/apply-grant/open-calls', alcance:'Internacional' },
    { id:'seed-fao', nombre:'Food and Agriculture Organization of the UN', sigla:'FAO', tipo:'ONU', pais:'Internacional', sitio_web:'https://www.fao.org', url_convocatorias:'https://www.fao.org/partnerships/civil-society/calls-for-proposals/en/', alcance:'Internacional' },
    { id:'seed-luminate', nombre:'Luminate Group', sigla:'Luminate', tipo:'Fundación', pais:'Reino Unido', sitio_web:'https://luminategroup.com', url_convocatorias:'https://luminategroup.com/open-calls', alcance:'Internacional' },
    { id:'seed-ffi', nombre:'Flora & Fauna International', sigla:'FFI', tipo:'ONG', pais:'Reino Unido', sitio_web:'https://www.fauna-flora.org', url_convocatorias:'https://www.fauna-flora.org/grants/', alcance:'Internacional' },
    { id:'seed-idblab', nombre:'IDB Lab – Fondo Multilateral de Inversiones', sigla:'IDB Lab', tipo:'Multilateral', pais:'Internacional', sitio_web:'https://idblab.iadb.org', url_convocatorias:'https://idblab.iadb.org/en/calls', alcance:'Regional' },
    { id:'seed-innpulsa', nombre:'iNNpulsa Colombia', sigla:'iNNpulsa', tipo:'Gobierno', pais:'Colombia', sitio_web:'https://www.innpulsacolombia.com', url_convocatorias:'https://www.innpulsacolombia.com/convocatorias', alcance:'Nacional' },
  ];
  for (const ent of NUEVAS_ENTIDADES) {
    try {
      // Por id (PK real), no por sigla+deleted_at — mismo motivo que WePropel/Darwin arriba.
      const exists = await getRow(`SELECT id FROM directorio_entidades WHERE id = ?`, [ent.id]);
      if (!exists) {
        const now = new Date().toISOString();
        await runSql(
          `INSERT INTO directorio_entidades (id,nombre,sigla,tipo,pais,sitio_web,url_convocatorias,telefono,email,alcance,validation_status,fuente,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [ent.id,ent.nombre,ent.sigla,ent.tipo,ent.pais,ent.sitio_web,ent.url_convocatorias,'','',ent.alcance,'VALIDADO','seed',now,now]
        );
        console.log(`[Seed] ${ent.sigla} agregado al Directorio`);
      }
    } catch(e){ console.warn(`[Seed] ${ent.sigla}:`, e.message?.slice(0,80)); }
  }

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  // FIX (auditoría SRE 2026-08-08, Capa 3): sin esto, Express ignora la cadena
  // real de proxies y getRateLimitKey() (SecurityMiddleware.js) leía el header
  // X-Forwarded-For crudo del cliente sin validar — cualquiera podía mandar un
  // XFF distinto en cada request y resetear authLimiter/trialLimiter a
  // voluntad. `1` = confiar en 1 salto de proxy (el balanceador de Render).
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: isProd ? {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:         ["'self'", 'data:', 'https:'],
        connectSrc:     ["'self'", 'https://generativelanguage.googleapis.com', 'https://api.frankfurter.app'],
        frameSrc:       ["'none'"],
        objectSrc:      ["'none'"],
        upgradeInsecureRequests: [],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  }));

  // ── CORS estricto — solo orígenes autorizados ────────────────────────────
  const _allowedOrigins = [
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  app.use(cors({
    origin: (origin, cb) => {
      // Permitir sin origin (curl, Postman, same-origin)
      if (!origin || _allowedOrigins.includes(origin)) return cb(null, true);
      logger.warn('[CORS] Origen bloqueado', { origin });
      cb(new Error(`CORS: origen no permitido — ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Smoke-Token'],
  }));
  // STRIPE WEBHOOK — debe ir ANTES de express.json() para recibir raw body
  // (la verificación de firma de Stripe falla si el body ya fue parseado)
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.set('etag', false);

  // WOMPI WEBHOOK — a diferencia de Stripe, Wompi firma sobre el JSON ya
  // parseado (no bytes crudos), así que va DESPUÉS de express.json() normal.
  app.post('/api/wompi/webhook', wompiWebhookHandler);

  // ── Slowdown progresivo (antes del hard limit) ────────────────────────────
  app.use('/api', slowDown);

  // ── Rate limiter global — todas las rutas /api ────────────────────────────
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    // FIX (auditoría SRE 2026-08-08): mismo bypass de XFF corregido en
    // SecurityMiddleware.js — se delega en req.ip (requiere trust proxy, ver arriba).
    keyGenerator: (req) => ipKeyGenerator(req.ip || 'unknown'),
    handler: (_req, res) => res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.',
    }),
  }));

  // ── Aplicación Reglas Materiales (F4-01) ─────────────────────────────────
  app.use('/api/formulador', rejectMaterialsInput);
  app.use('/api/ia', rejectMaterialsInput);
  app.use('/api/modulo3b', rejectMaterialsInput);
  app.use('/api/radar/barrido-masivo', rejectMaterialsInput);

  // ── Health Check (plataformas: Railway, Render, K8s liveness probe) ─────────
  app.get('/health', (_req, res) => {
    const db = dbStatus();
    res.json({ status: 'ok', uptime: process.uptime(), db });
  });

  app.get('/api/db-status', (_req, res) => {
    res.json(dbStatus());
  });

  // GET /api/system/engines-status — para ControlPanel.tsx (/settings, panel
  // del usuario, no del admin). Solo expone si el motor Gemini del SERVIDOR
  // está configurado (GOOGLE_API_KEY presente) — nunca la llave misma. A
  // diferencia de /api/admin/system-status, cualquier usuario autenticado
  // puede consultarlo (es su propio panel de ajustes, no uno administrativo).
  app.get('/api/system/engines-status', authenticateToken, tryCatch(async (_req, res) => {
    res.json({ success: true, data: { gemini: !!process.env.GOOGLE_API_KEY } });
  }));

  // ── Quota Status — Gemini Circuit Breaker ───────────────────────────────
  app.get('/api/admin/quota-status', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    res.json({ success: true, data: geminiCB.getStatus() });
  }));

  // ── Healthcheck ──────────────────────────────────────────────────────────
  // FIX (auditoría "ROOT OFFLINE" 2026-08-16): antes esta ruta hacía un
  // getRow() a la BD en cada chequeo — TopNavBar.tsx la sondea cada 30s con
  // un timeout de 3s (AbortSignal.timeout(3000)) para pintar el indicador
  // ROOT ONLINE/OFFLINE. Verificado en vivo con curl: la BD/capa REST de
  // Supabase puede demorar varios segundos bajo carga de los rastreos en
  // background (Rastreo1/Sectores/Montos corriendo en el mismo proceso Node),
  // lo que hacía abortar el healthcheck y mostrar "OFFLINE" con el backend
  // realmente arriba. Además, `production_ready` no tiene NINGÚN consumidor
  // real (grep confirmado: ni frontend ni otro backend lo leen de esta ruta;
  // solo smokeTest.js lo ESCRIBE vía POST /api/system/production-ready) — no
  // había ninguna razón para pagar una consulta a BD en el endpoint que debe
  // ser el más rápido de toda la app. Se cachea en memoria, refrescada en
  // background sin bloquear la respuesta.
  let productionReadyCache = false;
  const refreshProductionReadyCache = async () => {
    try {
      const cfg = await getRow("SELECT value FROM system_config WHERE key = 'production_ready'");
      productionReadyCache = cfg?.value === 'true';
    } catch { /* se conserva el último valor conocido */ }
  };
  refreshProductionReadyCache();
  setInterval(refreshProductionReadyCache, 5 * 60_000);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), production_ready: productionReadyCache, version: '8.0' });
  });

  // POST /api/system/production-ready — llamado por smokeTest.js tras checks exitosos
  app.post('/api/system/production-ready', tryCatch(async (req, res) => {
    const smokeToken = req.headers['x-smoke-token'];
    if (!smokeToken || smokeToken !== JWT_SECRET) {
      return res.status(403).json({ success: false, message: 'Token inválido' });
    }
    // Se evita "INSERT ... ON CONFLICT" con literales embebidos: el traductor
    // REST (Capa 2) hace zip columna↔parámetro por posición usando el array
    // `params`, y con literales fijos (sin `?`) ese array llega vacío — el
    // INSERT terminaba mandando un body {} y violando el NOT NULL de "key".
    const nowIso = new Date().toISOString();
    const existingCfg = await getRow('SELECT key FROM system_config WHERE key = ?', ['production_ready']);
    if (existingCfg) {
      await runSql('UPDATE system_config SET value = ?, updated_at = ? WHERE key = ?', ['true', nowIso, 'production_ready']);
    } else {
      await runSql('INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?)', ['production_ready', 'true', nowIso]);
    }
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
     const errorPassword = validarFortalezaPassword(password);
     if (errorPassword) return res.status(400).json({ success: false, message: errorPassword });

     // Anti-enumeración: si el email ya existe, responder EXACTAMENTE igual
     // que un registro nuevo exitoso (mismo status, mismo shape) para que un
     // atacante no pueda usar este endpoint para descubrir qué correos ya
     // tienen cuenta. Al dueño real de la cuenta se le avisa por correo en
     // vez de filtrarlo en la respuesta HTTP.
     const existing = await getRow('SELECT id, email FROM usuarios WHERE email = ?', [email.trim().toLowerCase()]);
     if (existing) {
       emailAdapter.sendDuplicateRegistrationNotice(existing.email)
         .catch(e => console.warn('[register] No se pudo notificar registro duplicado:', e.message));
       return res.status(201).json({
         success: true,
         pendingApproval: true,
         message: 'Cuenta creada correctamente. Un administrador debe aprobarla antes de que puedas iniciar sesión.',
       });
     }
     const id = crypto.randomUUID();
     const password_hash = await hashPassword(password);
     const safeRole = role === 'admin' ? 'user' : (role || 'user'); // no permitir auto-admin
     await runSql(
       `INSERT INTO usuarios (id, email, password_hash, nombre, tipousuario, rol, is_approved) VALUES (?, ?, ?, ?, ?, ?, ?)`,
       [id, email.trim().toLowerCase(), password_hash, nombre.trim(), 'Usuario', safeRole, 0]
     );
    // V8.0: auto-crear suscripción free al registrarse
    try {
      await runSql(
        `INSERT INTO user_subscriptions (id, user_id, plan, access_radar, access_formulador)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO NOTHING`,
        [crypto.randomUUID(), id, 'free', 0, 0]
      );
    } catch (e) {
      logger.error('[register] No se pudo crear suscripción free — el usuario quedará sin fila hasta la próxima consulta', { userId: id, err: e.message });
    }
    // Aviso al administrador — no bloquea la respuesta si el correo falla o no está configurado.
    // Token de un solo clic: aprobar/rechazar directo desde el botón del
    // correo, sin loguearse ni abrir el panel (7 días de validez, un solo uso).
    const decisionToken = jwt.sign({ sub: id, purpose: 'admin_pending_decision' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    const backendUrl = (process.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
    emailAdapter.sendPendingApprovalNotice(process.env.ADMIN_NOTIFY_EMAIL || 'jaansave@gmail.com', {
      id, nombre: nombre.trim(), email: email.trim().toLowerCase(),
      aprobarUrl:  `${backendUrl}/api/admin/usuarios/${id}/aprobar-por-correo?token=${decisionToken}`,
      rechazarUrl: `${backendUrl}/api/admin/usuarios/${id}/rechazar-por-correo?token=${decisionToken}`,
    }).catch(e => console.warn('[register] No se pudo notificar al admin:', e.message));

    // No se emite token: la cuenta queda con is_approved=0 hasta que el
    // administrador la apruebe manualmente (ver PUT /api/admin/usuarios/:id/aprobar).
    res.status(201).json({
      success: true,
      pendingApproval: true,
      message: 'Cuenta creada correctamente. Un administrador debe aprobarla antes de que puedas iniciar sesión.',
    });
  }));

  // POST /api/auth/login
  app.post('/api/auth/login', authLimiter, sanitizeAuthBody, tryCatch(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'email y password requeridos' });
    const user = await getRow('SELECT * FROM usuarios WHERE email = ? AND deleted_at IS NULL', [email.trim().toLowerCase()]);
    if (!user) return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    if (!user.is_active) return res.status(403).json({ success: false, message: 'Cuenta desactivada' });
    if (user.tipousuario !== 'admin') {
      const sub = await getRow('SELECT expires_at FROM user_subscriptions WHERE user_id = ?', [user.id]);
      if (sub?.expires_at && new Date(sub.expires_at).getTime() < Date.now()) {
        return res.status(403).json({ success: false, code: 'SUBSCRIPTION_EXPIRED', message: 'Tu membresía expiró. Contacta al administrador para renovarla.' });
      }
    }

    // Bloqueo por CUENTA (no solo por IP como authLimiter) — un atacante con
    // muchas IPs podía forzar bruta una sola cuenta sin activar el límite
    // por IP. 5 intentos fallidos → 15 minutos bloqueada.
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutosRestantes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      return res.status(423).json({
        success: false, code: 'ACCOUNT_LOCKED',
        message: `Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto(s).`,
      });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const intentos = (user.failed_login_attempts || 0) + 1;
      const LIMITE_INTENTOS = 5;
      if (intentos >= LIMITE_INTENTOS) {
        const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await runSql('UPDATE usuarios SET failed_login_attempts = ?, locked_until = ? WHERE id = ?', [0, lockedUntil, user.id]);
        return res.status(423).json({
          success: false, code: 'ACCOUNT_LOCKED',
          message: 'Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intenta de nuevo en 15 minutos.',
        });
      }
      await runSql('UPDATE usuarios SET failed_login_attempts = ? WHERE id = ?', [intentos, user.id]);
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }

    if (!user.is_approved) {
      return res.status(403).json({ success: false, code: 'PENDING_APPROVAL', message: 'Tu cuenta está pendiente de aprobación por el administrador. Te avisaremos cuando quede activa.' });
    }

    // Login correcto — reiniciar contador de intentos fallidos.
    if (user.failed_login_attempts > 0 || user.locked_until) {
      await runSql('UPDATE usuarios SET failed_login_attempts = ?, locked_until = ? WHERE id = ?', [0, null, user.id]);
    }

    // MFA: password correcta no basta si la cuenta tiene TOTP activo — se
    // emite un token de pre-auth de vida corta (5 min, sin poder de acceder
    // a ninguna ruta real) en vez del JWT de sesión. El JWT real solo sale
    // de /api/auth/mfa/challenge tras validar el código.
    if (user.mfa_enabled) {
      const preAuthToken = jwt.sign({ sub: user.id, purpose: 'mfa_pending' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
      return res.json({ success: true, mfaRequired: true, preAuthToken });
    }

    const token = jwt.sign({ sub: user.id, role: user.tipousuario }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, nombre: user.nombre, role: user.tipousuario, plan: user.plan || 'free', created_at: user.createdat, is_active: !!user.is_active, email_verified: !!user.email_verified },
      subscription: await getLoginSubscription(user.id, getRow),
    });
  }));

  // POST /api/auth/mfa/challenge — segundo factor: consume el preAuthToken
  // de /login + el código TOTP de 6 dígitos, emite el JWT de sesión real.
  app.post('/api/auth/mfa/challenge', authLimiter, tryCatch(async (req, res) => {
    const { preAuthToken, code } = req.body || {};
    if (!preAuthToken || !code) return res.status(400).json({ success: false, message: 'preAuthToken y code son requeridos' });

    let payload;
    try {
      payload = jwt.verify(preAuthToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Sesión de verificación inválida o expirada. Inicia sesión de nuevo.' });
    }
    if (payload.purpose !== 'mfa_pending' || !payload.sub) {
      return res.status(401).json({ success: false, message: 'Token de verificación inválido.' });
    }

    const user = await getRow('SELECT * FROM usuarios WHERE id = ? AND deleted_at IS NULL', [payload.sub]);
    if (!user || !user.mfa_enabled || !user.mfa_secret) {
      return res.status(401).json({ success: false, message: 'Cuenta no válida para verificación MFA.' });
    }

    const valido = authenticator.check(String(code).trim(), user.mfa_secret);
    if (!valido) return res.status(401).json({ success: false, message: 'Código incorrecto.' });

    const token = jwt.sign({ sub: user.id, role: user.tipousuario }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, nombre: user.nombre, role: user.tipousuario, plan: user.plan || 'free', created_at: user.createdat, is_active: !!user.is_active, email_verified: !!user.email_verified },
      subscription: await getLoginSubscription(user.id, getRow),
    });
  }));

  // POST /api/auth/mfa/setup — genera un secreto TOTP nuevo (sin activar
  // todavía) y el URI otpauth:// para escanear con Google Authenticator/
  // Authy/etc. Requiere confirmar con un código real antes de activarse.
  // GET /api/auth/mfa/status — estado actual de MFA de la cuenta en sesión,
  // para que la UI de gestión sepa si mostrar "activar" o "desactivar".
  app.get('/api/auth/mfa/status', authenticateToken, tryCatch(async (req, res) => {
    const user = await getRow('SELECT mfa_enabled FROM usuarios WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    res.json({ success: true, mfaEnabled: !!user.mfa_enabled });
  }));

  app.post('/api/auth/mfa/setup', authenticateToken, tryCatch(async (req, res) => {
    const user = await getRow('SELECT id, email FROM usuarios WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const secret = authenticator.generateSecret();
    await runSql('UPDATE usuarios SET mfa_secret = ?, mfa_enabled = ? WHERE id = ?', [secret, false, user.id]);
    const otpauthUrl = authenticator.keyuri(user.email, 'RadFor-360', secret);

    res.json({ success: true, data: { secret, otpauthUrl } });
  }));

  // POST /api/auth/mfa/confirmar — valida el primer código real generado
  // por la app del usuario antes de activar MFA de verdad.
  app.post('/api/auth/mfa/confirmar', authenticateToken, tryCatch(async (req, res) => {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ success: false, message: 'code es requerido' });

    const user = await getRow('SELECT mfa_secret FROM usuarios WHERE id = ?', [req.userId]);
    if (!user?.mfa_secret) return res.status(400).json({ success: false, message: 'No hay una configuración de MFA pendiente. Ejecuta /mfa/setup primero.' });

    const valido = authenticator.check(String(code).trim(), user.mfa_secret);
    if (!valido) return res.status(400).json({ success: false, message: 'Código incorrecto. Verifica la hora de tu dispositivo e intenta de nuevo.' });

    await runSql('UPDATE usuarios SET mfa_enabled = ? WHERE id = ?', [true, req.userId]);
    res.json({ success: true, message: 'MFA activado. Se te pedirá un código cada vez que inicies sesión.' });
  }));

  // POST /api/auth/mfa/desactivar — exige la contraseña actual, no solo
  // estar autenticado (desactivar 2FA es una acción sensible).
  app.post('/api/auth/mfa/desactivar', authenticateToken, tryCatch(async (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ success: false, message: 'password es requerido' });

    const user = await getRow('SELECT password_hash FROM usuarios WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });

    await runSql('UPDATE usuarios SET mfa_enabled = ?, mfa_secret = ? WHERE id = ?', [false, null, req.userId]);
    res.json({ success: true, message: 'MFA desactivado.' });
  }));

  // GET /api/auth/verify
  app.get('/api/auth/verify', authenticateToken, tryCatch(async (req, res) => {
    const user = await getRow('SELECT id, email, nombre, tipousuario, plan, createdat, is_active, email_verified FROM usuarios WHERE id = ? AND deleted_at IS NULL', [req.userId]);
    if (!user) return res.status(401).json({ valid: false });
    const sub = await getRow(
      'SELECT plan, access_radar, access_formulador FROM user_subscriptions WHERE user_id = ?',
      [req.userId]
    );
    res.json({
      valid: true,
      user: {
        id: user.id, email: user.email, nombre: user.nombre,
        role: user.tipousuario, plan: user.plan || 'free',
        created_at: user.createdat, is_active: !!user.is_active,
        email_verified: !!user.email_verified,
        subscription: {
          plan: sub?.plan || 'free',
          access_radar: !!sub?.access_radar,
          access_formulador: !!sub?.access_formulador,
        },
      },
    });
  }));

  // POST /api/auth/validar-por-correo — intercambia el token de un solo uso
  // que llega en el correo "tu cuenta ya fue validada" (enviado justo después
  // de que el admin aprueba, ver aprobar-por-correo más abajo) por una sesión
  // real. Reemplaza al viejo doble-opt-in de verificación de correo — un
  // usuario nuevo ya no ve dos "validaciones" distintas y sin relación entre
  // sí (confirmar correo + esperar aprobación admin), solo una: cuando el
  // admin aprueba, el usuario recibe un único botón que lo mete directo al
  // portal ya con sesión iniciada.
  app.post('/api/auth/validar-por-correo', authLimiter, tryCatch(async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ success: false, message: 'token es requerido' });
    if (isRevoked(token)) {
      return res.status(400).json({ success: false, message: 'Este enlace ya fue usado. Inicia sesión normalmente con tu correo y contraseña.' });
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(400).json({ success: false, message: 'El enlace es inválido o expiró. Inicia sesión normalmente con tu correo y contraseña.' });
    }
    if (payload.purpose !== 'account_activated' || !payload.sub) {
      return res.status(400).json({ success: false, message: 'El enlace no es válido.' });
    }
    const user = await getRow('SELECT * FROM usuarios WHERE id = ? AND deleted_at IS NULL', [payload.sub]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    if (!user.is_approved) {
      return res.status(403).json({ success: false, code: 'PENDING_APPROVAL', message: 'Tu cuenta todavía no ha sido aprobada por el administrador.' });
    }
    if (!user.is_active) return res.status(403).json({ success: false, message: 'Cuenta desactivada.' });
    if (user.tipousuario !== 'admin') {
      const sub = await getRow('SELECT expires_at FROM user_subscriptions WHERE user_id = ?', [user.id]);
      if (sub?.expires_at && new Date(sub.expires_at).getTime() < Date.now()) {
        return res.status(403).json({ success: false, code: 'SUBSCRIPTION_EXPIRED', message: 'Tu membresía expiró. Contacta al administrador para renovarla.' });
      }
    }

    await revokeToken(token, user.id, payload.exp, runSql);
    const sessionToken = jwt.sign({ sub: user.id, role: user.tipousuario }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
    res.json({
      success: true,
      token: sessionToken,
      user: { id: user.id, email: user.email, nombre: user.nombre, role: user.tipousuario, plan: user.plan || 'free', created_at: user.createdat, is_active: !!user.is_active },
    });
  }));

  // ── Aprobación manual de registros (admin) ───────────────────────────────────
  // Blindaje: rastro forense de acciones admin — antes no había forma de
  // responder "quién aprobó esta cuenta y cuándo" con certeza. No bloquea
  // la respuesta si falla (la acción real ya se ejecutó).
  async function registrarAuditoriaAdmin(req, accion, objetivo) {
    try {
      const admin = await getRow('SELECT email FROM usuarios WHERE id = ?', [req.userId]);
      // FIX (auditoría SRE 2026-08-08): req.ip ya resuelve correctamente el
      // XFF real (trust proxy configurado) — antes un admin_audit_log podía
      // quedar con una IP falsa si el request traía un XFF manipulado.
      const ip = req.ip || 'desconocida';
      await runSql(
        `INSERT INTO admin_audit_log (admin_id, admin_email, accion, objetivo_id, objetivo_email, detalle, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.userId, admin?.email || null, accion, objetivo?.id || null, objetivo?.email || null, objetivo?.detalle || null, ip]
      );
    } catch (e) {
      console.warn('[auditoria-admin] No se pudo registrar:', e.message);
    }
  }

  // GET /api/admin/auditoria — últimas 100 acciones admin (aprobar/rechazar/purgar)
  app.get('/api/admin/auditoria', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    const rows = await getRows(
      'SELECT admin_email, accion, objetivo_id, objetivo_email, detalle, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ success: true, data: rows });
  }));

  // GET /api/admin/usuarios/pendientes
  app.get('/api/admin/usuarios/pendientes', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    const rows = await getRows(
      'SELECT id, email, nombre, createdat FROM usuarios WHERE is_approved = 0 AND deleted_at IS NULL ORDER BY createdat DESC'
    );
    res.json({ success: true, data: rows });
  }));

  // POST /api/admin/usuarios/:id/aprobar
  app.post('/api/admin/usuarios/:id/aprobar', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });

    // Verificar que el usuario existe ANTES de aprobar — un id inválido no
    // debe responder success:true (falso positivo real, confirmado en
    // auditoría: el UPDATE contra un id inexistente afecta 0 filas y el
    // endpoint igual devolvía éxito).
    const objetivo = await getRow('SELECT id, email, nombre FROM usuarios WHERE id = ?', [req.params.id]);
    if (!objetivo) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    // Placeholder real (no literal "1"): bajo el fallback REST, restUpdate()
    // en database.config.js solo traduce placeholders $N en el SET — un
    // literal se descarta en silencio y el UPDATE no cambia nada.
    await runSql('UPDATE usuarios SET is_approved = ? WHERE id = ?', [1, req.params.id]);
    await registrarAuditoriaAdmin(req, 'aprobar', { id: req.params.id, email: objetivo.email });

    const activationToken = jwt.sign({ sub: objetivo.id, purpose: 'account_activated' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '30d' });
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    emailAdapter.sendAccountActivatedNotice(objetivo.email, {
      nombre: objetivo.nombre,
      validarUrl: `${frontendUrl}/validar?token=${activationToken}`,
    }).catch(e => console.warn('[aprobar] No se pudo notificar al usuario aprobado:', e.message));

    res.json({ success: true, message: 'Usuario aprobado — ya puede iniciar sesión.' });
  }));

  // POST /api/admin/usuarios/:id/rechazar
  app.post('/api/admin/usuarios/:id/rechazar', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    await runSql('UPDATE usuarios SET is_active = ? WHERE id = ?', [0, req.params.id]);
    const objetivo = await getRow('SELECT email FROM usuarios WHERE id = ?', [req.params.id]);
    await registrarAuditoriaAdmin(req, 'rechazar', { id: req.params.id, email: objetivo?.email });
    res.json({ success: true, message: 'Usuario rechazado.' });
  }));

  // GET /api/admin/usuarios — TODOS los usuarios (no solo pendientes), con su
  // user_subscriptions mergeado en JS (nunca JOIN — extractTable() del
  // traductor REST solo reconoce la primera tabla tras FROM/JOIN).
  app.get('/api/admin/usuarios', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    const usuarios = await getRows(
      'SELECT id, email, nombre, tipousuario, is_active, is_approved, createdat FROM usuarios WHERE deleted_at IS NULL ORDER BY createdat DESC'
    );
    const subs = await getRows('SELECT user_id, plan, access_radar, access_formulador, expires_at FROM user_subscriptions');
    const subsByUser = new Map(subs.map(s => [s.user_id, s]));
    const data = usuarios.map(u => {
      const s = subsByUser.get(u.id);
      return {
        id: u.id, email: u.email, nombre: u.nombre, role: u.tipousuario,
        is_active: !!u.is_active, is_approved: !!u.is_approved, created_at: u.createdat,
        plan: s?.plan || 'free', access_radar: !!s?.access_radar, access_formulador: !!s?.access_formulador,
        expires_at: s?.expires_at || null,
      };
    });
    res.json({ success: true, data });
  }));

  // PATCH /api/admin/usuarios/:id/permisos — matriz de módulos + vigencia + bloqueo
  app.patch('/api/admin/usuarios/:id/permisos', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    const targetId = req.params.id;
    const target = await getRow('SELECT id, email, tipousuario, is_active FROM usuarios WHERE id = ? AND deleted_at IS NULL', [targetId]);
    if (!target) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const { access_radar, access_formulador, expires_at, is_active } = req.body || {};

    // Protección "último admin activo" — mismo patrón que DELETE /api/usuarios/:id/purgar
    if (target.tipousuario === 'admin' && is_active === false && target.is_active) {
      const otrosAdmins = await getRows(
        "SELECT id FROM usuarios WHERE tipousuario = 'admin' AND is_active = 1 AND id != ? AND deleted_at IS NULL",
        [targetId]
      );
      if (otrosAdmins.length === 0) {
        return res.status(400).json({ success: false, message: 'No puedes desactivar al único administrador activo restante.' });
      }
    }

    if (typeof is_active === 'boolean') {
      await runSql('UPDATE usuarios SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, targetId]);
    }

    if (access_radar !== undefined || access_formulador !== undefined || expires_at !== undefined) {
      const existing = await getRow('SELECT access_radar, access_formulador FROM user_subscriptions WHERE user_id = ?', [targetId]);
      const nextRadar      = access_radar      !== undefined ? !!access_radar      : !!existing?.access_radar;
      const nextFormulador = access_formulador !== undefined ? !!access_formulador : !!existing?.access_formulador;
      const nextPlan = nextRadar && nextFormulador ? 'suite' : nextRadar ? 'radar' : nextFormulador ? 'formulador' : 'free';

      if (existing) {
        if (expires_at !== undefined) {
          await runSql(
            'UPDATE user_subscriptions SET plan = ?, access_radar = ?, access_formulador = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            [nextPlan, nextRadar ? 1 : 0, nextFormulador ? 1 : 0, expires_at || null, targetId]
          );
        } else {
          await runSql(
            'UPDATE user_subscriptions SET plan = ?, access_radar = ?, access_formulador = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            [nextPlan, nextRadar ? 1 : 0, nextFormulador ? 1 : 0, targetId]
          );
        }
      } else {
        await runSql(
          `INSERT INTO user_subscriptions (id, user_id, plan, access_radar, access_formulador, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), targetId, nextPlan, nextRadar ? 1 : 0, nextFormulador ? 1 : 0, expires_at || null]
        );
      }
    }

    await registrarAuditoriaAdmin(req, 'actualizar_permisos', {
      id: targetId, email: target.email,
      detalle: JSON.stringify({ access_radar, access_formulador, expires_at, is_active }),
    });

    const updatedUser = await getRow('SELECT is_active FROM usuarios WHERE id = ?', [targetId]);
    const updatedSub  = await getRow('SELECT plan, access_radar, access_formulador, expires_at FROM user_subscriptions WHERE user_id = ?', [targetId]);
    res.json({
      success: true, message: 'Permisos actualizados',
      data: {
        id: targetId, is_active: !!updatedUser?.is_active, plan: updatedSub?.plan || 'free',
        access_radar: !!updatedSub?.access_radar, access_formulador: !!updatedSub?.access_formulador,
        expires_at: updatedSub?.expires_at || null,
      },
    });
  }));

  // POST /api/dev/make-admin — utilidad SOLO de desarrollo local para elevar
  // una cuenta a rol admin sin depender de acceso directo a la BD (Supabase
  // MCP puede no estar disponible, como pasó esta sesión). Gateado a
  // NODE_ENV !== 'production' — en el deploy real (Render, NODE_ENV=production
  // confirmado) esta ruta ni siquiera se registra. Requiere sesión real
  // (authenticateToken) pero NO rol admin — exigirlo sería circular, ya que
  // el propósito es justamente obtenerlo.
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/dev/make-admin', authenticateToken, tryCatch(async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ success: false, message: 'email es requerido' });
      const user = await getRow('SELECT id, email, tipousuario FROM usuarios WHERE email = ?', [email]);
      if (!user) return res.status(404).json({ success: false, message: `No existe ningún usuario con email ${email}` });
      await runSql('UPDATE usuarios SET tipousuario = ? WHERE email = ?', ['admin', email]);
      console.warn(`[DEV] ${email} elevado a rol admin vía /api/dev/make-admin (por ${req.userId}).`);
      res.json({ success: true, message: `${email} ahora tiene rol admin. Vuelve a iniciar sesión para que el token lo refleje.` });
    }));
  }

  // GET /api/admin/finops — consumo agregado de IA (ai_token_logs, migración 034).
  // Usa SUM/GROUP BY — la Capa 2 (REST/PostgREST) de database.config.js no
  // traduce agregación SQL, solo filtros WHERE simples; este endpoint requiere
  // Capa 1 (pg.Pool) activa. Se degrada con un mensaje claro si falla, nunca
  // devuelve datos parciales/incorrectos en silencio.
  app.get('/api/admin/finops', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    try {
      const totales = await getRow(
        `SELECT COALESCE(SUM(tokens_input),0) AS tokens_input, COALESCE(SUM(tokens_output),0) AS tokens_output,
                COALESCE(SUM(cost_cop_estimated),0) AS costo_total_cop, COUNT(*) AS total_requests
         FROM ai_token_logs`
      );
      const porAgente = await getRows(
        `SELECT agent_name, COUNT(*) AS requests, COALESCE(SUM(tokens_input),0) AS tokens_input,
                COALESCE(SUM(tokens_output),0) AS tokens_output, COALESCE(SUM(cost_cop_estimated),0) AS costo_cop
         FROM ai_token_logs GROUP BY agent_name ORDER BY costo_cop DESC`
      );
      const topRaw = await getRows(
        `SELECT user_id, COUNT(*) AS requests, COALESCE(SUM(tokens_input),0) AS tokens_input,
                COALESCE(SUM(tokens_output),0) AS tokens_output, COALESCE(SUM(cost_cop_estimated),0) AS costo_cop
         FROM ai_token_logs GROUP BY user_id ORDER BY costo_cop DESC LIMIT 20`
      );
      // Sin JOIN a propósito (extractTable() de la Capa 2 solo reconoce la
      // primera tabla) — se resuelven los emails con una consulta separada y
      // se mergea en JS, mismo patrón que GET /api/admin/usuarios.
      const usuarios = await getRows('SELECT id, email FROM usuarios');
      const emailById = new Map(usuarios.map(u => [u.id, u.email]));
      const topUsuarios = topRaw.map(r => ({ ...r, email: emailById.get(r.user_id) || r.user_id }));

      res.json({ success: true, data: { totales, porAgente, topUsuarios } });
    } catch (e) {
      logger.warn('[finops] No se pudo agregar el consumo (¿Capa 2 activa?)', { err: e.message });
      res.status(503).json({ success: false, message: 'Reporte de FinOps no disponible en modo degradado — requiere conexión directa a la base de datos.' });
    }
  }));

  // GET /api/admin/system-status — estado ACTIVO/STANDBY de integraciones
  // (nunca expone valores de credenciales, solo si están presentes o no).
  app.get('/api/admin/system-status', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    const activo = v => !!(v && String(v).trim());
    res.json({
      success: true,
      data: {
        sentry:        activo(process.env.SENTRY_DSN) ? 'ACTIVO' : 'STANDBY',
        posthog:       activo(process.env.VITE_POSTHOG_KEY) ? 'ACTIVO' : 'STANDBY',
        stripe:        activo(process.env.STRIPE_SECRET_KEY) ? 'ACTIVO' : 'STANDBY',
        wompi:         activo(process.env.WOMPI_PRIVATE_KEY) ? 'ACTIVO' : 'STANDBY',
        resend:        activo(process.env.RESEND_API_KEY) ? 'ACTIVO' : 'STANDBY',
        brevo:         activo(process.env.BREVO_API_KEY) ? 'ACTIVO' : 'STANDBY',
        google_gemini: activo(process.env.GOOGLE_API_KEY) ? 'ACTIVO' : 'STANDBY',
        google_oauth:  activo(process.env.GOOGLE_CLIENT_ID) && activo(process.env.GOOGLE_CLIENT_SECRET) ? 'ACTIVO' : 'STANDBY',
        payment_provider_activo: (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase(),
      },
    });
  }));

  // ── Aprobación/rechazo de UN SOLO CLIC desde el correo — sin sesión ─────────
  // El correo de "nuevo registro pendiente" trae un link firmado (JWT,
  // purpose:'admin_pending_decision', atado al id del usuario objetivo,
  // 7 días de validez, un solo uso — mismo patrón que password_reset/
  // email_verification). Clickearlo aprueba/rechaza de inmediato, sin login
  // ni abrir el panel — esto es lo que se pidió explícitamente.
  async function verificarTokenAprobacionCorreo(targetId, token) {
    if (!token) return { ok: false, message: 'Enlace inválido — falta el token.' };
    if (isRevoked(token)) return { ok: false, message: 'Este enlace ya fue usado o fue invalidado.' };
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return { ok: false, message: 'El enlace es inválido o expiró.' };
    }
    if (payload.purpose !== 'admin_pending_decision' || payload.sub !== targetId) {
      return { ok: false, message: 'El enlace no corresponde a este usuario.' };
    }
    return { ok: true, payload };
  }

  function paginaResultadoAprobacion(titulo, mensaje, exito) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
      <title>${titulo} — RadFor-360</title></head>
      <body style="margin:0;background:#0b1326;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
        <div style="max-width:420px;padding:2.5rem;background:#0a1426;border:1px solid #1a3a50;border-radius:16px;text-align:center;">
          <p style="font-size:10px;font-family:monospace;color:#557997;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:8px;">RadFor-360</p>
          <div style="font-size:40px;margin-bottom:12px;">${exito ? '✅' : '⚠️'}</div>
          <h1 style="color:#e0e0ff;font-size:18px;margin:0 0 10px;">${titulo}</h1>
          <p style="color:#8bafcf;font-size:14px;line-height:1.5;">${mensaje}</p>
        </div>
      </body></html>`;
  }

  async function registrarAuditoriaAdminSinSesion(accion, objetivo, req) {
    try {
      const ip = req.ip || 'desconocida'; // FIX (auditoría SRE 2026-08-08): ver registrarAuditoriaAdmin
      await runSql(
        `INSERT INTO admin_audit_log (admin_id, admin_email, accion, objetivo_id, objetivo_email, detalle, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        // admin_id es NOT NULL — no hay sesión real en este flujo (click desde
        // el correo), se usa un valor centinela en vez de null.
        ['sistema-correo-1clic', process.env.ADMIN_NOTIFY_EMAIL || null, accion, objetivo.id, objetivo.email, `${accion === 'aprobar' ? 'Aprobado' : 'Rechazado'} con un clic desde el correo (sin sesión)`, ip]
      );
    } catch (e) { console.warn('[auditoria-admin] No se pudo registrar decisión por correo:', e.message); }
  }

  app.get('/api/admin/usuarios/:id/aprobar-por-correo', tryCatch(async (req, res) => {
    const check = await verificarTokenAprobacionCorreo(req.params.id, req.query.token);
    if (!check.ok) return res.status(400).send(paginaResultadoAprobacion('No se pudo aprobar', check.message, false));

    const objetivo = await getRow('SELECT id, email, nombre, is_approved FROM usuarios WHERE id = ?', [req.params.id]);
    if (!objetivo) return res.status(404).send(paginaResultadoAprobacion('Usuario no encontrado', 'La cuenta ya no existe.', false));

    if (objetivo.is_approved) {
      await revokeToken(req.query.token, req.params.id, check.payload.exp, runSql);
      return res.send(paginaResultadoAprobacion('Ya estaba aprobado', `${objetivo.email} ya tenía acceso habilitado.`, true));
    }

    await runSql('UPDATE usuarios SET is_approved = ? WHERE id = ?', [1, req.params.id]);
    await revokeToken(req.query.token, req.params.id, check.payload.exp, runSql);
    await registrarAuditoriaAdminSinSesion('aprobar', objetivo, req);

    // Cierra el círculo: el usuario recién aprobado recibe un correo con UN
    // botón ("Validar") que lo mete directo al portal ya con sesión iniciada
    // — token de un solo uso, 30 días de validez (no todos revisan el correo
    // el mismo día que se aprueban).
    const activationToken = jwt.sign({ sub: objetivo.id, purpose: 'account_activated' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '30d' });
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    emailAdapter.sendAccountActivatedNotice(objetivo.email, {
      nombre: objetivo.nombre,
      validarUrl: `${frontendUrl}/validar?token=${activationToken}`,
    }).catch(e => console.warn('[aprobar-por-correo] No se pudo notificar al usuario aprobado:', e.message));

    res.send(paginaResultadoAprobacion('Cuenta aprobada', `${objetivo.email} ya puede iniciar sesión. Le enviamos un correo con acceso directo al portal.`, true));
  }));

  app.get('/api/admin/usuarios/:id/rechazar-por-correo', tryCatch(async (req, res) => {
    const check = await verificarTokenAprobacionCorreo(req.params.id, req.query.token);
    if (!check.ok) return res.status(400).send(paginaResultadoAprobacion('No se pudo rechazar', check.message, false));

    const objetivo = await getRow('SELECT id, email FROM usuarios WHERE id = ?', [req.params.id]);
    if (!objetivo) return res.status(404).send(paginaResultadoAprobacion('Usuario no encontrado', 'La cuenta ya no existe.', false));

    await runSql('UPDATE usuarios SET is_active = ? WHERE id = ?', [0, req.params.id]);
    await revokeToken(req.query.token, req.params.id, check.payload.exp, runSql);
    await registrarAuditoriaAdminSinSesion('rechazar', objetivo, req);
    res.send(paginaResultadoAprobacion('Cuenta rechazada', `${objetivo.email} fue rechazada.`, true));
  }));

  // DELETE /api/usuarios/:id/purgar — Habeas Data (Ley 1581): Hard Delete real.
  // No existe ON DELETE CASCADE en usuarios→proyectos/user_favorites/user_subscriptions
  // (confdeltype='a', NO ACTION, verificado vía pg_constraint) — se hace cascada manual
  // en orden de dependencia. Cada DELETE usa igualdad simple de una sola columna a
  // propósito: el fallback REST (Capa 2, database.config.js) solo sabe traducir
  // condiciones simples a filtros PostgREST — un IN/subquery ahí se ignora en
  // silencio y el DELETE quedaría sin filtro, borrando la tabla completa.
  app.delete('/api/usuarios/:id/purgar', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    const targetId = req.params.id;
    if (targetId === req.userId) {
      return res.status(400).json({ success: false, message: 'No puedes purgar tu propia cuenta.' });
    }
    const target = await getRow('SELECT id, email, tipousuario FROM usuarios WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    if (target.tipousuario === 'admin') {
      const otrosAdmins = await getRows(
        "SELECT id FROM usuarios WHERE tipousuario = 'admin' AND is_active = 1 AND id != ? AND deleted_at IS NULL",
        [targetId]
      );
      if (otrosAdmins.length === 0) {
        return res.status(400).json({ success: false, message: 'No puedes purgar al único administrador activo restante.' });
      }
    }

    const proyectos = await getRows('SELECT id FROM proyectos WHERE user_id = ?', [targetId]);
    for (const p of proyectos) {
      // Únicas 2 tablas de proyecto con FK NO ACTION — el resto de project_* ya
      // tienen ON DELETE CASCADE real y se limpian solas al borrar el proyecto.
      await runSql('DELETE FROM versiones_proyecto WHERE proyecto_id = ?', [p.id]);
      await runSql('DELETE FROM project_budgets WHERE proyecto_id = ?', [p.id]);
    }
    await runSql('DELETE FROM proyectos WHERE user_id = ?', [targetId]);
    await runSql('DELETE FROM user_favorites WHERE user_id = ?', [targetId]);
    await runSql('DELETE FROM user_subscriptions WHERE user_id = ?', [targetId]);
    await runSql('DELETE FROM usuarios WHERE id = ?', [targetId]);

    // Se registra DESPUÉS del delete — admin_audit_log no tiene FK a usuarios
    // a propósito (el objetivo ya no existe tras purgar), queda como rastro
    // independiente.
    await registrarAuditoriaAdmin(req, 'purgar', {
      id: targetId, email: target.email,
      detalle: `${proyectos.length} proyecto(s) eliminado(s) en cascada`,
    });

    res.json({ success: true, message: 'Usuario y todos sus datos asociados purgados definitivamente (Habeas Data / Ley 1581).' });
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
  app.post('/api/auth/forgot-password', authLimiter, tryCatch(async (req, res) => {
    const { email } = req.body;
    // Respuesta idéntica exista o no el email (no revela enumeración de usuarios)
    res.json({ success: true, message: 'Si el email existe, recibirás un correo de recuperación' });
    if (!email) return;
    try {
      const user = await getRow('SELECT id, email FROM usuarios WHERE email = ? AND deleted_at IS NULL', [email.trim().toLowerCase()]);
      if (!user) return;
      // Token de reset = JWT de 1 hora
      const resetToken = jwt.sign({ sub: user.id, purpose: 'password_reset' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
      await emailAdapter.sendPasswordReset(user.email, resetLink);
    } catch (e) {
      console.error('[forgot-password] Error enviando email:', e.message);
    }
  }));

  // POST /api/auth/reset-password — aplica la nueva contraseña usando el
  // token del email de recuperación. Hallazgo real: este paso nunca existió
  // — forgot-password generaba el link pero nada lo consumía. Un solo uso:
  // se revoca el token inmediatamente tras aplicarse (reusa el mismo
  // mecanismo de blacklist que el logout — hash SHA-256, sin guardar el JWT
  // en crudo), así un link filtrado (logs de correo, historial) no sirve
  // dos veces aunque no haya expirado todavía.
  app.post('/api/auth/reset-password', authLimiter, tryCatch(async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, message: 'token y newPassword son requeridos' });
    }
    const errorPassword = validarFortalezaPassword(newPassword);
    if (errorPassword) return res.status(400).json({ success: false, message: errorPassword });

    if (isRevoked(token)) {
      return res.status(400).json({ success: false, message: 'Este enlace ya fue usado o fue invalidado. Solicita uno nuevo.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(400).json({ success: false, message: 'El enlace de recuperación es inválido o expiró. Solicita uno nuevo.' });
    }
    if (payload.purpose !== 'password_reset' || !payload.sub) {
      return res.status(400).json({ success: false, message: 'El enlace de recuperación es inválido.' });
    }

    const user = await getRow('SELECT id FROM usuarios WHERE id = ? AND deleted_at IS NULL', [payload.sub]);
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const newHash = await hashPassword(newPassword);
    await runSql('UPDATE usuarios SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    await runSql('UPDATE usuarios SET tokens_invalidated_at = NOW() WHERE id = ?', [user.id]);
    await revokeToken(token, user.id, payload.exp, runSql);

    res.json({ success: true, message: 'Contraseña actualizada correctamente. Inicia sesión con tu nueva contraseña.' });
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
    const enc = process.env.ENCRYPTION_KEY;
    if (!enc) return res.status(503).json({ success: false, message: 'Servicio de credenciales no disponible — ENCRYPTION_KEY no configurada' });
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
    // R1 = rastreadas por EntityScraper desde entidades del Directorio
    // R2 = rastreadas por DataIngestor desde portales web externos (fuente = RASTREO_WEB_EXTERNO)
    // La distinción es por fuente de ingesta, no por entidad_id (que puede ser asignado a posteriori).
    if (rastreo === '1') where += " AND c.fuente = 'RASTREO_DIRECTORIO'";
    if (rastreo === '2') where += " AND c.fuente = 'RASTREO_WEB_EXTERNO'";
    // Normalización de dominio: si el input parece un hostname (3+ partes), extraer root_domain
    function normDomain(v) {
      const t = v.trim();
      if (/^[a-z0-9\-]+(\.[a-z0-9\-]+){2,}$/i.test(t)) return extractRootDomain(t) || t;
      return t;
    }
    // Nota: el filtro `q` se aplica en JS post-fetch (accent-insensitive en ambas capas DB)
    if (entidad_id) { where += ' AND c.entidad_id = ?'; params.push(entidad_id); }
    // Todas = todas las abiertas | Nueva = abiertas ≤7 días | Abierta = abiertas >7 días
    // Usa fecha literal (no NOW()) para que el REST translator pueda parsearla.
    const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    if (estado === 'nueva') {
      where += ` AND c.estado = 'abierta' AND c.created_at >= '${hace7dias}'`;
    } else if (estado === 'abierta') {
      where += ` AND c.estado = 'abierta' AND c.created_at < '${hace7dias}'`;
    } else {
      where += ` AND c.estado = 'abierta'`;
    }
    if (sector && sector !== 'Todos') {
      // Whitelist estricta: solo sectores conocidos + fragmentos alfanuméricos sin tokens SQL
      const SECTORES_PERMITIDOS = new Set([
        'Hábitat y Territorio','Soberanía y Vida','Paz y Sociedad',
        'Autonomía Económica','Cooperación Internacional','Futuro y Conocimiento',
        'Construcción','Vivienda','Transporte','Ordenamiento Territorial',
        'Agua','Saneamiento','Salud','Alimentación','Energía',
        'Seguridad','Justicia','Cultura','Deporte','Educación',
        'Inclusión Social','Equidad de Género','Emprendimiento','Empleo',
        'Turismo','Agropecuario','Medio Ambiente','Tecnología','Investigación',
        'Todos',
      ]);
      const _cleanSector = (v) => {
        const s = String(v).trim().slice(0, 120);
        // Rechazar si contiene tokens SQL peligrosos
        if (/union|select|insert|update|delete|drop|--|;|\/\*/i.test(s)) return null;
        return s;
      };
      const sectorList = String(sector).split('|||')
        .map(_cleanSector).filter(Boolean)
        .filter(s => SECTORES_PERMITIDOS.has(s) || /^[\p{L}\p{N}\s&áéíóúñÁÉÍÓÚÑüÜ,.()\-]+$/u.test(s));
      if (sectorList.length === 1) {
        where += ' AND c.sectores ILIKE ?'; params.push(`%${sectorList[0]}%`);
      } else if (sectorList.length > 1) {
        where += ` AND (${sectorList.map(() => 'c.sectores ILIKE ?').join(' OR ')})`;
        sectorList.forEach(s => params.push(`%${s}%`));
      }
    }
    if (pais && pais !== 'Todos') {
      // Solo letras, espacios y caracteres propios de nombres de países
      const _cleanPais = String(pais).trim().slice(0, 80);
      if (!/union|select|insert|update|delete|drop|--|;|\/\*/i.test(_cleanPais) &&
          /^[\p{L}\p{N}\s&áéíóúñÁÉÍÓÚÑüÜ,.()\-]+$/u.test(_cleanPais)) {
        where += ' AND c.paises_elegibles ILIKE ?';
        params.push(`%${_cleanPais}%`);
      }
    }

    // Filtro JS accent-insensitive para el término de búsqueda `q`
    // (funciona en Capa 1/pg y Capa 2/REST sin depender de unaccent() en la DB)
    const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const searchTerms = q
      ? q.split(/[+,]/).map(t => {
          const n = normDomain(t.trim());
          return norm(n !== t.trim() ? n : t.trim());
        }).filter(Boolean)
      : [];

    // Cuando hay búsqueda de texto, traer todas las filas sin LIMIT para filtrar en JS
    let rows, total;
    if (searchTerms.length > 0) {
      const allSql = `SELECT c.*, de.nombre AS entidad_nombre, de.sigla AS entidad_sigla, de.tipo AS entidad_tipo, de.pais AS entidad_pais FROM convocatorias c LEFT JOIN directorio_entidades de ON de.id = c.entidad_id ${where} ORDER BY c.created_at DESC LIMIT 2000`;
      const allRows = await getRows(allSql, params);
      // Filtro accent-insensitive en JS: todos los términos deben coincidir (AND)
      const filtered = allRows.filter(r =>
        searchTerms.every(t =>
          norm(r.titulo).includes(t) ||
          norm(r.donante).includes(t) ||
          norm(r.descripcion).includes(t) ||
          norm(r.sectores).includes(t) ||
          norm(r.paises_elegibles).includes(t) ||
          norm(r.root_domain).includes(t)
        )
      );
      total = filtered.length;
      const offset = (Number(page) - 1) * Number(limit);
      rows = filtered.slice(offset, offset + Number(limit));
    } else {
      // Sin búsqueda: COUNT + LIMIT/OFFSET en DB (más eficiente)
      const countSql = `SELECT COUNT(*) AS cnt FROM convocatorias c LEFT JOIN directorio_entidades de ON de.id = c.entidad_id ${where}`;
      const totalRow = await getRow(countSql, params);
      total = Number(totalRow?.cnt ?? 0);
      const dataSql = `SELECT c.*, de.nombre AS entidad_nombre, de.sigla AS entidad_sigla, de.tipo AS entidad_tipo, de.pais AS entidad_pais FROM convocatorias c LEFT JOIN directorio_entidades de ON de.id = c.entidad_id ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
      rows = await getRows(dataSql, [...params, Number(limit), (Number(page) - 1) * Number(limit)]);
    }

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

  // GET /api/entidades — fetch directo PostgREST (evita problemas del SQL translator con subqueries)
  app.get('/api/entidades', tryCatch(async (req, res) => {
    const { q, tipo, pais, page = 1, limit = 500 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const filters = ['deleted_at=is.null'];
    if (q)    filters.push(`or=(nombre.ilike.${encodeURIComponent(`%${q}%`)},sigla.ilike.${encodeURIComponent(`%${q}%`)})`);
    if (tipo) filters.push(`tipo=eq.${encodeURIComponent(tipo)}`);
    if (pais) filters.push(`pais=eq.${encodeURIComponent(pais)}`);
    const qs = `${filters.join('&')}&order=nombre.asc&limit=${Number(limit)}&offset=${offset}`;
    const r   = await fetch(`${SB_ADMIN_URL}/rest/v1/directorio_entidades?${qs}`, { headers: PGREST_HEADERS });
    if (!r.ok) { const err = await r.json().catch(() => ({})); return res.status(500).json({ success: false, message: err.message || 'Error al leer directorio' }); }
    const rows = await r.json();
    res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
  }));

  // POST /api/entidades — crea nueva entidad desde URL o manualmente
  app.post('/api/entidades', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { nombre, sigla, tipo, pais, sitio_web, url_convocatorias, telefono, email, alcance } = req.body || {};
    if (!nombre || !sitio_web) return res.status(400).json({ success: false, message: 'nombre y sitio_web son requeridos' });

    // ── Chequeo de duplicado — fail-CLOSED: si hay duda, bloquea ────────────
    const entRoot = getApexDomain(sitio_web.trim()) || '';
    const urlConvRoot = url_convocatorias ? (getApexDomain(url_convocatorias.trim()) || '') : '';
    try {
      // Capa 1 (pg Pool): compara root_domain, url_convocatorias Y nombre
      const roots = [entRoot, urlConvRoot].filter(Boolean);
      const dupCheck = await getRow(
        `SELECT id, nombre FROM directorio_entidades
         WHERE deleted_at IS NULL AND (
           LOWER(nombre) = LOWER(?)
           ${roots.length ? `OR root_domain = ANY(ARRAY[${roots.map(() => '?').join(',')}]::text[])
           OR LOWER(COALESCE(sitio_web,''))       LIKE ANY(ARRAY[${roots.map(() => "'%' || ? || '%'").join(',')}])
           OR LOWER(COALESCE(url_convocatorias,'')) LIKE ANY(ARRAY[${roots.map(() => "'%' || ? || '%'").join(',')}])` : ''}
         ) LIMIT 1`,
        [nombre.trim(), ...roots, ...roots, ...roots]
      );
      if (dupCheck) {
        return res.status(409).json({ success: false, code: 'DUPLICATE', message: `ENTIDAD YA ESTA INSCRITA: "${dupCheck.nombre}"` });
      }
    } catch (dupErr) {
      // Fail-closed: si el check falla, bloquear inserción para evitar duplicados
      console.warn('[POST /api/entidades] Chequeo de duplicado falló — bloqueando inserción por seguridad:', dupErr.message?.slice(0, 120));
      return res.status(503).json({ success: false, message: 'No se pudo verificar duplicados — reintenta en un momento' });
    }

    // ── Chequeo de dominio bloqueado — el usuario lo eliminó y bloqueó antes ──
    // Sin deleted_at IS NULL a propósito: la fila bloqueada queda soft-deleted
    // pero debe seguir siendo encontrable por root_domain.
    if (entRoot) {
      try {
        const bloqueado = await getRow(
          "SELECT id FROM directorio_entidades WHERE root_domain = ? AND validation_status = ?",
          [entRoot, 'BLOQUEADO']
        );
        if (bloqueado) {
          return res.status(409).json({
            success: false, code: 'DOMINIO_BLOQUEADO',
            message: 'Este dominio fue eliminado y bloqueado manualmente — no aplica a convocatorias de subvención.',
          });
        }
      } catch (e) {
        console.warn('[POST /api/entidades] Error consultando bloqueo de dominio:', e.message);
      }
    }

    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    await runSql(
      `INSERT INTO directorio_entidades
       (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias, telefono, email, alcance,
        validation_status, fuente, root_domain, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nombre.trim(), (sigla||'').trim(), (tipo||'ENTIDAD').trim(), (pais||'').trim(),
       sitio_web.trim(), (url_convocatorias||'').trim(), (telefono||'').trim(),
       (email||'').trim(), (alcance||'Internacional').trim(), 'IMPORTADO', 'manual',
       entRoot || null, now, now]
    );
    // ── MOTOR DE COINCIDENCIA CODICIOSA (Greedy Match) ───────────────────────
    // Regla: RADAR 1 para todo lo que tenga la más mínima sospecha de relación.
    // Tres pruebas; cualquier TRUE mueve la convocatoria a Rastreo 1 al instante.
    const trimNombre = nombre.trim();
    const trimSigla  = (sigla || '').trim();

    // Prueba 1 — TEXTO FUZZY (nombre/sigla vs donante, ambas direcciones)
    // · exacto nombre · exacto sigla · donante⊃nombre · nombre⊃donante · donante⊃sigla
    try {
      await runSql(`
        UPDATE convocatorias SET entidad_id = ?
        WHERE entidad_id IS NULL AND deleted_at IS NULL
          AND (
            LOWER(donante) = LOWER(?)
            OR (? != '' AND LOWER(donante) = LOWER(?))
            OR LOWER(donante) LIKE '%' || LOWER(?) || '%'
            OR (LENGTH(donante) > 4 AND LOWER(?) LIKE '%' || LOWER(donante) || '%')
            OR (? != '' AND LENGTH(?) > 2 AND LOWER(donante) LIKE '%' || LOWER(?) || '%')
          )
      `, [id, trimNombre, trimSigla, trimSigla, trimNombre, trimNombre, trimSigla, trimSigla, trimSigla]);
      invalidateRadarCache();
    } catch (e) { console.warn('[greedy/T1-texto]', e.message?.slice(0, 120)); }

    // Prueba 2 — HOSTNAME endsWith (Regla de Pertenencia por Inclusión).
    // Extrae el hostname de la URL y aplica .endsWith(entity.root_domain).
    // Cubre: entidad 'wellcome.org' captura conv. 'https://funding.wellcome.org/...'
    if (entRoot) {
      try {
        await runSql(`
          UPDATE convocatorias SET entidad_id = ?, root_domain = COALESCE(root_domain, ?)
          WHERE entidad_id IS NULL AND deleted_at IS NULL
            AND (
              -- exact root_domain match
              LOWER(COALESCE(root_domain,'')) = LOWER(?)
              -- root_domain es subdominio (endsWith con punto — evita false positives)
              OR LOWER(COALESCE(root_domain,'')) LIKE '%.' || LOWER(?)
              -- hostname de url_fuente endsWith entity.root_domain
              OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_fuente,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) = LOWER(?)
              OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_fuente,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) LIKE '%.' || LOWER(?)
              -- hostname de url_convocatoria endsWith entity.root_domain
              OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_convocatoria,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) = LOWER(?)
              OR SPLIT_PART(REGEXP_REPLACE(LOWER(COALESCE(url_convocatoria,'')),'^https{0,1}://(www\\.){0,1}',''),'/',1) LIKE '%.' || LOWER(?)
            )
        `, [id, entRoot, entRoot, entRoot, entRoot, entRoot, entRoot, entRoot]);
        invalidateRadarCache();
      } catch (e) { console.warn('[greedy/T2-host]', e.message?.slice(0, 120)); }
    }

    // Prueba 3 — EMAIL DOMAIN (donante con formato user@dominio coincide con root_domain)
    // Ej: "BCF-Flexigrant@niras.com" → dominio "niras.com" == entRoot "niras.com"
    if (entRoot) {
      const safeRoot = entRoot.replace(/[%_\\;'"]/g, '');
      try {
        await runSql(`
          UPDATE convocatorias SET entidad_id = ?
          WHERE entidad_id IS NULL AND deleted_at IS NULL
            AND donante LIKE '%@%'
            AND LOWER(SUBSTRING(donante FROM POSITION('@' IN donante) + 1)) LIKE '%' || LOWER(?) || '%'
        `, [id, safeRoot]);
        invalidateRadarCache();
      } catch (e) { console.warn('[greedy/T3-email]', e.message?.slice(0, 120)); }
    }

    const row = await getRow('SELECT * FROM directorio_entidades WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: row });

    // Rastreo automático en background para la entidad recién agregada
    setImmediate(async () => {
      try {
        const { ingestDirectorioConvocatorias } = await import('./backend/pipeline/EntityScraper.js');
        await ingestDirectorioConvocatorias({ soloEntidadId: id });
        console.log(`[Rastreo1/auto] ✓ Entidad ${nombre} rastreada tras inserción`);
      } catch (e) {
        console.warn(`[Rastreo1/auto] Error rastreando ${nombre}:`, e.message?.slice(0, 100));
      }
    });
  }));

  // POST /api/entidades/lookup — analiza URL con Gemini y valida si aplica a Colombia
  app.post('/api/entidades/lookup', authenticateToken, aiLimiter, tryCatch(async (req, res) => {
    const { url, url_convocatorias: urlConvInput } = req.body || {};
    if (!url) return res.status(400).json({ success: false, message: 'url requerida' });
    let hostname = '';
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { return res.status(400).json({ success: false, message: 'URL inválida' }); }
    const siglaFallback = hostname.split('.')[0].toUpperCase().slice(0, 8);

    // Sub-ruta: si el usuario pega una URL profunda (p.ej. /grants?query=...), separar
    // sitio_web (dominio raíz) de url_convocatorias (la URL exacta provista).
    let rootUrl = url;
    let hasSubPath = false;
    try {
      const _u = new URL(url);
      rootUrl = `${_u.protocol}//${_u.host}`;
      hasSubPath = _u.pathname !== '/' && _u.pathname !== '' && _u.pathname.length > 1;
    } catch { /* rootUrl = url */ }

    // getApexDomain: funding.wellcome.org → wellcome.org | sena.edu.co → sena.edu.co
    const domainRoot = getApexDomain(hostname) || hostname;

    // ── Bloqueo manual: dominio eliminado y bloqueado por el usuario ────────
    // Corta el flujo ANTES de scrapear/llamar a Gemini — un dominio bloqueado
    // nunca debe volver a aparecer como Aprobado, sin importar el heurístico.
    try {
      const bloqueado = await getRow(
        "SELECT id FROM directorio_entidades WHERE root_domain = ? AND validation_status = ?",
        [domainRoot, 'BLOQUEADO']
      );
      if (bloqueado) {
        return res.json({
          success: true,
          data: {
            nombre: siglaFallback, sigla: siglaFallback, sitio_web: url, url_convocatorias: '',
            tipo: '', pais: '', alcance: '', email: '', telefono: '', fuente: hostname,
            estado: 'Rechazado', aplica_colombia: false,
            resumen: '[Bloqueado] Este dominio fue eliminado y bloqueado manualmente — no aplica a convocatorias de subvención.',
          },
        });
      }
    } catch (e) {
      console.warn('[lookup/bloqueo] Error consultando bloqueo de dominio:', e.message);
    }

    // ── Scraping del HTML de la página ──────────────────────────────────────
    let pageTitle = siglaFallback;
    let rawHtml   = '';
    let pageText  = '';

    // Patrones que indican un título de pestaña genérico, no el nombre oficial
    const NOISY_TITLE = /^(home|homepage|inicio|index|welcome|bienvenid|convocatorias?|grants?|funding|opportunities|page not found|error\s*\d|search|suchergebnisse|ergebnisse|zoekresultaten|résultats|risultati|resultados?|search\s*result|filter|browse|catalog|liste?|directory|login|signin|register)/i;

    function extractOfficialNameFromHtml(html, domainFallback) {
      // 1. JSON-LD schema.org Organization.name — más autoritativo
      const ldBlocks = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
      for (const m of ldBlocks) {
        try {
          const nodes = (() => { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : [j, ...(j['@graph'] ?? [])]; })();
          for (const node of nodes) {
            if (/Organization|NGO|GovernmentOrg|Educational|Corporation|Foundation/i.test(node['@type'] ?? '')) {
              if (typeof node.name === 'string' && node.name.trim().length >= 3) return node.name.trim().slice(0, 120);
            }
          }
        } catch { /* JSON inválido */ }
      }
      // 2. og:site_name — nombre del sitio, no del artículo
      const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
                  ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
      if (ogSite?.[1]?.trim() && !NOISY_TITLE.test(ogSite[1].trim())) return ogSite[1].trim().slice(0, 120);
      // 3. <title> limpio: quitar el segmento ruidoso y conservar el nombre real
      const rawTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '';
      if (rawTitle) {
        const parts = rawTitle.split(/\s*[\|–\-—]\s*/);
        const clean = parts.find(p => !NOISY_TITLE.test(p.trim()) && p.trim().length >= 3);
        if (clean) return clean.trim().slice(0, 120);
      }
      // 4. meta application-name
      const appName = html.match(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)?.[1];
      if (appName?.trim() && !NOISY_TITLE.test(appName)) return appName.trim().slice(0, 120);
      // 5. Dominio como último recurso
      return domainFallback;
    }

    try {
      const resp = await fetchResiliente(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0' } });
      rawHtml = (await resp.text()).slice(0, 500_000); // cap: evita spike de memoria en sitios grandes
      pageTitle = extractOfficialNameFromHtml(rawHtml, siglaFallback);
      // Texto plano (strip tags, colapsar espacios)
      pageText = rawHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 6000);
    } catch { /* usar dominio como fallback */ }

    // ── Sub-ruta: obtener nombre oficial desde el dominio raíz ───────────────
    // Cuando el usuario pega una URL profunda (p.ej. /Suchergebnisse.jsp?query=grants),
    // el <title> de esa sub-página es el título de la PÁGINA, no el nombre de la ORG.
    // Fetch adicional al dominio raíz para extraer el nombre correcto.
    if (hasSubPath && rootUrl !== url) {
      try {
        const rootResp = await fetchResiliente(rootUrl, {
          signal: AbortSignal.timeout(9000),
          headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', Accept: 'text/html' },
        });
        if (rootResp.ok) {
          const rootHtml = (await rootResp.text()).slice(0, 300_000);
          const rootName = extractOfficialNameFromHtml(rootHtml, siglaFallback);
          if (rootName && rootName !== siglaFallback && !NOISY_TITLE.test(rootName)) {
            pageTitle = rootName;
            console.info(`[lookup/rootName] ✓ Nombre desde raíz "${rootUrl}": "${rootName}"`);
          }
        }
      } catch (e) {
        console.warn('[lookup/rootName] fetch raíz falló:', e.message?.slice(0, 80));
      }
    }

    // ── CAPA 0: Validación cruzada con Rastreo 2 ─────────────────────────────
    // Si R2 ya tiene convocatorias de este dominio raíz, la entidad es válida.
    // No tiene sentido rechazarla si nuestra propia BD la conoce.
    let autoApprovedByR2 = false;
    let r2SampleDonante = '';
    try {
      const safeRoot = domainRoot.replace(/[%_\\;'"]/g, '');
      const r2Row = await getRow(
        `SELECT donante FROM convocatorias
         WHERE deleted_at IS NULL AND entidad_id IS NULL
           AND (url_fuente ILIKE ? OR url_convocatoria ILIKE ?)
         LIMIT 1`,
        [`%${safeRoot}%`, `%${safeRoot}%`]
      );
      if (r2Row) {
        autoApprovedByR2 = true;
        r2SampleDonante  = r2Row.donante || '';
        console.info(`[lookup/capa0] ✓ "${safeRoot}" encontrado en R2 (donante: "${r2SampleDonante}") → auto-aprobado.`);
      }
    } catch (e) {
      console.warn('[lookup/capa0] Error en validación cruzada:', e.message);
    }

    // ── Extracción heurística de campos de contacto desde el HTML ───────────
    function extractEmail(html) {
      // 1) mailto: links
      const mailto = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g) || [];
      if (mailto.length) return mailto[0].replace('mailto:', '').toLowerCase();
      // 2) texto plano (excluir noreply, example)
      const plain = html.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g) || [];
      return plain.find(e => !/noreply|example|domain|sentry|test@/.test(e))?.toLowerCase() ?? '';
    }
    function extractPhone(text) {
      const m = text.match(/(?:\+?[\d\s\-().]{7,18}(?=\D|$))/g) || [];
      return m.find(p => {
        const digits = p.replace(/\D/g,'');
        return digits.length >= 7 && digits.length <= 15;
      })?.trim() ?? '';
    }
    function extractSigla(title, hostname) {
      // Si el título tiene palabras en mayúscula que parezcan sigla
      const caps = title.match(/\b[A-Z]{2,8}\b/g);
      if (caps?.length) return caps[0];
      // Fallback: primera letra de cada palabra del título (máx 5)
      const words = title.split(/\s+/).filter(w => /^[A-Z]/.test(w));
      if (words.length >= 2) return words.slice(0,5).map(w=>w[0]).join('');
      return hostname.split('.')[0].toUpperCase().slice(0,6);
    }
    function inferPais(text, hostname) {
      const t = (text + ' ' + hostname).toLowerCase();
      const map = [
        ['colombia','Colombia'],['españa','España'],['spain','España'],
        ['germany','Alemania'],['alemania','Alemania'],['giz.de','Alemania'],
        ['united states','Estados Unidos'],['usaid','Estados Unidos'],
        ['france','Francia'],['agence française','Francia'],
        ['united kingdom','Reino Unido'],['british','Reino Unido'],
        ['netherlands','Países Bajos'],['dutch','Países Bajos'],
        ['sweden','Suecia'],['sida.se','Suecia'],
        ['norway','Noruega'],['norad','Noruega'],
        ['japan','Japón'],['jica','Japón'],
        ['canada','Canadá'],['mexico','México'],['brazil','Brasil'],
        ['belgique','Bélgica'],['belgium','Bélgica'],
        ['switzerland','Suiza'],['suiza','Suiza'],
        ['denmark','Dinamarca'],['danida','Dinamarca'],
        ['multilateral','Internacional'],['worldbank','Internacional'],
        ['undp','Internacional'],['unicef','Internacional'],
        ['onu','Internacional'],['oecd','Internacional'],
        ['bid.org','Internacional'],['iadb','Internacional'],
      ];
      for (const [kw, pais] of map) if (t.includes(kw)) return pais;
      return 'Internacional';
    }
    function inferTipo(text, hostname) {
      const t = (text + ' ' + hostname).toLowerCase();
      if (/banco|bank|financ|credit|ifad|iadb|bid\.org|worldbank/.test(t)) return 'BANCO_DESARROLLO';
      if (/onu|unicef|undp|unfpa|pnud|unops|oms|who|fao|ifad|wfp|unesco/.test(t)) return 'MULTILATERAL';
      if (/ministerio|ministry|gobern|gobierno|agencia.*estado|giz|usaid|aecid|jica|sida|norad|danida/.test(t)) return 'BILATERAL';
      if (/fundaci|foundation|fund\b/.test(t)) return 'FUNDACION';
      if (/univers|academ|college|institute|research/.test(t)) return 'ACADEMIA';
      if (/ong|ngo|civil|nonprofit|no.?profit|asociaci/.test(t)) return 'ONG';
      return 'ENTIDAD';
    }
    function inferAlcance(text) {
      const t = text.toLowerCase();
      if (/global|worldwide|internacional|multilateral|world/.test(t)) return 'Internacional';
      if (/latinoam|iberoam|carib|regional|hemisfer|america latina/.test(t)) return 'Regional';
      return 'Internacional';
    }
    function extractUrlConvocatorias(html, base) {
      const patterns = [/href="([^"]*(?:grant|call|convocator|funding|opportunit|apply|becas|financiamiento)[^"]*)"/gi];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m?.length) {
          const href = m[0].match(/href="([^"]+)"/)?.[1] ?? '';
          if (!href) continue;
          try { return new URL(href, base).href; } catch { /* ignore */ }
        }
      }
      return base;
    }

    const scrapedEmail   = extractEmail(rawHtml || '');
    const scrapedPhone   = extractPhone(pageText);
    const scrapedSigla   = extractSigla(pageTitle, hostname);
    const scrapedPais    = inferPais(pageText + pageTitle, hostname);
    const scrapedTipo    = inferTipo(pageText + pageTitle, hostname);
    const scrapedAlcance = inferAlcance(pageText + pageTitle);
    let urlConvFinal = extractUrlConvocatorias(rawHtml || '', url);
    // Sub-ruta: la URL exacta que el usuario pegó ES la página de grants → preservarla
    if (hasSubPath) urlConvFinal = url;

    // ── Deep Search: busca sub-páginas de grants cuando la URL raíz no basta ─
    // Estrategia 0: parseo de links de la homepage (usa rawHtml ya cargado — sin request extra).
    // Estrategia A: Gemini con Google Search Grounding.
    // Estrategia B: sitemap.xml.
    // Estrategia C: sondeo de rutas canónicas.
    // Estrategia D: subdominios canónicos.
    const LINK_GRANT_KW = /convocator|becas?|grant|fund(?!ament)|financiami|cooperaci|postulaci|llamado|oportunidad(?:es)?|programa(?:s)?|iniciativa|apoyo|subsidio|subvenci|fellowship|award|call[-_]|apply|edital|appel|opportunity|open[-_]call/i;
    async function runDeepSearch(orgName, domain, apiKey) {
      // ── Estrategia 0: parsear links de la homepage ya descargada (sin request extra) ──
      // rawHtml es accesible por closure. Extrae todos los <a href> cuyo href o texto
      // contenga palabras clave de grants. Luego fetcha esas páginas y verifica contenido.
      if (rawHtml) {
        const FETCH_OPTS = { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', Accept: 'text/html' } };
        const homeBase = `https://${domain}`;
        const grantLinks = new Set();
        // Extraer pares (href, anchorText) del HTML
        for (const m of rawHtml.matchAll(/href=["']([^"'#?][^"']*?)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
          const href = m[1].trim();
          const text = m[2].replace(/<[^>]+>/g, ' ').trim();
          if (LINK_GRANT_KW.test(href) || LINK_GRANT_KW.test(text)) {
            try {
              const abs = new URL(href, homeBase).href;
              if (new URL(abs).hostname.endsWith(domain)) grantLinks.add(abs);
            } catch { /* href relativo inválido */ }
          }
        }
        // También buscar atributos aria-label y title con keywords
        for (const m of rawHtml.matchAll(/href=["']([^"'#?][^"']*?)["'][^>]*(?:aria-label|title)=["']([^"']{3,120})["']/gi)) {
          const href = m[1].trim(); const label = m[2];
          if (LINK_GRANT_KW.test(label)) {
            try { const abs = new URL(href, homeBase).href; if (new URL(abs).hostname.endsWith(domain)) grantLinks.add(abs); } catch {}
          }
        }
        const candidates = [...grantLinks].slice(0, 8); // máximo 8 links a sondear
        for (const linkUrl of candidates) {
          try {
            const r = await fetchResiliente(linkUrl, FETCH_OPTS);
            if (!r.ok) continue;
            const snippet = (await r.text()).slice(0, 12000);
            if (LINK_GRANT_KW.test(snippet)) {
              console.info(`[deep/S0] ✓ Link de grants en nav: ${linkUrl}`);
              return { aplica: true, deep_url: linkUrl, evidencia: `Página de convocatorias encontrada en navegación del sitio: ${linkUrl}`, nombre_oficial: orgName };
            }
          } catch { /* continuar */ }
        }
      }

      // ── Estrategia 0.5: crawl BFS de 2 niveles sobre TODOS los links internos ──
      // La Estrategia 0 solo sigue <a> cuyo href/texto YA contiene una keyword de
      // grants (p.ej. no habría seguido "/convocatoria" en singular si el regex
      // solo hubiese cazado plurales, o un link de menú sin texto descriptivo).
      // Esta estrategia visita TODOS los links internos de la home (sin filtrar
      // por keyword) y, si una de esas páginas de nivel 1 enlaza a su vez a algo
      // con pinta de grants, también la sigue — un rastreo real de profundidad 2,
      // no solo coincidencias de texto en la portada.
      if (rawHtml) {
        const FETCH_OPTS2 = { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', Accept: 'text/html' } };
        const homeBase = `https://${domain}`;
        const nivel1 = new Set();
        // Solo <a href="...">, no CSS/JS/link[rel] — evita que el tope de 15
        // candidatos se agote con assets (bootstrap.css, app.js, etc.) antes
        // de llegar a los enlaces de navegación reales.
        for (const m of rawHtml.matchAll(/<a\s[^>]*?href=["']([^"'#?][^"']*?)["']/gi)) {
          const href = m[1].trim();
          if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
          try {
            const abs = new URL(href, homeBase).href;
            if (new URL(abs).hostname.endsWith(domain)) nivel1.add(abs);
          } catch { /* href inválido */ }
        }
        const candidatosN1 = [...nivel1].slice(0, 15);
        let visitasNivel2 = 0;
        for (const linkUrl of candidatosN1) {
          try {
            const r = await fetchResiliente(linkUrl, FETCH_OPTS2);
            if (!r.ok) continue;
            const html2 = (await r.text()).slice(0, 15000);
            if (LINK_GRANT_KW.test(html2)) {
              console.info(`[deep/S0.5] ✓ Página de nivel 1 con evidencia de grants: ${linkUrl}`);
              return { aplica: true, deep_url: linkUrl, evidencia: `Página encontrada tras rastreo interno del sitio: ${linkUrl}`, nombre_oficial: orgName };
            }
            if (visitasNivel2 >= 6) continue;
            for (const m2 of html2.matchAll(/href=["']([^"'#?][^"']*?)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
              if (visitasNivel2 >= 6) break;
              const href2 = m2[1].trim();
              const text2 = m2[2].replace(/<[^>]+>/g, ' ').trim();
              if (!(LINK_GRANT_KW.test(href2) || LINK_GRANT_KW.test(text2))) continue;
              try {
                const abs2 = new URL(href2, linkUrl).href;
                if (!new URL(abs2).hostname.endsWith(domain)) continue;
                visitasNivel2++;
                const r2 = await fetchResiliente(abs2, FETCH_OPTS2);
                if (!r2.ok) continue;
                const html3 = (await r2.text()).slice(0, 15000);
                if (LINK_GRANT_KW.test(html3)) {
                  console.info(`[deep/S0.5] ✓ Página de nivel 2 con evidencia de grants: ${abs2}`);
                  return { aplica: true, deep_url: abs2, evidencia: `Página encontrada tras rastreo interno de 2 niveles: ${abs2}`, nombre_oficial: orgName };
                }
              } catch { /* continuar con el siguiente link de nivel 2 */ }
            }
          } catch { /* continuar con el siguiente candidato de nivel 1 */ }
        }
      }

      // ── Estrategia B-sitemap: parsear sitemap.xml del dominio ──────────────
      {
        const SITEMAP_URLS = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`, `https://www.${domain}/sitemap.xml`];
        for (const sUrl of SITEMAP_URLS) {
          try {
            const r = await fetchResiliente(sUrl, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0' } });
            if (!r.ok) continue;
            const sText = await r.text();
            // Buscar <loc> URLs con keywords de grants
            for (const m of sText.matchAll(/<loc>([^<]+)<\/loc>/g)) {
              const sitemapUrl = m[1].trim();
              if (LINK_GRANT_KW.test(sitemapUrl)) {
                console.info(`[deep/Bsitemap] ✓ URL en sitemap: ${sitemapUrl}`);
                return { aplica: true, deep_url: sitemapUrl, evidencia: `URL de convocatorias/grants encontrada en sitemap.xml`, nombre_oficial: orgName };
              }
            }
          } catch { /* continuar */ }
        }
      }

      // A) Gemini Search Grounding — una sola llamada, busca Y evalúa
      // apiKey es undefined cuando el circuit breaker está cerrado: se omite Strategy A.
      if (apiKey) try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: 'gemini-2.0-flash',
          tools: [{ googleSearch: {} }],
        });
        const deepPrompt =
          `Organización: "${orgName}" — Dominio: ${domain}\n\n` +
          `Tarea: busca si esta organización tiene programas de grants, fundaciones, filantropía, ` +
          `cooperación internacional, becas o financiamiento aplicables a Colombia o América Latina. ` +
          `Revisa todo el dominio ${domain} (no solo la homepage): busca rutas como /grants, /foundation, ` +
          `/philanthropy, /csr, /social-impact, /giving, /convocatorias, /becas, /responsibility.\n\n` +
          `Responde EXCLUSIVAMENTE con JSON válido (sin bloques markdown ni texto extra):\n` +
          `{"aplica_colombia":true,"deep_url":"URL exacta de la página de grants encontrada","evidencia":"descripción breve de los programas","nombre_oficial":"nombre oficial de la organización"}`;
        const result = await model.generateContent(deepPrompt);
        const text = result.response.text().trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.aplica_colombia && parsed.deep_url) {
            return { aplica: true, deep_url: parsed.deep_url, evidencia: parsed.evidencia ?? '', nombre_oficial: parsed.nombre_oficial };
          }
        }
        // Extraer URLs de los chunks de grounding aunque el JSON falle
        const chunks = result.response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const foundUrl = chunks.map(c => c.web?.uri).find(u => {
          try { return new URL(u).hostname.includes(domain); } catch { return false; }
        });
        if (foundUrl) {
          return { aplica: true, deep_url: foundUrl, evidencia: 'Sub-página encontrada por Google Search Grounding', nombre_oficial: orgName };
        }
      } catch (e) {
        console.warn('[lookup/deep] Gemini Search Grounding falló:', e.message?.slice(0, 100));
      }

      // B) Sondeo directo de rutas canónicas de grants en el dominio
      const GRANT_PATHS = [
        // Inglés
        '/grants', '/foundation', '/philanthropy', '/giving', '/csr',
        '/social-impact', '/responsibility', '/sustainability', '/community',
        '/programs', '/impact', '/donate', '/donations', '/opportunities',
        '/apply', '/calls', '/open-calls', '/funding', '/fellowships',
        // Español raíz (plural y singular — muchos portales de gobierno usan singular)
        '/convocatorias', '/convocatoria', '/becas', '/beca',
        '/financiamiento', '/cooperacion', '/iniciativas', '/iniciativa',
        '/fondos', '/fondo', '/oportunidades', '/oportunidad',
        '/postulaciones', '/postulacion', '/programas', '/programa',
        '/llamado', '/llamados', '/apoyo', '/subvenciones', '/subvencion',
        // Prefijo /es/ (sitios bilingüe tipo fontagro.org)
        '/es/convocatorias', '/es/convocatoria', '/es/iniciativas', '/es/programas',
        '/es/fondos', '/es/becas', '/es/financiamiento', '/es/oportunidades',
        '/es/cooperacion', '/es/postulaciones', '/es/llamados',
        // Prefijo /pt/ (Portugal / Brasil)
        '/pt/editais', '/pt/financiamento', '/pt/oportunidades', '/pt/chamadas',
        // Prefijo /fr/
        '/fr/appels-a-projets', '/fr/financement', '/fr/subventions',
      ];
      const GRANT_KW = /grant|foundation|philanthrop|fellowship|subvenci|convocatoria|social[\s-]impact|csr|giving|donation|financiamiento|becas|fondo|iniciativa|llamado|postulaci|editais|appel.{0,10}projet|subvention/i;
      for (const path of GRANT_PATHS) {
        const testUrl = `https://${domain}${path}`;
        try {
          const r = await fetchResiliente(testUrl, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', 'Accept': 'text/html' },
          });
          if (!r.ok) continue;
          const snippet = await r.text();
          if (GRANT_KW.test(snippet.slice(0, 10000))) {
            return { aplica: true, deep_url: testUrl, evidencia: `Página de grants/filantropía encontrada en ruta '${path}'`, nombre_oficial: orgName };
          }
        } catch { /* continuar con la siguiente ruta */ }
      }

      // B2) Sondeo de subdominios canónicos de grants/fondos
      const GRANT_SUBDOMAINS = ['funding', 'grants', 'foundation', 'philanthropy', 'apply', 'programs', 'giving', 'becas', 'convocatorias', 'opportunities'];
      for (const sub of GRANT_SUBDOMAINS) {
        const subUrl = `https://${sub}.${domain}`;
        try {
          const r = await fetchResiliente(subUrl, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', 'Accept': 'text/html' },
          });
          if (!r.ok) continue;
          const snippet = await r.text();
          if (GRANT_KW.test(snippet.slice(0, 10000))) {
            return { aplica: true, deep_url: subUrl, evidencia: `Subdominio de grants encontrado: ${sub}.${domain}`, nombre_oficial: orgName };
          }
        } catch { /* continuar con el siguiente subdominio */ }
      }
      return null;
    }

    // ── Gemini: análisis semántico + enriquecimiento de campos ──────────────
    const systemPrompt = `Eres un analista experto en cooperación internacional y directorios de donantes.
Analiza la entidad descrita y devuelve UN ÚNICO objeto JSON sin texto adicional ni bloques markdown.

Estructura EXACTA (todos los campos son obligatorios):
{
  "aplica_colombia": true,
  "estado": "Aceptado",
  "resumen": "Descripción breve de la entidad y sus fondos para Colombia.",
  "nombre": "Nombre oficial completo de la entidad",
  "sigla": "SIGLA",
  "tipo": "BILATERAL",
  "pais": "Alemania",
  "alcance": "Internacional",
  "email": "info@entidad.org",
  "telefono": "+57 1 234 5678"
}

Reglas:
- "aplica_colombia": booleano estricto (true/false).
- "estado": "Aceptado" si aplica_colombia=true, "Rechazado" si false.
- "tipo": uno de BILATERAL | MULTILATERAL | ONG | BANCO_DESARROLLO | FUNDACION | ACADEMIA | GOBIERNO | ENTIDAD
- "alcance": uno de Internacional | Regional | Nacional
- "email" y "telefono": extrae del contenido si están disponibles; si no, usa cadena vacía "".
- "pais": país sede de la entidad (no de Colombia).
- Responde SOLO con el JSON. Sin texto antes ni después.`;

    let geminiResult = null;
    if (geminiCB.canCall()) {
      const apiKeys = [process.env.GOOGLE_API_KEY, process.env.GEMINI_API_KEY_FALLBACK, process.env.GEMINI_API_KEY].filter(Boolean);
      const models  = ['gemini-2.0-flash', 'gemini-1.5-flash'];
      const userMsg = `URL: ${url}\nNombre detectado: ${pageTitle}\nContenido de la página (primeros 3000 chars):\n${pageText.slice(0, 3000)}`;
      outer: for (const apiKey of apiKeys) {
        for (const modelName of models) {
          try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: systemPrompt });
            const result = await model.generateContent(userMsg);
            const text = result.response.text().trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) { geminiResult = JSON.parse(jsonMatch[0]); geminiCB.recordSuccess(); break outer; }
          } catch (err) {
            const is429 = err.message?.includes('429') || err.message?.includes('quota');
            if (is429) { geminiCB.recordQuotaError(); break outer; }
            console.warn(`[lookup] Gemini ${modelName} falló:`, err.message?.slice(0, 100));
          }
        }
      }
    } else {
      console.info('[lookup] Circuit breaker OPEN — usando heurística (modo Respaldo).');
    }

    // ── Heurística de respaldo + merge con datos scrapeados ─────────────────
    let aplica, estado, resumen;
    let nombre    = pageTitle;
    let sigla     = scrapedSigla;
    let tipo      = scrapedTipo;
    let pais      = scrapedPais;
    let alcance   = scrapedAlcance;
    let email     = scrapedEmail;
    let telefono  = scrapedPhone;

    if (geminiResult) {
      aplica   = geminiResult.aplica_colombia === true;
      estado   = geminiResult.estado ?? (aplica ? 'Aceptado' : 'Rechazado');
      resumen  = geminiResult.resumen ?? '';
      // Prefer Gemini values when non-empty, fallback to scraped
      nombre   = geminiResult.nombre?.trim()   || nombre;
      sigla    = geminiResult.sigla?.trim()    || sigla;
      tipo     = geminiResult.tipo?.trim()     || tipo;
      pais     = geminiResult.pais?.trim()     || pais;
      alcance  = geminiResult.alcance?.trim()  || alcance;
      email    = geminiResult.email?.trim()    || email;
      telefono = geminiResult.telefono?.trim() || telefono;
    } else {
      const txt = `${url} ${pageTitle} ${hostname} ${pageText.slice(0,500)}`.toLowerCase();
      const tieneGrants      = /grant|subvenci|donaci|fund|award|fellowship|convocatoria|call\b|becas|financiami|edital|appel.{0,10}projet/.test(txt);
      const mencionaColombia = /colombia|col\.gov|minciencias|apc|colciencias/.test(txt);
      const esCooperKnown   = /undp|pnud|onu|unicef|unfpa|oecd|ocde|worldbank|iadb|bid\.org|aecid|giz\.de|usaid|jica|danida|sida\.se|norad|dfid|fao\.org|who\.int|ifad|unops|iom\.int|oim|minga|lux-development|helvetas|snv\.org|gef|globalfund|gates|ford|rockefeller|kfw|entwicklungsbank|afdb|eib\.org|ebrd|adb\.org|isdb|ifs\.dk|proparco|dfc\.gov|mcc\.gov|idfc|caf\.com|fonplata|cabei|bcie|bice|bladex/.test(hostname + ' ' + txt);
      const esCooper        = /cooperaci|bilateral|multilateral|development|desarrollo intern|aid\b|ayuda intern|oda\b|international.*fund|programa.*nacion/.test(txt);
      // Nombre/dominio contiene palabras clave de fondo/financiador (ej: fontagro, fondo, fundacion)
      const nombreEsFondo   = /\bfond(o|os|tagro|agua|ciencias|paz)?\b|\bfund(a|acion|ing|s)?\b|\bfoundation\b|\bagro\b/i.test(pageTitle + ' ' + hostname);
      aplica  = tieneGrants || mencionaColombia || esCooperKnown || nombreEsFondo || (esCooper && /latinoam|iberoam|america latina|global|world/.test(txt));
      estado  = aplica ? 'Aceptado' : 'Rechazado';
      resumen = `Análisis heurístico: ${aplica ? 'La entidad presenta indicadores de cooperación o fondos aplicables a Colombia.' : 'No se detectaron indicadores de fondos para Colombia. Verifique manualmente.'}`;
    }

    // ── CAPA 0 override: datos cruzados tienen precedencia sobre rechazo de Fase 1 ──
    if (!aplica && autoApprovedByR2) {
      aplica  = true;
      estado  = 'Aceptado';
      resumen = `[Capa 0] Validación cruzada: R2 ya contiene convocatorias de "${domainRoot}"` +
                (r2SampleDonante ? ` (donante registrado: "${r2SampleDonante}")` : '') +
                `. Entidad confirmada por base de datos interna — sin scraping adicional.`;
    }

    // ── FASE 2: Deep Search — activo solo cuando Fase 1 rechaza ─────────────
    // Solo se lanza para dominios raíz o de primer nivel: si el usuario ya pasó
    // una URL profunda (/grants/...) y fue rechazada, no hay más donde buscar.
    const urlPath = (() => { try { return new URL(url).pathname; } catch { return '/'; } })();
    const isRootOrShallow = urlPath === '/' || urlPath === '' || urlPath.split('/').filter(Boolean).length <= 2;

    if (!aplica && isRootOrShallow) {
      console.info(`[lookup/deep] Fase 1 rechazó ${hostname} — iniciando Deep Search...`);
      const apiKeyDeep = [process.env.GOOGLE_API_KEY, process.env.GEMINI_API_KEY_FALLBACK, process.env.GEMINI_API_KEY].find(Boolean);
      const deepApiKey = geminiCB.canCall() ? apiKeyDeep : undefined;
      try {
        const deepResult = await runDeepSearch(nombre, hostname, deepApiKey);
        if (deepResult) {
          aplica   = true;
          estado   = 'Aceptado';
          resumen  = `[Búsqueda profunda] ${deepResult.evidencia || 'Se encontraron programas de cooperación en el dominio.'}`;
          if (deepResult.nombre_oficial?.trim()) nombre = deepResult.nombre_oficial.trim();
          if (deepResult.deep_url && deepResult.deep_url !== url) urlConvFinal = deepResult.deep_url;
          if (deepApiKey) geminiCB.recordSuccess();
          console.info(`[lookup/deep] ✓ ${hostname} aprobado → ${deepResult.deep_url}`);
        } else {
          console.info(`[lookup/deep] ✗ ${hostname} sin evidencia — confirmado Rechazado.`);
        }
      } catch (e) {
        console.warn('[lookup/deep] Error en Fase 2:', e.message?.slice(0, 100));
      }
    }

    // ── FASE 3: Evaluar url_convocatorias provista por el usuario ────────────
    // Si el usuario ya sabe la URL exacta de grants y la entidad sigue rechazada,
    // fetchar esa URL y verificar si tiene indicadores de subvenciones.
    if (!aplica && urlConvInput && urlConvInput !== url) {
      try {
        const convResp = await fetchResiliente(urlConvInput, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0' } });
        if (convResp.ok) {
          const convText = (await convResp.text()).slice(0, 8000).toLowerCase();
          const tieneGrants = /grant|subvenci|fund|award|fellowship|convocatoria|call\b|becas|financiami|apply|proposal/.test(convText);
          if (tieneGrants) {
            aplica       = true;
            estado       = 'Aceptado';
            urlConvFinal = urlConvInput;
            resumen      = `[URL Convocatorias] La URL de grants provista contiene indicadores de subvenciones aplicables.`;
            console.info(`[lookup/fase3] ✓ ${hostname} aprobado por url_convocatorias: ${urlConvInput}`);
          }
        }
      } catch (e) {
        console.warn('[lookup/fase3] Error evaluando url_convocatorias:', e.message?.slice(0, 80));
      }
    }

    // ── POST-FASES: Mejorar urlConvFinal si aún apunta a la raíz ───────────────
    // rawHtml ya cargado → sin costo de red. Parsea <a href> buscando keywords en href Y texto.
    // Solo acepta el candidato si el fetch de verificación confirma contenido de grants.
    if (urlConvFinal === url && rawHtml) {
      // "fund" como palabra independiente (evita false positives: fundacion, fundamento, refund)
      const LP_KW = /convocator|becas?|grants?\b|funding\b|financiami|cooperaci|postulaci|llamado|oportunidad(?:es)?\b|iniciativa(?:s)?\b|fellowship|award|apply\b|edital|opportunity(?:ies)?\b/i;
      const LP_VERIFY = /convocator|grant|becas|fund(?!ament|acion)|financiami|cooperaci|postulaci|fellowship|award|edital|oportunidad|llamado/i;
      const candidates = new Set();
      for (const m of rawHtml.matchAll(/href=["']([^"'#?][^"']*?)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
        const href = m[1].trim();
        const text = m[2].replace(/<[^>]+>/g, ' ').trim();
        if (LP_KW.test(href) || LP_KW.test(text)) {
          try {
            const abs = new URL(href, url).href;
            const absHost = new URL(abs).hostname;
            if (absHost === hostname || absHost.endsWith('.' + domainRoot) || absHost === 'www.' + domainRoot) candidates.add(abs);
          } catch { /* href inválido */ }
        }
      }
      for (const candidate of [...candidates].slice(0, 5)) {
        try {
          const vr = await fetchResiliente(candidate, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0', Accept: 'text/html' } });
          if (!vr.ok) continue;
          const snippet = (await vr.text()).slice(0, 10000);
          if (LP_VERIFY.test(snippet)) {
            urlConvFinal = candidate;
            console.info(`[lookup/linkparse] ✓ urlConvFinal mejorado: ${candidate}`);
            break;
          }
        } catch { /* continuar con siguiente candidato */ }
      }
    }

    res.json({
      success: true,
      data: {
        nombre,
        sigla,
        sitio_web:         hasSubPath ? rootUrl : url,
        url_convocatorias: urlConvFinal,
        tipo,
        pais,
        alcance,
        email,
        telefono,
        fuente:            hostname,
        aplica_colombia:   aplica,
        estado,
        resumen,
      }
    });
  }));

  // DELETE /api/entidades/:id — soft-delete (preserva historial)
  app.delete('/api/entidades/:id', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { id } = req.params;
    const bloquear = req.query.bloquear === 'true' || req.body?.bloquear === true;

    // Si se pide bloqueo: en vez de borrar la fila, se conserva marcada como
    // BLOQUEADO (además del soft-delete) — así /lookup y POST /api/entidades
    // pueden seguir encontrándola por root_domain aunque ya no aparezca en el
    // listado activo. No usa una tabla nueva: este entorno corre en Capa 2
    // (Supabase REST) donde el CREATE TABLE de arranque es un no-op — solo
    // las tablas provisionadas en el dashboard de Supabase son alcanzables.
    if (bloquear) {
      try {
        const entidad = await getRow('SELECT sitio_web, root_domain FROM directorio_entidades WHERE id = ?', [id]);
        const raw = entidad?.sitio_web || '';
        const hostname = raw ? new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '') : '';
        const rootDomain = entidad?.root_domain || getApexDomain(hostname) || hostname || null;
        await runSql(
          "UPDATE directorio_entidades SET validation_status = ?, root_domain = ?, deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
          ['BLOQUEADO', rootDomain, id]
        );
        console.info(`[entidades/bloquear] ✓ Dominio "${rootDomain}" bloqueado permanentemente por usuario ${req.userId}`);
      } catch (blockErr) {
        console.warn('[entidades/bloquear] No se pudo registrar el bloqueo de dominio, aplicando soft-delete simple:', blockErr.message);
        await runSql(
          "UPDATE directorio_entidades SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
          [id]
        );
      }
    } else {
      await runSql(
        "UPDATE directorio_entidades SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        [id]
      );
    }
    // Liberar convocatorias vinculadas → vuelven a Rastreo 2
    try {
      await runSql(
        "UPDATE convocatorias SET entidad_id = NULL WHERE entidad_id = ? AND deleted_at IS NULL",
        [id]
      );
      invalidateRadarCache();
    } catch (unlinkErr) {
      console.warn('[entidades] Aviso: no se pudo desvincular convocatorias:', unlinkErr.message);
    }
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

  // POST /api/entidades/:id/rastrear — vincula convocatorias existentes y dispara ingesta
  app.post('/api/entidades/:id/rastrear', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { id } = req.params;
    const entidad = await getRow('SELECT * FROM directorio_entidades WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!entidad) return res.status(404).json({ success: false, message: 'Entidad no encontrada' });

    // ── MOTOR CODICIOSA aplicado al rastreo manual ───────────────────────────
    let vinculadas = 0;
    const rNombre = entidad.nombre || '';
    const rSigla  = entidad.sigla  || '';
    const rRoot   = entidad.root_domain || getApexDomain(entidad.sitio_web || '') || '';

    // Prueba 1 — Texto fuzzy
    try {
      const r1 = await runSql(`
        UPDATE convocatorias SET entidad_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE entidad_id IS NULL AND deleted_at IS NULL
          AND (
            LOWER(donante) = LOWER(?)
            OR (? != '' AND LOWER(donante) = LOWER(?))
            OR LOWER(donante) LIKE '%' || LOWER(?) || '%'
            OR (LENGTH(donante) > 4 AND LOWER(?) LIKE '%' || LOWER(donante) || '%')
            OR (? != '' AND LENGTH(?) > 2 AND LOWER(donante) LIKE '%' || LOWER(?) || '%')
          )
      `, [id, rNombre, rSigla, rSigla, rNombre, rNombre, rSigla, rSigla, rSigla]);
      vinculadas += r1?.changes || 0;
    } catch (e) { console.warn('[rastrear/T1]', e.message?.slice(0, 100)); }

    // Prueba 2 — Hostname
    if (rRoot) {
      const safeRoot = rRoot.replace(/[%_\\;'"]/g, '');
      try {
        const r2 = await runSql(`
          UPDATE convocatorias SET entidad_id = ?, root_domain = COALESCE(root_domain, ?), updated_at = CURRENT_TIMESTAMP
          WHERE entidad_id IS NULL AND deleted_at IS NULL
            AND (url_fuente ILIKE ? OR url_convocatoria ILIKE ?)
        `, [id, rRoot, `%${safeRoot}%`, `%${safeRoot}%`]);
        vinculadas += r2?.changes || 0;
      } catch (e) { console.warn('[rastrear/T2]', e.message?.slice(0, 100)); }
    }

    // Prueba 3 — Email domain
    if (rRoot) {
      const safeRoot = rRoot.replace(/[%_\\;'"]/g, '');
      try {
        const r3 = await runSql(`
          UPDATE convocatorias SET entidad_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE entidad_id IS NULL AND deleted_at IS NULL
            AND donante LIKE '%@%'
            AND LOWER(SUBSTRING(donante FROM POSITION('@' IN donante) + 1)) LIKE '%' || LOWER(?) || '%'
        `, [id, safeRoot]);
        vinculadas += r3?.changes || 0;
      } catch (e) { console.warn('[rastrear/T3]', e.message?.slice(0, 100)); }
    }

    invalidateRadarCache();

    // Dispara ingesta global en background (no bloquea)
    runManualIngest().catch(e => console.error('[Rastrear] ingesta:', e.message));

    const total = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE entidad_id = ? AND deleted_at IS NULL', [id]);
    res.json({ success: true, message: 'Rastreo iniciado', entidad_id: id, convocatorias_count: total, nuevas_vinculadas: vinculadas });
  }));

  // PATCH /api/entidades/:id — actualiza url_convocatorias y dispara re-scraping
  app.patch('/api/entidades/:id', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { id } = req.params;
    const { url_convocatorias } = req.body;
    if (!url_convocatorias) return res.status(400).json({ success: false, message: 'url_convocatorias requerida' });
    await runSql(
      `UPDATE directorio_entidades SET url_convocatorias = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [url_convocatorias, new Date().toISOString(), id]
    );
    setImmediate(async () => {
      try {
        await ingestDirectorioConvocatorias({ soloEntidadId: id });
        console.log(`[patch/entidad] ✓ Re-scraping completado para entidad ${id} con url ${url_convocatorias}`);
      } catch (e) {
        console.warn(`[patch/entidad] Re-scraping falló para ${id}:`, e.message?.slice(0, 80));
      }
    });
    res.json({ success: true, message: 'URL de convocatorias actualizada y re-scraping iniciado' });
  }));

  // PATCH /api/entidades/:id/status — activa o deshabilita una entidad
  app.patch('/api/entidades/:id/status', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (status !== 'active' && status !== 'disabled') {
      return res.status(400).json({ success: false, message: 'status debe ser "active" o "disabled"' });
    }
    await runSql(
      "UPDATE directorio_entidades SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      [status, new Date().toISOString(), id]
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

  // ── Whitelist de tipos permitidos en Anexos ───────────────────────────────
  const ALLOWED_UPLOAD_TYPES = {
    // extensión → { mimes, magic (hex prefijos), maxBytes }
    csv:  { mimes: ['text/csv','text/plain','application/csv'], magic: null, maxBytes: 5 * 1024 * 1024 },
    xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/zip','application/octet-stream'], magic: '504b0304', maxBytes: 10 * 1024 * 1024 },
    xls:  { mimes: ['application/vnd.ms-excel','application/octet-stream'], magic: 'd0cf11e0', maxBytes: 10 * 1024 * 1024 },
    pdf:  { mimes: ['application/pdf'], magic: '25504446', maxBytes: 20 * 1024 * 1024 },
    json: { mimes: ['application/json','text/plain'], magic: null, maxBytes: 2 * 1024 * 1024 },
  };

  function validateUploadedFile(file) {
    // 1. Nombre seguro — solo letras, números, guiones, puntos; sin traversal
    const safeName = /^[\w\-. ]{1,200}$/.test(file.originalname);
    if (!safeName) return 'Nombre de archivo no permitido';

    // 2. Extensión permitida
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const rule = ALLOWED_UPLOAD_TYPES[ext];
    if (!rule) return `Extensión ".${ext}" no permitida. Solo: ${Object.keys(ALLOWED_UPLOAD_TYPES).join(', ')}`;

    // 3. Tamaño por tipo
    if (file.size > rule.maxBytes) return `Archivo demasiado grande (máx ${rule.maxBytes / 1024 / 1024} MB para .${ext})`;

    // 4. Magic bytes (firma real del archivo)
    if (rule.magic) {
      const head = file.buffer.slice(0, 4).toString('hex');
      if (!head.startsWith(rule.magic)) return `Firma del archivo no coincide con .${ext} — posible archivo malicioso`;
    }

    // 5. CSV/JSON — solo texto imprimible (sin bytes nulos, sin secuencias de escape de shell)
    if (ext === 'csv' || ext === 'json') {
      if (file.buffer.includes(0x00)) return 'Archivo contiene bytes nulos — rechazado';
    }

    return null; // OK
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // límite global de multer; validación por tipo en el handler
    fileFilter: (_req, file, cb) => {
      const ext = (file.originalname.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_UPLOAD_TYPES[ext]) return cb(new Error(`Extensión ".${ext}" no permitida`));
      cb(null, true);
    },
  });

  app.post('/api/importar', authenticateToken, upload.single('file'), tryCatch(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Archivo requerido' });

    // Validación de seguridad profunda
    const error = validateUploadedFile(req.file);
    if (error) {
      console.warn(`[UPLOAD BLOCKED] IP=${req.ip} file="${req.file.originalname}" reason="${error}"`);
      return res.status(422).json({ success: false, message: error });
    }

    const { tipo = 'convocatorias' } = req.body;
    let rows;
    try {
      rows = await parseFileBuffer(req.file.buffer, req.file.originalname);
    } catch (e) {
      // Formato no soportado o JSON malformado — error explícito, no 500 genérico.
      if (e.code === 'UNSUPPORTED_FILE_FORMAT' || e.code === 'INVALID_JSON' || e.code === 'INVALID_JSON_SHAPE') {
        return res.status(422).json({ success: false, code: e.code, message: e.message });
      }
      throw e;
    }
    const report = tipo === 'directorio'
      ? await importToDirectorio(rows)
      : await importToConvocatorias(rows);
    res.json({ success: true, message: `${report.inserted} registros importados`, report });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEDULER / ADMIN STUBS (responden 200 para no crashear el frontend)
  // ════════════════════════════════════════════════════════════════════════════

  app.post('/api/scheduler/now', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    try {
      await runManualIngest();
      res.json({ success: true, message: 'Ingesta iniciada' });
    } catch (e) {
      logger.error('[scheduler] runManualIngest falló', { err: e.message });
      res.status(500).json({ success: false, message: 'No se pudo iniciar la ingesta', detail: e.message });
    }
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
  // POST /api/radar/start — reanuda las 4 tareas cron (Rastreo1/2, expiración, backup S3)
  // y persiste el flag en app_settings para que sobreviva a un reinicio del proceso.
  app.post('/api/radar/start', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const activas = resumeScheduler();
    const now = new Date().toISOString();
    const upd = await runSql(
      `UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'radar_scheduler_enabled'`,
      ['true', now]
    );
    if ((upd?.rowCount ?? upd?.changes ?? 0) === 0) {
      // Placeholders para las 3 columnas, no literales mezclados: restInsert()
      // en database.config.js mapea columna↔parámetro por posición e ignora
      // el contenido real de VALUES() — un literal ahí desalinea todo bajo REST.
      await runSql(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`, ['radar_scheduler_enabled', 'true', now]).catch(() => {});
    }
    res.json({ success: true, message: `Programador de radar activo (${activas} tarea(s) cron).`, tareas_activas: activas });
  }));

  // POST /api/radar/stop — detiene las tareas cron (node-cron .stop() real) y persiste el flag.
  app.post('/api/radar/stop', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const detenidas = pauseScheduler();
    const now = new Date().toISOString();
    const upd = await runSql(
      `UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'radar_scheduler_enabled'`,
      ['false', now]
    );
    if ((upd?.rowCount ?? upd?.changes ?? 0) === 0) {
      await runSql(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`, ['radar_scheduler_enabled', 'false', now]).catch(() => {});
    }
    res.json({ success: true, message: `Programador de radar detenido (${detenidas} tarea(s) cron).`, tareas_detenidas: detenidas });
  }));
  app.post('/api/radar/trigger', authenticateToken, requireAccess('radar'), tryCatch(async (_req, res) => {
    runManualIngest().catch(e => console.error('[Radar/trigger]', e.message));
    res.json({ success: true, message: 'Rastreo 2 iniciado — portales web externos al Directorio. Los resultados aparecerán en segundos.' });
  }));

  // ── Panel keywords — palabras clave para filtrar ingesta R2 ─────────────────
  app.get('/api/panel/keywords', tryCatch(async (_req, res) => {
    const row = await getRow(`SELECT value FROM app_settings WHERE key = 'radar_keywords'`);
    const keywords = row ? JSON.parse(row.value) : [];
    res.json({ success: true, keywords });
  }));

  // PUT es config global de la app (no por-tenant) — exige admin, no solo plan Radar.
  app.put('/api/panel/keywords', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Requiere rol admin' });
    }
    const { keywords } = req.body;
    if (!Array.isArray(keywords)) return res.status(400).json({ success: false, message: 'keywords debe ser array' });
    const val = JSON.stringify(keywords);
    const now = new Date().toISOString();
    // Upsert compatible con Capa 1 (pg) y Capa 2 (REST): UPDATE primero, INSERT si no existía
    const upd = await runSql(
      `UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'radar_keywords'`,
      [val, now]
    );
    if ((upd?.rowCount ?? upd?.changes ?? 0) === 0) {
      await runSql(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
        ['radar_keywords', val, now]
      ).catch(() => {}); // ignora conflicto de clave duplicada si ocurre en paralelo
    }
    res.json({ success: true });
  }));

  // Rastreo 1: escaneo de convocatorias desde cada entidad del Directorio
  app.post('/api/radar/rastreo1', authenticateToken, requireAccess('radar'), tryCatch(async (req, res) => {
    ingestDirectorioConvocatorias().catch(e => console.error('[Radar/rastreo1]', e.message));
    res.json({ success: true, message: 'Rastreo 1 iniciado — visitando entidades del Directorio. Los resultados aparecerán en segundos.' });
  }));

  // POST /api/radar/clasificar-sectores — Clasificación masiva en background vía Gemini/keywords
  app.post('/api/radar/clasificar-sectores', authenticateToken, requireAccess('radar'), tryCatch(async (req, res) => {
    const batchLimit = Math.min(parseInt(req.query.limit || '200'), 1000);
    clasificarSectoresEnBatch(batchLimit).catch(e => console.error('[Sectores/batch]', e.message));
    res.json({ success: true, message: `Clasificación de sectores iniciada — hasta ${batchLimit} convocatorias procesadas en background.` });
  }));

  // POST /api/radar/enrich-montos — Enriquecimiento de montos con fetch+regex (sin Gemini)
  app.post('/api/radar/enrich-montos', authenticateToken, requireAccess('radar'), tryCatch(async (req, res) => {
    const batchLimit = Math.min(parseInt(req.query.limit || '300'), 1000);
    enriquecerMontosBatch(batchLimit).catch(e => console.error('[Montos/batch]', e.message));
    res.json({ success: true, message: `Enriquecimiento de montos iniciado — hasta ${batchLimit} convocatorias procesadas en background.` });
  }));

  // GET /api/radar/clasificar-sectores/status — Progreso de clasificación
  app.get('/api/radar/clasificar-sectores/status', tryCatch(async (_req, res) => {
    const total     = await getCount('SELECT COUNT(*) as cnt FROM convocatorias WHERE deleted_at IS NULL');
    const sinSector = await getCount("SELECT COUNT(*) as cnt FROM convocatorias WHERE deleted_at IS NULL AND (sectores IS NULL OR sectores = '[]')");
    res.json({ total, sinSector, clasificadas: total - sinSector, porcentaje: total > 0 ? Math.round(((total - sinSector) / total) * 100) : 0 });
  }));

  // /api/radar/barrido — alias real de /api/radar/barrido-masivo (registrado
  // más abajo junto con el handler compartido barridoMasivoHandler).
  app.post('/api/radar/barrido', authenticateToken, requireAccess('radar'), aiLimiter, (req, res, next) => barridoMasivoHandler(req, res, next));

  // POST /api/radar/sweep — Barrido retroactivo endsWith: vincula R2 ↔ Directorio
  app.post('/api/radar/sweep', authenticateToken, tryCatch(async (_req, res) => {
    const n = await sweepEndsWith();
    res.json({ success: true, vinculadas: n });
  }));

  // POST /api/radar/expirar — Marca como 'cerrada' convocatorias vencidas + soft-delete falsos positivos
  app.post('/api/radar/expirar', authenticateToken, requireAccess('radar'), tryCatch(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    // 1. Cerrar por fecha_limite vencida (explícita)
    const rowsFecha = await getRows(
      `SELECT id, fecha_limite FROM convocatorias WHERE estado = 'abierta' AND deleted_at IS NULL AND fecha_limite != ''`,
      []
    );
    let cerradasFecha = 0;
    for (const row of rowsFecha) {
      const norm = (row.fecha_limite || '').replace(/\//g, '-');
      if (norm && norm < today) {
        await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', ['cerrada', row.id]);
        cerradasFecha++;
      }
    }

    // 1b. Cerrar por antigüedad: sin fecha_limite + más de 180 días
    const corte180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const rowsAntiguas = await getRows(
      `SELECT id FROM convocatorias WHERE estado = 'abierta' AND deleted_at IS NULL AND (fecha_limite = '' OR fecha_limite IS NULL) AND created_at < ?`,
      [corte180]
    );
    let cerradasAntiguas = 0;
    for (const row of rowsAntiguas) {
      await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', ['cerrada', row.id]);
      cerradasAntiguas++;
    }

    // 2. Soft-delete falsos positivos: títulos de navegación/institucionales
    const NOISE_RE = new RegExp([
      // Frases institucionales genéricas (nav/secciones)
      '^(our|their|its)\\s\\w',
      '^about\\s(us|the\\s|our\\s)',
      '^(who|what)\\s(we|is)\\s',
      '^(learn|read|see|view|explore)\\s(more|all)',
      '^(sign|log)\\s(in|out)',
      '^(get|be(come)?)\\s(involved|a\\s)',
      '^(partner|connect)\\s(with|us)',
      '^(join|follow)\\s(our|us)',
      // Navegación de página (skip-links, breadcrumbs, menús)
      'skip\\sto|to\\smain\\scontent|pasar\\sal\\scontenido|main\\scontent$',
      '(main|mobile)\\s(nav|navigation|menu)',
      'selector\\sde\\sidioma|visualiz.*men[uú]|ruta\\sde\\snaveg',
      'activar\\sel\\smodo|publicador\\sde\\scontenidos',
      'ruta\\sde\\snavegaci|contenido\\sprincip|additional\\slinks',
      // Redes sociales y suscripciones
      'opens\\sa\\snew\\swindow|^(facebook|instagram|twitter|linkedin|youtube|flickr)',
      '^(sign|subscribe)\\s(up|to)\\s',
      '\\bsocial\\smedia\\s(accounts|platform)',
      // Páginas de info interna para beneficiarios (no convocatorias)
      'grantee\\s(publications|stories|news|research)',
      '^resources\\sfor\\s.*grantees?',
      '^info\\sfor\\s(grant|grantee)',
      '^managing\\s(your|funds|award)',
      '^(results\\sand\\sevaluation|key\\smaterials|standard\\sdocuments)',
      '^(open\\saccess\\spolicy|open\\sknowledge)',
      '^(funding\\spolicies|funding\\sguidance|applying\\sfor\\sfunding)',
      'funding\\sfaq|grants?\\sfaq|grants?\\sdata|grants?\\sdatabase',
      '^(awarded\\sgrants|approved\\s.*grants|grant\\sopportunities$)',
      '^(grantee\\spublications|info\\sfor\\sgrantseekers)',
      // Contratación y políticas (no fondos de cooperación)
      'public\\sprocurement|general\\stendering|award\\sprocedure',
      'tenders?\\selectronic\\sdaily|quantum\\setendering',
      '^(tender\\sopportunities|data\\sprotection\\sin)',
      '^(contract\\sawards?|requests\\sfor\\sproposals$)',
      // Páginas institucionales genéricas
      '^(where\\s(we\\s)?work|case\\sstudies|impact\\sin\\snumbers)',
      '^(project\\sportfolio|major\\sinitiatives|country\\sprograms?)',
      '^(global\\sinvestment\\smap|portfolio\\sexplorer)',
      '^(awards\\sand\\srecognition|press\\srelease|media\\srelease)',
      '^(small\\sand\\smedium|sustainability$|development\\sfinance)',
      '^(security\\sand\\sdefence|innovation,\\sdigital)',
      '^(organisation$|^values?\\sinstituc)',
      'valores\\sinstitucionales',
      // Descargas y documentos de soporte
      '^descarga\\s|^download\\s(our|the)\\s|brochure',
      '^(map\\sof\\sjica|open\\slearning\\scampus)',
      // Navegación en idiomas extranjeros y selectores de idioma
      '^(zum\\shauptinhalt|förderung\\sfinden|formulaire\\sde\\sdemande)',
      '^(форма\\sзаявки|pasar\\sal|activar\\sel)',
      'selector\\sde\\sidioma|\\bнавигаци|\\bالميزانية|استمارة\\sالتقديم',
      '^(es|en|fr|pt|de|it|nl|ru|ar|zh)\\s[-–]\\s',
      // Títulos cortos de sección sin contexto de convocatoria
      '^(convocatorias?$|all\\sabout|standard\\sdocuments)',
      '^(flexi-grant|bcf-flexi|access\\sfunding$|receive\\sfunding$)',
      '^(find\\sa\\sfunding\\sopportunity$|other\\sfunding\\smodalities)',
      '^(apply\\sfor\\sgrant$|project\\sfunding$|small\\sgrants$)',
      '^(medium\\sgrants$|large\\sinnovation|innovation\\sfunding$)',
      '^(readiness\\sgrant|access\\sand\\squality$)',
      '^(dashboards\\sand|results\\sand\\sevaluati|open\\sdata)',
      '^(commissioning\\sus|become\\sa\\scontractor|career)',
      '^(social\\ssustainab|sustainable\\senergy\\sand|sustainable\\scities)',
      '^(climate\\sand\\senvironmental|innovation,\\sdigital)',
      '^(health\\s&|development\\sfinance|solidarity\\swith)',
      '^(turning\\sinnovation|why\\sagri-input|advancing\\sscience)',
      // Páginas de categoría/nav adicionales frecuentes
      '^grants\\sand\\sfellowships$',
      '^research\\sfunding\\soverview',
      '^fellows\\ssearch$',
      '^(discover|explore)\\sour\\s',
      '^green\\sclimate\\sfund$',
      '^please\\sgive',
      '^lla\\s(proposals|regional|single)',
      '^(build\\sprogram$|international\\sfellowships\\sprogram$)',
      '^(proposals\\sunder\\sreview$|img\\scall\\s\\d{4}$|isg\\scall\\s\\d{4}$)',
      '^(approved\\slla|nil\\ssmall\\sgrants)',
      // Testimoniales (citas entre comillas ascii y tipográficas)
      '^[""“”]',
      // Líneas de crédito / préstamos (no son subvenciones)
      '^l[ií]nea\\sde\\scr[eé]dito',
      // Años pasados de grantees de IAF (son proyectos financiados, no convocatorias abiertas)
      '^20\\d{2}\\s[&#\\-–]',
      // Secciones y categorías genéricas de financiadores
      '^(empowering|where\\scgiar|restoring\\slandscapes)',
      '^(a\\slow-carbon|gender\\sand\\syouth|it\'?s\\sabout\\sbig)',
      '^(why\\sagri|advancing\\sscience|gggi\\son\\ssocial)',
      '^(management\\sboard|\\u200b)',
      'bilan\\set\\scompte|balance\\sy\\scuenta|\\bоценк',
      '^(equity|development|capacity|innovation|sustainability|resilience|empowerment)\\s*$',
    ].join('|'), 'i');
    const allOpen = await getRows(
      `SELECT id, titulo FROM convocatorias WHERE deleted_at IS NULL AND estado != 'cerrada'`,
      []
    );
    let eliminados = 0;
    for (const row of allOpen) {
      if (NOISE_RE.test((row.titulo || '').trim())) {
        await runSql('UPDATE convocatorias SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
        eliminados++;
      }
    }

    res.json({
      success: true,
      cerradas_por_fecha: cerradasFecha,
      eliminados_ruido: eliminados,
      message: `${cerradasFecha} cerradas por fecha vencida, ${cerradasAntiguas} cerradas por antigüedad (+180 días sin fecha_limite), ${eliminados} falsos positivos eliminados`,
    });
  }));

  // POST /api/radar/cerrar-ids — Cierra manualmente convocatorias por array de IDs
  app.post('/api/radar/cerrar-ids', authenticateToken, requireAccess('radar'), tryCatch(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'ids requerido (array)' });
    let cerradas = 0;
    for (const id of ids) {
      await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', ['cerrada', id]);
      cerradas++;
    }
    res.json({ success: true, cerradas, message: `${cerradas} convocatorias marcadas como cerradas` });
  }));

  // POST /api/radar/reparar-fuente — Corrige columna fuente de convocatorias (idempotente)
  app.post('/api/radar/reparar-fuente', authenticateToken, requireAccess('radar'), tryCatch(async (_req, res) => {
    const result = await repararFuenteConvocatorias();
    if (result.error) return res.status(500).json({ success: false, error: result.error });
    res.json({ success: true, message: 'Columna fuente reparada: R2=RASTREO_WEB_EXTERNO, R1=RASTREO_DIRECTORIO' });
  }));
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
  // GET /api/radar/buscar?q= — búsqueda semántica (alias legacy de /api/ia/busqueda-semantica)
  app.get('/api/radar/buscar', tryCatch(async (req, res) => {
    const texto = String(req.query.q || '').trim();
    if (!texto) return res.status(400).json({ success: false, message: 'q requerido' });
    const qVec   = await textToEmbedding(texto);
    const vecStr = JSON.stringify(qVec);
    const usePg  = !!process.env.DATABASE_URL;
    let resultados = [];
    if (usePg) {
      resultados = await getRows(
        `SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado,
                round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
         WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL AND estado != 'cerrada'
           AND (1 - (embedding_vec <=> $1::vector)) >= 0.25
         ORDER BY embedding_vec <=> $1::vector LIMIT 20`,
        [vecStr]
      );
    } else {
      const convs = await getRows("SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL AND estado != 'cerrada'", []);
      resultados = convs
        .map(c => ({ ...c, embedding: undefined, similitud: Math.round(cosineSimilarity(qVec, deserializeEmbedding(c.embedding)) * 10000) / 10000 }))
        .filter(c => c.similitud >= 0.25)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, 20);
    }
    res.json({ success: true, resultados, total: resultados.length });
  }));

  // GET /api/buscar?q= — búsqueda unificada por texto (ILIKE, sin costo de embeddings)
  // sobre convocatorias y directorio_entidades. No usa vectores: pensado para
  // búsquedas rápidas de coincidencia literal, complementario a la semántica.
  app.get('/api/buscar', tryCatch(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, message: 'q requerido' });
    const like = `%${q}%`;
    const [convocatorias, entidades] = await Promise.all([
      getRows(
        `SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado, fuente
         FROM convocatorias
         WHERE deleted_at IS NULL AND (titulo ILIKE ? OR donante ILIKE ? OR descripcion ILIKE ?)
         ORDER BY created_at DESC LIMIT 25`,
        [like, like, like]
      ).catch(() => []),
      getRows(
        `SELECT id, nombre, sigla, tipo, pais, sitio_web
         FROM directorio_entidades
         WHERE deleted_at IS NULL AND (nombre ILIKE ? OR sigla ILIKE ?)
         ORDER BY nombre LIMIT 25`,
        [like, like]
      ).catch(() => []),
    ]);
    res.json({ success: true, data: { convocatorias, entidades }, total: convocatorias.length + entidades.length });
  }));

  // GET /api/fuentes — fuentes de datos reales del radar, agrupadas con conteo.
  // Agregación hecha en JS (no SQL GROUP BY): la Capa 2 (REST de Supabase)
  // reenvía el SELECT a PostgREST sin traducir GROUP BY/agregados — el mismo
  // patrón de degradación que ya usa matchScore.js para el coseno en Capa 2.
  app.get('/api/fuentes', tryCatch(async (req, res) => {
    const rows = await getRows(
      `SELECT fuente, estado FROM convocatorias WHERE deleted_at IS NULL AND fuente IS NOT NULL AND fuente != ''`
    );
    const porFuente = new Map();
    for (const r of rows) {
      const entry = porFuente.get(r.fuente) || { fuente: r.fuente, total: 0, activas: 0 };
      entry.total++;
      if (r.estado !== 'cerrada') entry.activas++;
      porFuente.set(r.fuente, entry);
    }
    const data = [...porFuente.values()].sort((a, b) => b.total - a.total);
    res.json({ success: true, data });
  }));

  // GET /api/scraped-results — historial real de ejecuciones de scraping (crawl_log)
  app.get('/api/scraped-results', tryCatch(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await getRows(
      `SELECT id, tipo, fuente, subvenciones_encontradas, resultado, ejecutada_en
       FROM crawl_log ORDER BY ejecutada_en DESC LIMIT ?`,
      [limit]
    );
    res.json(rows.map(r => {
      let resultado = r.resultado;
      if (typeof resultado === 'string') { try { resultado = JSON.parse(resultado); } catch { /* deja el texto crudo */ } }
      return { ...r, resultado };
    }));
  }));

  // POST /api/entidades/scrape-async — dispara scraping en background (no bloquea la respuesta).
  // Body opcional: { entidadId } → escanea solo esa entidad; sin body → Directorio completo.
  app.post('/api/entidades/scrape-async', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { entidadId } = req.body || {};
    if (entidadId) {
      const entidad = await getRow('SELECT id FROM directorio_entidades WHERE id = ? AND deleted_at IS NULL', [entidadId]);
      if (!entidad) return res.status(404).json({ success: false, message: 'Entidad no encontrada' });
    }
    ingestDirectorioConvocatorias(entidadId ? { soloEntidadId: entidadId } : {})
      .catch(e => console.error('[entidades/scrape-async]', e.message));
    res.status(202).json({
      success: true,
      message: entidadId
        ? `Scraping iniciado para la entidad ${entidadId} — los resultados aparecerán en el Directorio en segundos.`
        : 'Scraping del Directorio completo iniciado en background.',
    });
  }));

  // POST /api/entidades/indexadas — entidades ya validadas/indexadas (opuesto de la cola de validación)
  app.post('/api/entidades/indexadas', authenticateToken, tryCatch(async (req, res) => {
    const { filtros = {} } = req.body || {};
    const cond   = [`deleted_at IS NULL`, `validation_status NOT ILIKE '%PENDIENTE%'`];
    const params = [];
    if (filtros.tipo)  { cond.push('tipo ILIKE ?');  params.push(`%${filtros.tipo}%`); }
    if (filtros.pais)  { cond.push('pais ILIKE ?');  params.push(`%${filtros.pais}%`); }
    const rows = await getRows(
      `SELECT id, nombre, sigla, tipo, pais, validation_status, updated_at
       FROM directorio_entidades WHERE ${cond.join(' AND ')}
       ORDER BY updated_at DESC LIMIT 200`,
      params
    );
    res.json({ success: true, data: rows, total: rows.length });
  }));

  // GET /api/cola-validacion?estado= — entidades pendientes de validación manual
  app.get('/api/cola-validacion', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const { estado } = req.query;
    const cond   = [`deleted_at IS NULL`];
    const params = [];
    if (estado) { cond.push('validation_status = ?'); params.push(estado); }
    else        { cond.push(`validation_status ILIKE '%PENDIENTE%'`); }
    const rows = await getRows(
      `SELECT id, nombre, sigla, tipo, pais, sitio_web, validation_status, fuente, created_at
       FROM directorio_entidades WHERE ${cond.join(' AND ')}
       ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ success: true, data: rows, total: rows.length });
  }));

  // POST /api/cola-validacion/:id/aprobar — marca una entidad como validada
  app.post('/api/cola-validacion/:id/aprobar', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const entidad = await getRow('SELECT id FROM directorio_entidades WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!entidad) return res.status(404).json({ success: false, message: 'Entidad no encontrada' });
    await runSql(`UPDATE directorio_entidades SET validation_status = 'VALIDADA', updated_at = ? WHERE id = ?`, [new Date().toISOString(), req.params.id]);
    res.json({ success: true, message: 'Entidad aprobada y validada' });
  }));

  // POST /api/cola-validacion/:id/descartar — rechaza y soft-delete de la entidad
  app.post('/api/cola-validacion/:id/descartar', authenticateToken, requireAdmin, tryCatch(async (req, res) => {
    const entidad = await getRow('SELECT id FROM directorio_entidades WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!entidad) return res.status(404).json({ success: false, message: 'Entidad no encontrada' });
    const now = new Date().toISOString();
    await runSql(`UPDATE directorio_entidades SET validation_status = 'RECHAZADA', deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, req.params.id]);
    res.json({ success: true, message: 'Entidad descartada' });
  }));
  // Proyectos (GET/POST/PATCH/:id gestionados por proyectos.routes.js)
  // GET /api/admin/deleted — papelera: usuarios/proyectos/convocatorias con soft-delete
  app.get('/api/admin/deleted', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Acceso exclusivo de administradores' });

    const [usuarios, proyectos, convocatorias] = await Promise.all([
      getRows(`SELECT id, email, nombre, createdAt AS created_at, deleted_at FROM usuarios WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`).catch(() => []),
      getRows(`SELECT id, nombre, estado, created_at, deleted_at FROM proyectos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`).catch(() => []),
      getRows(`SELECT id, titulo, estado, created_at, deleted_at FROM convocatorias WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`).catch(() => []),
    ]);

    res.json({ success: true, usuarios, proyectos, convocatorias });
  }));

  // POST /api/admin/restore/:tipo/:id — revierte el soft-delete (deleted_at = NULL)
  const ADMIN_RESTORE_TABLES = { usuario: 'usuarios', proyecto: 'proyectos', convocatoria: 'convocatorias' };
  app.post('/api/admin/restore/:tipo/:id', authenticateToken, tryCatch(async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Acceso exclusivo de administradores' });

    const tabla = ADMIN_RESTORE_TABLES[req.params.tipo];
    if (!tabla) return res.status(400).json({ success: false, message: `tipo inválido — usa: ${Object.keys(ADMIN_RESTORE_TABLES).join(', ')}` });

    const row = await getRow(`SELECT id FROM ${tabla} WHERE id = ? AND deleted_at IS NOT NULL`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: 'Elemento no encontrado en la papelera' });

    await runSql(`UPDATE ${tabla} SET deleted_at = NULL WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: `${req.params.tipo} restaurado correctamente` });
  }));
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
  // POST /api/ia/buscar — alias real de /api/ia/busqueda-semantica, body { query }
  // (AIChat.tsx envía "query"; busqueda-semantica espera "texto" — se traduce aquí).
  app.post('/api/ia/buscar', authenticateToken, aiLimiter, tryCatch(async (req, res) => {
    const texto = String(req.body?.query || '').trim();
    if (!texto) return res.status(400).json({ success: false, message: 'query requerido' });
    const qVec   = await textToEmbedding(texto);
    const vecStr = JSON.stringify(qVec);
    const usePg  = !!process.env.DATABASE_URL;
    let data = [];
    if (usePg) {
      data = await getRows(
        `SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado,
                round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
         WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL
           AND (1 - (embedding_vec <=> $1::vector)) >= 0.25
         ORDER BY embedding_vec <=> $1::vector LIMIT 10`,
        [vecStr]
      );
    } else {
      const convs = await getRows("SELECT id, titulo, donante, monto_min, monto_max, fecha_limite, estado, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL", []);
      data = convs
        .map(c => ({ ...c, embedding: undefined, similitud: Math.round(cosineSimilarity(qVec, deserializeEmbedding(c.embedding)) * 10000) / 10000 }))
        .filter(c => c.similitud >= 0.25)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, 10);
    }
    res.json({ success: true, data, total: data.length });
  }));
  // POST /api/ai/generate — proxy seguro hacia Google Gemini (la key nunca sale al cliente)
  app.post('/api/ai/generate', authenticateToken, aiLimiter, tryCatch(async (req, res) => {
    const GEMINI_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_KEY) return res.status(503).json({ success: false, code: 'AI_NO_DISPONIBLE', message: 'GOOGLE_API_KEY no configurada.' });

    // Circuit breaker: si la cuota de Gemini está agotada, no gastar la llamada.
    if (!geminiCB.canCall()) {
      return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE);
    }

    const { messages, temperature = 0.7, max_tokens = 8192 } = req.body;
    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ success: false, message: 'messages[] requerido' });

    // Validar que cada mensaje tiene role y content string
    const validRoles = new Set(['system', 'user', 'assistant']);
    for (const m of messages) {
      if (!validRoles.has(m?.role) || typeof m?.content !== 'string' || m.content.length > 32_000)
        return res.status(400).json({ success: false, message: 'Mensaje inválido en messages[]' });
    }

    // Endpoint OpenAI-compatible de Google — acepta el mismo formato de messages[]
    const GEMINI_MODEL = 'gemini-2.0-flash';
    let upstream;
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GEMINI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: GEMINI_MODEL, messages, temperature, max_tokens }),
        }
      );
    } catch (err) {
      logger.warn('[AI/generate] Fallo de red hacia Gemini', { error: err.message });
      return res.status(502).json({ success: false, code: 'UPSTREAM_ERROR', message: 'Error en Google Gemini.' });
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      if (upstream.status === 429) {
        geminiCB.recordQuotaError();
        return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE);
      }
      logger.warn('[AI/generate] Gemini error', { status: upstream.status, body: errText.slice(0, 200) });
      return res.status(502).json({ success: false, code: 'UPSTREAM_ERROR', message: 'Error en Google Gemini.' });
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    geminiCB.recordSuccess();
    res.json({ success: true, result: content, model: GEMINI_MODEL });
  }));

  // POST /api/radar/barrido-gemini — proxy seguro con Google Search Grounding
  // (reemplaza la llamada directa cliente→Google que usaba geminiScanner.ts con
  // una API key guardada en localStorage; la key vive exclusivamente aquí).
  app.post('/api/radar/barrido-gemini', authenticateToken, requireAccess('radar'), aiLimiter, tryCatch(async (req, res) => {
    const GEMINI_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_KEY) return res.status(503).json({ success: false, code: 'AI_NO_DISPONIBLE', message: 'GOOGLE_API_KEY no configurada.' });

    const { prompt } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8_000)
      return res.status(400).json({ success: false, message: 'prompt requerido (máx 8000 caracteres)' });

    if (!geminiCB.canCall()) {
      return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE);
    }

    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
    let lastErr = null;
    for (const model of MODELS) {
      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ googleSearch: {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          }
        );

        if (!upstream.ok) {
          const errText = await upstream.text().catch(() => '');
          if (upstream.status === 429) {
            geminiCB.recordQuotaError();
            return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE);
          }
          lastErr = new Error(`[${upstream.status}] ${errText.slice(0, 200)}`);
          continue; // probar el siguiente modelo de la lista
        }

        const data = await upstream.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        geminiCB.recordSuccess();
        return res.json({ success: true, result: text, model });
      } catch (err) {
        lastErr = err;
        if (isQuotaError(err)) {
          geminiCB.recordQuotaError();
          return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE);
        }
      }
    }

    logger.warn('[radar/barrido-gemini] Todos los modelos fallaron', { error: lastErr?.message });
    return res.status(502).json({ success: false, code: 'UPSTREAM_ERROR', message: 'Error en Google Gemini.' });
  }));

  // POST /api/ai/convocatoria-analyze — mismo proxy seguro que /api/ai/generate
  // (geminiCB gating, key server-side), body { prompt, context }.
  app.post('/api/ai/convocatoria-analyze', authenticateToken, aiLimiter, tryCatch(async (req, res) => {
    const GEMINI_KEY = process.env.GOOGLE_API_KEY;
    if (!GEMINI_KEY) return res.status(503).json({ success: false, code: 'AI_NO_DISPONIBLE', message: 'GOOGLE_API_KEY no configurada.' });
    if (!geminiCB.canCall()) return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE);

    const { prompt, context } = req.body;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32_000) {
      return res.status(400).json({ success: false, message: 'prompt requerido (máx 32000 caracteres)' });
    }

    const fullPrompt = context ? `${prompt}\n\nContexto adicional:\n${String(context).slice(0, 8000)}` : prompt;
    const GEMINI_MODEL = 'gemini-2.0-flash';
    let upstream;
    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GEMINI_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: GEMINI_MODEL, messages: [{ role: 'user', content: fullPrompt }], temperature: 0.4, max_tokens: 4096 }),
        }
      );
    } catch (err) {
      logger.warn('[ai/convocatoria-analyze] Fallo de red hacia Gemini', { error: err.message });
      return res.status(502).json({ success: false, code: 'UPSTREAM_ERROR', message: 'Error en Google Gemini.' });
    }

    if (!upstream.ok) {
      if (upstream.status === 429) { geminiCB.recordQuotaError(); return res.status(503).json(AI_LIMIT_EXCEEDED_RESPONSE); }
      const errText = await upstream.text().catch(() => '');
      logger.warn('[ai/convocatoria-analyze] Gemini error', { status: upstream.status, body: errText.slice(0, 200) });
      return res.status(502).json({ success: false, code: 'UPSTREAM_ERROR', message: 'Error en Google Gemini.' });
    }

    const data = await upstream.json();
    geminiCB.recordSuccess();
    res.json({ success: true, result: data?.choices?.[0]?.message?.content ?? '', model: GEMINI_MODEL });
  }));

  // POST /api/triggers/run-with-context — registra el contexto de alertas/soportes
  // como traza de auditoría real en system_logs (tabla ya existente).
  app.post('/api/triggers/run-with-context', authenticateToken, tryCatch(async (req, res) => {
    const { alertas = [], soportes = [] } = req.body || {};
    const id = crypto.randomUUID();
    await runSql(
      `INSERT INTO system_logs (id, origen, mensaje, payload, nivel, created_at) VALUES (?,?,?,?,?,?)`,
      [
        id, 'triggers/run-with-context',
        `Contexto de disparadores ejecutado: ${alertas.length} alerta(s), ${soportes.length} soporte(s)`,
        JSON.stringify({ alertas, soportes, userId: req.userId }),
        'INFO',
        new Date().toISOString(),
      ]
    );
    res.json({ success: true, message: 'Contexto registrado', log_id: id, alertas: alertas.length, soportes: soportes.length });
  }));

  // POST /api/configuracion/guardar — persiste credenciales de IA por usuario
  // (mismo patrón cifrado que POST /api/credentials, tabla user_credentials).
  app.post('/api/configuracion/guardar', authenticateToken, tryCatch(async (req, res) => {
    const { cuentaGoogleNotebook, apiKeyMotorBusqueda } = req.body || {};
    if (!apiKeyMotorBusqueda) return res.status(400).json({ success: false, message: 'apiKeyMotorBusqueda requerido' });

    const enc = process.env.ENCRYPTION_KEY;
    if (!enc) return res.status(503).json({ success: false, message: 'Servicio de configuración no disponible — ENCRYPTION_KEY no configurada' });

    const apiKeyEnc = encryptKey(apiKeyMotorBusqueda, enc);
    const nbKeyEnc  = cuentaGoogleNotebook ? encryptKey(cuentaGoogleNotebook, enc) : null;
    const existing  = await getRow('SELECT id FROM user_credentials WHERE user_id = ?', [req.userId]);
    if (existing) {
      await runSql('UPDATE user_credentials SET api_key_enc = ?, notebook_key_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', [apiKeyEnc, nbKeyEnc, req.userId]);
    } else {
      await runSql('INSERT INTO user_credentials (id, user_id, api_key_enc, notebook_key_enc) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), req.userId, apiKeyEnc, nbKeyEnc]);
    }
    res.json({ success: true, message: 'Configuración guardada correctamente' });
  }));
  // Handler compartido — /api/radar/barrido es un alias real de esta misma
  // lógica (antes devolvía 501 diciendo "usa barrido-masivo"; ahora corre la
  // búsqueda vectorial directamente en vez de redirigir con un mensaje).
  const barridoMasivoHandler = tryCatch(async (req, res) => {
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
  });
  app.post('/api/radar/barrido-masivo', authenticateToken, requireAccess('radar'), aiLimiter, barridoMasivoHandler);
  app.post('/api/convocatorias/filtros', (req, res) => res.json({ success: true, data: [] }));
  // FIX AUDITORÍA (crítico): antes cualquier usuario autenticado, de cualquier
  // tenant, podía poner CUALQUIER valor de estado en CUALQUIER convocatoria —
  // convocatorias es una tabla compartida por todos los tenants (no tiene
  // org_id), así que sin este guard un usuario podía marcar como "cerrada"
  // una oportunidad real para TODOS los demás tenants. Se restringe a
  // requireAccess('radar') (mismo criterio que el resto de mutaciones de
  // convocatorias/radar) y se valida el enum real de la columna.
  const ESTADOS_CONVOCATORIA_VALIDOS = ['abierta', 'cerrada', 'nueva'];
  app.put('/api/convocatorias/:id/estado', authenticateToken, requireAccess('radar'), tryCatch(async (req, res) => {
    const { estado } = req.body;
    if (!ESTADOS_CONVOCATORIA_VALIDOS.includes(estado)) {
      return res.status(400).json({ success: false, message: `estado debe ser uno de: ${ESTADOS_CONVOCATORIA_VALIDOS.join(', ')}` });
    }
    await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', [estado, req.params.id]);
    res.json({ success: true });
  }));

  // ════════════════════════════════════════════════════════════════════════════
  // ORQUESTACIÓN IA Y REGLAS DE NEGOCIO (FASE 4)
  // ════════════════════════════════════════════════════════════════════════════

  // F4-02: CRITICAL_DESIGN_EXCEPTION
  app.post('/api/formulador/validar-estructura', authenticateToken, setTenantContext, rejectMaterialsInput, tryCatch(async (req, res) => {
    const { proyectoId, elementos } = req.body;
    if (!proyectoId || !Array.isArray(elementos)) {
      return res.status(400).json({ success: false, message: 'proyectoId y elementos[] requeridos' });
    }
    const { valid, exceptions } = validateStructuralElements(elementos, proyectoId);
    if (!valid) {
      // RLS-scoped: si proyectoId no pertenece al tenant del usuario, la
      // policy projects_tenant_rls hace que el UPDATE afecte 0 filas en vez
      // de bloquear un proyecto ajeno (antes: runSql sin contexto de tenant).
      try {
        await req.withTenant(client => client.query(
          "UPDATE proyectos SET estado = 'BLOQUEADO', bloqueo_razon = $1 WHERE id = $2",
          ['CRITICAL_DESIGN_EXCEPTION: columnas en zonas de circulación', proyectoId]
        ));
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

  // Ownership compartido para todas las rutas del Motor de Coherencia (Fase 2).
  async function checkProyectoOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // F4-03: Módulo 3b - Árbol de Objetivos (usa la API key del usuario o la del sistema)
  app.post('/api/modulo3b/arbol/generar', authenticateToken, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const { proyectoId, objetivoCentral } = req.body;
    if (!proyectoId || !objetivoCentral) return res.status(400).json({ success: false, message: 'proyectoId y objetivoCentral requeridos' });
    if (!(await checkProyectoOwnership(proyectoId, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const apiKey = await resolveGoogleApiKey(req.userId, getRow);
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        code: 'IA_NO_DISPONIBLE',
        message: 'El módulo de inteligencia artificial no está disponible. Configura tu API key en Ajustes o contacta al administrador.',
      });
    }
    const nodos = await generarArbolConIA(objetivoCentral, apiKey, req.userId);

    // Persistir realmente los nodos en objetivos_arbol — antes se devolvían al
    // cliente pero nunca se guardaban, dejando "confirmar" sin nada que validar.
    await runSql('DELETE FROM objetivos_arbol WHERE proyecto_id = ?', [proyectoId]);
    const ids = nodos.map(() => crypto.randomUUID());
    for (let i = 0; i < nodos.length; i++) {
      const n = nodos[i];
      const parentId = (n.parentIndex !== null && n.parentIndex !== undefined) ? ids[n.parentIndex] : null;
      await runSql(
        `INSERT INTO objetivos_arbol (id, proyecto_id, tipo, nivel, texto, parent_id, generado_por_ia, confirmado)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
        [ids[i], proyectoId, n.tipo, n.nivel, n.texto, parentId]
      );
    }

    res.json({
      success: true,
      data: nodos.map((n, i) => ({
        ...n, id: ids[i],
        parent_id: (n.parentIndex !== null && n.parentIndex !== undefined) ? ids[n.parentIndex] : null,
      })),
    });
  }));

  // GET /api/proyectos/:id/arbol — árbol de objetivos ya persistido
  app.get('/api/proyectos/:id/arbol', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const nodos = await getRows(
      'SELECT id, tipo, nivel, texto, parent_id, confirmado, supuestos FROM objetivos_arbol WHERE proyecto_id = ? ORDER BY nivel ASC',
      [req.params.id]
    );
    res.json({ success: true, data: nodos });
  }));

  // PATCH /api/proyectos/:id/arbol/:nodoId — edita texto/supuestos de un nodo puntual
  // (los "supuestos" alimentan la matriz de marco lógico BID — Fase 5).
  app.patch('/api/proyectos/:id/arbol/:nodoId', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const { texto, supuestos } = req.body;
    const updates = [], params = [];
    if (texto !== undefined)     { updates.push('texto = ?');     params.push(texto); }
    if (supuestos !== undefined) { updates.push('supuestos = ?'); params.push(supuestos); }
    if (updates.length === 0) return res.status(400).json({ success: false, message: 'Nada que actualizar' });
    params.push(req.params.nodoId, req.params.id);
    await runSql(`UPDATE objetivos_arbol SET ${updates.join(', ')} WHERE id = ? AND proyecto_id = ?`, params);
    res.json({ success: true });
  }));

  // ── Indicadores (project_indicators) — Fase 2 ──────────────────────────────
  app.get('/api/proyectos/:id/indicadores', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const rows = await getRows(
      'SELECT id, nombre, tipo, linea_base, meta_total, unidad_medida, fuente_verificacion FROM project_indicators WHERE project_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  }));

  app.post('/api/proyectos/:id/indicadores', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const { nombre, tipo, linea_base = 0, meta_total, unidad_medida, fuente_verificacion = '' } = req.body;
    if (!nombre || !tipo || meta_total === undefined || meta_total === '' || !unidad_medida) {
      return res.status(400).json({ success: false, message: 'nombre, tipo, meta_total y unidad_medida son requeridos' });
    }
    const id = crypto.randomUUID();
    await runSql(
      `INSERT INTO project_indicators (id, project_id, org_id, nombre, tipo, linea_base, meta_total, unidad_medida, fuente_verificacion)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.params.id, req.userId, nombre, tipo, linea_base, meta_total, unidad_medida, fuente_verificacion]
    );
    res.status(201).json({ success: true, data: { id } });
  }));

  app.delete('/api/proyectos/:id/indicadores/:indicadorId', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    await runSql('DELETE FROM project_indicators WHERE id = ? AND project_id = ?', [req.params.indicadorId, req.params.id]);
    res.json({ success: true });
  }));

  // ── Teoría de Cambio (project_change_theory) — Fase 2, 1 fila por proyecto ─
  app.get('/api/proyectos/:id/teoria-cambio', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const row = await getRow(
      'SELECT insumos, actividades, productos, resultados_corto_plazo, impacto_largo_plazo FROM project_change_theory WHERE proyecto_id = ?',
      [req.params.id]
    );
    const parseArr = v => { try { return JSON.parse(v || '[]'); } catch { return []; } };
    res.json({
      success: true,
      data: row ? {
        insumos: parseArr(row.insumos), actividades: parseArr(row.actividades),
        productos: parseArr(row.productos), resultados_corto_plazo: parseArr(row.resultados_corto_plazo),
        impacto_largo_plazo: row.impacto_largo_plazo || '',
      } : null,
    });
  }));

  app.put('/api/proyectos/:id/teoria-cambio', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const { insumos = [], actividades = [], productos = [], resultados_corto_plazo = [], impacto_largo_plazo = '' } = req.body;
    const existing = await getRow('SELECT id FROM project_change_theory WHERE proyecto_id = ?', [req.params.id]);
    const vals = [JSON.stringify(insumos), JSON.stringify(actividades), JSON.stringify(productos), JSON.stringify(resultados_corto_plazo), impacto_largo_plazo];
    if (existing) {
      await runSql(
        `UPDATE project_change_theory SET insumos=?, actividades=?, productos=?, resultados_corto_plazo=?, impacto_largo_plazo=?, updated_at=CURRENT_TIMESTAMP WHERE proyecto_id=?`,
        [...vals, req.params.id]
      );
    } else {
      await runSql(
        `INSERT INTO project_change_theory (id, proyecto_id, org_id, insumos, actividades, productos, resultados_corto_plazo, impacto_largo_plazo)
         VALUES (?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), req.params.id, req.userId, ...vals]
      );
    }
    res.json({ success: true });
  }));

  // ── Postulaciones por entidad (postulaciones_entidad) ───────────────────────
  // "Guardar como" ya no duplica el proyecto completo — crea una postulación
  // hija ligada al proyecto matriz (`proyectos`), con su propio enfoque
  // narrativo generado por IA y su propio estado de trámite.
  function extraerContextoMatriz(proyecto) {
    // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10 — migración ficha_tecnica a
    // JSONB nativo): JSON.parse(objeto) lanza (cae al catch → {}) cuando el
    // driver pg ya entrega un objeto parseado (columna JSONB real) en vez de
    // un string — perdía silenciosamente entrada_completa/contexto_narrativo.
    const fichaTecnica = (() => {
      if (proyecto.ficha_tecnica && typeof proyecto.ficha_tecnica === 'object') return proyecto.ficha_tecnica;
      try { return JSON.parse(proyecto.ficha_tecnica || '{}'); } catch { return {}; }
    })();
    const entradaCompleta   = fichaTecnica.entrada_completa   || {};
    const contextoNarrativo = fichaTecnica.contexto_narrativo || {};
    const poblacionPartes = [entradaCompleta.numeroBeneficiarios, entradaCompleta.coberturaGeografica].filter(Boolean);
    return {
      problematicaCentral: contextoNarrativo.A_diagnostico || proyecto.problem_statement || '',
      poblacionObjetivo: poblacionPartes.join(' — '),
    };
  }

  app.get('/api/proyectos/:id/postulaciones', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkProyectoOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    const rows = await getRows(
      'SELECT id, nombre_entidad, url_lineamientos, enfoque_generado_ia, enfoque_fuente, estado_postulacion, created_at, updated_at FROM postulaciones_entidad WHERE proyecto_matriz_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  }));

  app.post('/api/proyectos/:id/postulaciones', authenticateToken, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const proyecto = await getRow(
      'SELECT id, ficha_tecnica, problem_statement FROM proyectos WHERE id = ? AND org_id = ?',
      [req.params.id, req.userId]
    );
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombreEntidad = String(req.body?.nombre_entidad || '').trim().slice(0, 255);
    const urlLineamientos = String(req.body?.url_lineamientos || '').trim().slice(0, 500);
    if (!nombreEntidad) {
      return res.status(400).json({ success: false, message: 'nombre_entidad es requerido' });
    }

    const { problematicaCentral, poblacionObjetivo } = extraerContextoMatriz(proyecto);
    const { enfoque, fuente } = await generarEnfoqueEntidad({
      nombreEntidad, urlLineamientos, problematicaCentral, poblacionObjetivo, userId: req.userId,
    });

    const id = crypto.randomUUID();
    await runSql(
      `INSERT INTO postulaciones_entidad (id, proyecto_matriz_id, org_id, nombre_entidad, url_lineamientos, enfoque_generado_ia, enfoque_fuente, estado_postulacion)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, req.params.id, req.userId, nombreEntidad, urlLineamientos, enfoque, fuente, 'Borrador']
    );

    res.status(201).json({ success: true, data: { id, nombre_entidad: nombreEntidad, url_lineamientos: urlLineamientos, enfoque_generado_ia: enfoque, enfoque_fuente: fuente, estado_postulacion: 'Borrador' } });
  }));

  async function checkPostulacionOwnership(postulacionId, userId) {
    return getRow(
      'SELECT id, proyecto_matriz_id, nombre_entidad, url_lineamientos FROM postulaciones_entidad WHERE id = ? AND org_id = ?',
      [postulacionId, userId]
    );
  }

  // FIX AUDITORÍA (defensa en profundidad): antes se leía `proyectos` solo por
  // id (sin org_id), confiando en que proyecto_matriz_id ya venía validado a
  // través de checkPostulacionOwnership. Funcionalmente seguro (esa invariante
  // siempre se cumple hoy), pero no autoevidente — se agrega el filtro directo
  // para que esta consulta sea segura por sí misma, sin depender de otra.
  app.post('/api/postulaciones/:id/regenerar-enfoque', authenticateToken, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const postulacion = await checkPostulacionOwnership(req.params.id, req.userId);
    if (!postulacion) return res.status(404).json({ success: false, message: 'Postulación no encontrada' });

    const proyecto = await getRow(
      'SELECT ficha_tecnica, problem_statement FROM proyectos WHERE id = ? AND org_id = ?',
      [postulacion.proyecto_matriz_id, req.userId]
    );
    const { problematicaCentral, poblacionObjetivo } = extraerContextoMatriz(proyecto || {});
    const { enfoque, fuente } = await generarEnfoqueEntidad({
      nombreEntidad: postulacion.nombre_entidad, urlLineamientos: postulacion.url_lineamientos, problematicaCentral, poblacionObjetivo, userId: req.userId,
    });

    await runSql(
      'UPDATE postulaciones_entidad SET enfoque_generado_ia = ?, enfoque_fuente = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [enfoque, fuente, req.params.id]
    );
    res.json({ success: true, data: { enfoque_generado_ia: enfoque, enfoque_fuente: fuente } });
  }));

  app.patch('/api/postulaciones/:id', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkPostulacionOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Postulación no encontrada' });
    }
    const { estado_postulacion, url_lineamientos, enfoque_generado_ia } = req.body;
    const ESTADOS_VALIDOS = ['Borrador', 'Radicado', 'Aprobado', 'Rechazado'];
    if (estado_postulacion !== undefined && !ESTADOS_VALIDOS.includes(estado_postulacion)) {
      return res.status(400).json({ success: false, message: `estado_postulacion debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
    }
    const updates = [], params = [];
    if (estado_postulacion !== undefined)  { updates.push('estado_postulacion = ?'); params.push(estado_postulacion); }
    if (url_lineamientos !== undefined)    { updates.push('url_lineamientos = ?');   params.push(String(url_lineamientos).slice(0, 500)); }
    if (enfoque_generado_ia !== undefined) { updates.push('enfoque_generado_ia = ?'); params.push(String(enfoque_generado_ia).slice(0, 2000)); }
    if (updates.length === 0) return res.status(400).json({ success: false, message: 'Nada que actualizar' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    await runSql(`UPDATE postulaciones_entidad SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  }));

  app.delete('/api/postulaciones/:id', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    if (!(await checkPostulacionOwnership(req.params.id, req.userId))) {
      return res.status(404).json({ success: false, message: 'Postulación no encontrada' });
    }
    await runSql('DELETE FROM postulaciones_entidad WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  }));

  // Confirmar coherencia del árbol — validación REAL (antes: UPDATE ciego sin
  // verificar nada, y sin nodos persistidos no había ni siquiera qué validar).
  app.post('/api/modulo3b/arbol/:proyectoId/confirmar', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    const proyectoId = req.params.proyectoId;
    if (!(await checkProyectoOwnership(proyectoId, req.userId))) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }

    const nodos = await getRows('SELECT id, tipo, parent_id FROM objetivos_arbol WHERE proyecto_id = ?', [proyectoId]);
    const detail = [];

    if (nodos.length === 0) {
      detail.push('El árbol de objetivos está vacío — genera el árbol antes de confirmar.');
    } else {
      const centrales = nodos.filter(n => n.tipo === 'CENTRAL');
      if (centrales.length !== 1) detail.push(`Debe existir exactamente 1 nodo CENTRAL (hay ${centrales.length}).`);

      const idsValidos = new Set(nodos.map(n => n.id));
      const sinPadre = nodos.filter(n => n.tipo !== 'CENTRAL' && !n.parent_id);
      if (sinPadre.length > 0) detail.push(`${sinPadre.length} nodo(s) sin padre asignado (parent_id vacío).`);
      const huerfanos = nodos.filter(n => n.tipo !== 'CENTRAL' && n.parent_id && !idsValidos.has(n.parent_id));
      if (huerfanos.length > 0) detail.push(`${huerfanos.length} nodo(s) con parent_id que no resuelve a otro nodo del árbol.`);

      // Detección de ciclos: cada nodo debe llegar a CENTRAL en un número finito de saltos.
      const byId = new Map(nodos.map(n => [n.id, n]));
      for (const n of nodos) {
        let cur = n, saltos = 0;
        while (cur && cur.tipo !== 'CENTRAL' && saltos <= nodos.length) {
          cur = cur.parent_id ? byId.get(cur.parent_id) : null;
          saltos++;
        }
        if (saltos > nodos.length) { detail.push('Se detectó un ciclo en el árbol (un nodo termina siendo ancestro de sí mismo).'); break; }
      }
    }

    const totalIndicadores = await getCount('SELECT COUNT(*) as cnt FROM project_indicators WHERE project_id = ?', [proyectoId]);
    if (totalIndicadores === 0) {
      detail.push('El proyecto no tiene ningún indicador registrado — todo objetivo debe tener al menos 1 indicador verificable.');
    }

    const tdc = await getRow('SELECT resultados_corto_plazo, impacto_largo_plazo FROM project_change_theory WHERE proyecto_id = ?', [proyectoId]);
    if (tdc) {
      let resultados = [];
      try { resultados = JSON.parse(tdc.resultados_corto_plazo || '[]'); } catch { /* noop */ }
      if (resultados.length > 0 && !String(tdc.impacto_largo_plazo || '').trim()) {
        detail.push('Hay resultados de corto plazo definidos pero no hay impacto de largo plazo — la cadena causal queda incompleta.');
      }
    }

    if (detail.length > 0) {
      return res.status(422).json({ success: false, message: 'El árbol no pasa la validación de coherencia', detail });
    }

    await runSql('UPDATE objetivos_arbol SET confirmado = ? WHERE proyecto_id = ?', [1, proyectoId]);
    res.json({ success: true, message: 'Árbol confirmado — coherencia verificada' });
  }));

  // PATCH /api/proyectos/:id/ficha-tecnica-merge — upsert de UNA clave dentro de
  // ficha_tecnica (JSON), leyendo y escribiendo en el servidor en una sola
  // petición. Reemplaza el patrón cliente GET→merge→PATCH (usado antes por
  // ContextoPage) que mantenía una copia de ficha_tecnica en el navegador
  // durante todo el tiempo de edición del usuario.
  //
  // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 7 — hallazgo del Agente
  // Arquitecto, no listado en la auditoría original): el comentario previo de
  // esta ruta ya admitía que leer-justo-antes-de-escribir solo "acorta la
  // ventana de carrera", no la elimina — mismo patrón leer-blob→merge-JS→
  // sobrescribir que proyectos.routes.js /viabilidad-financiera. jsonb_set
  // con path dinámico cierra la carrera del todo: el merge ocurre atómico
  // sobre el valor vivo de la fila, sin copia JS intermedia.
  app.patch('/api/proyectos/:id/ficha-tecnica-merge', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ success: false, message: 'key (string) es requerido' });
    }
    const proyecto = await getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [req.params.id, req.userId]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    // ficha_tecnica es JSONB nativo desde 037_ficha_tecnica_a_jsonb.sql
    // (2026-08-10) — sin casts tácticos ::jsonb/::text, ya innecesarios.
    await runSql(
      `UPDATE proyectos
       SET ficha_tecnica = jsonb_set(ficha_tecnica, ARRAY[?]::text[], ?::jsonb, true),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND org_id = ?`,
      [key, JSON.stringify(value), req.params.id, req.userId]
    );
    res.json({ success: true, message: 'Ficha técnica actualizada' });
  }));

  // POST /api/radar/persistir-barrido — guarda en convocatorias los resultados
  // reales de "Iniciar Barrido" (Gemini Search Grounding, PestañaRadar.tsx).
  // Antes esos resultados eran reales (no un mock) pero solo vivían en memoria
  // del navegador — desaparecían al recargar. Dedup por url_convocatoria.
  app.post('/api/radar/persistir-barrido', authenticateToken, requireAccess('radar'), tryCatch(async (req, res) => {
    const { resultados } = req.body;
    if (!Array.isArray(resultados) || resultados.length === 0) {
      return res.status(400).json({ success: false, message: 'resultados (array) es requerido' });
    }
    let insertadas = 0, duplicadas = 0;
    for (const r of resultados.slice(0, 100)) {
      const url = String(r.enlace_oficial || '').trim();
      const titulo = String(r.titulo || '').trim();
      if (!url || !titulo || url === '#') continue;
      const existente = await getRow('SELECT id FROM convocatorias WHERE url_convocatoria = ?', [url]);
      if (existente) { duplicadas++; continue; }
      const estado = /abiert/i.test(r.estado || '') ? 'abierta' : (/próxim|proxim/i.test(r.estado || '') ? 'abierta' : 'abierta');
      await runSql(
        `INSERT INTO convocatorias
           (id, titulo, donante, fuente, descripcion, url_convocatoria, estado, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), titulo.slice(0, 300), String(r.fuente || 'Desconocido').slice(0, 200),
         'RASTREO_MANUAL_IA', String(r.descripcion_corta || '').slice(0, 800), url, estado, new Date().toISOString()]
      );
      insertadas++;
    }
    res.json({ success: true, insertadas, duplicadas, message: `${insertadas} convocatoria(s) guardada(s), ${duplicadas} ya existían` });
  }));

  // F4-04: Módulo 7 - Match Score Pipeline (requiere plan formulador + GOOGLE_API_KEY)
  app.post('/api/modulo7/match/:proyectoId', authenticateToken, setTenantContext, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const apiKey = await resolveGoogleApiKey(req.userId, getRow);
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        code: 'IA_NO_DISPONIBLE',
        message: 'El módulo de Match Score requiere Google API Key. Configura tu clave en Ajustes o contacta al administrador.',
      });
    }
    // SECURITY FIX: verificar ownership antes de pasar al pipeline.
    // RLS-scoped vía req.withTenant — projects_tenant_rls es la segunda
    // barrera detrás del WHERE org_id explícito, no un reemplazo de este.
    const ownerCheck = await req.withTenant(client => client.query(
      'SELECT id FROM proyectos WHERE id = $1 AND org_id = $2',
      [req.params.proyectoId, req.userId]
    ));
    if (!ownerCheck.rows?.[0]) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

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

  // Scoring dinámico del Dashboard Formulador — reemplaza el mock estático
  // SECTIONS de DashboardFormuladorPage.tsx con cálculo real sobre BD.
  app.get('/api/proyectos/:id/scoring-dinamico', authenticateToken, requireAccess('formulador'), setTenantContext, tryCatch(async (req, res) => {
    const ownerCheck = await req.withTenant(client => client.query(
      'SELECT id FROM proyectos WHERE id = $1 AND org_id = $2',
      [req.params.id, req.userId]
    ));
    if (!ownerCheck.rows?.[0]) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const resultado = await calcularScoringDinamico(req.params.id, { getRow, getRows });
    if (!resultado) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    res.json({ success: true, data: resultado });
  }));

  // Motor de Viabilidad con Gemini real — conecta NN_Viability_Agent.ts (frontend)
  // a un análisis real de IA sobre el proyecto y sus anexos. Usa la tabla
  // `proyectos` (esquema realmente activo: TEXT ids, sin tenant_id) en vez de
  // `projects`, porque POST /api/proyectos inserta ahí, no en `projects`.
  app.post('/api/proyectos/:id/viabilidad-ia', authenticateToken, requireAccess('formulador'), aiLimiter, tryCatch(async (req, res) => {
    const proyecto = await getRow(
      'SELECT id, nombre, ficha_tecnica, presupuesto, problem_statement FROM proyectos WHERE id = ? AND org_id = ?',
      [req.params.id, req.userId]
    );
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    // project_anexos / objetivos_arbol.supuestos / project_change_theory pueden
    // no existir todavía en esta instancia — recolectarContextoViabilidad()
    // (backend/services/viabilidadAgent.js) degrada con gracia a valor vacío
    // en cada una en vez de fallar 500. Compartida con
    // POST /api/proyectos/:id/continuar-formulacion (proyectos.routes.js) —
    // única fuente de verdad, ya no duplicada (auditoría 2026-08-08).
    const { ctx, fichaTecnica } = await recolectarContextoViabilidad(proyecto, req.userId, { getRow, getRows });
    const resultado = await calcularViabilidadIA(ctx);

    // Persistencia real dentro de ficha_tecnica (columna JSON ya existente) —
    // evita depender de una columna/tabla nueva que requeriría DDL.
    const fichaActualizada = { ...fichaTecnica, viabilidad_ia: resultado };
    await runSql(
      'UPDATE proyectos SET ficha_tecnica = ?, updated_at = ? WHERE id = ? AND org_id = ?',
      [JSON.stringify(fichaActualizada), new Date().toISOString(), req.params.id, req.userId]
    );

    res.json({ success: true, data: resultado });
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
  registerConfigLogisticaRoutes(app, { authenticateToken, runSql, runTransaction, getRow, getRows, tryCatch });

  // V8.0 — Formulador: M8 Marco Normativo
  registerMarcoNormativoRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M10 Compliance
  registerComplianceRoutes(app, { authenticateToken, runSql, getRow, tryCatch });

  // V8.0 — Formulador: M12 Ficha Técnica Maestra (Hash SHA-256)
  registerFichaTecnicaRoutes(app, { authenticateToken, runSql, runTransaction, getRow, getRows, tryCatch });

  // Scraping portales oficiales (Minciencias, etc.)
  registerScraperRoutes(app, authenticateToken, requireAdmin);

  // Proyectos CRUD con RLS por org_id
  registerProyectosRoutes(app, { authenticateToken, requireAccess, runSql, runTransaction, getRow, getRows, verifyPassword, aiLimiter });

  // M4: Presupuesto APU por proyecto
  registerPresupuestoRoutes(app, { authenticateToken, runSql, getRow, getRows });

  // Anexos: CRUD real contra project_anexos (migración 013) — reemplaza localStorage de AnexosView.tsx
  await registerAnexosRoutes(app, { authenticateToken, runSql, getRow, getRows, financialPipelineLimiter });
  // Biblioteca Gubernamental: clon aislado de Anexos (migración 039) — bucket
  // de Storage propio, sin pipeline financiero (ExtractorService/AuditorForenseService)
  await registerBibliotecaRoutes(app, { authenticateToken, runSql, getRow, getRows });
  await registerEstresFinancieroRoutes(app, { authenticateToken, getRow, financialPipelineLimiter });
  await registerValorExponencialRoutes(app, { authenticateToken, getRow, financialPipelineLimiter });
  await registerCopilotoRoutes(app, { authenticateToken, getRow, aiLimiter });
  // Entrada (M1) — "Generar con AI" a partir de la carpeta "Investigación" de Anexos
  await registerEntradaIARoutes(app, { authenticateToken, getRow, getRows, requireAccess, aiLimiter });

  // F5-01: Módulo 9 — Cross-Check Pipeline & Radicación
  registerRadicacionRoutes(app, { authenticateToken, runSql, getRow });

  // Fase 5: Exportación a estructura MGA / BID / OXI
  registerExportacionRoutes(app, { authenticateToken, getRow, getRows, tryCatch });

  // F5-02: Módulo 9 — Exportación Certificada (reporte PDF SSR)
  registerReporteRoutes(app, { authenticateToken, getRow });

  // Google Auth routes
  registerGoogleAuthRoutes(app, { authenticateToken, runSql, getRow, encryptKey, JWT_SECRET });

  // ════════════════════════════════════════════════════════════════════════════
  // ── Error handler global (CORS + otros errores de Express) ──────────────
  app.use((err, req, res, _next) => {
    if (err.message?.startsWith('CORS:')) {
      return res.status(403).json({ success: false, code: 'CORS_BLOCKED', message: err.message });
    }
    // Errores de subida de archivos (multer, disparados por upload.single()
    // ANTES de llegar al handler de la ruta — su propio try/catch nunca los
    // ve) — antes se perdían en el 500 genérico de abajo, dejando al usuario
    // sin saber POR QUÉ falló adjuntar un archivo (bug reportado 2026-08-17:
    // "no permite anexar archivos" resultó ser esto + una clave de Supabase
    // Storage inválida — ver anexos.routes.js/biblioteca.routes.js).
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'El archivo supera el tamaño máximo permitido.' });
    }
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    logger.error('[server] Error middleware', { path: req.path, err: err.message });
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  });

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
    // Activar cron de actualización diaria de convocatorias (02:00 COT).
    // Si un admin lo detuvo con POST /api/radar/stop, respeta esa preferencia al reiniciar.
    try {
      startScheduler();
      getRow(`SELECT value FROM app_settings WHERE key = 'radar_scheduler_enabled'`)
        .then(row => { if (row?.value === 'false') pauseScheduler(); })
        .catch(() => {});
    } catch (e) { console.error('[server] startScheduler error:', e.message); }
    // Backfill root_domain en background (no bloquea arranque)
    setImmediate(() => backfillRootDomains().catch(e => console.warn('[backfill] root_domain error:', e.message)));
    // Barrido endsWith: vincula convocatorias R2 al Directorio tras el backfill
    setImmediate(() => sweepEndsWith().catch(e => console.warn('[sweep/endsWith] startup error:', e.message)));
    // Clasificación de sectores en background: 30s después del arranque para no interferir con otros inits
    setTimeout(() => clasificarSectoresEnBatch(500).catch(e => console.warn('[Sectores] startup error:', e.message)), 30_000);
    // Enriquecimiento de montos: 90s después (evita concurrencia con sectores)
    setTimeout(() => enriquecerMontosBatch(300).catch(e => console.warn('[Montos] startup error:', e.message)), 90_000);
  });
}

// getApexDomain y extractRootDomain importados desde backend/utils/domainUtils.js

// ── Backfill root_domain en directorio_entidades y convocatorias ────────────
async function backfillRootDomains() {
  // getApexDomain acepta URL completa directamente
  function rdFromUrl(url) {
    if (!url) return null;
    const u = url.startsWith('http') ? url : `https://${url}`;
    return getApexDomain(u);
  }
  let ec = 0, cc = 0;
  // Entidades — solo actualiza registros con root_domain ausente o vacío
  const ents = await getRows(
    `SELECT id, sitio_web FROM directorio_entidades WHERE sitio_web IS NOT NULL AND sitio_web != '' AND deleted_at IS NULL AND (root_domain IS NULL OR root_domain = '')`,
    []
  );
  for (const e of ents) {
    const rd = rdFromUrl(e.sitio_web);
    if (rd) { await runSql(`UPDATE directorio_entidades SET root_domain = ? WHERE id = ?`, [rd, e.id]); ec++; }
  }
  // Convocatorias — solo registros sin root_domain; lote de 5000
  const convs = await getRows(
    `SELECT id, url_fuente, url_convocatoria FROM convocatorias WHERE deleted_at IS NULL AND (root_domain IS NULL OR root_domain = '') LIMIT 5000`,
    []
  );
  for (const c of convs) {
    const rd = rdFromUrl(c.url_fuente) || rdFromUrl(c.url_convocatoria);
    if (rd) { await runSql(`UPDATE convocatorias SET root_domain = ? WHERE id = ?`, [rd, c.id]); cc++; }
  }
  if (ec || cc) console.info(`[backfill] root_domain: ${ec} entidades, ${cc} convocatorias actualizadas.`);
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
