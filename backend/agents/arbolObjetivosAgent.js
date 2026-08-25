/**
 * arbolObjetivosAgent.js — Módulo 3b: Árbol de Objetivos con Gemini
 * Spec v2.0 Sección C-M3: Grafo dirigido Causas→Problema→Efectos invertido a Medios→Objetivo→Fines
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger.js';
import { geminiCB, isQuotaError, withKeyRotation, GeminiPoolExhaustedError } from '../services/geminiCircuitBreaker.js';
import { withUserKeyRotation, UserKeyPoolExhaustedError } from '../services/byokService.js';
import { logTokenUsage } from '../services/aiTokenLogger.js';

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

function buildMockArbol(objetivoCentral) {
  return [
    { tipo: 'CENTRAL',    nivel: 0, texto: objetivoCentral || 'Mejorar las condiciones de vida de la población objetivo', parentIndex: null },
    { tipo: 'ESPECIFICO', nivel: 1, texto: 'Aumentar el acceso a infraestructura básica de calidad',      parentIndex: 0 },
    { tipo: 'RESULTADO',  nivel: 2, texto: '500 familias con acceso a servicios básicos mejorados',       parentIndex: 1 },
    { tipo: 'ACTIVIDAD',  nivel: 3, texto: 'Construir 2 unidades de saneamiento básico integral (UMIS)',  parentIndex: 2 },
    { tipo: 'ESPECIFICO', nivel: 1, texto: 'Fortalecer las capacidades técnicas de la comunidad',         parentIndex: 0 },
    { tipo: 'RESULTADO',  nivel: 2, texto: '80 líderes comunitarios capacitados en gestión de proyectos', parentIndex: 4 },
    { tipo: 'ACTIVIDAD',  nivel: 3, texto: 'Ejecutar programa de formación técnica de 120 horas',         parentIndex: 5 },
  ];
}

// Llamada real al SDK con una llave dada — factorizada para poder usarse
// tanto con el pool BYOK propio de un usuario (withUserKeyRotation) como
// con el pool de llaves del servidor (withKeyRotation, 2026-08-19).
async function intentarGenerarArbol(key, objetivoCentral) {
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.6-flash',
    generationConfig: {
      temperature:     0.3,
      topP:            0.8,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  });

  // Sanitización anti-prompt-injection: limitar longitud y strip de delimitadores
  const sanitized = String(objetivoCentral || '')
    .slice(0, 400)
    .replace(/["`\\]/g, '')
    .replace(/\n{2,}/g, ' ');
  const prompt = `${ARBOL_SYSTEM_PROMPT}\n\nOBJETIVO CENTRAL DEL PROYECTO:\n"${sanitized}"`;
  const result = await model.generateContent(prompt);
  const text   = result.response.text().trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Intentar extraer JSON del texto si viene envuelto en markdown
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Respuesta de Gemini no contiene JSON válido');
    parsed = JSON.parse(match[0]);
  }

  const nodos = parsed.nodos || parsed;
  if (!Array.isArray(nodos) || nodos.length === 0) {
    throw new Error('Árbol de objetivos vacío en respuesta de Gemini');
  }

  // SDK oficial @google/generative-ai — forma distinta a las llamadas fetch
  // directas de los otros agentes (data.usage.prompt_tokens): acá viene en
  // result.response.usageMetadata.{promptTokenCount,candidatesTokenCount}.
  return { nodos, usage: result.response.usageMetadata || {} };
}

// REFACTOR (2026-08-22, BYOK migración 045): `apiKey` (una sola llave de
// server.js:resolveGoogleApiKey) se reemplaza por `userGeminiKeys` (array de
// llaves propias del usuario ya desencriptadas, resuelto por
// requireByokOrExento). REGLA DE ORO explícita (revisión de architect):
// buildMockArbol() es un árbol de DEMOSTRACIÓN fijo, no un cálculo real
// sobre el proyecto — a diferencia de viabilidadAgent/enfoqueEntidadAgent
// (heurísticas reales, etiquetadas), esto SÍ es la fabricación ya rechazada
// 8 veces en este proyecto. Por eso el pool BYOK agotado NUNCA cae a
// buildMockArbol: se propaga UserKeyPoolExhaustedError (429) tal cual. El
// pool del SERVIDOR agotado conserva su comportamiento previo (mock) — es
// una decisión de producto anterior a BYOK, fuera de este alcance.
export async function generarArbolConIA(objetivoCentral, userGeminiKeys, userId) {
  const useUserKeys = Array.isArray(userGeminiKeys) && userGeminiKeys.length > 0;

  if (!useUserKeys && !geminiCB.keys.length) {
    console.warn('[ArbolAgent] Sin llaves configuradas — usando árbol de objetivos de demostración');
    return buildMockArbol(objetivoCentral);
  }

  try {
    let nodos, usage;
    if (useUserKeys) {
      ({ nodos, usage } = await withUserKeyRotation(userGeminiKeys, (key) => intentarGenerarArbol(key, objetivoCentral)));
    } else {
      ({ nodos, usage } = await withKeyRotation((key) => intentarGenerarArbol(key, objetivoCentral)));
    }

    console.log(`[ArbolAgent] Árbol generado con ${nodos.length} nodos via Gemini`);
    logTokenUsage({
      userId, agentName: 'arbol_objetivos',
      tokensInput: usage.promptTokenCount ?? 0,
      tokensOutput: usage.candidatesTokenCount ?? 0,
    }).catch(() => {});
    return nodos;
  } catch (err) {
    if (err instanceof UserKeyPoolExhaustedError) {
      logger.warn('[ArbolAgent] Pool BYOK del usuario agotado — sin fallback a demostración (anti-fabricación)', { objetivoCentral, userId });
      throw err;
    }
    if (isQuotaError(err) || err instanceof GeminiPoolExhaustedError) {
      logger.warn('[ArbolAgent] Cuota del pool del servidor agotada — degradando a árbol de demostración', { objetivoCentral });
      return buildMockArbol(objetivoCentral);
    }
    logger.error('[ArbolAgent] Fallo al generar árbol con Gemini', { err: err.message, objetivoCentral });
    throw new Error('La IA de Gemini está experimentando alta latencia. Por favor, reintenta en unos momentos.');
  }
}
