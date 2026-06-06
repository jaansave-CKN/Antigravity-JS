/**
 * auth.middleware.js — Fuente ÚNICA de verdad para autenticación
 *
 * Estrategia de validación en cascada (sin estado compartido entre servicios):
 *
 *   1. Supabase Auth (PROD)  — supabase.auth.getUser(token) si SUPABASE_URL configurado
 *      → token firmado con el JWT Secret del proyecto Supabase
 *      → garantiza que la sesión activa del cliente sea legítima en el servidor remoto
 *
 *   2. JWT local (DEV/fallback) — jwt.verify(token, JWT_SECRET) si Supabase no está configurado
 *      → compatible con el flujo de registro/login interno de server.js
 *      → NO usar en producción si Supabase está activo
 *
 * Ambas ramas setean los mismos campos en req:
 *   req.userId   — UUID del usuario autenticado
 *   req.userRole — 'Usuario' | 'admin' | etc.
 *   req.tenantId — UUID del tenant (org_id)
 *   req.email    — email del usuario
 *
 * Uso:
 *   import { requireAuth, optionalAuth } from './middlewares/auth.middleware.js';
 *   app.get('/api/formulador/*', requireAuth, handler);
 */

import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const JWT_SECRET       = process.env.JWT_SECRET;
const USE_SUPABASE     = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// Instancia Supabase (solo si está configurado)
const supabase = USE_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

if (USE_SUPABASE) {
  console.log('[auth.middleware] Modo: Supabase Auth (producción)');
} else {
  console.log('[auth.middleware] Modo: JWT local (desarrollo)');
}

// ── Extrae el token del header Authorization: Bearer <token> ─────────────────
function extractToken(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

// ── Validación Supabase: fuente de verdad en producción ──────────────────────
async function validateWithSupabase(token) {
  if (!supabase) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  return {
    userId:            user.id,
    userRole:          user.user_metadata?.role || 'Usuario',
    tenantId:          user.user_metadata?.tenant_id || user.id,
    email:             user.email,
    access_radar:      user.user_metadata?.access_radar === true,
    access_formulador: user.user_metadata?.access_formulador === true,
    source:            'supabase',
  };
}

// ── Validación JWT local: fallback de desarrollo ──────────────────────────────
function validateWithLocalJWT(token) {
  if (!JWT_SECRET) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return {
      userId:            payload.sub,
      userRole:          payload.role || 'Usuario',
      tenantId:          payload.tenant_id || payload.org_id || payload.sub,
      email:             payload.email || null,
      access_radar:      payload.access_radar === true,
      access_formulador: payload.access_formulador === true,
      source:            'jwt-local',
    };
  } catch {
    return null;
  }
}

// ── Validación unificada ──────────────────────────────────────────────────────
async function resolveIdentity(req) {
  const token = extractToken(req);
  if (!token) return null;

  // Demo mode: siempre rechazado en rutas protegidas
  if (token === 'demo-mode-token') return null;

  // Supabase primero (producción)
  if (USE_SUPABASE) {
    const identity = await validateWithSupabase(token);
    if (identity) return identity;
    // Si Supabase falla (error de red, token expirado) no hacer fallback a JWT local
    return null;
  }

  // JWT local (desarrollo / sin Supabase)
  return validateWithLocalJWT(token);
}

// ── Middleware estricto: rechaza con 401 si no hay sesión válida ─────────────
export async function requireAuth(req, res, next) {
  const identity = await resolveIdentity(req);

  if (!identity) {
    return res.status(401).json({
      success: false,
      code:    'UNAUTHORIZED',
      message: 'Token de sesión inválido, expirado o ausente',
    });
  }

  req.userId            = identity.userId;
  req.userRole          = identity.userRole;
  req.tenantId          = identity.tenantId;
  req.email             = identity.email;
  req.access_radar      = identity.access_radar;
  req.access_formulador = identity.access_formulador;

  next();
}

// ── Middleware permisivo: continúa aunque no haya sesión ─────────────────────
export async function optionalAuth(req, res, next) {
  const identity = await resolveIdentity(req);

  if (identity) {
    req.userId            = identity.userId;
    req.userRole          = identity.userRole;
    req.tenantId          = identity.tenantId;
    req.email             = identity.email;
    req.access_radar      = identity.access_radar;
    req.access_formulador = identity.access_formulador;
  }

  next();
}

// ── Mapa de módulos → plan requerido ─────────────────────────────────────────
// M1 = Radar búsqueda, M2 = Puente (requiere formulador para inyección)
// M3-M12 = Formulador completo
const MODULE_PLAN_MAP = {
  M1:  'radar',
  M2:  'formulador',   // Puente: accede al formulador, valida plan formulador
  M3:  'formulador',
  M4:  'formulador',
  M5:  'formulador',
  M6:  'formulador',
  M7:  'formulador',
  M8:  'formulador',
  M9:  'formulador',
  M10: 'formulador',
  M11: 'formulador',
  M12: 'formulador',
};

/**
 * validatePlanAccess(userId, requiredModule)
 * Consulta user_subscriptions y verifica que el plan cubra el módulo solicitado.
 * Retorna null si está autorizado, o un objeto {code, message} si no.
 *
 * requiredModule: 'radar' | 'formulador' | 'M1'..'M12'
 */
export async function validatePlanAccess(userId, requiredModule) {
  const planKey = MODULE_PLAN_MAP[requiredModule] ?? requiredModule;

  try {
    const { getRow } = await import('../config/database.config.js');
    const sub = await getRow(
      'SELECT access_radar, access_formulador FROM user_subscriptions WHERE user_id = $1',
      [userId]
    );

    if (planKey === 'radar' && !sub?.access_radar) {
      return {
        code:    'UPGRADE_PLAN',
        message: 'Acceso restringido: requiere suscripción activa al Plan Radar',
        upgrade_required: true,
        redirect_to: '/planes',
      };
    }
    if (planKey === 'formulador' && !sub?.access_formulador) {
      return {
        code:    'UPGRADE_PLAN',
        message: 'Acceso restringido: requiere suscripción activa al Plan Formulador',
        upgrade_required: true,
        redirect_to: '/planes',
      };
    }

    return null; // autorizado
  } catch (err) {
    console.error('[auth.middleware] validatePlanAccess error:', err.message);
    return {
      code:    'INTERNAL_ERROR',
      message: 'Error verificando permisos de suscripción',
    };
  }
}

// ── Guard RBAC: verifica acceso a módulos (radar | formulador | admin) ────────
export function requirePlan(module) {
  return async (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    }
    if (req.userRole === 'admin') return next();

    const denial = await validatePlanAccess(req.userId, module);
    if (denial) {
      const status = denial.code === 'INTERNAL_ERROR' ? 500 : 403;
      return res.status(status).json({ success: false, ...denial });
    }

    next();
  };
}

// ── Exportar supabase para uso en otros módulos ───────────────────────────────
export { supabase, USE_SUPABASE };
