/**
 * arbolObjetivosAgent.js — Módulo 3b: Árbol de Objetivos con Gemini
 * Spec v2.0 Sección C-M3: Grafo dirigido Causas→Problema→Efectos invertido a Medios→Objetivo→Fines
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger.js';
import { geminiCB, isQuotaError } from '../services/geminiCircuitBreaker.js';
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

export async function generarArbolConIA(objetivoCentral, apiKey, userId) {
  // Intentar con Gemini real; caer en mock estructurado si no hay clave
  const key = apiKey && apiKey !== 'api_key_placeholder'
    ? apiKey
    : (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '');

  if (!key) {
    console.warn('[ArbolAgent] Sin GOOGLE_API_KEY — usando árbol de objetivos de demostración');
    return buildMockArbol(objetivoCentral);
  }

  // ── Circuit Breaker: si la cuota de Gemini está agotada, degradar sin llamar a la API ──
  if (!geminiCB.canCall()) {
    logger.warn('[ArbolAgent] Circuit breaker OPEN — usando árbol de objetivos de demostración');
    return buildMockArbol(objetivoCentral);
  }

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
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

    console.log(`[ArbolAgent] Árbol generado con ${nodos.length} nodos via Gemini`);
    geminiCB.recordSuccess();
    // SDK oficial @google/generative-ai — forma distinta a las llamadas fetch
    // directas de los otros agentes (data.usage.prompt_tokens): acá viene en
    // result.response.usageMetadata.{promptTokenCount,candidatesTokenCount}.
    const usage = result.response.usageMetadata || {};
    logTokenUsage({
      userId, agentName: 'arbol_objetivos',
      tokensInput: usage.promptTokenCount ?? 0,
      tokensOutput: usage.candidatesTokenCount ?? 0,
    }).catch(() => {});
    return nodos;
  } catch (err) {
    if (isQuotaError(err)) {
      geminiCB.recordQuotaError();
      logger.warn('[ArbolAgent] Cuota de Gemini agotada — degradando a árbol de demostración', { objetivoCentral });
      return buildMockArbol(objetivoCentral);
    }
    logger.error('[ArbolAgent] Fallo al generar árbol con Gemini', { err: err.message, objetivoCentral });
    throw new Error('La IA de Gemini está experimentando alta latencia. Por favor, reintenta en unos momentos.');
  }
}
