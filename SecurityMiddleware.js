/**
 * SecurityMiddleware.js — Blindaje de seguridad institucional
 * GGIE · Radar de Fondos 360
 *
 * Exporta: authLimiter, sanitizeInput, sanitizeAuthBody, COOKIE_OPTIONS
 */

import rateLimit from 'express-rate-limit';

// ── Rate limiting estricto para rutas de autenticación ────────────────────────
// Máx 5 intentos fallidos por IP cada 15 minutos
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  max: 5,
  skipSuccessfulRequests: true, // Solo cuenta los intentos fallidos
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? req.socket?.remoteAddress ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AUTH_RATE_LIMITED',
      message: 'ACCESO BLOQUEADO: Límite de intentos de autenticación excedido. Reintente en 15 minutos.',
    });
  },
});

// ── Sanitización de entradas ──────────────────────────────────────────────────
// Previene XSS e Injection en campos de texto
export function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '')          // elimina etiquetas HTML
    .replace(/javascript:/gi, '')     // elimina protocolo JS
    .replace(/on\w+\s*=/gi, '')       // elimina event handlers inline
    .replace(/--/g, '')               // elimina comentarios SQL
    .replace(/[`;]/g, '')             // elimina terminadores SQL y backticks
    .replace(/\x00/g, '')             // elimina bytes nulos
    .trim()
    .slice(0, 512);                   // límite de longitud máxima
}

// Middleware: sanitiza campos del cuerpo en rutas de autenticación
export function sanitizeAuthBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    const textFields = ['email', 'correo', 'nombre', 'nombreCompleto'];
    for (const field of textFields) {
      if (typeof req.body[field] === 'string') {
        req.body[field] = sanitizeInput(req.body[field]);
      }
    }
    // Contraseñas: solo límite de longitud (preservar caracteres especiales del usuario)
    if (typeof req.body.password   === 'string') req.body.password   = req.body.password.slice(0, 128);
    if (typeof req.body.contrasena === 'string') req.body.contrasena = req.body.contrasena.slice(0, 128);
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
