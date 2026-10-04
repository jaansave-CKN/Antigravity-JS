// =============================================================================
// LlmGateway.js — puerta única de IA de la aplicación RadFor-360 (M1, AGT-052
// vía /api/chat, health). Orden del dueño 2026-10-04 (ADR-0003 enmendado):
// enrutamiento por aptitud sobre el catálogo NIM, con Anthropic al final como
// respaldo de pago si hay ANTHROPIC_API_KEY.
//
// Reutiliza la capa del gate (agents/gate-proveedor.cjs): mismos contratos de
// error, contención <15 s de primer byte por eslabón, breakers por modelo y
// FinOps (uso real o estimado + costo en COP). Breakers propios de la app en
// LLM_BREAKER_DIR (por defecto logs/llm/, no versionado), separados del gate.
// =============================================================================

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const proveedor = require('../../../agents/gate-proveedor.cjs');

const DIR_BREAKERS_DEFAULT = fileURLToPath(new URL('../../../logs/llm/', import.meta.url));
// Tope de primer byte para TODOS los eslabones (incluido el último): un
// usuario espera la respuesta, no 300 s como el gate.
export const PRIMER_BYTE_APP_MS = 15_000;

export const { ErrorProveedor, PERFILES_TAREA } = proveedor;

export function rutaBreaker(tarea, env = process.env) {
  return path.join(env.LLM_BREAKER_DIR || DIR_BREAKERS_DEFAULT, `cb_${tarea}.json`);
}

// mensaje: { system, user, max_tokens }. Devuelve { texto, uso, costo,
// proveedor, modelo, failover, ... } o lanza ErrorProveedor.
export async function llamarIA(mensaje, { tarea, deadlineMs, env = process.env } = {}) {
  return proveedor.llamarPorTarea(mensaje, {
    tarea, env, deadlineMs,
    primerByteMs: PRIMER_BYTE_APP_MS,
    breakerPath: rutaBreaker(tarea, env),
  });
}

// Formato de uso que espera LangfuseMonitoring.trackGeneration().
export function usoLangfuse(r) {
  return r?.uso ? { input_tokens: r.uso.prompt_tokens ?? null, output_tokens: r.uso.completion_tokens ?? null } : undefined;
}

// Proveedores configurados (para /status y /api/health), sin exponer keys.
export function proveedoresConfigurados(env = process.env) {
  return {
    nim: Boolean(String(env.NVIDIA_API_KEY ?? '').trim()),
    anthropic: Boolean(String(env.ANTHROPIC_API_KEY ?? '').trim()),
  };
}
