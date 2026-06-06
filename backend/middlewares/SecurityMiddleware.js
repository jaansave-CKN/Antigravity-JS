/**
 * SecurityMiddleware.js — Blindaje de seguridad institucional
 * GGIE · Radar de Fondos 360
 *
 * Exporta: authLimiter, sanitizeInput, sanitizeAuthBody, COOKIE_OPTIONS
 */

import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger.js';

// ── Rate limiting estricto para rutas de autenticación ────────────────────────
// Máx 5 intentos fallidos por IP cada 15 minutos
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AUTH_RATE_LIMITED',
      message: 'ACCESO BLOQUEADO: Límite de intentos de autenticación excedido. Reintente en 15 minutos.',
    });
  },
});

// ── Rate limiting para Modo Trial — previene bypass infinito ──────────────────
// Máx 3 tokens trial por IP por hora
export const trialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'TRIAL_RATE_LIMITED',
      message: 'Límite de sesiones trial alcanzado. Regístrate para acceso completo.',
    });
  },
});

// ── Rate limiting para endpoints de IA — previene agotamiento de créditos ─────
// Máx 20 llamadas por usuario por hora (identifica por IP en anonimo)
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  // Los endpoints IA requieren authenticateToken, por lo que req.userId siempre existe
  keyGenerator: (req) => req.userId || 'anon',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AI_RATE_LIMITED',
      message: 'Límite de consultas de IA alcanzado. Reintenta en una hora.',
    });
  },
});

// ── Sanitización ESTRICTA — rutas de autenticación ───────────────────────────
// Sin HTML, sin SQL, sin bytes nulos. Límite 512 chars.
export function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/--/g, '')
    .replace(/[`;]/g, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, 512);
}

// Middleware: sanitiza campos de auth con sanitizeInput estricto
export function sanitizeAuthBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const field of ['email', 'correo', 'nombre', 'nombreCompleto']) {
      if (typeof req.body[field] === 'string') req.body[field] = sanitizeInput(req.body[field]);
    }
    if (typeof req.body.password   === 'string') req.body.password   = req.body.password.slice(0, 128);
    if (typeof req.body.contrasena === 'string') req.body.contrasena = req.body.contrasena.slice(0, 128);
  }
  next();
}

// ── Sanitización con WHITELIST — textos técnicos y jurídicos del Formulador ───
// Permite: <b> <i> <p> <br> <ul> <ol> <li> <strong> <em>
// Elimina: atributos, <script>, event handlers, javascript:, bytes nulos
// Límite: 8000 chars (suficiente para descripciones técnicas largas)
const ALLOWED_TAGS_WL = new Set(['b','i','p','br','ul','ol','li','strong','em']);

export function sanitizeTechnicalText(value, maxLength = 8000) {
  if (typeof value !== 'string') return value;
  return value
    // Etiquetas de apertura: elimina atributos, preserva tag si está en whitelist
    .replace(/<(\w+)([^>]*)>/gi, (_match, tag, _attrs) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS_WL.has(t) ? `<${t}>` : '';
    })
    // Etiquetas de cierre: preserva si está en whitelist
    .replace(/<\/(\w+)>/gi, (_match, tag) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS_WL.has(t) ? `</${t}>` : '';
    })
    // Destruye vectores de ataque que no dependen de tags
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, maxLength);
}

// ── Middleware Formulador — whitelist para textos técnicos ────────────────────
const FIELDS_FICHA_TECNICA = [
  'nombre', 'descripcion', 'objetivos', 'poblacion', 'municipio',
  'convocatoria', 'indicadores', 'mediosVerif', 'supuestos',
  'componenteMarco', 'fuenteFinanciamiento', 'contrapartida',
];

export function sanitizeFormuladorBody(req, res, next) {
  try {
    if (typeof req.body?.nombre === 'string') {
      req.body.nombre = sanitizeInput(req.body.nombre); // nombre: estricto (sin HTML)
    }
    if (req.body?.fichaTecnica && typeof req.body.fichaTecnica === 'object') {
      for (const field of FIELDS_FICHA_TECNICA) {
        if (typeof req.body.fichaTecnica[field] === 'string') {
          req.body.fichaTecnica[field] = sanitizeTechnicalText(req.body.fichaTecnica[field]);
        }
      }
    }
  } catch (e) {
    logger.warn('[SecurityMiddleware] Fallo sanitizando body — payload posiblemente malformado', { path: req.path, err: e.message });
  }
  next();
}

// ── Opciones de cookie segura para sesiones ───────────────────────────────────
export const COOKIE_OPTIONS = {
  httpOnly: true,                                         // inaccessible a JS del cliente
  secure: process.env.NODE_ENV === 'production',          // solo HTTPS en producción
  sameSite: 'strict',                                     // previene CSRF
  maxAge: 24 * 60 * 60 * 1000,                           // 24 horas
  path: '/',
};
