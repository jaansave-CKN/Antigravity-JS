/**
 * supabaseAuth.js — Middleware de autenticación Supabase
 * Alternativa empresarial al JWT local del servidor.
 *
 * Variables de entorno requeridas:
 *   SUPABASE_URL         — https://<proyecto>.supabase.co
 *   SUPABASE_ANON_KEY    — clave pública anon/service
 *   SUPABASE_JWT_SECRET  — JWT secret (Project Settings → API)
 *
 * Uso en rutas:
 *   import { requireSupabaseAuth, optionalSupabaseAuth } from './middlewares/supabaseAuth.js';
 *   app.get('/api/formulador/*', requireSupabaseAuth, handler);
 *
 * Compatible con el middleware JWT local: comparte req.userId, req.userRole, req.tenantId.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const isConfigured = SUPABASE_URL && SUPABASE_ANON_KEY;

let supabase;
if (isConfigured) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
} else {
  console.warn('[supabaseAuth] SUPABASE_URL / SUPABASE_ANON_KEY no configuradas — middleware desactivado');
}

// ── Extrae y valida el Bearer token de la cabecera Authorization ──────────────
async function resolveSupabaseUser(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  if (!supabase) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  return user;
}

// ── Middleware estricto: rechaza si no hay sesión válida ─────────────────────
export async function requireSupabaseAuth(req, res, next) {
  if (!isConfigured) {
    return res.status(503).json({
      success: false,
      code: 'AUTH_NOT_CONFIGURED',
      message: 'Supabase Auth no configurado en este entorno',
    });
  }

  const user = await resolveSupabaseUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Token de sesión inválido o expirado' });
  }

  // Propaga al resto del handler — igual que el middleware JWT local
  req.userId   = user.id;
  req.userRole = user.user_metadata?.role || 'Usuario';
  req.tenantId = user.user_metadata?.tenant_id || user.id;
  req.email    = user.email;

  next();
}

// ── Middleware permisivo: continúa aunque no haya sesión (rutas públicas) ─────
export async function optionalSupabaseAuth(req, res, next) {
  if (!isConfigured) return next();

  const user = await resolveSupabaseUser(req);
  if (user) {
    req.userId   = user.id;
    req.userRole = user.user_metadata?.role || 'Usuario';
    req.tenantId = user.user_metadata?.tenant_id || user.id;
    req.email    = user.email;
  }
  next();
}

// ── Guard RBAC por módulo (radar | formulador | admin) ───────────────────────
export function requirePlan(module) {
  return async (req, res, next) => {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    }

    if (req.userRole === 'admin') return next();

    const meta = req.user?.user_metadata || {};

    const access = {
      radar:      meta.access_radar      || false,
      formulador: meta.access_formulador || false,
    };

    if (module === 'radar' && !access.radar) {
      return res.status(403).json({
        success: false,
        code: 'NO_ACCESS_RADAR',
        message: 'Plan Radar requerido',
        upgrade_required: true,
        redirect_to: '/planes',
      });
    }

    if (module === 'formulador' && !access.formulador) {
      return res.status(403).json({
        success: false,
        code: 'NO_ACCESS_FORMULADOR',
        message: 'Plan Formulador requerido',
        upgrade_required: true,
        redirect_to: '/planes',
      });
    }

    next();
  };
}

export { supabase };
