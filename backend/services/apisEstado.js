/**
 * apisEstado.js — diagnóstico SIN COSTO de los proveedores de IA para el
 * Búnker de Conexiones del Panel (GET /api/admin/apis-estado, solo admin).
 * Decisión del dueño 2026-09-28; dictamen architect APROBADO CON CAMBIOS.
 *
 * - Nunca devuelve llaves, prefijos, labels ni el payload crudo de un
 *   proveedor: solo la lista blanca de campos de abajo.
 * - OpenRouter: sin_llave/pausado/sin_tope salen de estadoOpenRouter() (no se
 *   reimplementan); el saldo, de consultarSaldoOpenRouter() (GET /credits,
 *   gratis). Si no se puede obtener → 'saldo_no_verificable', nunca inferido.
 * - NVIDIA NIM: solo presencia de la llave. /v1/models de NIM es público y no
 *   valida la llave, y un fetch literal a NIM fuera de nimCliente rompería la
 *   guardia de tests/unit/lote9Reintento.test.mjs.
 * - Groq (rol creador, 2026-09-30): solo presencia de la llave y la pausa de
 *   estadoGroq() (tras 429/401) — no se gasta una petición de su cuota
 *   gratuita para diagnosticar.
 * - Gemini NO está aquí: QuotaTelemetry ya consulta /api/admin/quota-status.
 * - Embeddings y su cobertura se componen en server.js (este módulo es
 *   NEUTRAL y no puede importar el Radar).
 */
import { estadoOpenRouter, estadoGroq } from './llmProveedor.js';
import { consultarSaldoOpenRouter } from './openRouterCliente.js';
import { leerFlagsIA } from './iaFlags.js';

const CACHE_MS = 60_000;
let _saldoCache = null; // { en: number, valor: { estado, saldoUsd? } }
let _saldoEnVuelo = null;

async function diagnosticoSaldo(ahora) {
  if (_saldoCache && ahora - _saldoCache.en < CACHE_MS) return _saldoCache.valor;
  if (!_saldoEnVuelo) {
    _saldoEnVuelo = consultarSaldoOpenRouter()
      .then(({ saldoUsd }) => ({ estado: saldoUsd > 0 ? 'con_saldo' : 'sin_saldo', saldoUsd }))
      .catch((err) => ({ estado: err?.motivo === 'llave_rechazada' ? 'llave_rechazada' : 'saldo_no_verificable' }))
      .then((valor) => { _saldoCache = { en: Date.now(), valor }; return valor; })
      .finally(() => { _saldoEnVuelo = null; });
  }
  return _saldoEnVuelo;
}

async function diagnosticoOpenRouter(env, flags, ahora) {
  const configurada = !!(env.OPENROUTER_API_KEY || '').trim();
  const base = { configurada, habilitada: flags.openrouter, flagDisponible: true };
  if (!configurada) return { ...base, estado: 'faltante' };
  const saldo = await diagnosticoSaldo(ahora);
  const conSaldo = saldo.saldoUsd !== undefined ? { saldoUsd: saldo.saldoUsd } : {};
  if (saldo.estado !== 'con_saldo') return { ...base, ...conSaldo, estado: saldo.estado };
  // Con saldo: el resto de las condiciones de la cascada (tope configurado,
  // pausa tras 402/401) las decide estadoOpenRouter(), igual que en producción.
  // Se evalúa con el interruptor forzado a encendido para informar el estado
  // subyacente; que el admin lo apagó ya lo dice `habilitada`.
  const or = estadoOpenRouter(env, ahora, { ...flags, openrouter: true });
  const estado = or.activo ? 'activo'
    : or.motivo === 'sin_tope_configurado' ? 'sin_tope'
      : or.motivo === 'pausado_por_configuracion' ? 'pausado'
        : 'error';
  return { ...base, ...conSaldo, estado };
}

function diagnosticoGroq(env, flags, ahora) {
  const configurada = !!(env.GROQ_API_KEY || '').trim();
  const base = { configurada, habilitada: flags.groq, flagDisponible: true };
  if (!configurada) return { ...base, estado: 'faltante' };
  // Interruptor forzado a encendido para informar el estado subyacente (igual que OpenRouter).
  const g = estadoGroq(env, ahora, { ...flags, groq: true });
  return { ...base, estado: g.activo ? 'configurada_no_verificada' : 'pausado' };
}

/** @returns {Promise<{ openrouter: object, groq: object, nvidia: object, tavily: object }>} */
export async function estadoApis({ env = process.env, ahora = Date.now() } = {}) {
  const flags = await leerFlagsIA();
  const nvidiaConfigurada = !!(env.NVIDIA_API_KEY || '').trim();
  return {
    openrouter: await diagnosticoOpenRouter(env, flags, ahora),
    groq: diagnosticoGroq(env, flags, ahora),
    nvidia: {
      configurada: nvidiaConfigurada, habilitada: flags.nvidia, flagDisponible: true,
      estado: nvidiaConfigurada ? 'configurada_no_verificada' : 'faltante',
    },
    tavily: { integrado: false, estado: 'no_integrado' },
  };
}

/** Solo para pruebas. */
export function _reiniciarApisEstado() {
  _saldoCache = null;
  _saldoEnVuelo = null;
}
