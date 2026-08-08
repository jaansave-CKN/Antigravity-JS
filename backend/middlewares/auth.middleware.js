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

export async function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token requerido' });
  const token = auth.slice(7);

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
  if (!payload) return res.status(401).json({ success: false, message: 'Token invalido' });

  // Sesión revocada: blacklist por-token (logout) o invalidación bulk (Stripe/admin)
  if (isRevoked(token) || !(await checkSessionValid(payload.sub, payload.iat, getRow))) {
    return res.status(401).json({ success: false, message: 'Sesión revocada' });
  }

  // Bloqueo manual / vigencia de membresía — chequeo en vivo en CADA request,
  // no solo al iniciar sesión: así una cuenta ya logueada (JWT de 7 días
  // todavía válido) se corta de inmediato si un admin la bloquea o expira.
  const accountStatus = await checkAccountStatus(payload.sub, payload.role, getRow);
  if (!accountStatus.ok) {
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
