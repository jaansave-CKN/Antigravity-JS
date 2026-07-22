/**
 * geminiCircuitBreaker.js — Gestor de cuota + Circuit Breaker para Gemini API
 * Free Tier: 15 RPM / 1500 RPD (gemini-2.0-flash)
 *
 * Estados del circuito:
 *   CLOSED    → IA Avanzada (Gemini operativo)
 *   OPEN      → Respaldo    (cuota agotada, usa heurística)
 *   HALF_OPEN → Sondeo      (probando si la cuota se recuperó)
 */

const RPM_LIMIT  = 15;
const RPD_LIMIT  = 1500;
const RPM_WINDOW = 60_000;          // 1 minuto en ms
const HALF_OPEN_PROBE_MS = 5 * 60_000; // espera 5 min antes de re-probar

class GeminiCircuitBreaker {
  constructor() {
    this.state             = 'CLOSED';
    this.dailyCount        = 0;
    this.minuteTimestamps  = [];  // rolling window para RPM
    this.lastQuotaError    = null;
    this.lastHalfOpenAt    = 0;
    this.dailyResetAt      = this._nextMidnightUTC();
  }

  _nextMidnightUTC() {
    const now = new Date();
    return new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
    ));
  }

  _checkDailyReset() {
    if (Date.now() >= this.dailyResetAt.getTime()) {
      this.dailyCount   = 0;
      this.dailyResetAt = this._nextMidnightUTC();
      if (this.state === 'OPEN') {
        this.state = 'HALF_OPEN';
        console.log('[GeminiCB] Reset diario → pasando a HALF_OPEN para sondeo.');
      }
    }
  }

  _currentRPM() {
    const cutoff = Date.now() - RPM_WINDOW;
    this.minuteTimestamps = this.minuteTimestamps.filter(t => t > cutoff);
    return this.minuteTimestamps.length;
  }

  /** Retorna true si se puede lanzar una llamada a Gemini */
  canCall() {
    this._checkDailyReset();
    if (this.state === 'OPEN') return false;
    if (this.state === 'HALF_OPEN') {
      if (Date.now() - this.lastHalfOpenAt < HALF_OPEN_PROBE_MS) return false;
      this.lastHalfOpenAt = Date.now();
      return true; // permite 1 sondeo
    }
    if (this.dailyCount >= RPD_LIMIT) { this.state = 'OPEN'; return false; }
    if (this._currentRPM() >= RPM_LIMIT) return false; // throttle RPM sin abrir circuito
    return true;
  }

  /** Registrar llamada exitosa */
  recordSuccess() {
    this.minuteTimestamps.push(Date.now());
    this.dailyCount++;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log('[GeminiCB] Sondeo exitoso → circuito CLOSED (IA Avanzada).');
    }
  }

  /** Registrar error 429 — abre el circuito */
  recordQuotaError() {
    this.lastQuotaError = new Date();
    this.state = 'OPEN';
    console.warn('[GeminiCB] Cuota agotada → circuito OPEN (Modo Respaldo).');
  }

  /** Retorna el estado completo para el endpoint /api/admin/quota-status */
  getStatus() {
    this._checkDailyReset();
    const rpm = this._currentRPM();
    const msToReset = Math.max(0, this.dailyResetAt.getTime() - Date.now());
    const hh = String(Math.floor(msToReset / 3_600_000)).padStart(2, '0');
    const mm = String(Math.floor((msToReset % 3_600_000) / 60_000)).padStart(2, '0');
    const ss = String(Math.floor((msToReset % 60_000) / 1_000)).padStart(2, '0');

    const isActive = this.state === 'CLOSED' || this.state === 'HALF_OPEN';
    return {
      operating_mode:        isActive ? 'IA Avanzada' : 'Respaldo',
      circuit_state:         this.state,
      current_usage: {
        daily:            this.dailyCount,
        rpm_last_minute:  rpm,
      },
      limit_daily:           RPD_LIMIT,
      limit_rpm:             RPM_LIMIT,
      daily_pct:             Math.min(100, Math.round((this.dailyCount / RPD_LIMIT) * 100)),
      rpm_pct:               Math.min(100, Math.round((rpm / RPM_LIMIT) * 100)),
      reset_time_countdown:  `${hh}:${mm}:${ss}`,
      reset_at:              this.dailyResetAt.toISOString(),
      last_quota_error:      this.lastQuotaError?.toISOString() ?? null,
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
