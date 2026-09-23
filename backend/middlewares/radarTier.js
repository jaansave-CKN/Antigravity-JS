/**
 * radarTier.js — nivel de acceso al catálogo del Radar (BIZ-001, auditoría 2026-09-23).
 *
 * Para rutas públicas del catálogo; va DESPUÉS de optionalAuth
 * (auth.middleware.js), que puebla req.userId/req.userRole si hay sesión.
 * Pone req.radarTier:
 *   'full'    → admin, o plan con user_subscriptions.access_radar = 1
 *   'muestra' → anónimo, trial, free o cualquier error (cierra en falso a
 *               propósito: ante la duda, muestra).
 * El trial se corta antes de consultar: su sub 'trial-xxxx' no es un UUID
 * válido para user_subscriptions. Misma consulta que requireAccess('radar')
 * en server.js.
 */
import { withTenantRow } from '../config/database.config.js';
import { logger } from '../utils/logger.js';

export async function nivelRadar(userId, userRole) {
  if (!userId) return 'muestra';
  if (userRole === 'admin') return 'full';
  if (userRole === 'trial' || String(userId).startsWith('trial-')) return 'muestra';
  const sub = await withTenantRow(userId,
    'SELECT access_radar FROM user_subscriptions WHERE user_id = ?', [userId]);
  return sub?.access_radar ? 'full' : 'muestra';
}

export function resolverNivelRadar(req, _res, next) {
  nivelRadar(req.userId, req.userRole)
    .catch(e => {
      logger.warn('[radar] No se pudo resolver el plan, se sirve muestra', { userId: req.userId, err: e.message });
      return 'muestra';
    })
    .then(nivel => { req.radarTier = nivel; next(); });
}
