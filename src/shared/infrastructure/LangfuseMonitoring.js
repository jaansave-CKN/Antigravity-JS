import { Langfuse } from 'langfuse';

// FinOps — costo/latencia/tokens reales por request de IA, agrupados por uid.
// Mismo patrón defensivo que SentryMonitoring.js: sin LANGFUSE_SECRET_KEY /
// LANGFUSE_PUBLIC_KEY, initLangfuse() no hace nada — el servidor arranca
// igual, sin tracing, con una advertencia visible en el log de arranque.
let _client = null;

export function initLangfuse() {
  if (!process.env.LANGFUSE_SECRET_KEY || !process.env.LANGFUSE_PUBLIC_KEY) {
    console.warn('[Langfuse] LANGFUSE_SECRET_KEY/PUBLIC_KEY no configurados — tracking de costo/tokens deshabilitado.');
    return;
  }
  _client = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl:   process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
  });
  console.log('[Langfuse] Inicializado — host:', process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com');
}

export function langfuseHabilitado() {
  return _client !== null;
}

// Registra una llamada a Claude como trace + generation. Fire-and-forget
// deliberado (sin await del lado del caller): el batching/flush interno del
// SDK no debe agregar latencia a la respuesta que ya recibió el usuario.
// `traceId` agrupa múltiples generations bajo un mismo request (p.ej. el loop
// agéntico de m1Pipeline con hasta 3 llamadas a Claude por búsqueda).
export function trackGeneration({ traceId, name, userId, model, input, output, usage, latencyMs, error = null, metadata = {} }) {
  if (!_client) return;
  try {
    const trace = _client.trace({ id: traceId, name, userId: userId || 'anonymous', metadata });
    trace.generation({
      name,
      model,
      input,
      output: error ? undefined : output,
      level: error ? 'ERROR' : 'DEFAULT',
      statusMessage: error ? String(error.message || error) : undefined,
      usage: usage ? {
        input:  usage.input_tokens,
        output: usage.output_tokens,
        unit:   'TOKENS',
      } : undefined,
      startTime: new Date(Date.now() - (latencyMs || 0)),
      endTime:   new Date(),
    });
  } catch (err) {
    // Nunca dejar que un fallo de telemetría rompa la respuesta real al usuario.
    console.warn('[Langfuse] trackGeneration falló (no bloqueante):', err.message);
  }
}

export async function shutdownLangfuse() {
  if (_client) await _client.shutdownAsync();
}
