/**
 * auth.middleware.js — Autenticación JWT (pbkdf2 + HS256)
 *
 * Extraído de server.js (Operación Bisturí, Grupo Elite, 2026-08-06) — vivía
 * inline como monolito (líneas ~149-196). El documento v11 lo describía como
 * un archivo separado ("auth.middleware.js valida primero contra Supabase
 * Auth, cae a JWT local si falla") que nunca existió: `validateSupabaseToken`
 * (backend/config/supabase.config.js) tenía cero invocaciones — se eliminó por
 * separado, no hay fallback Supabase real. Este archivo solo valida JWT propio.
 */
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';
import { isRevoked, checkSessionValid, checkAccountStatus } from './tokenBlacklist.js';
import { getRow } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET;
export const AUTH_COOKIE_NAME = 'auth_token';

// FIX (Fase 1 Dual-Mode, Prioridad Amarilla, 2026-09-05): única fuente de
// verdad de "de dónde viene el token" — cookie primero, header Authorization
// como fallback. Compartida entre authenticateToken y logout (server.js)
// para que ambos coincidan siempre: si el logout leyera el token de un lugar
// distinto al que authenticateToken usó para autenticar, podría revocar el
// token equivocado (o, con la cookie como única fuente real, explotar contra
// `req.headers.authorization.slice(7)` con authorization===undefined).
export function extractToken(req) {
  if (req.cookies?.[AUTH_COOKIE_NAME]) return req.cookies[AUTH_COOKIE_NAME];
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// Usuario de desarrollo para 'demo-mode-token' (solo NODE_ENV !== 'production').
// UUID fijo y reconocible (todo ceros salvo el último dígito) — nunca debe
// existir con este id en una base de datos de producción real. Sembrado en
// 015_seed_dev_user.sql y en el bootstrap de server.js (gateado a no-producción).
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

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

// Logging de cada rechazo 401 con su motivo exacto (auditoría 2026-08-22):
// antes de esto, un 401 no dejaba ningún rastro server-side — encontrar la
// causa real de un "Sesión revocada" espurio (usuarios.tokens_invalidated_at
// con un valor futuro anómalo, ver migración de ese incidente) requirió
// instrumentar esto desde cero. Se queda como observabilidad permanente.
function logAuthRejection(req, motivo, extra) {
  logger.warn('[auth] Rechazo 401', { path: req.path, method: req.method, motivo, ...extra });
}

export async function authenticateToken(req, res, next) {
  // Cookie primero (Fase 1 Dual-Mode), header Authorization como fallback —
  // ver extractToken() arriba. El frontend actual (sin tocar en esta fase)
  // nunca manda la cookie de vuelta (fetch sin credentials), así que hoy
  // esto SIEMPRE cae al header, igual que antes de este cambio.
  const token = extractToken(req);
  if (!token) {
    const auth = req.headers.authorization;
    logAuthRejection(req, 'sin_cookie_ni_header_valido', { tieneCookie: !!req.cookies?.[AUTH_COOKIE_NAME], authPresente: !!auth, authPrefijo: auth ? auth.slice(0, 15) : null });
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }

  // DEV: demo-mode-token es aceptado en entorno local para no bloquear el trabajo de desarrollo.
  // Debe ser un UUID real (no 'dev-user-001') porque proyectos.user_id/org_id y
  // projects.tenant_id son columnas UUID con FK a usuarios(id) — un valor no-UUID
  // hace fallar cualquier INSERT/UPDATE autenticado con este token (500 de BD).
  // El usuario correspondiente se siembra en 015_seed_dev_user.sql / bootstrap.
  if (process.env.NODE_ENV !== 'production' && token === 'demo-mode-token') {
    req.userId = DEV_USER_ID;
    req.userRole = 'admin';
    return next();
  }

  const payload = verifyToken(token);
  if (!payload) {
    logAuthRejection(req, 'jwt_verify_fallo', { tokenPrefijo: token.slice(0, 12) });
    return res.status(401).json({ success: false, message: 'Token invalido' });
  }

  // Sesión revocada: blacklist por-token (logout) o invalidación bulk (Stripe/admin)
  const revocado = isRevoked(token);
  const sesionValida = await checkSessionValid(payload.sub, payload.iat, getRow);
  if (revocado || !sesionValida) {
    logAuthRejection(req, 'sesion_revocada', { userId: payload.sub, revocadoPorBlacklist: revocado, sesionValida, iat: payload.iat });
    return res.status(401).json({ success: false, message: 'Sesión revocada' });
  }

  // Bloqueo manual / vigencia de membresía — chequeo en vivo en CADA request,
  // no solo al iniciar sesión: así una cuenta ya logueada (JWT de 7 días
  // todavía válido) se corta de inmediato si un admin la bloquea o expira.
  const accountStatus = await checkAccountStatus(payload.sub, payload.role, getRow);
  if (!accountStatus.ok) {
    logAuthRejection(req, 'account_status', { userId: payload.sub, code: accountStatus.code, roleEnToken: payload.role });
    return res.status(401).json({ success: false, code: accountStatus.code, message: accountStatus.message });
  }

  req.userId = payload.sub;
  req.userRole = payload.role;
  next();
}

// SECURITY (auditoría 2026-08-08, docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md §6.3):
// centraliza el patrón `if (req.userRole !== 'admin') return res.status(403)...`
// que antes se repetía inline 13+ veces en server.js y que varios endpoints de
// Directorio/Scheduler/moderación omitían por descuido. Usar SIEMPRE después de
// authenticateToken (depende de req.userRole ya poblado).
export function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ success: false, message: 'Requiere rol admin' });
  next();
}
