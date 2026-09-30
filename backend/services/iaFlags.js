/**
 * iaFlags.js — interruptores (kill switch) de proveedores de IA, persistidos
 * en app_settings y manejados desde el Búnker de Conexiones del Panel (solo
 * admin, PUT /api/admin/apis-flags). Decisión del dueño 2026-09-28; dictamen
 * architect APROBADO CON CAMBIOS.
 *
 *   ia_flag_openrouter = 'false' → llmProveedor saca a OpenRouter de la
 *                                  cascada (la IA cae al pool Gemini).
 *   ia_flag_nvidia     = 'false' → nimCliente responde deshabilitado_por_admin
 *                                  (Formulador MGA "no disponible", sin respaldo).
 *   ia_flag_groq       = 'false' → llmProveedor saca a Groq del rol creador
 *                                  (Entrada IA/Árbol/MGA caen al paso siguiente).
 *
 * Reglas:
 * - Sin import estático de la BD: server.js inyecta { getRow, runSql } con
 *   configurarFlagsIA(). Sin configurar (tests, scripts) → todo habilitado y
 *   cero E/S.
 * - Solo el texto exacto 'false' deshabilita; clave ausente = habilitado.
 * - Lectura FAIL-OPEN: si la BD falla se conserva el último valor conocido
 *   (indefinidamente). Es seguro porque el gasto de OpenRouter ya falla
 *   cerrado en iaPresupuesto.reservar() sin BD verificable.
 * - Escritura FAIL-CLOSED: si no se puede persistir (o la relectura no
 *   coincide) lanza; nunca se responde "guardado" sin confirmar.
 * - app_settings en modo REST: WHERE key = ? por clave (sin IN ni ON CONFLICT,
 *   no soportados por la capa REST de database.config.js).
 */
import { logger } from '../utils/logger.js';

const CLAVES = { openrouter: 'ia_flag_openrouter', nvidia: 'ia_flag_nvidia', groq: 'ia_flag_groq' };
export const PROVEEDORES_CON_FLAG = Object.keys(CLAVES);
const TTL_MS = 15_000;
const LOG_ERROR_CADA_MS = 60_000;

let _deps = null;
let _cache = { openrouter: true, nvidia: true, groq: true };
let _leidoEn = 0;
let _enVuelo = null;
let _ultimoLogError = 0;

/** server.js lo llama al arrancar con las funciones reales de la BD. */
export function configurarFlagsIA(deps) {
  _deps = deps;
  _leidoEn = 0;
}

/** Lectura síncrona del último valor conocido (para estadoOpenRouter()). */
export function flagsIACacheados() {
  return { ..._cache };
}

async function refrescar() {
  // Una consulta por clave (la capa REST no soporta IN), en paralelo.
  const filas = await Promise.all(Object.values(CLAVES).map(clave =>
    _deps.getRow('SELECT value FROM app_settings WHERE key = ?', [clave])));
  _cache = Object.fromEntries(Object.keys(CLAVES).map((proveedor, i) => [proveedor, filas[i]?.value !== 'false']));
}

/** Valor vigente (caché de 15 s, una sola lectura en vuelo). */
export async function leerFlagsIA(ahora = Date.now()) {
  if (!_deps || ahora - _leidoEn < TTL_MS) return flagsIACacheados();
  if (!_enVuelo) {
    _enVuelo = refrescar()
      .catch((err) => {
        if (Date.now() - _ultimoLogError > LOG_ERROR_CADA_MS) {
          _ultimoLogError = Date.now();
          logger.error('[iaFlags] No se pudieron leer los interruptores de IA — se conserva el último valor', { err: err?.message });
        }
      })
      .finally(() => { _leidoEn = Date.now(); _enVuelo = null; });
  }
  await _enVuelo;
  return flagsIACacheados();
}

/**
 * Persiste un interruptor y lo relee antes de confirmarlo.
 * @throws si el proveedor no existe, la BD no está configurada o no se pudo persistir.
 */
export async function fijarFlagIA(proveedor, habilitado) {
  const clave = CLAVES[proveedor];
  if (!clave) throw new Error(`Proveedor sin interruptor: ${proveedor}`);
  if (!_deps) throw new Error('iaFlags sin configurar');
  const valor = habilitado ? 'true' : 'false';
  const ahoraIso = new Date().toISOString();
  const upd = await _deps.runSql('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?', [valor, ahoraIso, clave]);
  if ((upd?.rowCount ?? upd?.changes ?? 0) === 0) {
    // Placeholders para las 3 columnas (restInsert mapea por posición).
    await _deps.runSql('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', [clave, valor, ahoraIso]);
  }
  const fila = await _deps.getRow('SELECT value FROM app_settings WHERE key = ?', [clave]);
  if (fila?.value !== valor) throw new Error('El interruptor no quedó persistido');
  _cache = { ..._cache, [proveedor]: habilitado };
  _leidoEn = Date.now();
  return habilitado;
}

/** Solo para pruebas. */
export function _reiniciarFlagsIA() {
  _deps = null;
  _cache = { openrouter: true, nvidia: true, groq: true };
  _leidoEn = 0;
  _enVuelo = null;
  _ultimoLogError = 0;
}
