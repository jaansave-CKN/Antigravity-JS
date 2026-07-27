/**
 * EstresadoFinancieroService.js — Simulador de resiliencia macroeconómica
 * (Sprint 3, capa ACTUAR/VERIFICAR del ciclo PHVA).
 *
 * Toma el presupuesto real ya ingerido en project_apu_lineas (Sprint 1),
 * aplica un incremento porcentual simulado (alza de SMMLV, inflación,
 * insumos) y evalúa si el proyecto resiste el choque financiero.
 *
 * El "Red Teaming" es un reporte DETERMINÍSTICO redactado a partir de las
 * cifras reales calculadas — no es una narrativa generada por un modelo de
 * IA (esa sería una integración aparte con el agente de viabilidad/Gemini
 * ya existente en el proyecto).
 */
import { supabaseAdmin } from '../config/supabase.config.js';

const UMBRAL_CRITICO_PCT = 15;
const UMBRAL_RIESGO_PCT = UMBRAL_CRITICO_PCT / 2;

class EstresadoError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

async function obtenerPresupuestoBase(projectId) {
  const { data, error } = await supabaseAdmin
    .from('project_apu_lineas')
    .select('valor_total_cop')
    .eq('project_id', projectId);
  if (error) throw new Error(`No se pudo leer el presupuesto base: ${error.message}`);
  return (data || []).reduce((sum, r) => sum + Number(r.valor_total_cop || 0), 0);
}

function clasificarViabilidad(porcentajeSobrecosto) {
  if (porcentajeSobrecosto >= UMBRAL_CRITICO_PCT) return 'CRITICO';
  if (porcentajeSobrecosto >= UMBRAL_RIESGO_PCT) return 'EN RIESGO';
  return 'VIABLE';
}

function redactarObservaciones({ nombreEscenario, valorBase, valorNuevo, impacto, porcentaje, viabilidad }) {
  const fmt = n => Number(n).toLocaleString('es-CO');
  const base = `Escenario "${nombreEscenario}": el presupuesto base de $${fmt(valorBase)} COP pasaría a $${fmt(valorNuevo)} COP bajo un incremento simulado del ${porcentaje}% en insumos/mano de obra — un sobrecosto de $${fmt(impacto)} COP.`;
  const veredictos = {
    VIABLE: 'El proyecto absorbe este choque sin comprometer la viabilidad financiera declarada.',
    'EN RIESGO': 'El sobrecosto es significativo — revisar el margen de contingencia (AIU) y las cláusulas de reajuste de precios antes de radicar.',
    CRITICO: 'El sobrecosto supera el umbral crítico (15% del presupuesto base) — el proyecto, tal como está formulado, no resistiría este escenario sin una fuente adicional de financiación o un rediseño del alcance.',
  };
  return `${base} ${veredictos[viabilidad]}`;
}

/**
 * Simula un escenario de estrés macroeconómico sobre el presupuesto real
 * de un proyecto y guarda el resultado. Si la viabilidad resulta CRITICO,
 * registra además un hallazgo en project_hallazgos (fase ACTUAR).
 */
export async function simularEscenario(projectId, orgId, { nombreEscenario, porcentajeIncremento }) {
  if (!nombreEscenario?.trim()) throw new EstresadoError('nombreEscenario es requerido');
  const porcentaje = Number(porcentajeIncremento);
  if (!Number.isFinite(porcentaje) || porcentaje < 0) {
    throw new EstresadoError('porcentajeIncremento debe ser un número >= 0');
  }

  const valorBase = await obtenerPresupuestoBase(projectId);
  if (valorBase === 0) {
    throw new EstresadoError('El proyecto no tiene líneas de presupuesto ingeridas (sube primero un presupuesto/APU marcado como "presupuesto_apu" en Anexos antes de simular un escenario de estrés).');
  }

  const impacto = valorBase * (porcentaje / 100);
  const valorNuevo = valorBase + impacto;
  const viabilidad = clasificarViabilidad(porcentaje);
  const observaciones = redactarObservaciones({ nombreEscenario, valorBase, valorNuevo, impacto, porcentaje, viabilidad });

  const { data, error } = await supabaseAdmin.from('project_escenarios_estres').insert({
    project_id: projectId,
    org_id: orgId,
    nombre_escenario: nombreEscenario,
    porcentaje_incremento_insumos: porcentaje,
    valor_base_cop: valorBase,
    impacto_total_calculado_cop: impacto,
    viabilidad_resultado: viabilidad,
    observaciones_red_teaming: observaciones,
  }).select().single();
  if (error) throw new Error(`No se pudo guardar el escenario de estrés: ${error.message}`);

  if (viabilidad === 'CRITICO') {
    await supabaseAdmin.from('project_hallazgos').insert({
      project_id: projectId,
      anexo_id: null,
      org_id: orgId,
      fase_phva: 'ACTUAR',
      tipo: 'ESTRES_FINANCIERO_CRITICO',
      tipo_hallazgo: 'ESTRES_FINANCIERO_CRITICO',
      severidad: 'CRITICA',
      titulo: `Riesgo financiero crítico bajo el escenario "${nombreEscenario}"`,
      detalle: observaciones,
      accion_recomendada: 'Revisar el presupuesto de contingencia (AIU), negociar cláusulas de reajuste de precios, o ajustar el alcance del proyecto antes de radicar.',
      resuelto: false,
    });
  }

  return data;
}

export async function listarEscenarios(projectId) {
  const { data, error } = await supabaseAdmin
    .from('project_escenarios_estres')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`No se pudieron listar los escenarios: ${error.message}`);
  return data || [];
}
