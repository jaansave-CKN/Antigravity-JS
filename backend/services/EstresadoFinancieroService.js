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
// FIX (005_INGENIERO_BACKEND, 2026-09-04): supabaseAdmin (service_role)
// bypaseaba RLS por completo — ver AuditorForenseService.js para el detalle
// completo del hallazgo/fix. withTenant() usa rf360_rls_scoped (migración
// 053_rls_scoped_role.sql), sin BYPASSRLS.
import { withTenant } from '../config/database.config.js';

const UMBRAL_CRITICO_PCT = 15;
const UMBRAL_RIESGO_PCT = UMBRAL_CRITICO_PCT / 2;

class EstresadoError extends Error {
  constructor(message) { super(message); this.status = 422; }
}

async function obtenerPresupuestoBase(projectId, orgId) {
  let rows;
  try {
    const res = await withTenant(orgId, client => client.query(
      'SELECT valor_total_cop FROM project_apu_lineas WHERE project_id = $1',
      [projectId]
    ));
    rows = res.rows;
  } catch (err) {
    throw new Error(`No se pudo leer el presupuesto base: ${err.message}`);
  }
  return (rows || []).reduce((sum, r) => sum + Number(r.valor_total_cop || 0), 0);
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

  const valorBase = await obtenerPresupuestoBase(projectId, orgId);
  if (valorBase === 0) {
    throw new EstresadoError('El proyecto no tiene líneas de presupuesto ingeridas (sube primero un presupuesto/APU marcado como "presupuesto_apu" en Anexos antes de simular un escenario de estrés).');
  }

  const impacto = valorBase * (porcentaje / 100);
  const valorNuevo = valorBase + impacto;
  const viabilidad = clasificarViabilidad(porcentaje);
  const observaciones = redactarObservaciones({ nombreEscenario, valorBase, valorNuevo, impacto, porcentaje, viabilidad });

  let data;
  try {
    const res = await withTenant(orgId, client => client.query(
      `INSERT INTO project_escenarios_estres
        (project_id, org_id, nombre_escenario, porcentaje_incremento_insumos, valor_base_cop, impacto_total_calculado_cop, viabilidad_resultado, observaciones_red_teaming)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [projectId, orgId, nombreEscenario, porcentaje, valorBase, impacto, viabilidad, observaciones]
    ));
    data = res.rows?.[0];
  } catch (err) {
    throw new Error(`No se pudo guardar el escenario de estrés: ${err.message}`);
  }

  if (viabilidad === 'CRITICO') {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_hallazgos
        (project_id, anexo_id, org_id, fase_phva, tipo, tipo_hallazgo, severidad, titulo, detalle, accion_recomendada, resuelto)
       VALUES ($1, NULL, $2, 'ACTUAR', 'ESTRES_FINANCIERO_CRITICO', 'ESTRES_FINANCIERO_CRITICO', 'CRITICA', $3, $4, $5, false)`,
      [
        projectId, orgId,
        `Riesgo financiero crítico bajo el escenario "${nombreEscenario}"`,
        observaciones,
        'Revisar el presupuesto de contingencia (AIU), negociar cláusulas de reajuste de precios, o ajustar el alcance del proyecto antes de radicar.',
      ]
    )).catch(() => {}); // fire-and-forget, mismo comportamiento previo (no bloqueaba el resultado principal)
  }

  return data;
}

export async function listarEscenarios(projectId, orgId) {
  try {
    const res = await withTenant(orgId, client => client.query(
      'SELECT * FROM project_escenarios_estres WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    ));
    return res.rows || [];
  } catch (err) {
    throw new Error(`No se pudieron listar los escenarios: ${err.message}`);
  }
}
