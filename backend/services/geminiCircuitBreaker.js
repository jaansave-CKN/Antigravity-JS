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
import { supabaseAdmin } from '../config/supabase.config.js';

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

// FIX (2026-08-22, hallazgo real #2 verificado): la versión anterior de
// este fix arreglaba el caso de huecos (ej. _1 ausente, _2 presente), pero
// introdujo uno nuevo: si CUALQUIER GEMINI_API_KEY_N estaba presente,
// devolvía SOLO el array `explicit` — ignorando GOOGLE_API_KEY por
// completo. La convención real de este .env (verificada en vivo, nunca
// cambiada) es GOOGLE_API_KEY = llave #1 SIEMPRE, GEMINI_API_KEY_2/_3 =
// llaves adicionales — nunca se renombra la primera a GEMINI_API_KEY_1.
// Al agregar una GEMINI_API_KEY_2 real, el pool se redujo de 1 a 1 (la
// original desapareció en silencio, reemplazada por la nueva) — la
// rotación entre 2 llaves nunca existió pese a estar "configurada".
// Ahora: legacy (GOOGLE_API_KEY/GEMINI_API_KEY) es SIEMPRE la llave #1 si
// existe; GEMINI_API_KEY_1..10 explícitas se suman como adicionales —
// GEMINI_API_KEY_1, si alguna vez se usa, sería entonces una llave EXTRA,
// no un alias de la legacy (evita duplicar la misma llave dos veces solo
// si su valor es idéntico al de GOOGLE_API_KEY).
const MAX_KEYS_ESCANEADAS = 10;
function resolveKeyPool() {
  const pool = [];
  const legacy = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (legacy) pool.push(legacy);

  const huecos = [];
  let ultimoPresente = 0;
  for (let i = 1; i <= MAX_KEYS_ESCANEADAS; i++) {
    const k = (process.env[`GEMINI_API_KEY_${i}`] || '').trim();
    if (k) {
      if (i > ultimoPresente + 1) huecos.push(...Array.from({ length: i - ultimoPresente - 1 }, (_, n) => ultimoPresente + 1 + n));
      if (k !== legacy) pool.push(k); // evita duplicar si _N repite el valor de la legacy
      ultimoPresente = i;
    }
  }
  if (huecos.length) {
    console.warn(`[GeminiCB] GEMINI_API_KEY_${huecos.join(', GEMINI_API_KEY_')} tienen nombre en .env pero están vacías o ausentes — se omiten del pool, no bloquean a las llaves posteriores.`);
  }

  if (pool.length) {
    console.log(`[GeminiCB] Pool de llaves: ${pool.length} (${legacy ? '1 legacy GOOGLE_API_KEY' : '0 legacy'} + ${pool.length - (legacy ? 1 : 0)} explícita(s) GEMINI_API_KEY_N).`);
  } else {
    console.warn('[GeminiCB] Pool de llaves: VACÍO — ni GOOGLE_API_KEY ni GEMINI_API_KEY_N configuradas. La IA real quedará siempre inactiva.');
  }
  return pool;
}

class KeyState {
  constructor() {
    this.state            = 'CLOSED';
    this.dailyCount       = 0;
    this.minuteTimestamps = [];
    this.lastQuotaError   = null;
    this.lastHalfOpenAt   = 0;
    this.dailyResetAt     = nextMidnightUTC();
    // FIX (2026-08-24, "cuándo la cuota está al 100%" — verificado con la
    // respuesta real de Google): el 429 del free tier de Gemini casi siempre
    // es un throttle de RPM (requests-por-minuto) que Google mismo reporta
    // como "Please retry in ~45s" — un cooldown fijo de 5 min (abajo) es
    // varias veces más largo de lo necesario. Si el caller sabe cuánto pidió
    // Google (retryDelayMs), se usa ESE valor en vez del fijo.
    this.retryAfterMs     = null;
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
      // FIX (2026-08-24): usa el retryDelay real que Google reportó (si lo
      // tenemos) en vez del fijo de 5 min — ver comentario en KeyState.
      const cooldown = ks.retryAfterMs ?? HALF_OPEN_PROBE_MS;
      if (msDesdeError < cooldown) return false;
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

  // PERSISTENCIA (2026-08-22, migración 043): el estado de arriba vivía SOLO
  // en memoria — cada reinicio de PM2 reseteaba dailyCount/state a 0/CLOSED,
  // aunque la cuota REAL de Google siguiera agotada del lado de ellos (ya
  // confirmado en vivo esta sesión: primer intento tras un restart limpio
  // volvió a fallar con 429 real inmediatamente). Persistir en
  // gemini_key_state no cambia NINGUNA regla de negocio de arriba — solo
  // evita que un restart le "mienta" a la app sobre cuánta cuota queda.
  // Best-effort: un fallo al guardar no debe romper ninguna llamada real a
  // Gemini, por eso siempre es fire-and-forget con .catch().
  _persistir(i) {
    if (!supabaseAdmin) return;
    const ks = this.keyStates[i];
    if (!ks) return;
    supabaseAdmin.from('gemini_key_state').upsert({
      key_index:        i + 1,
      state:             ks.state,
      daily_count:       ks.dailyCount,
      daily_reset_at:    ks.dailyResetAt.toISOString(),
      last_quota_error:  ks.lastQuotaError ? ks.lastQuotaError.toISOString() : null,
      // FIX (2026-08-24, migración 048): sin esto, un restart con la llave
      // OPEN perdía el cooldown REAL de Google y caía al fijo de 5 min — ver
      // comentario de la migración.
      retry_after_ms:    ks.retryAfterMs,
      updated_at:        new Date().toISOString(),
    }, { onConflict: 'key_index' }).then(
      ({ error }) => { if (error) console.warn('[GeminiCB] No se pudo persistir estado (se omite, no bloqueante):', error.message); },
      (e) => console.warn('[GeminiCB] No se pudo persistir estado (se omite, no bloqueante):', e.message)
    );
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
    this._persistir(i);
  }

  /** Registrar error 429 con la llave #i — abre el circuito de ESA llave.
   *  `retryAfterMs` (opcional): cuánto pidió Google esperar realmente (ver
   *  comentario en KeyState) — si no se pasa, cae al fijo de 5 min. */
  recordQuotaError(i = 0, retryAfterMs = null) {
    const ks = this.keyStates[i];
    if (!ks) return;
    ks.lastQuotaError = new Date();
    ks.retryAfterMs = typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : null;
    const eraCerrado = ks.state !== 'OPEN';
    ks.state = 'OPEN';
    const cooldownInfo = ks.retryAfterMs ? `${Math.round(ks.retryAfterMs / 1000)}s (real, reportado por Google)` : `${Math.round(HALF_OPEN_PROBE_MS / 1000)}s (fijo, sin dato real de Google)`;
    console.warn(`[GeminiCB] Llave #${i + 1} — cuota agotada → OPEN. Cooldown: ${cooldownInfo}`);
    this._persistir(i);
    // Solo alerta cuando la transición deja a TODAS las llaves sin cuota —
    // antes alertaba en cada transición de una sola llave compartida; con
    // pool, una llave en OPEN no es crítico si otra sigue disponible.
    if (eraCerrado && this.keyStates.every(k => k.state === 'OPEN')) {
      captureMessage('CRITICAL: Gemini Circuit Breaker OPEN (todas las llaves) - Degradación a heurística', 'fatal', {
        keys: this.keyStates.length,
      });
    }
  }

  /** FIX (2026-08-24, "coloca un reloj con cuenta regresiva y la hora exacta
   *  de reset en todo RADFOR-360 donde aparezca este mensaje"): momento real
   *  en que la PRIMERA llave del pool vuelve a estar disponible — usa el
   *  retryAfterMs real reportado por Google si lo tenemos (ver KeyState),
   *  nunca el reset diario (dailyResetAt), que no es la causa real de este
   *  tipo de 429 (RPM del free tier, no cuota diaria). Devuelve `null` si al
   *  menos una llave ya está disponible ahora mismo. */
  // FIX (2026-08-25, "sigue bloqueado" verificado en vivo): esta función
  // era una lectura pura que nunca revisaba si el cooldown de una llave
  // OPEN ya había vencido — solo canCall() hacía esa transición, y
  // canCall() solo se invoca en un intento REAL. Resultado real observado:
  // gemini_key_state seguía con state='OPEN' varios minutos después de que
  // el retryAt calculado ya había quedado en el pasado, porque nadie había
  // vuelto a intentar una llamada real — este endpoint de solo-lectura
  // reportaba "todavía agotado" con una hora de reset que ya pasó. Ahora
  // una llave OPEN cuyo cooldown ya venció cuenta como disponible aquí
  // también (mismo criterio que canCall(), sin mutar estado — el mutado
  // real sigue pasando solo en un intento real).
  //
  // FIX (2026-09-06, "el banner miente — cuenta regresiva a una hora fija que
  // nunca se cumple"): cuando Google NO reportó un retryDelay real (ks.retryAfterMs
  // === null), este método SIEMPRE usaba HALF_OPEN_PROBE_MS (5 min fijos) como
  // si fuera un dato confiable. Ese fijo es solo "cuándo volveremos a INTENTAR
  // un sondeo", no "cuándo la cuota real vuelve" — si la causa real es RPD
  // (cuota diaria agotada, se libera a medianoche UTC, no en 5 min), el sondeo
  // vuelve a fallar, se abre un NUEVO cooldown fijo de 5 min, y el ciclo se
  // repite indefinidamente mostrándole al usuario una hora de reset que nunca
  // se cumple. Se separa el cálculo en _computeRetryInfo() para exponer
  // también si el retryAt es una ESTIMACIÓN (ver esRetryEstimado() abajo) — la
  // UI decide con eso si mostrar una cuenta regresiva a una hora concreta
  // (dato real de Google) o un aviso honesto sin hora prometida (estimación).
  _computeRetryInfo() {
    this.keyStates.forEach(ks => this._checkDailyReset(ks));
    const abiertas = this.keyStates.filter(ks => {
      if (ks.state !== 'OPEN') return false;
      const cooldown = ks.retryAfterMs ?? HALF_OPEN_PROBE_MS;
      const vencida = Date.now() - (ks.lastQuotaError?.getTime() ?? 0) >= cooldown;
      return !vencida;
    });
    if (abiertas.length < this.keyStates.length) return { retryAt: null, esEstimado: false }; // al menos una llave ya sirve
    if (!abiertas.length) return { retryAt: null, esEstimado: false };
    const tiempos = abiertas.map(ks => {
      const cooldown = ks.retryAfterMs ?? HALF_OPEN_PROBE_MS;
      return (ks.lastQuotaError?.getTime() ?? Date.now()) + cooldown;
    });
    return {
      retryAt: new Date(Math.min(...tiempos)),
      // Si CUALQUIER llave que sigue contando para el mínimo no tiene un
      // retryAfterMs real, el resultado es una estimación — no se puede
      // prometer esa hora como cierta.
      esEstimado: abiertas.some(ks => ks.retryAfterMs == null),
    };
  }

  getEarliestRetryAt() {
    return this._computeRetryInfo().retryAt;
  }

  /** true si getEarliestRetryAt() es una ESTIMACIÓN (cooldown fijo de sondeo,
   *  sin dato real de Google) en vez de un retryDelay real reportado por la
   *  API — la UI no debe presentar una estimación como una hora de reset
   *  garantizada (mandato 2026-09-06).
   *
   *  Mapeo conceptual (Gemini reporta `status: "RESOURCE_EXHAUSTED"` para
   *  ambos casos — no hay un código de error distinto tipo
   *  rate_limit_exceeded/insufficient_quota como en otras APIs; el retryDelay
   *  real es la única señal confiable disponible para distinguirlos):
   *    esRetryEstimado() === false → rate_limit_exceeded temporal: Google
   *      incluyó "Please retry in Ns" (RPM del free tier, se libera en
   *      segundos) — cronómetro real y confiable, mostrar countdown.
   *    esRetryEstimado() === true  → posible insufficient_quota / cuota
   *      agotada: sin retryDelay real (típico de RPD, cuota diaria, que se
   *      libera a medianoche UTC, no en los 5 min del cooldown de sondeo) —
   *      no prometer una hora, mensaje definitivo + acción real (BYOK). */
  esRetryEstimado() {
    return this._computeRetryInfo().esEstimado;
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

// Carga el estado persistido (si existe) al arrancar — llamarse UNA vez
// desde server.js, después de que la conexión a BD esté lista. Antes de que
// esto se llame, geminiCB ya funciona con el estado por defecto (CLOSED/0)
// exactamente igual que antes de esta extensión — es un enriquecimiento del
// estado inicial, no una dependencia dura para operar.
export async function loadPersistedKeyState() {
  if (!supabaseAdmin) return;
  try {
    const { data, error } = await supabaseAdmin.from('gemini_key_state').select('*');
    if (error || !data) return;
    for (const row of data) {
      const ks = geminiCB.keyStates[row.key_index - 1];
      if (!ks) continue; // fila persistida de una llave que ya no está configurada — se ignora
      ks.state           = row.state || 'CLOSED';
      ks.dailyCount       = row.daily_count || 0;
      ks.dailyResetAt     = row.daily_reset_at ? new Date(row.daily_reset_at) : nextMidnightUTC();
      ks.lastQuotaError   = row.last_quota_error ? new Date(row.last_quota_error) : null;
      // FIX (2026-08-24, migración 048): sin esto, canCall() caía al fallback
      // fijo de 5 min tras cada restart en vez del cooldown real de Google.
      ks.retryAfterMs     = typeof row.retry_after_ms === 'number' && row.retry_after_ms > 0 ? row.retry_after_ms : null;
    }
    console.log(`[GeminiCB] Estado persistido cargado: ${data.length} llave(s) restauradas desde gemini_key_state.`);
  } catch (e) {
    console.warn('[GeminiCB] No se pudo cargar estado persistido (se sigue con estado por defecto):', e.message);
  }
}

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

/** Se lanza cuando TODAS las llaves del pool fallaron/están en cooldown.
 *  `retryAt` (opcional, Date): momento real en que la primera llave vuelve
 *  a estar disponible — ver GeminiCircuitBreaker.getEarliestRetryAt().
 *  `esEstimado` (2026-09-06): true si `retryAt` es una estimación (cooldown
 *  fijo de sondeo, sin dato real de Google) — ver esRetryEstimado(). La UI
 *  no debe prometer esa hora como un reset garantizado cuando es true. */
export class GeminiPoolExhaustedError extends Error {
  constructor(message = 'Límite de IA agotado en todas las llaves configuradas — intenta de nuevo en unos minutos.', retryAt = null, esEstimado = false) {
    super(message);
    this.name = 'GeminiPoolExhaustedError';
    this.status = 429;
    this.retryAt = retryAt;
    this.esEstimado = esEstimado;
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
        // err.retryDelayMs (opcional): si el caller parseó el retryDelay
        // real que Google reportó en el 429, se usa para el cooldown en vez
        // del fijo de 5 min — ver EntradaIAService.js::llamarGemini.
        geminiCB.recordQuotaError(i, typeof err.retryDelayMs === 'number' ? err.retryDelayMs : null);
        continue; // rota a la siguiente llave del pool, sin esperar
      }
      throw err; // error real (no de cuota) — se propaga tal cual, el caller decide
    }
  }

  throw new GeminiPoolExhaustedError(undefined, geminiCB.getEarliestRetryAt(), geminiCB.esRetryEstimado());
}
