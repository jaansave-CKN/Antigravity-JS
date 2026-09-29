/**
 * openRouterCliente.js — cliente de OpenRouter (API compatible con OpenAI).
 *
 * B1 (decisión del dueño 2026-09-28): proveedor PRIMARIO de las funciones de
 * IA del Formulador, con la llave del SERVIDOR (OPENROUTER_API_KEY). Solo lo
 * invoca llmProveedor.js — ningún servicio llama aquí directamente.
 *
 * Verificado contra https://openrouter.ai/api/v1/models (2026-09-28):
 * anthropic/claude-sonnet-5 existe, supported_parameters = max_tokens,
 * response_format, structured_outputs, reasoning… y NO incluye temperature.
 * Por eso: no se envía temperature, y NO se usa provider.require_parameters
 * (con un parámetro no soportado dejaría la petición sin proveedor → 404).
 * response_format sí se envía; la salida igual se valida en Node (validar()
 * de llmProveedor), así que un proveedor que lo ignore cae al siguiente.
 *
 * Un solo intento, sin reintento propio: la cascada de llmProveedor
 * (OpenRouter → pool Gemini → BYOK) ya cumple ese papel.
 */

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_MODELO_DEFECTO = 'anthropic/claude-sonnet-5';

/** Error con motivo estable; `cobrable` = la generación pudo completarse y facturarse. */
export class OpenRouterError extends Error {
  constructor(motivo, detalle = '', extra = {}) {
    super(`OpenRouter ${motivo}${detalle ? `: ${detalle}` : ''}`);
    this.name = 'OpenRouterError';
    this.motivo = motivo;
    this.cobrable = false;
    Object.assign(this, extra);
  }
}

export function modeloOpenRouter() {
  return (process.env.OPENROUTER_MODEL || '').trim() || OPENROUTER_MODELO_DEFECTO;
}

/**
 * @returns {Promise<{ texto: string, usage: object, modelo: string, costoUsd: number|null, truncada: boolean }>}
 * @throws {OpenRouterError} motivos: sin_llave | llave_rechazada | sin_creditos |
 *   rate_limit | parametro_no_soportado | saturado | timeout | error_red | error_http |
 *   respuesta_truncada | respuesta_vacia
 */
export async function llamarOpenRouter({ messages, maxTokens = 8192, responseFormat = null, timeoutMs = 38_000, permitirTruncado = false }) {
  const llave = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!llave) throw new OpenRouterError('sin_llave', 'OPENROUTER_API_KEY no configurada en el servidor');
  const modelo = modeloOpenRouter();
  const cuerpo = {
    model: modelo,
    messages,
    max_tokens: maxTokens,
    usage: { include: true },
    // Habeas Data: solo proveedores que no retienen/entrenan con los datos.
    provider: { data_collection: 'deny' },
  };
  if (responseFormat) cuerpo.response_format = responseFormat;

  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llave}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://radfor360.com',
        'X-Title': 'RadFor-360',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Un timeout ocurre con la petición ya enviada: OpenRouter puede haber
    // completado (y cobrado) la generación — el presupuesto la cuenta.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new OpenRouterError('timeout', `sin respuesta en ${timeoutMs} ms`, { cobrable: true });
    throw new OpenRouterError('error_red', err?.message || 'fallo de red');
  }

  if (!res.ok) {
    const detalle = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new OpenRouterError('llave_rechazada', `HTTP ${res.status}`, { detalle });
    if (res.status === 402) throw new OpenRouterError('sin_creditos', 'HTTP 402', { detalle });
    if (res.status === 429) throw new OpenRouterError('rate_limit', 'HTTP 429', { detalle });
    if (res.status === 400 || res.status === 404) throw new OpenRouterError('parametro_no_soportado', `HTTP ${res.status}`, { detalle });
    if (res.status === 408 || res.status >= 500) throw new OpenRouterError('saturado', `HTTP ${res.status}`, { detalle });
    throw new OpenRouterError('error_http', `HTTP ${res.status}`, { detalle });
  }

  const data = await res.json();
  const usage = data?.usage || {};
  const costoUsd = Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null;
  const opcion = data?.choices?.[0];
  // OpenRouter puede devolver 200 con un error del proveedor dentro del cuerpo.
  if (data?.error || opcion?.finish_reason === 'error') {
    throw new OpenRouterError('saturado', String(data?.error?.message || 'error del proveedor').slice(0, 200), { cobrable: costoUsd !== null, usage, costoUsd });
  }
  const texto = String(opcion?.message?.content || '').trim();
  const truncada = opcion?.finish_reason === 'length';
  if (truncada && !permitirTruncado) throw new OpenRouterError('respuesta_truncada', 'max_tokens alcanzado', { cobrable: true, usage, costoUsd });
  if (!texto) throw new OpenRouterError('respuesta_vacia', 'el modelo no devolvió contenido', { cobrable: true, usage, costoUsd });
  return { texto, usage, modelo: data?.model || modelo, costoUsd, truncada };
}

export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

/**
 * Saldo de la cuenta (Búnker de Conexiones, 2026-09-28) — GET sin costo, no
 * gasta tokens. Verificado en vivo el 2026-09-28 con la llave normal (no de
 * administración): HTTP 200 → data { total_credits, total_usage }; ese día
 * total_credits 0 y total_usage 0,1588 → saldo negativo = "sin saldo".
 * Solo devuelve el número redondeado; nunca reenvía el payload crudo.
 * @returns {Promise<{ saldoUsd: number }>}
 * @throws {OpenRouterError} motivos: sin_llave | llave_rechazada | error_http | respuesta_invalida
 */
export async function consultarSaldoOpenRouter({ timeoutMs = 5_000 } = {}) {
  const llave = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!llave) throw new OpenRouterError('sin_llave');
  const res = await fetch(OPENROUTER_CREDITS_URL, {
    headers: { Authorization: `Bearer ${llave}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new OpenRouterError('llave_rechazada', `HTTP ${res.status}`);
  if (!res.ok) throw new OpenRouterError('error_http', `HTTP ${res.status}`);
  const data = (await res.json().catch(() => null))?.data;
  const creditos = Number(data?.total_credits);
  const uso = Number(data?.total_usage);
  if (!Number.isFinite(creditos) || !Number.isFinite(uso)) throw new OpenRouterError('respuesta_invalida', 'sin total_credits/total_usage');
  return { saldoUsd: Math.round((creditos - uso) * 100) / 100 };
}
