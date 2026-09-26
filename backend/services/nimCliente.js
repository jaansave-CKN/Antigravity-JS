/**
 * nimCliente.js — cliente de NVIDIA NIM (API compatible con OpenAI).
 *
 * Fase 3 (decisión del dueño 2026-09-26): el Formulador MGA usa
 * deepseek-ai/deepseek-v4.1-flash vía NIM con la llave del SERVIDOR
 * (NVIDIA_API_KEY). byokGate/user_gemini_keys son exclusivos de Gemini y no
 * aplican aquí.
 *
 * Verificado contra la página pública del modelo (build.nvidia.com, 2026-09-26):
 * endpoint https://integrate.api.nvidia.com/v1/chat/completions, parámetros
 * model/messages/temperature/top_p/max_tokens/stream, "supports thinking
 * content". NO documenta response_format ni un parámetro de razonamiento: no
 * se envían (un parámetro no soportado puede devolver 400). El JSON se exige
 * en el prompt y se valida de forma estricta en Node (formuladorMga.js).
 *
 * Mismo blindaje que los agentes Gemini (guardias de CI, Lotes 8/9/10):
 * fetch con reintento exponencial ante 5xx, max_tokens 8192 (el razonamiento
 * consume tokens), respuesta cortada (finish_reason 'length') = error explícito.
 */
import { fetchGeminiConReintento } from './geminiReintento.js';

export const NIM_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const MAX_TOKENS_NIM = 8192;

/** Error con motivo estable (el llamador lo traduce a estado 'no_disponible'). */
export class NimError extends Error {
  constructor(motivo, detalle = '', extra = {}) {
    super(`${motivo}${detalle ? `: ${detalle}` : ''}`);
    this.name = 'NimError';
    this.motivo = motivo;
    Object.assign(this, extra);
  }
}

/** Quita el bloque de razonamiento que algunos modelos devuelven dentro de content. */
export function limpiarRazonamiento(texto) {
  return String(texto || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * @returns {Promise<{ texto: string, usage: object, modelo: string }>}
 * @throws {NimError} motivos: sin_llave_nvidia | llave_rechazada | cuota_nvidia |
 *   modelo_saturado | error_http | respuesta_truncada | respuesta_vacia
 */
export async function llamarNim({ model, messages, max_tokens = MAX_TOKENS_NIM, temperature = 0.2, top_p = 0.9, timeoutMs = 90_000, origen = 'nim' }) {
  const llave = (process.env.NVIDIA_API_KEY || '').trim();
  if (!llave) throw new NimError('sin_llave_nvidia', 'NVIDIA_API_KEY no configurada en el servidor');
  const res = await fetchGeminiConReintento(NIM_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model, messages, temperature, top_p, max_tokens, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  }, { origen });

  if (res.status === 401 || res.status === 403) throw new NimError('llave_rechazada', `HTTP ${res.status}`);
  if (res.status === 429) throw new NimError('cuota_nvidia', 'HTTP 429');
  if (res.status >= 500) throw new NimError('modelo_saturado', `HTTP ${res.status}`);
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new NimError('error_http', `HTTP ${res.status}`, { cuerpo: cuerpo.slice(0, 300) });
  }
  const data = await res.json();
  const opcion = data?.choices?.[0];
  if (opcion?.finish_reason === 'length') throw new NimError('respuesta_truncada', 'max_tokens alcanzado', { usage: data?.usage });
  const texto = limpiarRazonamiento(opcion?.message?.content);
  if (!texto) throw new NimError('respuesta_vacia', 'el modelo no devolvió contenido', { usage: data?.usage });
  return { texto, usage: data?.usage || {}, modelo: data?.model || model };
}
