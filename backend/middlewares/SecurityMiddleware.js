/**
 * SecurityMiddleware.js — Blindaje de seguridad institucional
 * GGIE · Radar de Fondos 360
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { PostgresRateLimitStore } from './PostgresRateLimitStore.js';

// Resolución de IP segura para IPv4 e IPv6 (usa ipKeyGenerator de express-rate-limit v7+)
//
// FIX (auditoría SRE 2026-08-08, Capa 3 — CRÍTICO): antes se leía
// req.headers['x-forwarded-for'] directamente, un valor 100% controlado por
// el cliente — sin `app.set('trust proxy', ...)` configurado (ver server.js),
// cualquiera podía mandar un XFF distinto en cada request y resetear
// authLimiter/trialLimiter a voluntad (bypass de fuerza bruta y de Modo
// Trial). Ahora se delega en `req.ip` de Express, que solo confía en el XFF
// hasta la cantidad de saltos configurada en trust proxy (1 = balanceador de
// Render) — un XFF falso agregado por el cliente antes de esa cadena real se
// descarta automáticamente por Express.
const getRateLimitKey = (req) => ipKeyGenerator(req.ip || 'unknown');

// ── Rate limiting por tenant para el pipeline financiero (rutas pesadas) ─────
// Se aplica DESPUÉS de authenticateToken en la cadena de middlewares, así
// req.userId (= org_id en este esquema) ya está disponible. El límite general
// de /api (300/15min) es por IP y no protege contra un solo tenant saturando
// el pool de conexiones REST de Supabase con extracciones/cálculos pesados —
// este limiter es más estricto y aísla por org_id, no por red compartida.
export const financialPipelineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store: new PostgresRateLimitStore('financialPipeline'),
  keyGenerator: (req) => req.userId || getRateLimitKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'FINANCIAL_PIPELINE_RATE_LIMITED',
      message: 'Límite de operaciones del pipeline financiero excedido (20 cada 15 minutos). Reintenta en unos minutos.',
    });
  },
});

// ── Rate limiting estricto para rutas de autenticación ────────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  store: new PostgresRateLimitStore('authLimiter'),
  keyGenerator: getRateLimitKey, // <-- Corregido
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AUTH_RATE_LIMITED',
      message: 'ACCESO BLOQUEADO: Límite de intentos excedido. Reintente en 15 minutos.',
    });
  },
});

// ── Rate limiting para Modo Trial ──────────────────────────────────────────
export const trialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: new PostgresRateLimitStore('trialLimiter'),
  keyGenerator: getRateLimitKey, // <-- Corregido
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'TRIAL_RATE_LIMITED',
      message: 'Límite de sesiones trial alcanzado.',
    });
  },
});

// ── Rate limiting para endpoints de IA ─────────────────────────────────────
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  store: new PostgresRateLimitStore('aiLimiter'),
  keyGenerator: (req) => req.userId ? ipKeyGenerator(req.userId) : getRateLimitKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AI_RATE_LIMITED',
      message: 'Límite de consultas de IA alcanzado.',
    });
  },
});

// ── Sanitización ESTRICTA ───────────────────────────────────────────────────
export function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value
    // Primero elimina tag + CONTENIDO de <script>/<style> — quitar solo las
    // etiquetas (como hacía antes el replace de abajo) dejaba el texto
    // interno como string plano (ej. "<script>alert(1)</script>" → "alert(1)"
    // sobrevivía). No es explotable hoy (React escapa todo, no hay
    // dangerouslySetInnerHTML en el proyecto), pero es higiene de datos real.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/--/g, '')
    .replace(/[;]/g, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, 512);
}

export function sanitizeAuthBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const field of ['email', 'correo', 'nombre', 'nombreCompleto']) {
      if (typeof req.body[field] === 'string') req.body[field] = sanitizeInput(req.body[field]);
    }
    if (typeof req.body.password === 'string') req.body.password = req.body.password.slice(0, 128);
    if (typeof req.body.contrasena === 'string') req.body.contrasena = req.body.contrasena.slice(0, 128);
  }
  next();
}

// ── Sanitización con WHITELIST (Se mantiene igual) ─────────────────────────
const ALLOWED_TAGS_WL = new Set(['b','i','p','br','ul','ol','li','strong','em']);

export function sanitizeTechnicalText(value, maxLength = 8000) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<(\w+)([^>]*)>/gi, (_match, tag, _attrs) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS_WL.has(t) ? `<${t}>` : '';
    })
    .replace(/<\/(\w+)>/gi, (_match, tag) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS_WL.has(t) ? `</${t}>` : '';
    })
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeFormuladorBody(req, res, next) {
  try {
    if (typeof req.body?.nombre === 'string') {
      req.body.nombre = sanitizeInput(req.body.nombre);
    }
    if (req.body?.fichaTecnica && typeof req.body.fichaTecnica === 'object') {
      for (const field of ['nombre', 'descripcion', 'objetivos', 'poblacion', 'municipio', 'convocatoria', 'indicadores', 'mediosVerif', 'supuestos', 'componenteMarco', 'fuenteFinanciamiento', 'contrapartida']) {
        if (typeof req.body.fichaTecnica[field] === 'string') {
          req.body.fichaTecnica[field] = sanitizeTechnicalText(req.body.fichaTecnica[field]);
        }
      }
    }
  } catch (e) {
    logger.warn('[SecurityMiddleware] Fallo sanitizando body', { path: req.path, err: e.message });
  }
  next();
}

// ── Slowdown anti-DDoS — retraso progresivo antes de bloquear ─────────────────
// Después de `freeRequests` por ventana, cada request adicional añade `delayMs`
const _slowStore = new Map(); // ip → { count, resetAt }
const SLOW_WINDOW_MS    = 15 * 60 * 1000; // 15 min
const SLOW_FREE         = 100;             // requests gratis por ventana
const SLOW_DELAY_MS     = 500;             // ms añadidos por request extra
const SLOW_MAX_DELAY_MS = 10_000;          // tope: 10 s

export function slowDown(req, res, next) {
  // FIX (auditoría SRE 2026-08-08): mismo bypass de XFF que getRateLimitKey — ver arriba.
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  let entry = _slowStore.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + SLOW_WINDOW_MS };
  } else {
    entry.count++;
  }
  _slowStore.set(ip, entry);

  const excess = entry.count - SLOW_FREE;
  if (excess <= 0) return next();

  const delay = Math.min(excess * SLOW_DELAY_MS, SLOW_MAX_DELAY_MS);
  res.setHeader('X-RateLimit-Delay-Ms', delay);
  setTimeout(next, delay);
}

// Limpieza periódica del store (evita leak de memoria)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _slowStore) {
    if (now > entry.resetAt) _slowStore.delete(ip);
  }
}, SLOW_WINDOW_MS);

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 24 * 60 * 60 * 1000,
  path: '/',
};
