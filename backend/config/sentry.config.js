/**
 * sentry.config.js — Colector remoto de errores del backend.
 * Espejo del patrón ya usado en el frontend (client/src/lib/sentry.ts):
 * no-op si SENTRY_DSN no está configurado, para no romper nada en local/dev
 * ni depender de una cuenta de Sentry para poder arrancar el servidor.
 */
import * as Sentry from '@sentry/node';

// NO se lee process.env.SENTRY_DSN al importar este módulo — loadEnv() en
// server.js carga el .env en tiempo de ejecución (línea 63), DESPUÉS de que
// los imports estáticos ya se evaluaron. Si se leyera aquí arriba, siempre
// vería undefined. initSentry() se llama explícitamente después de loadEnv().
let enabled = false;

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('[Sentry] Backend — SENTRY_DSN no configurado, colector remoto INACTIVO (solo logs locales).');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
  enabled = true;
  console.log('[Sentry] Backend — colector remoto ACTIVO.');
}

/** Captura una excepción — no-op si Sentry no está configurado. */
export function captureError(error, extra) {
  if (!enabled) return;
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { extra });
}

/** Captura un mensaje con nivel de severidad — no-op si Sentry no está configurado. */
export function captureMessage(message, level = 'info', extra) {
  if (!enabled) return;
  Sentry.captureMessage(message, { level, extra });
}

export { Sentry };
