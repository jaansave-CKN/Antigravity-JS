/**
 * arbolObjetivosAgent.js — Módulo 3b: Árbol de Objetivos con IA (llmProveedor.js)
 * Spec v2.0 Sección C-M3: Grafo dirigido Causas→Problema→Efectos invertido a Medios→Objetivo→Fines
 */
import { logger } from '../utils/logger.js';
import { LlmLoopGuardError } from '../services/geminiCircuitBreaker.js';
import { generarConIA, IaNoDisponibleError, IaTopeAgotadoError } from '../services/llmProveedor.js';

export const ARBOL_SYSTEM_PROMPT = `Eres un experto en formulación de proyectos de cooperación internacional, \
contratación pública colombiana y Metodología General Ajustada (MGA).
Tu tarea es generar un Árbol de Objetivos estructurado a partir del objetivo central proporcionado.

ESTRUCTURA OBLIGATORIA:
- 1 nodo CENTRAL (nivel 0) — objetivo central parafraseado con precisión técnica y lenguaje MGA
- 3-5 nodos ESPECIFICO (nivel 1) — objetivos específicos medibles (verbos en infinitivo)
- 2-3 nodos RESULTADO por cada ESPECIFICO (nivel 2) — resultados verificables con indicadores cuantificables
- 2-4 nodos ACTIVIDAD por cada RESULTADO (nivel 3) — actividades operativas concretas

REGLAS INMUTABLES:
- Cada nodo: oración completa con verbo en infinitivo.
- Nodos RESULTADO: verificables con indicadores cuantitativos (número, porcentaje, fecha).
- NO incluir actividades vagas (ej: "realizar talleres").
- NO usar materiales reciclados ni conceptos de reutilización.
- Contexto Colombia 2026: marco MGA, SGR, DNP.
- Responde EXCLUSIVAMENTE con JSON válido. Sin texto adicional, sin markdown.

FORMATO:
{"nodos":[{"tipo":"CENTRAL","nivel":0,"texto":"...","parentIndex":null},{"tipo":"ESPECIFICO","nivel":1,"texto":"...","parentIndex":0}]}`;

// F-02 (auditoría V3, 2026-09-23): antes, sin llaves o con la cuota del
// servidor agotada, se devolvía un árbol de DEMOSTRACIÓN fijo ("500
// familias", "80 líderes"...) que los callers guardaban en objetivos_arbol
// como generado_por_ia=1, borrando el árbol real anterior. Ahora falla con
// 503 explícito ANTES de que ningún caller toque objetivos_arbol (ambos
// hacen el DELETE después de generar), así el árbol previo queda intacto.
export class ArbolIANoDisponibleError extends Error {
  constructor(message, { code = 'IA_NO_DISPONIBLE', status = 503, retryAt = null } = {}) {
    super(message);
    this.name = 'ArbolIANoDisponibleError';
    this.status = status;
    this.code = code;
    this.retryAt = retryAt;
  }
}

const MSG_SIN_IA = 'Servicio de IA no disponible en este momento — ningún proveedor respondió. Tu árbol de objetivos actual no se modificó. Intenta de nuevo más tarde.';

/** Valida y extrae los nodos de la respuesta del modelo (lanza si no sirven). Exportada para test. */
export function parsearNodosArbol(texto) {
  let parsed;
  try {
    parsed = JSON.parse(texto);
  } catch {
    // Intentar extraer JSON del texto si viene envuelto en markdown
    const match = String(texto).match(/\{[\s\S]*\}/);
    if (!match) throw new Error('la respuesta no contiene JSON válido');
    parsed = JSON.parse(match[0]);
  }
  const nodos = parsed.nodos || parsed;
  if (!Array.isArray(nodos) || nodos.length === 0) throw new Error('árbol de objetivos vacío');
  return nodos;
}

// B1 (2026-09-28): la generación pasa por llmProveedor.js (OpenRouter →
// pool Gemini del servidor → BYOK del usuario), con timeout (antes la
// llamada del SDK no tenía). Nunca se devuelve un árbol fabricado: si nadie
// responde con un árbol válido → ArbolIANoDisponibleError (503), o 429 si
// el tope de gasto del usuario está agotado.
export async function generarArbolConIA(objetivoCentral, userId) {
  // Sanitización anti-prompt-injection: limitar longitud y strip de delimitadores
  const sanitized = String(objetivoCentral || '')
    .slice(0, 400)
    .replace(/["`\\]/g, '')
    .replace(/\n{2,}/g, ' ');

  try {
    const { valor: nodos, proveedor, modelo } = await generarConIA({
      userId, agente: 'arbol_objetivos', temperature: 0.3,
      messages: [
        { role: 'system', content: ARBOL_SYSTEM_PROMPT },
        { role: 'user', content: `OBJETIVO CENTRAL DEL PROYECTO:\n"${sanitized}"` },
      ],
      responseFormat: { type: 'json_object' },
      validar: parsearNodosArbol,
    });
    console.log(`[ArbolAgent] Árbol generado con ${nodos.length} nodos via ${proveedor} (${modelo})`);
    return nodos;
  } catch (err) {
    if (err instanceof IaTopeAgotadoError) {
      throw new ArbolIANoDisponibleError(`${err.message} Tu árbol de objetivos actual no se modificó.`, { code: err.code, status: 429, retryAt: err.retryAt });
    }
    if (err instanceof IaNoDisponibleError) {
      logger.warn('[ArbolAgent] Ningún proveedor de IA respondió — 503, sin árbol de demostración', { userId });
      throw new ArbolIANoDisponibleError(MSG_SIN_IA, { retryAt: err.retryAt });
    }
    if (err instanceof LlmLoopGuardError) throw err;
    logger.error('[ArbolAgent] Fallo al generar árbol', { err: err.message, userId });
    throw new ArbolIANoDisponibleError(MSG_SIN_IA);
  }
}
