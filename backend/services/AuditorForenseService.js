/**
 * AuditorForenseService.js — Motor VERIFICAR del ciclo PHVA (Sprint 2).
 *
 * Cruza las líneas ya insertadas en project_apu_lineas (por ExtractorService.js)
 * para detectar:
 *   1. Ausencia total de presupuesto HSEQ/SST/EPP/SEÑALIZACION — a nivel de
 *      anexo completo (no por fila: no existen filas EPP/SST que marcar
 *      cuando la ausencia es total).
 *   2. Descuadres aritméticos por fila (cantidad × valor_unitario ≠ valor_total,
 *      tolerancia $50 COP por redondeo).
 *
 * Los hallazgos son ALERTAS TÉCNICAS DE COHERENCIA — nunca dictámenes legales
 * ni citas normativas cerradas (Ley 80, NSR-10, etc.).
 *
 * Idempotente por anexo_id: limpia los hallazgos automáticos no resueltos de
 * una ejecución previa antes de re-evaluar, así si el usuario resube un Excel
 * corregido, las alertas viejas desaparecen solas.
 */
import { supabaseAdmin } from '../config/supabase.config.js';

const TOLERANCIA_COP = 50;
const CATEGORIAS_HSEQ = ['EPP', 'SST', 'SEÑALIZACION'];
const CATEGORIAS_SGC = ['SGC'];

async function limpiarHallazgosPrevios(projectId, anexoId) {
  await supabaseAdmin.from('project_hallazgos')
    .delete()
    .eq('project_id', projectId)
    .eq('anexo_id', anexoId)
    .eq('resuelto', false);
}

// Limpieza keyed por project_id + tipo (no por anexo_id, que aquí no aplica —
// es un hallazgo de PROYECTO, no de un anexo puntual). Sin esto, cada llamada
// a POST /viabilidad-financiera mientras el formulador ajusta cifras
// duplicaría filas en project_hallazgos — exigencia del Agente Arquitecto.
async function limpiarHallazgoViabilidadPrevio(projectId) {
  await supabaseAdmin.from('project_hallazgos')
    .delete()
    .eq('project_id', projectId)
    .eq('tipo', 'VIABILIDAD_FINANCIERA_SIN_PRESUPUESTO')
    .eq('resuelto', false);
}

async function auditarHSEQ(projectId, anexoId, orgId, lineas) {
  const totalHSEQ = lineas
    .filter(l => CATEGORIAS_HSEQ.includes(l.categoria_hseq))
    .reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);
  if (totalHSEQ > 0) return false;

  const { error } = await supabaseAdmin.from('project_hallazgos').insert({
    project_id: projectId,
    anexo_id: anexoId,
    org_id: orgId,
    fase_phva: 'ACTUAR',
    tipo: 'HSEQ_AUSENTE',
    tipo_hallazgo: 'HSEQ_AUSENTE',
    severidad: 'CRITICA',
    titulo: 'Ausencia de partidas presupuestales para seguridad industrial (HSEQ/SST)',
    detalle: 'Se analizó el 100% de las partidas del presupuesto/APU adjunto y no se identificaron asignaciones financieras en Pesos Colombianos destinadas a Elementos de Protección Personal (EPP), señalización preventiva o gestión de Seguridad y Salud en el Trabajo. Esta es una alerta técnica de coherencia presupuestal — no es una certificación legal ni cita normativa.',
    accion_recomendada: 'Revisar con el equipo formulador si los costos de HSEQ fueron diluidos en el porcentaje de Administración (AIU), o si se requiere adjuntar el anexo técnico específico de Seguridad Industrial y Salud Ocupacional antes de radicar.',
    resuelto: false,
  });
  return !error;
}

/**
 * Detección de ausencia de partidas de Sistema de Gestión de Calidad
 * (control de calidad, ensayos de laboratorio, interventoría de calidad).
 * Mismo patrón que auditarHSEQ(): alerta de coherencia presupuestal, NUNCA
 * una certificación de cumplimiento contra ISO 9001 — no evaluamos procesos,
 * documentación ni auditorías internas, solo si hay o no plata asignada a
 * la categoría. El proyecto sigue fluyendo con esta alerta activa.
 */
async function auditarSGC(projectId, anexoId, orgId, lineas) {
  const totalSGC = lineas
    .filter(l => CATEGORIAS_SGC.includes(l.categoria_hseq))
    .reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);
  if (totalSGC > 0) return false;

  const { error } = await supabaseAdmin.from('project_hallazgos').insert({
    project_id: projectId,
    anexo_id: anexoId,
    org_id: orgId,
    fase_phva: 'ACTUAR',
    tipo: 'SGC_AUSENTE',
    tipo_hallazgo: 'SGC_AUSENTE',
    severidad: 'ALTA',
    titulo: 'Ausencia de partidas presupuestales para control/aseguramiento de calidad (SGC)',
    detalle: 'Se analizó el 100% de las partidas del presupuesto/APU adjunto y no se identificaron asignaciones financieras en Pesos Colombianos destinadas a control de calidad, ensayos de laboratorio o interventoría de calidad. Esta es una alerta técnica de coherencia presupuestal — no es una auditoría de cumplimiento contra ISO 9001 ni una certificación normativa.',
    accion_recomendada: 'Revisar si los costos de aseguramiento de calidad fueron diluidos en el porcentaje de Administración (AIU), o si se requiere adjuntar el plan de calidad del proyecto antes de radicar.',
    resuelto: false,
  });
  return !error;
}

async function auditarDescuadres(projectId, anexoId, orgId, lineas) {
  const fmt = n => Number(n || 0).toLocaleString('es-CO');
  const descuadres = lineas.filter(l => {
    const esperado = Number(l.cantidad) * Number(l.valor_unitario_cop);
    return Math.abs(esperado - Number(l.valor_total_cop)) > TOLERANCIA_COP;
  });
  if (!descuadres.length) return 0;

  const rows = descuadres.map(l => {
    const esperado = Number(l.cantidad) * Number(l.valor_unitario_cop);
    const diferencia = Math.abs(esperado - Number(l.valor_total_cop));
    return {
      project_id: projectId,
      anexo_id: anexoId,
      org_id: orgId,
      fase_phva: 'VERIFICAR',
      tipo: 'DESCUADRE_FINANCIERO',
      tipo_hallazgo: 'DESCUADRE_FINANCIERO',
      severidad: 'ALTA',
      titulo: `Descuadre aritmético en "${(l.codigo_item || l.descripcion || '').slice(0, 60)}"`,
      detalle: `Cantidad (${l.cantidad}) × Valor Unitario ($${fmt(l.valor_unitario_cop)} COP) = $${fmt(esperado)} COP, pero el Valor Total registrado es $${fmt(l.valor_total_cop)} COP — diferencia de $${fmt(diferencia)} COP (tolerancia: $${TOLERANCIA_COP} COP).`,
      accion_recomendada: 'Corregir la fórmula o el valor en el Excel de origen y volver a subir el presupuesto.',
      resuelto: false,
    };
  });

  const { error } = await supabaseAdmin.from('project_hallazgos').insert(rows);
  return error ? 0 : rows.length;
}

/**
 * Bandera Roja: el punto de equilibrio (viabilidadAgent.calcularPuntoEquilibrio)
 * se calculó sin que exista NINGÚN presupuesto/APU real ingerido en Anexos
 * (project_apu_lineas vacío para este proyecto) — es decir, costos_variables_
 * totales fue tecleado manualmente sin ningún documento real que lo respalde.
 * Idempotente por project_id+tipo (ver limpiarHallazgoViabilidadPrevio) —
 * seguro de llamar en cada POST /api/proyectos/:id/viabilidad-financiera.
 */
export async function auditarViabilidadFinancieraIncompleta(projectId, orgId) {
  await limpiarHallazgoViabilidadPrevio(projectId);

  const { count, error: countError } = await supabaseAdmin
    .from('project_apu_lineas')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  if (countError) return false; // no bloqueante — fallo de lectura no debe tumbar el cálculo de equilibrio
  if (count > 0) return false;  // sí hay presupuesto real ingerido — nada que reportar

  const { error } = await supabaseAdmin.from('project_hallazgos').insert({
    project_id: projectId,
    anexo_id: null,
    org_id: orgId,
    fase_phva: 'ACTUAR',
    tipo: 'VIABILIDAD_FINANCIERA_SIN_PRESUPUESTO',
    tipo_hallazgo: 'VIABILIDAD_FINANCIERA_SIN_PRESUPUESTO',
    severidad: 'ALTA',
    titulo: 'Punto de equilibrio calculado sin presupuesto/APU real adjunto',
    detalle: 'Se calculó el punto de equilibrio financiero pero el proyecto no tiene ningún presupuesto/APU ingerido en Anexos (project_apu_lineas vacío) — los costos variables totales fueron ingresados manualmente sin un documento real que los respalde.',
    accion_recomendada: 'Adjuntar el presupuesto/APU real del proyecto en Anexos (categoría "presupuesto_apu", formato Excel) para que los costos variables se calculen automáticamente sobre datos verificables.',
    resuelto: false,
  });
  return !error;
}

/**
 * Ejecuta ambos motores de auditoría sobre las líneas de un anexo recién
 * ingerido. `lineas` son las filas ya insertadas por ExtractorService.js
 * (evita una relectura innecesaria a la base de datos).
 */
export async function ejecutarAuditoriaCompleta(projectId, anexoId, orgId, lineas) {
  await limpiarHallazgosPrevios(projectId, anexoId);
  const hallazgoHSEQ = await auditarHSEQ(projectId, anexoId, orgId, lineas);
  const hallazgoSGC = await auditarSGC(projectId, anexoId, orgId, lineas);
  const descuadresDetectados = await auditarDescuadres(projectId, anexoId, orgId, lineas);
  return { hallazgoHSEQ, hallazgoSGC, descuadresDetectados };
}
