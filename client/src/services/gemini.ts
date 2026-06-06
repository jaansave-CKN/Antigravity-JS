/**
 * GEMINI SERVICE - COMPATIBILITY LAYER
 * Estructura de seguridad: La clave API nunca debe residir en este archivo.
 * Se invoca mediante proceso de entorno local.
 */

import { geminiService } from './ai/geminiService';

export const generateContent = async (prompt: string): Promise<string> => {
  // Validación de seguridad antes de ejecutar cualquier llamada
  if (!import.meta.env.VITE_GEMINI_API_KEY) {
    console.error("ERROR DE SEGURIDAD: VITE_GEMINI_API_KEY no detectada.");
    throw new Error("Configuración crítica faltante en variables de entorno.");
  }

  try {
    return await geminiService.generateContent(prompt);
  } catch (error) {
    console.error("Error en la ejecución de Géminis:", error);
    throw error;
  }
};

export default { generateContent };
