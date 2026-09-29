/**
 * iaTopeSistema.js — tope DURO diario de tokens para las llamadas de IA del
 * SISTEMA (Radar: clasificación de sectores, extracción de convocatorias,
 * lookup de entidades del Directorio). Directiva "Contención y sincronización
 * de núcleo" (dueño, 2026-09-28): ningún proceso con cheque en blanco.
 * Dictamen architect APROBADO CON CAMBIOS (condiciones 2, 3 y 11).
 *
 * - Tope: LLM_TOPE_TOKENS_SISTEMA_DIA (defecto 50.000 tokens/día, entrada +
 *   salida), GLOBAL para la lista AGENTES_SISTEMA. Se cuenta por agent_name y
 *   no por user_id: lookup-entidad registra al usuario real que lo disparó
 *   (FinOps /api/admin/finops agrupa por user_id) y así no se pierde esa
 *   atribución.
 * - Día en hora de Colombia (mismo corte que iaPresupuesto.js).
 * - FAIL-CLOSED en todo caso dudoso (sin configurar, BD en modo REST, error de
 *   consulta, valor no finito, tope mal configurado): no se llama a la IA y
 *   los llamadores caen a su respaldo propio (palabras clave, null, heurística
 *   del Directorio).
 * - Lee ai_token_logs con el getRow del POOL PRINCIPAL (inyectado desde
 *   server.js): la tabla tiene RLS activo sin políticas (migración 063), y leída
 *   con withTenant devolvería 0 filas → el tope nunca saltaría.
 * - Contador en memoria del día: consumido = max(BD, memoria) + estimaciones
 *   en vuelo. Cubre la carrera entre llamadas concurrentes y un INSERT de
 *   FinOps fallido (logTokenUsage se traga su error).
 * - Sin import estático de la BD (mismo patrón DI que iaFlags.js): los tests
 *   de llmProveedor simulan database.config.js con un subconjunto de exports.
 */

export const AGENTES_SISTEMA = ['sector-classifier', 'markitdown-extract', 'lookup-entidad', 'lookup-deepsearch'];
const TOPE_DEFECTO = 50_000;

const SQL_CONSUMIDO = `
  SELECT coalesce(sum(coalesce(tokens_input, 0) + coalesce(tokens_output, 0)), 0)::bigint AS consumido
    FROM ai_token_logs
   WHERE agent_name = ANY(?::text[])
     AND created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')`;

export class IaTopeSistemaError extends Error {
  constructor(motivo, detalle = '') {
    super(`Tope de IA del sistema: ${motivo}${detalle ? ` (${detalle})` : ''}`);
    this.name = 'IaTopeSistemaError';
    this.code = 'IA_TOPE_SISTEMA';
    this.motivo = motivo;
    this.status = 429;
  }
}

let _deps = null;
let _dia = null;          // 'YYYY-MM-DD' en hora de Colombia
let _consumidoMem = 0;    // tokens reales liquidados hoy en este proceso
let _enVuelo = 0;         // estimaciones reservadas y aún no liquidadas

/** server.js lo llama al arrancar (antes de startScheduler) con el pool principal. */
export function configurarTopeSistema(deps) {
  _deps = deps;
}

const diaColombia = (ahora = Date.now()) => new Date(ahora - 5 * 3_600_000).toISOString().slice(0, 10);

function rotarDia(ahora) {
  const hoy = diaColombia(ahora);
  if (hoy !== _dia) { _dia = hoy; _consumidoMem = 0; _enVuelo = 0; }
}

/** Tope vigente. Ausente → 50.000; presente pero inválido → falla cerrado. */
export function topeSistemaDia(env = process.env) {
  const crudo = env.LLM_TOPE_TOKENS_SISTEMA_DIA;
  if (crudo === undefined || String(crudo).trim() === '') return TOPE_DEFECTO;
  const n = Number(crudo);
  if (!Number.isFinite(n) || n <= 0) throw new IaTopeSistemaError('tope_mal_configurado', `LLM_TOPE_TOKENS_SISTEMA_DIA=${String(crudo).slice(0, 20)}`);
  return n;
}

/** Estimación conservadora de una llamada: entrada (caracteres/3) + salida máxima. */
export function estimarTokensLlamada(messages, maxTokens) {
  const chars = (messages || []).reduce((s, m) => s + String(m?.content ?? '').length, 0);
  return Math.ceil(chars / 3) + (Number(maxTokens) || 0);
}

/**
 * Reserva `estimado` tokens del tope del día o lanza IaTopeSistemaError (sin
 * que se llame a la IA). Devuelve la reserva, que DEBE liquidarse con
 * liquidarTopeSistema() (en finally).
 */
export async function reservarTopeSistema(agente, estimado, { env = process.env, ahora = Date.now() } = {}) {
  if (!AGENTES_SISTEMA.includes(agente)) throw new IaTopeSistemaError('agente_no_es_de_sistema', agente);
  if (!_deps) throw new IaTopeSistemaError('no_configurado');
  if (!_deps.dbStatus?.().pgReady) throw new IaTopeSistemaError('bd_no_verificable', 'modo REST');
  const tope = topeSistemaDia(env);
  let fila;
  try {
    fila = await _deps.getRow(SQL_CONSUMIDO, [AGENTES_SISTEMA]);
  } catch (err) {
    throw new IaTopeSistemaError('consumo_no_verificable', err?.message?.slice(0, 80));
  }
  const consumidoBd = Number(fila?.consumido);
  if (!fila || !('consumido' in fila) || !Number.isFinite(consumidoBd)) throw new IaTopeSistemaError('consumo_no_verificable', 'valor no finito');
  rotarDia(ahora);
  const consumido = Math.max(consumidoBd, _consumidoMem) + _enVuelo;
  if (consumido + estimado > tope) throw new IaTopeSistemaError('tope_diario_agotado', `${consumido}+${estimado} > ${tope}`);
  _enVuelo += estimado;
  return { estimado, dia: _dia };
}

/** Libera la reserva y suma los tokens reales (0 si la llamada falló sin usage). */
export function liquidarTopeSistema(reserva, tokensReales = 0) {
  if (!reserva || reserva.dia !== _dia) return;
  _enVuelo = Math.max(0, _enVuelo - reserva.estimado);
  _consumidoMem += Math.max(0, Number(tokensReales) || 0);
}

/** Solo para pruebas. */
export function _reiniciarTopeSistema() {
  _deps = null; _dia = null; _consumidoMem = 0; _enVuelo = 0;
}
