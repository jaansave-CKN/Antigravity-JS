/**
 * llmProveedor.js — punto ÚNICO de llamada a un LLM para las funciones de IA
 * del Formulador (Entrada-AI, Árbol, Viabilidad, MIROFISH, Co-Piloto y, a
 * través de ellas, Formulación integral).
 *
 * B1 (decisión del dueño 2026-09-28, diseño fiscalizado por architect):
 * se retiró el gate BYOK — los 67 usuarios usan la IA sin llave propia.
 *
 * Cascada:
 *   1. OpenRouter (anthropic/claude-sonnet-5, llave del servidor), SOLO si
 *      hay OPENROUTER_API_KEY y el tope de gasto por usuario es verificable
 *      (iaPresupuesto.js, persistido en Postgres). Sin eso se salta.
 *   2. Pool Gemini del servidor (withKeyRotation, gemini-3.6-flash).
 *   3. Llaves BYOK propias del usuario, si guardó alguna (se cargan solo si
 *      se llega a este paso). No cuentan contra el tope: las paga el usuario.
 *
 * REGLA DE ORO (ratificada por el dueño 2026-09-28): si ningún proveedor
 * responde con una salida válida → IaNoDisponibleError (503) o, si el tope
 * del usuario estaba agotado, IaTopeAgotadoError (429). NUNCA plantillas,
 * heurísticas ni datos inventados.
 *
 * `validar(texto)` (opcional) lo aporta cada servicio: si la salida de un
 * proveedor no la pasa, se prueba el siguiente en vez de entregarla.
 */
import { llamarOpenRouter, OpenRouterError, modeloOpenRouter } from './openRouterCliente.js';
import {
  configPresupuesto, estimarReservaUsd, costoRealUsd, reservar, liquidar, liberar,
  IaTopeAgotadoError, PresupuestoNoVerificableError,
} from './iaPresupuesto.js';
import { geminiCB, withKeyRotation, registrarLlamadaLLM, LlmLoopGuardError, GeminiPoolExhaustedError, retryDelayDe429, isQuotaError } from './geminiCircuitBreaker.js';
import { withUserKeyRotation, resolverLlavesUsuario, UserKeyPoolExhaustedError } from './byokService.js';
import { withTenantRows } from '../config/database.config.js';
import { fetchGeminiConReintento } from './geminiReintento.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';

export { IaTopeAgotadoError };

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const MODELO_GEMINI = 'gemini-3.6-flash';

const TIEMPO_MIN_PASO_MS = 8_000;   // con menos, no se intenta otro proveedor
const OPENROUTER_MAX_MS = 38_000;
const GEMINI_MAX_MS = 45_000;
const PAUSA_CONFIG_MS = 10 * 60_000; // tras 401/402/403 (llave o saldo del dueño)

export class IaNoDisponibleError extends Error {
  constructor(intentos = [], retryAt = null) {
    super('Servicio de IA no disponible en este momento. Ningún proveedor respondió — no se generó ni se guardó nada. Intenta de nuevo más tarde.');
    this.name = 'IaNoDisponibleError';
    this.status = 503;
    this.code = 'IA_NO_DISPONIBLE';
    this.intentos = intentos; // [{ proveedor, motivo }] — sin secretos
    this.retryAt = retryAt;
  }
}

/** Salida del modelo rechazada por validar(): se prueba el siguiente proveedor. */
class SalidaInvalidaError extends Error {
  constructor(detalle) {
    // Sin "429/quota/rate limit" en el mensaje: isQuotaError lo rotaría como cuota.
    super(`salida del modelo inválida: ${detalle}`);
    this.name = 'SalidaInvalidaError';
    this.motivo = 'salida_invalida';
  }
}

let _openRouterPausaHasta = 0;
let _ultimoAvisoSinLlave = 0;

/** Si OpenRouter puede intentarse ahora (no mira el tope, que es por usuario). */
export function estadoOpenRouter(env = process.env, ahora = Date.now()) {
  if (!(env.OPENROUTER_API_KEY || '').trim()) return { activo: false, motivo: 'sin_llave' };
  if (ahora < _openRouterPausaHasta) return { activo: false, motivo: 'pausado_por_configuracion' };
  const cfg = configPresupuesto(env);
  if (!cfg.ok) return { activo: false, motivo: 'sin_tope_configurado', faltante: cfg.faltante };
  return { activo: true, modelo: modeloOpenRouter() };
}

/** Solo para pruebas. */
export function _reiniciarEstadoProveedor() { _openRouterPausaHasta = 0; _ultimoAvisoSinLlave = 0; }

function aplicarValidar(validar, texto) {
  if (!validar) return undefined;
  try { return validar(texto); }
  catch (e) { throw new SalidaInvalidaError(e?.message || 'no pasó la validación'); }
}

function salidaFacturada(usage = {}) {
  return Number.isFinite(usage.total_tokens) && Number.isFinite(usage.prompt_tokens)
    ? usage.total_tokens - usage.prompt_tokens : (usage.completion_tokens ?? 0);
}

/** Un intento contra el endpoint compatible-OpenAI de Gemini con una llave dada. */
function intentoGemini({ messages, temperature, maxTokens, responseFormat, permitirTruncado, validar, timeoutMs, agente }) {
  return async (apiKey) => {
    const cuerpo = {
      model: MODELO_GEMINI, messages, temperature,
      // gemini-3.6-flash RAZONA y esos tokens cuentan contra max_tokens (Lote 8).
      max_tokens: maxTokens, reasoning_effort: 'low',
    };
    if (responseFormat) cuerpo.response_format = responseFormat;
    const res = await fetchGeminiConReintento(GEMINI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    }, { origen: agente });

    if (res.status === 429) {
      const detalle = await res.text().catch(() => '');
      const err = new Error('Gemini 429 quota exceeded');
      const espera = retryDelayDe429(detalle);
      if (espera) err.retryDelayMs = espera;
      throw err;
    }
    if (!res.ok) {
      const detalle = (await res.text().catch(() => '')).slice(0, 300);
      const err = new Error(`Gemini HTTP ${res.status}`);
      err.motivo = `http_${res.status}`;
      err.detalle = detalle;
      throw err;
    }
    const data = await res.json();
    const opcion = data?.choices?.[0];
    const usage = data?.usage ?? {};
    const truncada = opcion?.finish_reason === 'length';
    const texto = String(opcion?.message?.content || '').trim();
    if (truncada && !permitirTruncado) throw Object.assign(new Error('Gemini: respuesta cortada por max_tokens'), { motivo: 'respuesta_truncada', usage });
    if (!texto) throw Object.assign(new Error('Gemini sin contenido en la respuesta'), { motivo: 'respuesta_vacia', usage });
    const valor = aplicarValidar(validar, texto);
    return { texto, valor, usage, truncada, modelo: MODELO_GEMINI };
  };
}

function motivoDe(err) {
  if (err instanceof UserKeyPoolExhaustedError || err?.code === 'USER_KEY_EXHAUSTED') return 'llaves_agotadas';
  if (err instanceof GeminiPoolExhaustedError || isQuotaError(err)) return 'cuota_agotada';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  return err?.motivo || 'error';
}

/**
 * @param {object} p
 * @param {string} p.userId — dueño de la solicitud (tope, FinOps, BYOK)
 * @param {string} p.agente — nombre FinOps (ai_token_logs.agent_name)
 * @param {Array<{role:string, content:string}>} p.messages — formato OpenAI (system/user/assistant)
 * @returns {Promise<{ texto: string, valor: any, proveedor: 'openrouter'|'gemini_servidor'|'byok', modelo: string, usage: object, truncada: boolean }>}
 * @throws {IaNoDisponibleError|IaTopeAgotadoError|LlmLoopGuardError}
 */
export async function generarConIA({
  userId, agente, messages, temperature = 0.2, maxTokens = 8192,
  responseFormat = null, validar = null, permitirTruncado = false, deadlineMs = 50_000,
}) {
  const inicio = Date.now();
  const restante = () => deadlineMs - (Date.now() - inicio);
  const intentos = [];
  let topeAgotado = null;
  let retryAtGemini = null;

  // ── 1. OpenRouter ──────────────────────────────────────────────────────────
  const or = estadoOpenRouter();
  if (!or.activo) {
    intentos.push({ proveedor: 'openrouter', motivo: or.motivo });
    if (or.motivo !== 'pausado_por_configuracion' && Date.now() - _ultimoAvisoSinLlave > PAUSA_CONFIG_MS) {
      _ultimoAvisoSinLlave = Date.now();
      logger.warn('[llmProveedor] OpenRouter no se intenta — se salta al pool Gemini', { motivo: or.motivo, faltante: or.faltante });
    }
  } else {
    registrarLlamadaLLM(`openrouter:${agente}`); // LlmLoopGuardError corta toda la cascada
    let reservaId = null;
    try {
      reservaId = await reservar({ userId, agente, modelo: or.modelo, reservaUsd: estimarReservaUsd(messages, maxTokens) });
    } catch (err) {
      if (err instanceof IaTopeAgotadoError) {
        topeAgotado = err;
        intentos.push({ proveedor: 'openrouter', motivo: 'tope_agotado' });
      } else {
        logger.error('[llmProveedor] Tope de gasto no verificable — OpenRouter se salta (falla cerrado)', { agente, userId, motivo: err instanceof PresupuestoNoVerificableError ? err.motivo : err.message });
        intentos.push({ proveedor: 'openrouter', motivo: 'presupuesto_no_verificable' });
      }
    }
    if (reservaId) {
      let r = null;
      try {
        r = await llamarOpenRouter({ messages, maxTokens, responseFormat, permitirTruncado, timeoutMs: Math.min(OPENROUTER_MAX_MS, restante()) });
      } catch (err) {
        const e = err instanceof OpenRouterError ? err : new OpenRouterError('error', err?.message);
        if (e.cobrable) {
          await liquidar(userId, reservaId, { costoUsd: Number.isFinite(e.costoUsd) ? e.costoUsd : costoSinReporte(e, messages, maxTokens), tokensIn: e.usage?.prompt_tokens ?? 0, tokensOut: e.usage?.completion_tokens ?? 0 }, logger);
        } else {
          await liberar(userId, reservaId, logger);
        }
        if (['llave_rechazada', 'sin_creditos'].includes(e.motivo)) {
          _openRouterPausaHasta = Date.now() + PAUSA_CONFIG_MS;
          logger.error('[llmProveedor] OpenRouter rechazó la llave o no tiene saldo — pausado 10 min (acción del dueño)', { motivo: e.motivo, detalle: e.detalle });
        } else {
          logger[e.motivo === 'parametro_no_soportado' ? 'error' : 'warn']('[llmProveedor] OpenRouter falló — se prueba el siguiente proveedor', { agente, motivo: e.motivo, detalle: e.detalle || e.message });
        }
        intentos.push({ proveedor: 'openrouter', motivo: e.motivo });
      }
      if (r) {
        const costo = costoRealUsd(r.usage, r.costoUsd);
        await liquidar(userId, reservaId, { costoUsd: costo, tokensIn: r.usage.prompt_tokens ?? 0, tokensOut: r.usage.completion_tokens ?? 0, modelo: r.modelo }, logger);
        logTokenUsage({ userId, agentName: agente, tokensInput: r.usage.prompt_tokens ?? 0, tokensOutput: r.usage.completion_tokens ?? 0, costoUsdReal: costo }).catch(() => {});
        try {
          const valor = aplicarValidar(validar, r.texto);
          return { texto: r.texto, valor, proveedor: 'openrouter', modelo: r.modelo, usage: r.usage, truncada: r.truncada };
        } catch (err) {
          logger.warn('[llmProveedor] Salida de OpenRouter rechazada por la validación — se prueba el siguiente proveedor', { agente, detalle: err.message });
          intentos.push({ proveedor: 'openrouter', motivo: 'salida_invalida' });
        }
      }
    }
  }

  // ── 2. Pool Gemini del servidor ────────────────────────────────────────────
  if (!geminiCB.keys.length) {
    intentos.push({ proveedor: 'gemini_servidor', motivo: 'sin_llaves_servidor' });
  } else if (restante() < TIEMPO_MIN_PASO_MS) {
    intentos.push({ proveedor: 'gemini_servidor', motivo: 'sin_tiempo' });
  } else {
    try {
      const r = await withKeyRotation(intentoGemini({ messages, temperature, maxTokens, responseFormat, permitirTruncado, validar, agente, timeoutMs: Math.min(GEMINI_MAX_MS, restante()) }));
      logTokenUsage({ userId, agentName: agente, tokensInput: r.usage?.prompt_tokens ?? 0, tokensOutput: salidaFacturada(r.usage) }).catch(() => {});
      return { ...r, proveedor: 'gemini_servidor' };
    } catch (err) {
      if (err instanceof LlmLoopGuardError) throw err;
      if (err instanceof GeminiPoolExhaustedError) retryAtGemini = err.retryAt;
      const motivo = motivoDe(err);
      logger[motivo === 'cuota_agotada' ? 'warn' : 'error']('[llmProveedor] Pool Gemini del servidor falló', { agente, motivo, detalle: err.detalle || err.message });
      intentos.push({ proveedor: 'gemini_servidor', motivo });
    }
  }

  // ── 3. BYOK del usuario (último recurso, también salida del tope) ──────────
  let llaves = [];
  try {
    llaves = await resolverLlavesUsuario(userId, { getRows: (sql, params) => withTenantRows(userId, sql, params) });
  } catch (err) {
    logger.warn('[llmProveedor] No se pudieron leer las llaves BYOK del usuario', { userId, err: err.message });
  }
  if (!llaves.length) {
    intentos.push({ proveedor: 'byok', motivo: 'sin_llaves_usuario' });
  } else if (restante() < TIEMPO_MIN_PASO_MS) {
    intentos.push({ proveedor: 'byok', motivo: 'sin_tiempo' });
  } else {
    try {
      const r = await withUserKeyRotation(llaves, intentoGemini({ messages, temperature, maxTokens, responseFormat, permitirTruncado, validar, agente, timeoutMs: Math.min(GEMINI_MAX_MS, restante()) }));
      logTokenUsage({ userId, agentName: agente, tokensInput: r.usage?.prompt_tokens ?? 0, tokensOutput: salidaFacturada(r.usage) }).catch(() => {});
      return { ...r, proveedor: 'byok' };
    } catch (err) {
      const motivo = motivoDe(err);
      logger.warn('[llmProveedor] Llaves BYOK del usuario fallaron', { agente, motivo, detalle: err.detalle || err.message });
      intentos.push({ proveedor: 'byok', motivo });
    }
  }

  // ── Nadie respondió: regla de oro ──────────────────────────────────────────
  logger.error('[llmProveedor] Ningún proveedor de IA respondió', { agente, userId, intentos });
  if (topeAgotado) throw topeAgotado;
  throw new IaNoDisponibleError(intentos, retryAtGemini);
}

// Timeout/corte sin usage.cost: se liquida al peor caso reservado (OpenRouter pudo cobrar).
function costoSinReporte(err, messages, maxTokens) {
  return err?.usage && Object.keys(err.usage).length ? costoRealUsd(err.usage, null) : estimarReservaUsd(messages, maxTokens);
}
