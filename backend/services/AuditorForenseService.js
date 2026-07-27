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

async function limpiarHallazgosPrevios(projectId, anexoId) {
  await supabaseAdmin.from('project_hallazgos')
    .delete()
    .eq('project_id', projectId)
    .eq('anexo_id', anexoId)
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
 * Ejecuta ambos motores de auditoría sobre las líneas de un anexo recién
 * ingerido. `lineas` son las filas ya insertadas por ExtractorService.js
 * (evita una relectura innecesaria a la base de datos).
 */
export async function ejecutarAuditoriaCompleta(projectId, anexoId, orgId, lineas) {
  await limpiarHallazgosPrevios(projectId, anexoId);
  const hallazgoHSEQ = await auditarHSEQ(projectId, anexoId, orgId, lineas);
  const descuadresDetectados = await auditarDescuadres(projectId, anexoId, orgId, lineas);
  return { hallazgoHSEQ, descuadresDetectados };
}
