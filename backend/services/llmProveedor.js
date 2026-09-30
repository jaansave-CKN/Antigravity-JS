/**
 * llmProveedor.js — punto ÚNICO de llamada a un LLM del backend: funciones de
 * IA del Formulador (Entrada-AI, Árbol, Viabilidad, MIROFISH, Co-Piloto,
 * Formulación integral y respaldo del Formulador MGA) y, desde 2026-09-28,
 * también las llamadas de SISTEMA del Radar (clasificación de sectores,
 * extracción de convocatorias, lookup y búsqueda profunda del Directorio).
 * Es el ÚNICO archivo que puede importar el SDK @google/generative-ai
 * (guardia de CI en tests/unit/nucleoRadar.test.mjs).
 *
 * Llamadas de sistema (`soloServidor: true`, directiva "Contención y
 * sincronización de núcleo", dueño 2026-09-28): SOLO pool Gemini del servidor
 * — sin OpenRouter (no se convierte gasto gratuito en gasto en USD) ni BYOK —
 * y bajo el tope DURO diario de tokens de iaTopeSistema.js (falla cerrado).
 *
 * B1 (decisión del dueño 2026-09-28, diseño fiscalizado por architect):
 * se retiró el gate BYOK — los 67 usuarios usan la IA sin llave propia.
 *
 * Cascada:
 *   0. Groq (openai/gpt-oss-120b, $0, llave del servidor) — SOLO para el rol
 *      CREADOR (AGENTES_CREADORES) y nunca en soloServidor. Arquitectura
 *      híbrida Cero-Sesgo (dueño 2026-09-30, dictamen architect APROBADO CON
 *      CAMBIOS): quien redacta (Groq) no es la misma familia de modelo que
 *      quien audita (Viabilidad, MIROFISH y Sectores siguen en Gemini). Si el
 *      contexto estimado no cabe en el límite por minuto (8K TPM del plan
 *      gratuito) se salta sin petición; 413/429/503 → cae al paso siguiente.
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
import { llamarGroq, GroqError, modeloGroq } from './groqCliente.js';
import {
  configPresupuesto, estimarReservaUsd, costoRealUsd, reservar, liquidar, liberar,
  IaTopeAgotadoError, PresupuestoNoVerificableError,
} from './iaPresupuesto.js';
import { geminiCB, withKeyRotation, registrarLlamadaLLM, LlmLoopGuardError, GeminiPoolExhaustedError, retryDelayDe429, isQuotaError } from './geminiCircuitBreaker.js';
import { withUserKeyRotation, resolverLlavesUsuario, UserKeyPoolExhaustedError } from './byokService.js';
import { withTenantRows } from '../config/database.config.js';
import { fetchGeminiConReintento, conReintentoTransitorio } from './geminiReintento.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { reservarTopeSistema, liquidarTopeSistema, estimarTokensLlamada, IaTopeSistemaError } from './iaTopeSistema.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';
import { flagsIACacheados, leerFlagsIA } from './iaFlags.js';

export { IaTopeAgotadoError, IaTopeSistemaError };

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const MODELO_GEMINI = 'gemini-3.6-flash';

const TIEMPO_MIN_PASO_MS = 8_000;   // con menos, no se intenta otro proveedor
const OPENROUTER_MAX_MS = 38_000;
const GEMINI_MAX_MS = 45_000;
const PAUSA_CONFIG_MS = 10 * 60_000; // tras 401/402/403 (llave o saldo del dueño)

/**
 * Rol CREADOR (nombres FinOps reales de los llamadores): EntradaIAService.js,
 * arbolObjetivosAgent.js, el respaldo de formuladorMga.js (que ya prueba
 * NVIDIA NIM primero) y expedienteFinanciador.js (Viabilidad, 2026-09-30). 'copiloto' queda fuera a propósito: responde texto
 * libre con permitirTruncado, incompatible con la salida solo-JSON.
 */
export const AGENTES_CREADORES = ['entrada-ia', 'arbol_objetivos', 'formulador_mga', 'expediente_financiador'];
const GROQ_MAX_MS = 20_000;
// Esfuerzo de razonamiento de gpt-oss por agente (por defecto 'low'). Medido en vivo 2026-09-30
// (Marco Lógico, 4 llamadas por nivel): con 'low' el modelo devolvió grupos obligatorios vacíos en 2/4;
// con 'medium' trajo todos los grupos en 4/4 (~2,4–3,2K tokens de salida, dentro del límite por minuto).
const ESFUERZO_GROQ = Object.freeze({ expediente_financiador: 'medium' });
const GROQ_LIMITE_TPM_DEFECTO = 8_000;  // plan gratuito de gpt-oss-120b (verificado 2026-09-30)
const GROQ_SALIDA_MIN = 2_048;          // con menos presupuesto de salida no vale la pena intentar
const GROQ_PAUSA_429_DEFECTO_MS = 60_000;
// Riesgo aceptado (dictamen architect, condición 10): el límite por minuto es
// de la LLAVE, no del usuario — dos creadores a la vez se provocan 429 entre
// sí y la pausa por retry-after lo absorbe. Con 200K tokens/día y ~7K por
// llamada, Groq cubre ~28 llamadas diarias; el resto va a Gemini. Con 2048 de
// salida mínima, el prompt máximo es ~5.150 tokens (~15K caracteres): Entrada
// IA con material grande irá casi siempre directo a Gemini.
// Se antepone al PRIMER mensaje system del llamador (no un segundo system).
// Los datos ausentes respetan la convención del llamador (p. ej. Entrada IA
// exige "ND (No Disponible en la investigación)", nunca vacío).
export const GUARDA_CERO_INVENCION = 'REGLA CERO-INVENCIÓN (obligatoria, por encima de todo lo demás): no inventes cifras, montos, fechas, porcentajes, nombres de entidades ni fuentes; usa solo datos presentes en el material entregado. Si un dato no está, aplica la convención para datos ausentes que indiquen las instrucciones de abajo; si no indican ninguna, usa null. Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después.';

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
let _groqPausaHasta = 0;
let _ultimoAvisoGroqSinLlave = 0;

/**
 * Si OpenRouter puede intentarse ahora (no mira el tope, que es por usuario).
 * Síncrona: lee el interruptor del admin desde la caché de iaFlags.js (Búnker
 * de Conexiones, 2026-09-28) para que /api/ia/estado-cuota no se contradiga
 * con la cascada real.
 */
export function estadoOpenRouter(env = process.env, ahora = Date.now(), flags = flagsIACacheados()) {
  if (!(env.OPENROUTER_API_KEY || '').trim()) return { activo: false, motivo: 'sin_llave' };
  if (flags.openrouter === false) return { activo: false, motivo: 'deshabilitado_por_admin' };
  if (ahora < _openRouterPausaHasta) return { activo: false, motivo: 'pausado_por_configuracion' };
  const cfg = configPresupuesto(env);
  if (!cfg.ok) return { activo: false, motivo: 'sin_tope_configurado', faltante: cfg.faltante };
  return { activo: true, modelo: modeloOpenRouter() };
}

/**
 * Si Groq puede intentarse ahora (misma semántica que estadoOpenRouter: solo
 * el interruptor en false lo deshabilita). No mira el tamaño del contexto,
 * que es por llamada.
 */
export function estadoGroq(env = process.env, ahora = Date.now(), flags = flagsIACacheados()) {
  if (!(env.GROQ_API_KEY || '').trim()) return { activo: false, motivo: 'sin_llave' };
  if (flags.groq === false) return { activo: false, motivo: 'deshabilitado_por_admin' };
  if (ahora < _groqPausaHasta) return { activo: false, motivo: 'pausado' };
  return { activo: true, modelo: modeloGroq() };
}

function limiteTpmGroq(env = process.env) {
  const n = Number(env.GROQ_LIMITE_TPM);
  return Number.isFinite(n) && n > 0 ? n : GROQ_LIMITE_TPM_DEFECTO;
}

/** Antepone la guarda al primer mensaje system (o la agrega si no hay ninguno). */
export function conGuardaCeroInvencion(messages) {
  const i = messages.findIndex(m => m?.role === 'system');
  if (i === -1) return [{ role: 'system', content: GUARDA_CERO_INVENCION }, ...messages];
  return messages.map((m, j) => (j === i ? { ...m, content: `${GUARDA_CERO_INVENCION}\n\n${m.content}` } : m));
}

/** Solo para pruebas. */
export function _reiniciarEstadoProveedor() { _openRouterPausaHasta = 0; _ultimoAvisoSinLlave = 0; _groqPausaHasta = 0; _ultimoAvisoGroqSinLlave = 0; }

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
 * @param {boolean} [p.soloServidor] — llamada de SISTEMA: solo pool Gemini, bajo el tope diario de iaTopeSistema.js
 * @returns {Promise<{ texto: string, valor: any, proveedor: 'groq'|'openrouter'|'gemini_servidor'|'byok', modelo: string, usage: object, truncada: boolean }>}
 * @throws {IaNoDisponibleError|IaTopeAgotadoError|IaTopeSistemaError|LlmLoopGuardError}
 */
export async function generarConIA(opciones) {
  if (!opciones.soloServidor) return generarConIAInterno(opciones);
  // Reserva ANTES de llamar: si el tope no se puede verificar o no alcanza,
  // lanza IaTopeSistemaError y no sale ninguna petición.
  const reserva = await reservarTopeSistema(opciones.agente, estimarTokensLlamada(opciones.messages, opciones.maxTokens ?? 8192));
  let tokens = 0;
  try {
    const r = await generarConIAInterno(opciones);
    tokens = (r.usage?.prompt_tokens ?? 0) + salidaFacturada(r.usage);
    return r;
  } finally {
    liquidarTopeSistema(reserva, tokens);
  }
}

async function generarConIAInterno({
  userId, agente, messages, temperature = 0.2, maxTokens = 8192,
  responseFormat = null, validar = null, permitirTruncado = false, deadlineMs = 50_000, soloServidor = false,
}) {
  const inicio = Date.now();
  const restante = () => deadlineMs - (Date.now() - inicio);
  const intentos = [];
  let topeAgotado = null;
  let retryAtGemini = null;

  // soloServidor (tráfico de fondo del Radar) se decide ANTES de mirar los
  // interruptores del Búnker: nunca los lee ni puede activar un proveedor
  // externo por ellos — se queda en el pool Gemini sin excepciones (directiva
  // de integración 2026-09-29). Solo las llamadas de usuario consultan iaFlags.
  const flags = soloServidor ? null : await leerFlagsIA();

  // ── 0. Groq (solo rol CREADOR) ─────────────────────────────────────────────
  if (!soloServidor && AGENTES_CREADORES.includes(agente)) {
    const r = await intentoGroq({ userId, agente, messages, temperature, maxTokens, responseFormat, validar, flags, restante, intentos });
    if (r) return r;
  }

  // ── 1. OpenRouter ──────────────────────────────────────────────────────────
  const or = soloServidor ? { activo: false, motivo: 'omitido_solo_servidor' } : estadoOpenRouter(process.env, Date.now(), flags);
  if (!or.activo) {
    intentos.push({ proveedor: 'openrouter', motivo: or.motivo });
    if (!['pausado_por_configuracion', 'omitido_solo_servidor'].includes(or.motivo) && Date.now() - _ultimoAvisoSinLlave > PAUSA_CONFIG_MS) {
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
  if (!soloServidor) try {
    llaves = await resolverLlavesUsuario(userId, { getRows: (sql, params) => withTenantRows(userId, sql, params) });
  } catch (err) {
    logger.warn('[llmProveedor] No se pudieron leer las llaves BYOK del usuario', { userId, err: err.message });
  }
  if (!llaves.length) {
    intentos.push({ proveedor: 'byok', motivo: soloServidor ? 'omitido_solo_servidor' : 'sin_llaves_usuario' });
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

/**
 * Paso 0 de la cascada (rol CREADOR). Devuelve el resultado o null si hay que
 * seguir con el siguiente proveedor (el motivo queda en `intentos`). Solo
 * relanza LlmLoopGuardError (corta toda la cascada, igual que OpenRouter).
 */
async function intentoGroq({ userId, agente, messages, temperature, maxTokens, responseFormat, validar, flags, restante, intentos }) {
  const g = estadoGroq(process.env, Date.now(), flags);
  if (!g.activo) {
    intentos.push({ proveedor: 'groq', motivo: g.motivo });
    if (g.motivo === 'sin_llave' && Date.now() - _ultimoAvisoGroqSinLlave > PAUSA_CONFIG_MS) {
      _ultimoAvisoGroqSinLlave = Date.now();
      logger.warn('[llmProveedor] Groq no se intenta (sin GROQ_API_KEY) — el rol creador salta al paso siguiente', { agente });
    }
    return null;
  }
  const mensajes = conGuardaCeroInvencion(messages);
  // Conservador: se asume que el límite por minuto cuenta también la salida
  // pedida (Groq no lo documenta) — prompt estimado + salida ≤ 90 % del límite.
  const salida = Math.min(maxTokens, Math.floor(limiteTpmGroq() * 0.9) - estimarTokensLlamada(mensajes, 0));
  if (salida < GROQ_SALIDA_MIN) {
    intentos.push({ proveedor: 'groq', motivo: 'contexto_excede_limite' });
    return null;
  }
  // Groq nunca se come el tiempo del respaldo: debe quedar un paso completo para Gemini.
  const tiempoGroq = Math.min(GROQ_MAX_MS, restante() - TIEMPO_MIN_PASO_MS);
  if (tiempoGroq < TIEMPO_MIN_PASO_MS) {
    intentos.push({ proveedor: 'groq', motivo: 'sin_tiempo' });
    return null;
  }
  registrarLlamadaLLM(`groq:${agente}`); // LlmLoopGuardError corta toda la cascada
  let r;
  try {
    r = await llamarGroq({ messages: mensajes, maxTokens: salida, temperature, responseFormat: responseFormat ?? { type: 'json_object' }, timeoutMs: tiempoGroq, reasoningEffort: ESFUERZO_GROQ[agente] ?? 'low' });
  } catch (err) {
    const e = err instanceof GroqError ? err : new GroqError('error', err?.message);
    if ([413, 429, 503].includes(e.status)) {
      logger.warn('[WARN] Groq límite excedido, cayendo a Gemini...', { agente, status: e.status, motivo: e.motivo });
      if (e.status === 429) _groqPausaHasta = Date.now() + Math.min(e.retryAfterMs ?? GROQ_PAUSA_429_DEFECTO_MS, PAUSA_CONFIG_MS);
    } else if (e.motivo === 'llave_rechazada') {
      _groqPausaHasta = Date.now() + PAUSA_CONFIG_MS;
      logger.error('[llmProveedor] Groq rechazó la llave — pausado 10 min (acción del dueño)', { status: e.status });
    } else {
      logger[e.motivo === 'parametro_no_soportado' ? 'error' : 'warn']('[llmProveedor] Groq falló — se prueba el siguiente proveedor', { agente, motivo: e.motivo, detalle: e.detalle || e.message });
    }
    // Respuesta cortada/vacía: la cuota gratuita ya se consumió → queda en FinOps.
    if (e.usage && Object.keys(e.usage).length) {
      logTokenUsage({ userId, agentName: agente, tokensInput: e.usage.prompt_tokens ?? 0, tokensOutput: salidaFacturada(e.usage), costoUsdReal: 0 }).catch(() => {});
    }
    intentos.push({ proveedor: 'groq', motivo: e.motivo });
    return null;
  }
  logTokenUsage({ userId, agentName: agente, tokensInput: r.usage.prompt_tokens ?? 0, tokensOutput: salidaFacturada(r.usage), costoUsdReal: 0 }).catch(() => {});
  try {
    const valor = aplicarValidar(validar, r.texto);
    return { texto: r.texto, valor, proveedor: 'groq', modelo: r.modelo, usage: r.usage, truncada: false };
  } catch (err) {
    logger.warn('[llmProveedor] Salida de Groq rechazada por la validación — se prueba el siguiente proveedor', { agente, detalle: err.message });
    intentos.push({ proveedor: 'groq', motivo: 'salida_invalida' });
    return null;
  }
}

/**
 * Búsqueda con Google Search Grounding para el lookup del Directorio (Radar).
 * El endpoint compatible con OpenAI no expone googleSearch, por eso usa el SDK
 * — y por eso vive AQUÍ y no en server.js: antes usaba UNA llave fuera del
 * pool, sin FinOps y sin tope (dictamen architect 2026-09-28, condición 4).
 * Pool de llaves (withKeyRotation), tope diario del sistema, guardián
 * anti-bucle, reintento del 503 transitorio y FinOps como 'lookup-deepsearch'.
 * @returns {Promise<{ texto: string, groundingChunks: Array }>}
 * @throws {IaTopeSistemaError|GeminiPoolExhaustedError|LlmLoopGuardError|Error}
 */
export async function buscarConGroundingServidor({ userId, prompt, modelo = 'gemini-2.5-flash', maxTokens = 8192 }) {
  const agente = 'lookup-deepsearch';
  const reserva = await reservarTopeSistema(agente, estimarTokensLlamada([{ content: prompt }], maxTokens));
  let tokens = 0;
  try {
    return await withKeyRotation(async (apiKey) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelo, tools: [{ googleSearch: {} }], generationConfig: { maxOutputTokens: maxTokens } });
      registrarLlamadaLLM(agente); // guardián anti-bucle (FinOps)
      const result = await conReintentoTransitorio(() => model.generateContent(prompt), { origen: agente });
      const u = result.response.usageMetadata || {};
      tokens = u.totalTokenCount ?? ((u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0));
      logTokenUsage({ userId, agentName: agente, tokensInput: u.promptTokenCount ?? 0, tokensOutput: Math.max(0, tokens - (u.promptTokenCount ?? 0)) }).catch(() => {});
      return { texto: result.response.text().trim(), groundingChunks: result.response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [] };
    });
  } finally {
    liquidarTopeSistema(reserva, tokens);
  }
}

// Timeout/corte sin usage.cost: se liquida al peor caso reservado (OpenRouter pudo cobrar).
function costoSinReporte(err, messages, maxTokens) {
  return err?.usage && Object.keys(err.usage).length ? costoRealUsd(err.usage, null) : estimarReservaUsd(messages, maxTokens);
}
