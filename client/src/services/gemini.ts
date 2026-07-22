/**
 * GEMINI SERVICE - COMPATIBILITY LAYER
 * Estructura de seguridad: La clave API nunca debe residir en este archivo.
 * Se invoca mediante proceso de entorno local.
 */

import { geminiService } from './ai/geminiService';

export const generateContent = async (prompt: string): Promise<string> => {
  try {
    return await geminiService.generateContent(prompt);
  } catch (error) {
    console.error('[AI] Error en generateContent:', error);
    throw error;
  }
};

export default { generateContent };
