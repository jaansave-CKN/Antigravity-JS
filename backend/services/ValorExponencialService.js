/**
 * ValorExponencialService.js — Sprint 4: SROI + mapeo ODS.
 *
 * IMPORTANTE (decisión deliberada tras auditoría): el ratio de conversión
 * SROI NO tiene un valor "estándar" fabricado — lo debe indicar el
 * formulador explícitamente (basado en sus propios estudios/lineamientos
 * DNP). Inventar un multiplicador aquí sería una alucinación financiera.
 *
 * empleos_persona_mes_estimados se calcula con el ÚNICO dato real y
 * verificable disponible: el SMMLV vigente (Decretos 1469/1470 de 2025,
 * SMMLV 2026 = $1.750.905 COP), aplicado sobre el costo de mano de obra
 * detectado heurísticamente en project_apu_lineas. Representa persona-mes
 * de empleo equivalente, no necesariamente empleos permanentes distintos —
 * se etiqueta así para no sobre-prometer.
 *
 * El mapeo ODS es una sugerencia heurística por palabras clave (igual
 * criterio que el etiquetado HSEQ) — no es una certificación oficial.
 */
import { supabaseAdmin } from '../config/supabase.config.js';

// Decretos 1469/1470 del 29 de diciembre de 2025 — actualizar cuando cambie el año.
export const SMMLV_2026_COP = 1750905;

class ValorExponencialError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

const MANO_OBRA_RULES = /mano de obra|cuadrilla|jornal|operario|oficial|ayudante|personal calificado/i;

const ODS_RULES = [
  { ods: 6,  meta: 'Agua limpia y saneamiento',                 regex: /acueducto|alcantarillado|agua potable|saneamiento b(a|á)sico|tuber(i|í)a|ptar/i },
  { ods: 8,  meta: 'Trabajo decente y crecimiento económico',   regex: MANO_OBRA_RULES },
  { ods: 9,  meta: 'Industria, innovación e infraestructura',   regex: /concreto|estructura|construcci(o|ó)n|infraestructura|pavimentaci(o|ó)n|v(i|í)a(l)?\b/i },
  { ods: 11, meta: 'Ciudades y comunidades sostenibles',        regex: /urbano|vivienda|espacio p(u|ú)blico|and(e|é)n|parque|equipamiento comunitario/i },
];

async function obtenerLineas(projectId) {
  const { data, error } = await supabaseAdmin
    .from('project_apu_lineas')
    .select('descripcion, valor_total_cop')
    .eq('project_id', projectId);
  if (error) throw new Error(`No se pudo leer el presupuesto: ${error.message}`);
  return data || [];
}

/**
 * Calcula el SROI con un ratio de conversión EXPLÍCITO (obligatorio, provisto
 * por el formulador) — nunca un valor por defecto inventado.
 */
export async function calcularSROI(projectId, orgId, { ratioConversion }) {
  const ratio = Number(ratioConversion);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new ValorExponencialError('ratioConversion es requerido y debe ser un número > 0 (indica cuántos COP de valor social se generan por cada COP invertido, según tus propios estudios/lineamientos).');
  }

  const lineas = await obtenerLineas(projectId);
  if (!lineas.length) {
    throw new ValorExponencialError('El proyecto no tiene líneas de presupuesto ingeridas — sube primero un presupuesto/APU en Anexos antes de calcular el SROI.');
  }

  const inversionTotal = lineas.reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);
  const costoManoObra = lineas
    .filter(l => MANO_OBRA_RULES.test(l.descripcion || ''))
    .reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);

  const valorSocialGenerado = inversionTotal * ratio;
  const empleosPersonaMes = Math.round(costoManoObra / SMMLV_2026_COP);

  const { data, error } = await supabaseAdmin.from('project_sroi_metrics').insert({
    project_id: projectId,
    org_id: orgId,
    inversion_total_cop: inversionTotal,
    ratio_conversion: ratio,
    valor_social_generado_cop: valorSocialGenerado,
    costo_mano_obra_detectado_cop: costoManoObra,
    smmlv_referencia_cop: SMMLV_2026_COP,
    empleos_persona_mes_estimados: empleosPersonaMes,
  }).select().single();
  if (error) throw new Error(`No se pudo guardar la métrica SROI: ${error.message}`);

  return data;
}

/**
 * Mapeo heurístico de partidas a ODS — sugerencia técnica, no certificación.
 * Idempotente: reemplaza el mapeo anterior del proyecto en cada corrida.
 */
export async function calcularMapeoODS(projectId, orgId) {
  const lineas = await obtenerLineas(projectId);
  if (!lineas.length) {
    throw new ValorExponencialError('El proyecto no tiene líneas de presupuesto ingeridas — sube primero un presupuesto/APU en Anexos.');
  }

  const inversionTotal = lineas.reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);

  await supabaseAdmin.from('project_ods_mapping').delete().eq('project_id', projectId);

  const filas = [];
  for (const regla of ODS_RULES) {
    const monto = lineas
      .filter(l => regla.regex.test(l.descripcion || ''))
      .reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);
    if (monto === 0) continue;
    filas.push({
      project_id: projectId,
      org_id: orgId,
      ods_numero: regla.ods,
      meta_asociada: regla.meta,
      monto_asociado_cop: monto,
      porcentaje_contribucion: inversionTotal > 0 ? Number(((monto / inversionTotal) * 100).toFixed(2)) : 0,
    });
  }

  if (!filas.length) return [];

  const { data, error } = await supabaseAdmin.from('project_ods_mapping').insert(filas).select();
  if (error) throw new Error(`No se pudo guardar el mapeo ODS: ${error.message}`);
  return data;
}

export async function obtenerImpactoSocial(projectId) {
  const [{ data: sroi }, { data: ods }] = await Promise.all([
    supabaseAdmin.from('project_sroi_metrics').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1),
    supabaseAdmin.from('project_ods_mapping').select('*').eq('project_id', projectId).order('ods_numero'),
  ]);
  return { sroi: sroi?.[0] || null, ods: ods || [] };
}
