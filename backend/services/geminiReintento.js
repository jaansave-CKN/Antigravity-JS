/**
 * geminiReintento.js — LOTE 9 (2026-09-24): reintento con backoff exponencial
 * SOLO ante fallos transitorios del servidor de Google (HTTP 500/502/503/504).
 *
 * Motivo (verificado en vivo esta sesión): gemini-3.6-flash devolvió 503
 * "high demand" repetidas veces; ningún agente reintentaba y el usuario caía
 * directo al respaldo por un fallo que se resuelve en segundos.
 *
 * Qué NO se reintenta, a propósito:
 *   - 429 (cuota): lo gestiona withKeyRotation rotando llaves / disyuntor.
 *   - 4xx: error real de la petición, reintentar no lo cambia.
 *   - Timeouts: el AbortSignal del caller acota el tiempo TOTAL (se comparte
 *     entre intentos), así un reintento nunca alarga la espera del usuario
 *     por encima del tope que el agente ya tenía.
 */
import { logger } from '../utils/logger.js';

const HTTP_TRANSITORIOS = new Set([500, 502, 503, 504]);
const dormirReal = (ms) => new Promise(r => setTimeout(r, ms));
const espera = (n, baseMs) => baseMs * 2 ** (n - 1) + Math.floor(Math.random() * (baseMs / 2));

/** fetch() con reintento ante 5xx transitorio. Devuelve la última respuesta. */
export async function fetchGeminiConReintento(url, init, { intentos = 3, baseMs = 800, dormir = dormirReal, origen = 'gemini' } = {}) {
  for (let n = 1; ; n++) {
    const res = await fetch(url, init);
    if (!HTTP_TRANSITORIOS.has(res.status) || n >= intentos) return res;
    try { await res.body?.cancel(); } catch { /* cuerpo ya consumido o bloqueado */ }
    const ms = espera(n, baseMs);
    logger.warn(`[${origen}] Gemini HTTP ${res.status} transitorio — reintento ${n}/${intentos - 1} en ${ms} ms`);
    await dormir(ms);
  }
}

/** Errores del SDK @google/generative-ai que son fallos transitorios de Google. */
export function esErrorTransitorioSDK(err) {
  return /\[(500|502|503|504)\b|\b503 Service Unavailable|UNAVAILABLE|overloaded|high demand/i.test(err?.message || '');
}

/** Envuelve una llamada del SDK con el mismo reintento exponencial. */
export async function conReintentoTransitorio(fn, { intentos = 3, baseMs = 800, dormir = dormirReal, origen = 'gemini-sdk' } = {}) {
  for (let n = 1; ; n++) {
    try {
      return await fn();
    } catch (err) {
      if (n >= intentos || !esErrorTransitorioSDK(err)) throw err;
      const ms = espera(n, baseMs);
      logger.warn(`[${origen}] Gemini transitorio (${String(err.message).slice(0, 80)}) — reintento ${n}/${intentos - 1} en ${ms} ms`);
      await dormir(ms);
    }
  }
}
