/**
 * datosMinimosIA.js — LOTE 10: verificación ex-ante de datos mínimos antes
 * de gastar cuota de Gemini. Los endpoints de MIROFISH y Viabilidad reciben
 * un body vacío y leen todo de la BD, así que la verificación se hace sobre
 * los datos YA recolectados del proyecto (no con Zod sobre el body).
 *
 * Criterio = lo que cada comité necesita para que su resultado signifique algo:
 *   MIROFISH   evalúa ubicación (reglas PDET) y líneas de presupuesto (rubro de
 *              seguridad, R1). Sin presupuesto, R1 declararía "falta seguridad"
 *              cuando en realidad falta TODO el presupuesto: hallazgo engañoso.
 *   Viabilidad evalúa proporcionalidad: problema frente a meta/población.
 *              Los anexos NO se exigen: su ausencia es un hallazgo legítimo del
 *              propio dictamen (respaldo_financiero_detectado: false).
 */

const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

/** @returns {Array<{campo: string, donde: string}>} */
export function faltantesMirofish({ datos = {}, lineasPresupuesto = [], ubicacion = [] }) {
  const faltan = [];
  if (vacio(datos['proyecto.nombre'])) faltan.push({ campo: 'proyecto.nombre', donde: 'Nombre del proyecto' });
  if (!ubicacion.some(u => !vacio(u.valor))) faltan.push({ campo: 'ubicacion', donde: 'Municipio del proyecto (Entrada o Logística)' });
  if (!lineasPresupuesto.length) faltan.push({ campo: 'presupuesto', donde: 'Líneas de presupuesto (APU en Anexos o módulo Presupuesto)' });
  return faltan;
}

/** @returns {Array<{campo: string, donde: string}>} */
export function faltantesViabilidad(ctx = {}) {
  const faltan = [];
  if (vacio(ctx.nombre)) faltan.push({ campo: 'nombre', donde: 'Nombre del proyecto' });
  if (vacio(ctx.problema)) faltan.push({ campo: 'problema', donde: 'Diagnóstico del problema (Contexto, sección A)' });
  if (vacio(ctx.metaEsperada) && vacio(ctx.poblacionAfectada) && vacio(ctx.coberturaGeografica)) {
    faltan.push({ campo: 'alcance', donde: 'Meta esperada (Contexto, sección C), número de beneficiarios o cobertura geográfica (Entrada)' });
  }
  return faltan;
}

/**
 * Formulador MGA (Fase 3): consolida lo que YA generaron los otros módulos, así
 * que exige que existan. `meta` viene de formuladorMga.recolectarFuentes().
 * Tipo de obra = sectores + nivelProyecto (decisión del dueño). Una corrida
 * Montecarlo calculada sobre otra inversión cuenta como faltante (B3).
 * @returns {Array<{campo: string, donde: string}>}
 */
export function faltantesFormulador(meta = {}) {
  const faltan = [];
  if (!meta.sectores) faltan.push({ campo: 'sectores', donde: 'Sectores del proyecto (Entrada)' });
  if (!meta.nivelProyecto) faltan.push({ campo: 'nivelProyecto', donde: 'Nivel del proyecto (Entrada)' });
  if (!meta.ubicacion) faltan.push({ campo: 'ubicacion', donde: 'Municipio del proyecto (Entrada o Logística)' });
  if (!meta.poblacion) faltan.push({ campo: 'poblacion', donde: 'Población beneficiaria (Entrada)' });
  if (!meta.viabilidad) faltan.push({ campo: 'viabilidad', donde: 'Dictamen de Viabilidad IA (pantalla Viabilidad)' });
  if (!meta.mirofish) faltan.push({ campo: 'mirofish', donde: 'Comité MIROFISH (pantalla Viabilidad)' });
  if (!meta.lineasApu) faltan.push({ campo: 'presupuesto', donde: 'Líneas de presupuesto (APU en Anexos)' });
  if (meta.corrida === 'ninguna') faltan.push({ campo: 'montecarlo', donde: 'Simulación Montecarlo (Evaluación Financiera)' });
  if (meta.corrida === 'obsoleta') faltan.push({ campo: 'montecarlo', donde: 'Simulación Montecarlo actualizada: el presupuesto cambió desde la última corrida (Evaluación Financiera)' });
  return faltan;
}

/** Cuerpo JSON del HTTP 422 — el mensaje ya es legible para mostrarlo tal cual en la UI. */
export function respuesta422(modulo, faltantes) {
  return {
    success: false,
    code: 'DATOS_MINIMOS_INSUFICIENTES',
    message: `No se ejecutó ${modulo} (sin gastar cuota de IA): faltan datos del proyecto — ${faltantes.map(f => f.donde).join('; ')}.`,
    faltantes,
  };
}
