/**
 * aiTokenLogger.js — FinOps: registra el consumo real de tokens de cada
 * llamada a Gemini en ai_token_logs (migración 034).
 *
 * Usa supabaseAdmin directamente (mismo patrón ya activo en
 * CopilotoService.js para project_chat_history) en vez de runSql/getRow —
 * estos archivos de agentes IA no reciben esas dependencias inyectadas
 * (a diferencia de server.js/*.routes.js), y supabaseAdmin ya es un
 * singleton importable sin necesidad de threading adicional.
 *
 * Nunca debe romper la respuesta de IA al usuario: cualquier fallo al
 * registrar el consumo se loguea y se ignora (fire-and-forget).
 */
import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase.config.js';

// Estimado de costo, NO facturación real verificada — Gemini 2.0 Flash,
// tarifa pagada pública aproximada a la fecha de esta implementación
// (USD 0.075 / 1M tokens input, USD 0.30 / 1M tokens output) convertida a
// COP con una tasa de referencia fija. Ajustar estas 3 constantes cuando
// se tenga la tarifa real facturada o cambie el modelo usado.
const USD_COP_REF        = 4000;
const COST_USD_PER_1M_IN  = 0.075;
const COST_USD_PER_1M_OUT = 0.30;

function estimarCostoCOP(tokensInput, tokensOutput) {
  const usd = (tokensInput / 1_000_000) * COST_USD_PER_1M_IN
            + (tokensOutput / 1_000_000) * COST_USD_PER_1M_OUT;
  return Math.round(usd * USD_COP_REF * 10000) / 10000;
}

/**
 * @param {{ userId: string, agentName: string, tokensInput?: number, tokensOutput?: number }} params
 */
export async function logTokenUsage({ userId, agentName, tokensInput = 0, tokensOutput = 0 }) {
  if (!supabaseAdmin || !userId || !agentName) return;
  try {
    // LOTE 8 (auditoría minera 2026-09-24): supabase-js NO lanza en un INSERT
    // fallido — devuelve { error }. Antes ese error se descartaba y el
    // try/catch no atrapaba nada: un fallo de registro FinOps era invisible.
    const { error } = await supabaseAdmin.from('ai_token_logs').insert([{
      id: crypto.randomUUID(),
      user_id: userId,
      agent_name: agentName,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      cost_cop_estimated: estimarCostoCOP(tokensInput, tokensOutput),
    }]);
    if (error) console.warn(`[aiTokenLogger] No se pudo registrar consumo (${agentName}):`, error.message);
  } catch (e) {
    console.warn('[aiTokenLogger] No se pudo registrar consumo:', e.message);
  }
}
