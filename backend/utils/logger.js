/**
 * logger.js — Logging estructurado JSON para producción (Railway/Render)
 *
 * Sustituye console.error/console.warn sueltos por líneas JSON con
 * timestamp + nivel + contexto, para que no se pierdan al rotar logs
 * y puedan ser ingeridas por colectores remotos (Logtail, Datadog, etc).
 *
 * Uso: import { logger } from '../utils/logger.js'
 *      logger.error('[ArbolAgent] Fallo Gemini', { err: err.message, proyectoId })
 */

function emit(level, message, meta = {}) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info:  (message, meta) => emit('info', message, meta),
  warn:  (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
};
