/**
 * enfoqueEntidadAgent.js — Genera el "enfoque narrativo" de una postulación:
 * adapta la problemática/población del proyecto matriz al lenguaje y
 * prioridades típicas de la entidad/convocatoria a la que se postula.
 *
 * Mismo patrón que viabilidadAgent.js: intenta Gemini primero (gateado por
 * geminiCB), y si no hay key/cuota/la respuesta es inválida, cae a una
 * plantilla determinista — nunca lanza, siempre devuelve texto utilizable.
 */
import { withKeyRotation } from './geminiCircuitBreaker.js';
import { logTokenUsage } from './aiTokenLogger.js';

function buildPrompt({ nombreEntidad, urlLineamientos, problematicaCentral, poblacionObjetivo }) {
  return `Eres un experto en redacción de propuestas para cooperación internacional y fondos de inversión pública en Colombia.

Adapta la siguiente problemática y población objetivo de un proyecto al lenguaje y prioridades típicas de la entidad financiadora indicada. No inventes cifras, fechas ni compromisos que no estén en los datos de entrada. Si no conoces los lineamientos exactos de la entidad, adapta el tono y énfasis a su misión conocida, sin fingir certeza sobre requisitos específicos que no tienes forma de verificar.

Responde ÚNICAMENTE con el texto del enfoque narrativo adaptado (máx. 600 caracteres), sin encabezados ni comentarios adicionales.

ENTIDAD: ${nombreEntidad}
${urlLineamientos ? `Lineamientos/convocatoria de referencia: ${urlLineamientos}` : ''}

PROBLEMÁTICA CENTRAL DEL PROYECTO: ${(problematicaCentral || '(no definida)').slice(0, 1200)}

POBLACIÓN OBJETIVO: ${poblacionObjetivo || '(no definida)'}`;
}

function generarEnfoqueHeuristico({ nombreEntidad, problematicaCentral, poblacionObjetivo }) {
  const problematica = (problematicaCentral || '').trim();
  const poblacion = (poblacionObjetivo || '').trim();
  const partes = [];
  if (problematica) partes.push(`El proyecto atiende la siguiente problemática: ${problematica.slice(0, 300)}`);
  if (poblacion) partes.push(`beneficiando directamente a ${poblacion}`);
  partes.push(`Se presenta para consideración de ${nombreEntidad}, alineado con sus lineamientos de financiación.`);
  return partes.join('. ') + '.';
}

/**
 * @param {{nombreEntidad:string, urlLineamientos?:string, problematicaCentral?:string, poblacionObjetivo?:string}} ctx
 * @returns {Promise<{enfoque:string, fuente:string}>}
 */
// REFACTOR (2026-08-19, pool de llaves): withKeyRotation() prueba cada
// llave del pool ante 429 — mismo contrato (nunca lanza, cae a la plantilla
// heurística ante cualquier fallo real o pool agotado).
export async function generarEnfoqueEntidad(ctx) {
  try {
    const { text, usage } = await withKeyRotation(async (apiKey) => {
      const upstream = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gemini-3.6-flash',
            messages: [{ role: 'user', content: buildPrompt(ctx) }],
            temperature: 0.4,
            max_tokens: 400,
          }),
        }
      );

      if (upstream.status === 429) throw new Error('Gemini 429 quota exceeded');
      if (!upstream.ok) throw new Error(`Gemini HTTP ${upstream.status}`);

      const data = await upstream.json();
      const textLocal = (data?.choices?.[0]?.message?.content ?? '').trim();
      if (!textLocal) throw new Error('Gemini sin contenido en la respuesta');
      return { text: textLocal, usage: data?.usage ?? {} };
    });

    logTokenUsage({
      userId: ctx.userId, agentName: 'enfoque_entidad',
      tokensInput: usage?.prompt_tokens ?? 0,
      tokensOutput: usage?.completion_tokens ?? 0,
    }).catch(() => {});
    return { enfoque: text.slice(0, 800), fuente: 'gemini-3.6-flash' };
  } catch {
    return { enfoque: generarEnfoqueHeuristico(ctx), fuente: 'heuristica' };
  }
}
