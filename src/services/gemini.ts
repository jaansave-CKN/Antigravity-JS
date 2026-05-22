/**
 * GEMINI SERVICE - LEGACY COMPATIBILITY LAYER
 * Re-exports from enhanced AI service for backward compatibility
 */

import { geminiService } from './ai/geminiService';

export const generateContent = (prompt: string): Promise<string> => 
  geminiService.generateContent(prompt);

export default { generateContent };