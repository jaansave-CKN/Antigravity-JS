/**
 * mirofishComite.js — F-09: IA adversarial del comité hostil MIROFISH.
 *
 * La IA pasa por llmProveedor.js (OpenRouter → pool Gemini → BYOK), igual
 * que calcularViabilidadIA (viabilidadAgent.js). B1, 2026-09-28.
 *
 * DIFERENCIA DELIBERADA con viabilidadAgent (fiscalización architect
 * 2026-09-24, B4): aquí NO hay respaldo heurístico. Si la IA no responde se
 * devuelve { estado: 'no_disponible', motivo } y el comité entrega solo las
 * reglas deterministas — nunca hallazgos fabricados.
 *   motivo: ia_no_disponible (ningún proveedor respondió; detalle en intentos)
 *           | IA_TOPE_AGOTADO | LLM_LOOP_GUARD | error
 *
 * Anti-alucinación (mismo criterio que F-07): el modelo recibe los datos como
 * un diccionario plano campo → valor y cada hallazgo debe citar
 * `evidencia: [{campo, valor}]`. Se DESCARTA todo hallazgo sin evidencia o
 * con un campo que no se envió o un valor que no coincide con lo enviado.
 */
import { LlmLoopGuardError } from './geminiCircuitBreaker.js';
import { generarConIA, IaNoDisponibleError, IaTopeAgotadoError } from './llmProveedor.js';
import { logger } from '../utils/logger.js';
import { normalizar } from './mirofishReglas.js';

const CATEGORIAS = new Set(['cronograma_clima', 'costos_transporte', 'orden_publico', 'coherencia_financiador', 'otro']);
const SEVERIDADES = new Set(['CRITICA', 'ALTA', 'MEDIA', 'INFO']);

export const SYSTEM_PROMPT = `Eres el COMITÉ HOSTIL MIROFISH: un panel de evaluadores escépticos de fondos públicos y de cooperación en Colombia. Tu trabajo es ATACAR la formulación del proyecto y encontrar vacíos reales de planificación antes de que lo haga el financiador.

Busca especialmente:
- cronograma_clima: cronogramas inviables por temporadas de lluvia, crecientes, vías destapadas o de montaña, duraciones de tramo incompatibles con el plazo total.
- costos_transporte: costos logísticos ocultos o irreales hacia zonas complejas (trochas, transporte fluvial, carga pesada en vías sin pavimentar) frente a lo presupuestado.
- orden_publico: riesgos de seguridad no gestionados.
- coherencia_financiador: contradicciones entre lo formulado y la fuente de financiación, el formato del financiador o las metodologías elegidas (campos entrada.fuente_financiacion, entrada.formato_financiador, entrada.metodologias).
- otro: cualquier otro vacío grave y verificable.

REGLAS INQUEBRANTABLES:
1. Usa EXCLUSIVAMENTE los DATOS DEL PROYECTO (diccionario campo → valor). NUNCA inventes cifras, lugares, climas ni hechos que no se deduzcan de esos datos.
2. Cada hallazgo DEBE citar en "evidencia" los campos exactos del diccionario en que se apoya, copiando su valor LITERAL: [{"campo": "<clave exacta>", "valor": "<valor exacto>"}]. Un hallazgo sin evidencia literal será descartado.
3. Si los datos no alcanzan para sostener un ataque, NO lo hagas. Es preferible devolver pocos hallazgos (o ninguno) que uno sin sustento.
4. Severidad: CRITICA (hace inviable el proyecto), ALTA, MEDIA o INFO.
5. Responde SOLO un objeto JSON: {"hallazgos": [{"categoria": "cronograma_clima|costos_transporte|orden_publico|coherencia_financiador|otro", "severidad": "CRITICA|ALTA|MEDIA|INFO", "titulo": string, "detalle": string, "evidencia": [{"campo": string, "valor": string}], "recomendacion": string}]}`;

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

/** Extrae el objeto { hallazgos: [...] } de la respuesta (lanza si no sirve → siguiente proveedor). Exportada para test. */
export function parsearRespuestaComite(texto) {
  const m = String(texto || '').match(/\{[\s\S]*\}/);
  const parsed = m ? JSON.parse(m[0]) : null;
  if (!parsed || !Array.isArray(parsed.hallazgos)) throw new Error('respuesta sin arreglo "hallazgos"');
  return parsed;
}

// B1 (2026-09-28): la llamada pasa por llmProveedor.js (OpenRouter → pool
// Gemini del servidor → BYOK). Sigue SIN respaldo heurístico: si la IA no
// responde, el comité entrega solo las reglas deterministas reales con
// ia.estado 'no_disponible' (se mantiene 201: convertirlo en 503 descartaría
// hallazgos reales de las reglas — excepción a confirmar por el dueño).
export async function evaluarComiteIA({ datos, hallazgosReglas, userId }) {
  let r;
  try {
    r = await generarConIA({
      userId, agente: 'mirofish_comite', temperature: 0.2,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(datos, hallazgosReglas) }],
      responseFormat: { type: 'json_object' },
      validar: parsearRespuestaComite,
    });
  } catch (err) {
    if (err instanceof IaTopeAgotadoError) {
      return { estado: 'no_disponible', motivo: 'IA_TOPE_AGOTADO', mensaje: err.message, retryAt: err.retryAt, hallazgos: [], descartados: [] };
    }
    if (err instanceof IaNoDisponibleError) {
      return { estado: 'no_disponible', motivo: 'ia_no_disponible', intentos: err.intentos, hallazgos: [], descartados: [] };
    }
    if (err instanceof LlmLoopGuardError) {
      return { estado: 'no_disponible', motivo: 'LLM_LOOP_GUARD', mensaje: err.message, hallazgos: [], descartados: [] };
    }
    logger.error('[MIROFISH] Excepción en la capa de IA', { err: err.message });
    return { estado: 'no_disponible', motivo: 'error', hallazgos: [], descartados: [] };
  }
  const { validos, descartados } = validarHallazgosIA(r.valor.hallazgos, datos);
  // B7: el modelo que realmente respondió (queda en project_mirofish_evaluaciones.ia).
  return { estado: 'ok', modelo: r.modelo, proveedor: r.proveedor, hallazgos: validos, descartados };
}
