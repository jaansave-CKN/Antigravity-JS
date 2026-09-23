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

// ELIMINADO (AUTH-001, auditoría 2026-09-23): el bypass 'demo-mode-token'
// (rol admin sin credenciales si NODE_ENV!=='production') y su DEV_USER_ID.
// Con el .env local en development apuntando a la BD real y el backend en
// 0.0.0.0, cualquier equipo de la red Wi-Fi obtenía admin sobre 81 cuentas
// reales (verificado en vivo). No hay sustituto: en local se usa una cuenta real.

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

// Núcleo compartido por authenticateToken (401 si falla) y optionalAuth
// (sigue como anónimo si falla). Devuelve { ok:true, userId, role } o
// { ok:false, message, code? }. `registrar=false` evita escribir un "Rechazo
// 401" por cada visita anónima a una ruta de acceso opcional.
async function resolveSession(req, { registrar = true } = {}) {
  const log = registrar ? logAuthRejection : () => {};
  // Cookie primero (Fase 1 Dual-Mode), header Authorization como fallback —
  // ver extractToken() arriba.
  const token = extractToken(req);
  if (!token) {
    const auth = req.headers.authorization;
    // DIAGNÓSTICO TEMPORAL (2026-09-16, investigación en vivo del reporte
    // "se perdió mi información" — quitar una vez identificada la causa real
    // de por qué la cookie httpOnly no llega en estas peticiones concretas):
    // se necesita el header Cookie CRUDO, no solo si req.cookies ya la
    // encontró parseada — para distinguir "el navegador no mandó Cookie en
    // absoluto" (credentials:'include' ausente o cookie nunca seteada) de
    // "mandó Cookie pero sin auth_token" (dominio/path no coincide).
    log(req, 'sin_cookie_ni_header_valido', {
      tieneCookie: !!req.cookies?.[AUTH_COOKIE_NAME],
      authPresente: !!auth,
      authPrefijo: auth ? auth.slice(0, 15) : null,
      cookieHeaderCrudo: req.headers.cookie || null,
      origin: req.headers.origin || null,
      referer: req.headers.referer || null,
    });
    return { ok: false, message: 'Token requerido' };
  }

  const payload = verifyToken(token);
  if (!payload) {
    log(req, 'jwt_verify_fallo', { tokenPrefijo: token.slice(0, 12) });
    return { ok: false, message: 'Token invalido' };
  }

  // AUTH-002 (auditoría 2026-09-23): los tokens de un solo uso (mfa_pending,
  // password_reset, account_activated, admin_pending_decision) se firman con
  // el mismo JWT_SECRET y llevan `purpose`; los de sesión ({sub, role}) nunca.
  // Sin este corte, el preAuthToken de MFA (emitido con solo la contraseña)
  // servía como sesión completa por header Bearer. Cada uno sigue siendo
  // válido en su propio endpoint, que lo verifica por su cuenta.
  if (payload.purpose !== undefined) {
    log(req, 'token_de_proposito_no_es_sesion', { userId: payload.sub, purpose: payload.purpose });
    return { ok: false, message: 'Token invalido' };
  }

  // Sesión revocada: blacklist por-token (logout) o invalidación bulk (Stripe/admin)
  const revocado = isRevoked(token);
  const sesionValida = await checkSessionValid(payload.sub, payload.iat, getRow);
  if (revocado || !sesionValida) {
    log(req, 'sesion_revocada', { userId: payload.sub, revocadoPorBlacklist: revocado, sesionValida, iat: payload.iat });
    return { ok: false, message: 'Sesión revocada' };
  }

  // Bloqueo manual / vigencia de membresía — chequeo en vivo en CADA request,
  // no solo al iniciar sesión: así una cuenta ya logueada (JWT de 7 días
  // todavía válido) se corta de inmediato si un admin la bloquea o expira.
  const accountStatus = await checkAccountStatus(payload.sub, payload.role, getRow);
  if (!accountStatus.ok) {
    log(req, 'account_status', { userId: payload.sub, code: accountStatus.code, roleEnToken: payload.role });
    return { ok: false, code: accountStatus.code, message: accountStatus.message };
  }

  return { ok: true, userId: payload.sub, role: payload.role };
}

export async function authenticateToken(req, res, next) {
  const sesion = await resolveSession(req);
  if (!sesion.ok) {
    return res.status(401).json({ success: false, ...(sesion.code ? { code: sesion.code } : {}), message: sesion.message });
  }
  req.userId = sesion.userId;
  req.userRole = sesion.role;
  next();
}

// Para rutas públicas cuyo contenido varía según la sesión (p. ej. el
// catálogo del Radar: muestra para anónimos, completo para plan Radar).
// Con sesión válida puebla req.userId/req.userRole; sin ella sigue como
// anónimo, sin 401 y sin log de rechazo.
export async function optionalAuth(req, _res, next) {
  try {
    const sesion = await resolveSession(req, { registrar: false });
    if (sesion.ok) {
      req.userId = sesion.userId;
      req.userRole = sesion.role;
    }
  } catch (e) {
    logger.warn('[auth] optionalAuth: error resolviendo sesión, se trata como anónimo', { err: e.message });
  }
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
