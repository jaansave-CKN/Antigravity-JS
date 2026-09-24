/**
 * mirofishComite.js — F-09: IA adversarial del comité hostil MIROFISH (BYOK).
 *
 * Mismo patrón de llamada que calcularViabilidadIA (viabilidadAgent.js):
 * endpoint OpenAI-compatible de Gemini, pool BYOK del usuario si lo tiene
 * (withUserKeyRotation), si no el pool del servidor (withKeyRotation) — el
 * gate byokGate de la ruta ya decidió cuál aplica.
 *
 * DIFERENCIA DELIBERADA con viabilidadAgent (fiscalización architect
 * 2026-09-24, B4): aquí NO hay respaldo heurístico. Si la IA no responde se
 * devuelve { estado: 'no_disponible', motivo } y el comité entrega solo las
 * reglas deterministas — nunca hallazgos fabricados.
 *   motivo: USER_KEY_EXHAUSTED | pool_servidor_agotado | sin_llaves_servidor
 *           | modelo_saturado (503 de Google, tras 1 reintento)
 *           | respuesta_truncada (finish_reason: length) | respuesta_invalida | error
 *
 * Anti-alucinación (mismo criterio que F-07): el modelo recibe los datos como
 * un diccionario plano campo → valor y cada hallazgo debe citar
 * `evidencia: [{campo, valor}]`. Se DESCARTA todo hallazgo sin evidencia o
 * con un campo que no se envió o un valor que no coincide con lo enviado.
 */
import { geminiCB, withKeyRotation, isQuotaError, GeminiPoolExhaustedError } from './geminiCircuitBreaker.js';
import { withUserKeyRotation, UserKeyPoolExhaustedError } from './byokService.js';
import { logTokenUsage } from './aiTokenLogger.js';
import { logger } from '../utils/logger.js';
import { normalizar } from './mirofishReglas.js';

export const MODELO = 'gemini-3.6-flash';
const CATEGORIAS = new Set(['cronograma_clima', 'costos_transporte', 'orden_publico', 'otro']);
const SEVERIDADES = new Set(['CRITICA', 'ALTA', 'MEDIA', 'INFO']);

export const SYSTEM_PROMPT = `Eres el COMITÉ HOSTIL MIROFISH: un panel de evaluadores escépticos de fondos públicos y de cooperación en Colombia. Tu trabajo es ATACAR la formulación del proyecto y encontrar vacíos reales de planificación antes de que lo haga el financiador.

Busca especialmente:
- cronograma_clima: cronogramas inviables por temporadas de lluvia, crecientes, vías destapadas o de montaña, duraciones de tramo incompatibles con el plazo total.
- costos_transporte: costos logísticos ocultos o irreales hacia zonas complejas (trochas, transporte fluvial, carga pesada en vías sin pavimentar) frente a lo presupuestado.
- orden_publico: riesgos de seguridad no gestionados.
- otro: cualquier otro vacío grave y verificable.

REGLAS INQUEBRANTABLES:
1. Usa EXCLUSIVAMENTE los DATOS DEL PROYECTO (diccionario campo → valor). NUNCA inventes cifras, lugares, climas ni hechos que no se deduzcan de esos datos.
2. Cada hallazgo DEBE citar en "evidencia" los campos exactos del diccionario en que se apoya, copiando su valor LITERAL: [{"campo": "<clave exacta>", "valor": "<valor exacto>"}]. Un hallazgo sin evidencia literal será descartado.
3. Si los datos no alcanzan para sostener un ataque, NO lo hagas. Es preferible devolver pocos hallazgos (o ninguno) que uno sin sustento.
4. Severidad: CRITICA (hace inviable el proyecto), ALTA, MEDIA o INFO.
5. Responde SOLO un objeto JSON: {"hallazgos": [{"categoria": "cronograma_clima|costos_transporte|orden_publico|otro", "severidad": "CRITICA|ALTA|MEDIA|INFO", "titulo": string, "detalle": string, "evidencia": [{"campo": string, "valor": string}], "recomendacion": string}]}`;

export function buildUserPrompt(datos, hallazgosReglas) {
  return `DATOS DEL PROYECTO (diccionario campo → valor, única fuente permitida):
${JSON.stringify(datos, null, 1)}

HALLAZGOS YA DETECTADOS POR REGLAS DETERMINISTAS (no los repitas; profundiza o ataca otros frentes):
${JSON.stringify(hallazgosReglas.map(h => ({ regla: h.regla, severidad: h.severidad, titulo: h.titulo })), null, 1)}`;
}

/**
 * Valida la salida del modelo contra los datos enviados. Exportada para test.
 * @returns {{ validos: object[], descartados: Array<{titulo: string, motivo: string}> }}
 */
export function validarHallazgosIA(crudos, datos) {
  const validos = [], descartados = [];
  for (const h of Array.isArray(crudos) ? crudos : []) {
    const titulo = String(h?.titulo || '').slice(0, 200);
    const ev = Array.isArray(h?.evidencia) ? h.evidencia : [];
    if (!titulo || !ev.length) { descartados.push({ titulo, motivo: 'sin_evidencia' }); continue; }
    const invalida = ev.find(e => {
      const campo = String(e?.campo ?? '');
      if (!(campo in datos)) return true;
      const enviado = normalizar(datos[campo]), citado = normalizar(e?.valor);
      // Igualdad, o fragmento literal de al menos 4 caracteres (una cita de
      // "1" no puede validar un valor que simplemente contiene ese dígito).
      return !citado || !(enviado === citado || (citado.length >= 4 && enviado.includes(citado)));
    });
    if (invalida) { descartados.push({ titulo, motivo: `evidencia_no_coincide:${String(invalida?.campo ?? '')}` }); continue; }
    validos.push({
      categoria: CATEGORIAS.has(h.categoria) ? h.categoria : 'otro',
      severidad: SEVERIDADES.has(h.severidad) ? h.severidad : 'MEDIA',
      titulo,
      detalle: String(h.detalle || '').slice(0, 1500),
      evidencia: ev.map(e => ({ campo: String(e.campo), valor: String(datos[e.campo]) })),
      recomendacion: String(h.recomendacion || '').slice(0, 800),
    });
  }
  return { validos, descartados };
}

export async function evaluarComiteIA({ datos, hallazgosReglas, userId, userGeminiKeys, reintentoMs = 2500 }) {
  const useUserKeys = Array.isArray(userGeminiKeys) && userGeminiKeys.length > 0;
  if (!useUserKeys && !geminiCB.keys.length) {
    return { estado: 'no_disponible', motivo: 'sin_llaves_servidor', hallazgos: [], descartados: [] };
  }

  const intentar = async (apiKey) => {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(datos, hallazgosReglas) }],
        // Lote 5 T4 (2026-09-24, verificado en vivo): gemini-3.6-flash
        // RAZONA ("thinking") y esos tokens cuentan contra max_tokens. Con
        // 3072, ~2.800 se iban en razonamiento, quedaban 272 de salida y el
        // JSON llegaba cortado (finish_reason: length). reasoning_effort acota
        // el razonamiento; 8192 deja espacio real a la respuesta.
        temperature: 0.2, max_tokens: 8192, reasoning_effort: 'low', response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (upstream.status === 429) throw new Error('Gemini 429 quota exceeded');
    // 503 UNAVAILABLE = modelo saturado en Google ("high demand"), transitorio
    // (verificado en vivo 2026-09-24). Se marca para reintentar, no es cuota.
    if (upstream.status === 503) {
      const e = new Error('Gemini 503 modelo saturado');
      e.code = 'MODEL_OVERLOADED';
      throw e;
    }
    if (!upstream.ok) {
      const cuerpo = await upstream.text().catch(() => '');
      logger.error('[MIROFISH] Fallo Gemini no-cuota', { status: upstream.status, body: cuerpo.slice(0, 300) });
      throw new Error(`Gemini HTTP ${upstream.status}`);
    }
    const data = await upstream.json();
    const eleccion = data?.choices?.[0];
    return { texto: eleccion?.message?.content ?? '', finishReason: eleccion?.finish_reason ?? null, usage: data?.usage ?? {} };
  };

  const llamar = () => (useUserKeys ? withUserKeyRotation(userGeminiKeys, intentar) : withKeyRotation(intentar));
  let respuesta;
  try {
    try {
      respuesta = await llamar();
    } catch (err) {
      if (err?.code !== 'MODEL_OVERLOADED') throw err;
      // Un solo reintento tras una pausa corta: la saturación suele ser breve.
      await new Promise(r => setTimeout(r, reintentoMs));
      respuesta = await llamar();
    }
  } catch (err) {
    if (err?.code === 'MODEL_OVERLOADED') {
      return { estado: 'no_disponible', motivo: 'modelo_saturado', hallazgos: [], descartados: [] };
    }
    if (err instanceof UserKeyPoolExhaustedError || err?.code === 'USER_KEY_EXHAUSTED') {
      return { estado: 'no_disponible', motivo: 'USER_KEY_EXHAUSTED', mensaje: err.message, hallazgos: [], descartados: [] };
    }
    if (err instanceof GeminiPoolExhaustedError || isQuotaError(err)) {
      return { estado: 'no_disponible', motivo: 'pool_servidor_agotado', hallazgos: [], descartados: [] };
    }
    logger.error('[MIROFISH] Excepción Gemini', { err: err.message });
    return { estado: 'no_disponible', motivo: 'error', hallazgos: [], descartados: [] };
  }

  // FinOps: los tokens de razonamiento no vienen en completion_tokens pero sí
  // en total_tokens (verificado: 1059 entrada + 272 salida visible = 4127
  // total). Se registra la salida REAL facturada = total − entrada.
  const u = respuesta.usage || {};
  const salidaReal = Number.isFinite(u.total_tokens) && Number.isFinite(u.prompt_tokens) ? u.total_tokens - u.prompt_tokens : (u.completion_tokens ?? 0);
  logTokenUsage({ userId, agentName: 'mirofish_comite', tokensInput: u.prompt_tokens ?? 0, tokensOutput: salidaReal }).catch(() => {});

  if (respuesta.finishReason === 'length') {
    logger.warn('[MIROFISH] Respuesta de Gemini truncada por max_tokens', { usage: u });
    return { estado: 'no_disponible', motivo: 'respuesta_truncada', hallazgos: [], descartados: [] };
  }

  let parsed;
  try {
    const m = respuesta.texto.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : null;
  } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.hallazgos)) {
    return { estado: 'no_disponible', motivo: 'respuesta_invalida', hallazgos: [], descartados: [] };
  }
  const { validos, descartados } = validarHallazgosIA(parsed.hallazgos, datos);
  return { estado: 'ok', modelo: MODELO, hallazgos: validos, descartados };
}
