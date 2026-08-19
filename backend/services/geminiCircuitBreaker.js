/**
 * geminiCircuitBreaker.js — Gestor de cuota + Circuit Breaker + pool de
 * llaves para Gemini API.
 * Free Tier por llave: 15 RPM / 1500 RPD (gemini-2.0-flash)
 *
 * Estados del circuito (por llave):
 *   CLOSED    → IA Avanzada (Gemini operativo)
 *   OPEN      → Respaldo    (cuota agotada, usa heurística)
 *   HALF_OPEN → Sondeo      (probando si la cuota se recuperó)
 *
 * REFACTOR (2026-08-19, "DIRECTIVA KILO-CUOTA", revisado por `architect`
 * antes de escribirse — verificado false que existiera "un cliente
 * centralizado": había 8 archivos con fetch/SDK duplicados y 3 nombres de
 * env var distintos entre ellos):
 *
 *   - Antes: un solo estado global (CLOSED/OPEN/HALF_OPEN) para toda la
 *     app, calibrado para UNA llave. Ahora: estado independiente POR LLAVE
 *     — cada una tiene su propia cuota real de Google. La app solo se
 *     considera "sin IA" cuando TODAS las llaves configuradas están OPEN.
 *   - Pool de llaves vía `GEMINI_API_KEY_1`, `_2`, `_3`... Retrocompatible:
 *     si no hay ninguna `_N`, se usa `GOOGLE_API_KEY` (o el legacy
 *     `GEMINI_API_KEY`) como llave única #1 — con una sola llave
 *     configurada (el caso real hoy) el comportamiento es idéntico al
 *     anterior, la rotación simplemente nunca tiene a dónde rotar.
 *   - `withKeyRotation(attemptFn)`: primitivo único de rotación que sirve
 *     tanto a los 4 archivos que hacen `fetch()` directo al endpoint
 *     compatible con OpenAI (CopilotoService, EntradaIAService,
 *     viabilidadAgent, enfoqueEntidadAgent) como a los 3 que usan el SDK
 *     `@google/generative-ai` (arbolObjetivosAgent, markitdownService,
 *     sectorClassifier) — cada `attemptFn` recibe `(apiKey, keyIndex)` y
 *     hace su propia llamada real (fetch o SDK) exactamente como antes;
 *     `withKeyRotation` solo decide QUÉ llave usar, cuándo rotar a la
 *     siguiente (únicamente en error de cuota/429, nunca en un error real
 *     de la API — eso se propaga de inmediato, no tiene sentido rotar) y
 *     cuándo declarar el pool agotado. NO toca prompts, formato de
 *     respuesta ni manejo de errores propio de cada agente.
 *   - Fail-fast: si todas las llaves del pool fallan, se lanza
 *     `GeminiPoolExhaustedError` de inmediato — sin espera bloqueante
 *     dentro de la petición (el mandato original pedía un sleep de 5-10s
 *     antes de abrir el circuito; `architect` lo objetó: EntradaIAService
 *     responde a un clic de usuario en la UI, no es un job en background,
 *     y dormir el hilo de respuesta solo empeora la espera sin ganar nada).
 *     El "esperar antes de reintentar" real vive en `HALF_OPEN_PROBE_MS`
 *     (5 min) — una ventana entre peticiones DISTINTAS, no un sleep dentro
 *     de la misma petición.
 *   - `embeddingsService.js` (endpoint de embeddings, no chat/completions,
 *     usa el SDK `@google/genai` — distinto de `@google/generative-ai`)
 *     queda FUERA de este refactor a propósito: es una API distinta con
 *     semántica de cuota distinta, y hoy ni siquiera pasa por este circuit
 *     breaker. Rotar llaves ahí es un cambio separado, no pedido.
 */

import { captureMessage } from '../config/sentry.config.js';

const RPM_LIMIT  = 15;
const RPD_LIMIT  = 1500;
const RPM_WINDOW = 60_000;          // 1 minuto en ms
const HALF_OPEN_PROBE_MS = 5 * 60_000; // espera 5 min antes de re-probar

function nextMidnightUTC() {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
  ));
}

// Lee el pool de llaves desde .env. Retrocompatible: si no hay ninguna
// GEMINI_API_KEY_N explícita, GOOGLE_API_KEY (o el legacy GEMINI_API_KEY,
// ya usado como fallback en algunos archivos) se toma como llave única #1.
function resolveKeyPool() {
  const explicit = [];
  for (let i = 1; ; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (!k) break;
    explicit.push(k);
  }
  if (explicit.length) return explicit;
  const legacy = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  return legacy ? [legacy] : [];
}

class KeyState {
  constructor() {
    this.state            = 'CLOSED';
    this.dailyCount       = 0;
    this.minuteTimestamps = [];
    this.lastQuotaError   = null;
    this.lastHalfOpenAt   = 0;
    this.dailyResetAt     = nextMidnightUTC();
  }
}

class GeminiCircuitBreaker {
  constructor() {
    this.keys       = resolveKeyPool();
    this.keyStates  = this.keys.map(() => new KeyState());
    this.rrPointer  = 0; // round-robin: próxima llave a intentar primero
  }

  _checkDailyReset(ks) {
    if (Date.now() >= ks.dailyResetAt.getTime()) {
      ks.dailyCount   = 0;
      ks.dailyResetAt = nextMidnightUTC();
      if (ks.state === 'OPEN') {
        ks.state = 'HALF_OPEN';
        console.log('[GeminiCB] Reset diario → pasando a HALF_OPEN para sondeo.');
      }
    }
  }

  _currentRPM(ks) {
    const cutoff = Date.now() - RPM_WINDOW;
    ks.minuteTimestamps = ks.minuteTimestamps.filter(t => t > cutoff);
    return ks.minuteTimestamps.length;
  }

  /** Retorna true si se puede lanzar una llamada con la llave #i (default 0 — retrocompat con callers que no rotan) */
  canCall(i = 0) {
    const ks = this.keyStates[i];
    if (!ks) return false;
    this._checkDailyReset(ks);

    // FIX (2026-08-19, verificado en vivo — bug preexistente, no introducido
    // por el refactor de pool): OPEN solo transicionaba a HALF_OPEN en el
    // reset diario (medianoche UTC) — un solo 429 real (típicamente de RPM,
    // que Google libera en ~60s) dejaba esta llave sin poder intentar IA
    // real el resto del día entero, cayendo siempre a heurística/Modo
    // Respaldo pese a que la cuota real ya se hubiera recuperado. Confirmado
    // con /api/admin/quota-status mostrando "reset_time_countdown":"18:54:39"
    // minutos después de un solo error real. HALF_OPEN_PROBE_MS (5 min) ya
    // existía y su nombre/comentario ya decían "espera 5 min antes de
    // re-probar" — nunca estaba conectado a esta transición.
    if (ks.state === 'OPEN') {
      const msDesdeError = Date.now() - (ks.lastQuotaError?.getTime() ?? 0);
      if (msDesdeError < HALF_OPEN_PROBE_MS) return false;
      ks.state = 'HALF_OPEN';
      ks.lastHalfOpenAt = Date.now();
      console.log(`[GeminiCB] Llave #${i + 1} — ${Math.round(HALF_OPEN_PROBE_MS / 60_000)} min sin nuevo error → HALF_OPEN para sondeo.`);
      return true;
    }
    if (ks.state === 'HALF_OPEN') {
      if (Date.now() - ks.lastHalfOpenAt < HALF_OPEN_PROBE_MS) return false;
      ks.lastHalfOpenAt = Date.now();
      return true; // permite 1 sondeo
    }
    if (ks.dailyCount >= RPD_LIMIT) { ks.state = 'OPEN'; return false; }
    if (this._currentRPM(ks) >= RPM_LIMIT) return false; // throttle RPM sin abrir circuito
    return true;
  }

  /** Registrar llamada exitosa con la llave #i */
  recordSuccess(i = 0) {
    const ks = this.keyStates[i];
    if (!ks) return;
    ks.minuteTimestamps.push(Date.now());
    ks.dailyCount++;
    if (ks.state === 'HALF_OPEN') {
      ks.state = 'CLOSED';
      console.log(`[GeminiCB] Llave #${i + 1} — sondeo exitoso → CLOSED.`);
    }
  }

  /** Registrar error 429 con la llave #i — abre el circuito de ESA llave */
  recordQuotaError(i = 0) {
    const ks = this.keyStates[i];
    if (!ks) return;
    ks.lastQuotaError = new Date();
    const eraCerrado = ks.state !== 'OPEN';
    ks.state = 'OPEN';
    console.warn(`[GeminiCB] Llave #${i + 1} — cuota agotada → OPEN.`);
    // Solo alerta cuando la transición deja a TODAS las llaves sin cuota —
    // antes alertaba en cada transición de una sola llave compartida; con
    // pool, una llave en OPEN no es crítico si otra sigue disponible.
    if (eraCerrado && this.keyStates.every(k => k.state === 'OPEN')) {
      captureMessage('CRITICAL: Gemini Circuit Breaker OPEN (todas las llaves) - Degradación a heurística', 'fatal', {
        keys: this.keyStates.length,
      });
    }
  }

  /** Retorna el estado completo para el endpoint /api/admin/quota-status.
   *  Forma AGREGADA idéntica a la de antes de este refactor (consumida por
   *  client/src/pages/PanelPage.tsx) + un desglose por llave adicional. */
  getStatus() {
    this.keyStates.forEach(ks => this._checkDailyReset(ks));

    const dailyCount = this.keyStates.reduce((s, ks) => s + ks.dailyCount, 0);
    const rpm        = this.keyStates.reduce((s, ks) => s + this._currentRPM(ks), 0);
    const limitDaily = RPD_LIMIT * Math.max(1, this.keyStates.length);
    const limitRpm   = RPM_LIMIT * Math.max(1, this.keyStates.length);

    const activeStates = this.keyStates.filter(ks => ks.state === 'CLOSED' || ks.state === 'HALF_OPEN');
    const isActive = this.keyStates.length > 0 && activeStates.length > 0;
    const circuitState = this.keyStates.length === 0
      ? 'OPEN'
      : (activeStates.length === this.keyStates.length ? 'CLOSED'
        : (activeStates.length > 0 ? 'HALF_OPEN' : 'OPEN'));

    const soonestReset = this.keyStates.reduce(
      (min, ks) => Math.min(min, ks.dailyResetAt.getTime()),
      this.keyStates[0]?.dailyResetAt.getTime() ?? nextMidnightUTC().getTime()
    );
    const msToReset = Math.max(0, soonestReset - Date.now());
    const hh = String(Math.floor(msToReset / 3_600_000)).padStart(2, '0');
    const mm = String(Math.floor((msToReset % 3_600_000) / 60_000)).padStart(2, '0');
    const ss = String(Math.floor((msToReset % 60_000) / 1_000)).padStart(2, '0');

    const lastQuotaError = this.keyStates
      .map(ks => ks.lastQuotaError)
      .filter(Boolean)
      .sort((a, b) => b - a)[0] ?? null;

    return {
      operating_mode:        isActive ? 'IA Avanzada' : 'Respaldo',
      circuit_state:         circuitState,
      current_usage: {
        daily:            dailyCount,
        rpm_last_minute:  rpm,
      },
      limit_daily:           limitDaily,
      limit_rpm:             limitRpm,
      daily_pct:             Math.min(100, Math.round((dailyCount / limitDaily) * 100)),
      rpm_pct:               Math.min(100, Math.round((rpm / limitRpm) * 100)),
      reset_time_countdown:  `${hh}:${mm}:${ss}`,
      reset_at:              new Date(soonestReset).toISOString(),
      last_quota_error:      lastQuotaError?.toISOString() ?? null,
      // Desglose por llave — aditivo, no rompe consumidores que solo leían
      // los campos agregados de arriba.
      pool: {
        total_keys:    this.keyStates.length,
        keys_active:   activeStates.length,
        per_key: this.keyStates.map((ks, i) => ({
          index: i + 1, state: ks.state, daily: ks.dailyCount,
          rpm_last_minute: this._currentRPM(ks),
        })),
      },
    };
  }
}

// Singleton compartido por toda la aplicación
export const geminiCB = new GeminiCircuitBreaker();

// ── Respuesta estandarizada — todo consumidor de geminiCB debe usar esta forma
// cuando canCall() es false o Google responde 429, en vez de inventar su propio
// código/mensaje de error. Mantiene el contrato HTTP consistente en toda la API.
export const AI_LIMIT_EXCEEDED_RESPONSE = Object.freeze({
  success: false,
  code:    'AI_LIMIT_EXCEEDED',
  message: 'Límite de cuota de Gemini alcanzado. Usando modo de respaldo.',
});

/** true si el error lanzado por el SDK/fetch de Gemini corresponde a cuota/429 */
export function isQuotaError(err) {
  const msg = err?.message || '';
  return /429|quota|rate.?limit/i.test(msg);
}

/** Se lanza cuando TODAS las llaves del pool fallaron/están en cooldown. */
export class GeminiPoolExhaustedError extends Error {
  constructor(message = 'Límite de IA agotado en todas las llaves configuradas — intenta de nuevo en unos minutos.') {
    super(message);
    this.name = 'GeminiPoolExhaustedError';
    this.status = 429;
  }
}

/**
 * Primitivo único de rotación de llaves — ver nota de cabecera. `attemptFn`
 * recibe `(apiKey, keyIndex)` y debe hacer la llamada real (fetch o SDK) y
 * devolver el resultado ya parseado, o lanzar. Un error cuyo mensaje matchea
 * `isQuotaError` rota a la siguiente llave disponible; cualquier otro error
 * se propaga de inmediato tal cual (no tiene sentido rotar por un error real
 * de la API que no es de cuota). Fail-fast: sin sleep bloqueante — si todo
 * el pool falla/está en cooldown, lanza GeminiPoolExhaustedError enseguida.
 */
export async function withKeyRotation(attemptFn) {
  if (!geminiCB.keys.length) {
    const e = new Error('La generación con IA no está configurada en el servidor (falta GOOGLE_API_KEY o GEMINI_API_KEY_1).');
    e.status = 503;
    throw e;
  }

  for (let n = 0; n < geminiCB.keys.length; n++) {
    const i = (geminiCB.rrPointer + n) % geminiCB.keys.length;
    if (!geminiCB.canCall(i)) continue;

    try {
      const result = await attemptFn(geminiCB.keys[i], i);
      geminiCB.recordSuccess(i);
      geminiCB.rrPointer = (i + 1) % geminiCB.keys.length; // balancea: la próxima llamada empieza por la siguiente llave
      return result;
    } catch (err) {
      if (isQuotaError(err)) {
        geminiCB.recordQuotaError(i);
        continue; // rota a la siguiente llave del pool, sin esperar
      }
      throw err; // error real (no de cuota) — se propaga tal cual, el caller decide
    }
  }

  throw new GeminiPoolExhaustedError();
}
