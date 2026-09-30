/**
 * groqCliente.js — cliente de Groq (API compatible con OpenAI).
 *
 * Arquitectura híbrida Cero-Sesgo (decisión del dueño 2026-09-30, dictamen
 * architect APROBADO CON CAMBIOS): proveedor $0 para el rol CREADOR (Entrada
 * IA, Árbol de Objetivos, respaldo del Formulador MGA), con la llave del
 * SERVIDOR (GROQ_API_KEY). Solo lo invoca llmProveedor.js.
 *
 * Verificado en la documentación de Groq (2026-09-30):
 * - deepseek-r1-distill-llama-70b se apagó el 2025-10-02 y llama-3.3-70b-versatile
 *   es solo Enterprise → el modelo grande del plan gratuito es openai/gpt-oss-120b
 *   (30 RPM, 1K RPD, 8K TPM, 200K TPD).
 * - gpt-oss: reasoning_effort low|medium|high e include_reasoning (bool);
 *   reasoning_format NO se admite (400).
 * - 413 = petición demasiado grande; 429 trae el header retry-after; 498 = capa
 *   flex sin capacidad; 503 = saturado/mantenimiento.
 *
 * Un solo intento con fetch simple, sin reintento propio (la cascada de
 * llmProveedor ya cumple ese papel; y fetchGeminiConReintento está contado en
 * la guardia de tests/unit/lote9Reintento.test.mjs).
 */

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODELO_DEFECTO = 'openai/gpt-oss-120b';

/** Error con motivo estable (ver @throws de llamarGroq). */
export class GroqError extends Error {
  constructor(motivo, detalle = '', extra = {}) {
    super(`Groq ${motivo}${detalle ? `: ${detalle}` : ''}`);
    this.name = 'GroqError';
    this.motivo = motivo;
    Object.assign(this, extra);
  }
}

export function modeloGroq() {
  return (process.env.GROQ_MODEL || '').trim() || GROQ_MODELO_DEFECTO;
}

/** retry-after de Groq: segundos (entero o decimal) → ms; null si no viene o no es válido. */
export function retryAfterMs(valor) {
  const s = Number(valor);
  return Number.isFinite(s) && s > 0 ? Math.ceil(s * 1000) : null;
}

/**
 * @returns {Promise<{ texto: string, usage: object, modelo: string, truncada: boolean }>}
 * @throws {GroqError} motivos: sin_llave | llave_rechazada | contexto_excedido |
 *   rate_limit (con retryAfterMs) | saturado | parametro_no_soportado | timeout |
 *   error_red | error_http | respuesta_truncada | respuesta_vacia
 */
export async function llamarGroq({ messages, maxTokens, temperature = 0.2, responseFormat = null, timeoutMs = 20_000, reasoningEffort = 'low' }) {
  const llave = (process.env.GROQ_API_KEY || '').trim();
  if (!llave) throw new GroqError('sin_llave', 'GROQ_API_KEY no configurada en el servidor');
  const modelo = modeloGroq();
  const cuerpo = {
    model: modelo,
    messages,
    temperature,
    // gpt-oss RAZONA: esos tokens salen del mismo presupuesto de salida.
    max_completion_tokens: maxTokens,
    reasoning_effort: ['low', 'medium', 'high'].includes(reasoningEffort) ? reasoningEffort : 'low',
    include_reasoning: false,
  };
  if (responseFormat) cuerpo.response_format = responseFormat;

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new GroqError('timeout', `sin respuesta en ${timeoutMs} ms`);
    throw new GroqError('error_red', err?.message || 'fallo de red');
  }

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 300);
    const s = res.status;
    if (s === 401 || s === 403) throw new GroqError('llave_rechazada', `HTTP ${s}`, { status: s, detalle });
    if (s === 413) throw new GroqError('contexto_excedido', 'HTTP 413', { status: s, detalle });
    if (s === 429) throw new GroqError('rate_limit', 'HTTP 429', { status: s, detalle, retryAfterMs: retryAfterMs(res.headers?.get?.('retry-after')) });
    if (s === 400 || s === 404 || s === 422) throw new GroqError('parametro_no_soportado', `HTTP ${s}`, { status: s, detalle });
    if (s === 408 || s === 498 || s >= 500) throw new GroqError('saturado', `HTTP ${s}`, { status: s, detalle });
    throw new GroqError('error_http', `HTTP ${s}`, { status: s, detalle });
  }

  const data = await res.json();
  const usage = data?.usage || {};
  const opcion = data?.choices?.[0];
  const texto = String(opcion?.message?.content || '').trim();
  const truncada = opcion?.finish_reason === 'length';
  if (truncada) throw new GroqError('respuesta_truncada', 'max_completion_tokens alcanzado', { usage });
  if (!texto) throw new GroqError('respuesta_vacia', 'el modelo no devolvió contenido', { usage });
  return { texto, usage, modelo: data?.model || modelo, truncada };
}
