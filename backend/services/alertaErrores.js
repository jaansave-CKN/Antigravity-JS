/**
 * alertaErrores.js — LOTE 10: todo error 5xx no controlado de la API llega
 * a system_logs y, si existe ERROR_WEBHOOK_URL, a Discord/Slack, vía
 * logService.logCriticalError (que ya persiste + avisa por webhook).
 *
 * Por qué aquí y no solo en el manejador global de Express (verificado
 * 2026-09-25): las 13 envolturas `wrap()` de backend/routes y el `tryCatch`
 * de server.js atrapan sus errores, responden 500 ellos mismos y llaman a
 * sentry.config.captureError() — que sin SENTRY_DSN era un no-op. Casi ningún
 * 500 llegaba al manejador global. captureError() ahora delega aquí, y el
 * manejador global también: un único punto, sin duplicar el webhook.
 *
 * Reglas:
 *   - Solo 5xx (o errores sin status): un 4xx es un error del cliente, no una alerta.
 *   - Anti-inundación: la misma (método + ruta normalizada + mensaje) se avisa
 *     como máximo una vez por minuto.
 *   - Nunca incluye el body ni el query string (pueden llevar datos sensibles).
 */
import { logCriticalError } from './logService.js';

const VENTANA_MS = 60_000;
const MAX_CLAVES = 500;
const vistos = new Map();

const ES_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d+|[A-Za-z0-9_-]{20,})$/i;
const RE_PROYECTO = /\/api\/(?:proyectos|formulacion\/integral|m4\/config)\/([^/?#]+)/;

/** project_id a partir de la ruta (/api/proyectos/:id/..., /api/formulacion/integral/:id, /api/m4/config/:id). */
export function extraerProjectId(ruta = '') {
  const m = String(ruta).match(RE_PROYECTO);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** Módulo afectado: último segmento de la ruta que no es un identificador. */
export function moduloDeRuta(ruta = '') {
  const segs = String(ruta).split('?')[0].split('/').filter(s => s && s !== 'api' && !ES_ID.test(s));
  return segs[segs.length - 1] || 'desconocido';
}

const normalizarRuta = (ruta) => String(ruta).split('/').map(s => (ES_ID.test(s) ? ':id' : s)).join('/');

/** true si esta clave no se ha avisado en el último minuto (y la registra). */
export function debeAlertar(clave, ahora = Date.now()) {
  const ultima = vistos.get(clave);
  if (ultima !== undefined && ahora - ultima < VENTANA_MS) return false;
  if (vistos.size >= MAX_CLAVES) {
    for (const [k, t] of vistos) if (ahora - t >= VENTANA_MS) vistos.delete(k);
    if (vistos.size >= MAX_CLAVES) vistos.delete(vistos.keys().next().value);
  }
  vistos.set(clave, ahora);
  return true;
}

/**
 * Registra un error de servidor (system_logs + webhook). Nunca lanza.
 * @param {unknown} err
 * @param {{ method?: string, path?: string, route?: string, userId?: string, project_id?: string }} [contexto]
 * @returns {Promise<boolean>} true si se registró; false si se omitió (4xx o repetido).
 */
export async function alertarErrorServidor(err, contexto = {}, { registrar = logCriticalError, ahora = Date.now() } = {}) {
  try {
    const status = Number(err?.status ?? err?.statusCode) || 500;
    if (status < 500) return false;
    const ruta = String(contexto.path || '').split('?')[0];
    const metodo = contexto.method || '';
    const mensaje = String(err?.message ?? err ?? 'error desconocido').slice(0, 500);
    const modulo = contexto.route || (ruta ? moduloDeRuta(ruta) : 'proceso');
    if (!debeAlertar(`${metodo} ${normalizarRuta(ruta)} ${mensaje.slice(0, 120)}`, ahora)) return false;
    await registrar(`API:${modulo}`, `Error ${status}${ruta ? ` en ${metodo} ${ruta}` : ''}: ${mensaje}`, {
      project_id: contexto.project_id ?? extraerProjectId(ruta),
      modulo,
      metodo: metodo || null,
      ruta: ruta || null,
      user_id: contexto.userId ?? null,
      status,
      error: mensaje,
      timestamp: new Date(ahora).toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}
