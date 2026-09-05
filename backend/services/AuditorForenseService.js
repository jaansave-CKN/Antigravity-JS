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
// FIX (005_INGENIERO_BACKEND, 2026-09-04): antes usaba supabaseAdmin
// (service_role vía REST, bypasea RLS por completo por diseño de Supabase)
// para leer/escribir project_hallazgos/project_apu_lineas — precisamente las
// tablas que sí tienen políticas RLS reales (026_rls_policies_tenant_
// isolation.sql) pero que nunca se evaluaban por esta vía. Ahora usa
// withTenant(orgId, ...), que abre una transacción sobre el rol
// rf360_rls_scoped (sin BYPASSRLS, migración 053_rls_scoped_role.sql) — RLS
// real, verificado en vivo (aislamiento cross-tenant confirmado por prueba
// directa). Mismo contrato de retorno que antes (boolean/count), cero cambio
// de comportamiento para los callers.
import { withTenant } from '../config/database.config.js';

const TOLERANCIA_COP = 50;
const CATEGORIAS_HSEQ = ['EPP', 'SST', 'SEÑALIZACION'];
const CATEGORIAS_SGC = ['SGC'];

async function limpiarHallazgosPrevios(projectId, anexoId, orgId) {
  await withTenant(orgId, client => client.query(
    'DELETE FROM project_hallazgos WHERE project_id = $1 AND anexo_id = $2 AND resuelto = false',
    [projectId, anexoId]
  ));
}

// Limpieza keyed por project_id + tipo (no por anexo_id, que aquí no aplica —
// es un hallazgo de PROYECTO, no de un anexo puntual). Sin esto, cada llamada
// a POST /viabilidad-financiera mientras el formulador ajusta cifras
// duplicaría filas en project_hallazgos — exigencia del Agente Arquitecto.
async function limpiarHallazgoViabilidadPrevio(projectId, orgId) {
  await withTenant(orgId, client => client.query(
    "DELETE FROM project_hallazgos WHERE project_id = $1 AND tipo = 'VIABILIDAD_FINANCIERA_SIN_PRESUPUESTO' AND resuelto = false",
    [projectId]
  ));
}

async function auditarHSEQ(projectId, anexoId, orgId, lineas) {
  const totalHSEQ = lineas
    .filter(l => CATEGORIAS_HSEQ.includes(l.categoria_hseq))
    .reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);
  if (totalHSEQ > 0) return false;

  try {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_hallazgos
        (project_id, anexo_id, org_id, fase_phva, tipo, tipo_hallazgo, severidad, titulo, detalle, accion_recomendada, resuelto)
       VALUES ($1, $2, $3, 'ACTUAR', 'HSEQ_AUSENTE', 'HSEQ_AUSENTE', 'CRITICA', $4, $5, $6, false)`,
      [
        projectId, anexoId, orgId,
        'Ausencia de partidas presupuestales para seguridad industrial (HSEQ/SST)',
        'Se analizó el 100% de las partidas del presupuesto/APU adjunto y no se identificaron asignaciones financieras en Pesos Colombianos destinadas a Elementos de Protección Personal (EPP), señalización preventiva o gestión de Seguridad y Salud en el Trabajo. Esta es una alerta técnica de coherencia presupuestal — no es una certificación legal ni cita normativa.',
        'Revisar con el equipo formulador si los costos de HSEQ fueron diluidos en el porcentaje de Administración (AIU), o si se requiere adjuntar el anexo técnico específico de Seguridad Industrial y Salud Ocupacional antes de radicar.',
      ]
    ));
    return true;
  } catch {
    return false;
  }
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

  try {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_hallazgos
        (project_id, anexo_id, org_id, fase_phva, tipo, tipo_hallazgo, severidad, titulo, detalle, accion_recomendada, resuelto)
       VALUES ($1, $2, $3, 'ACTUAR', 'SGC_AUSENTE', 'SGC_AUSENTE', 'ALTA', $4, $5, $6, false)`,
      [
        projectId, anexoId, orgId,
        'Ausencia de partidas presupuestales para control/aseguramiento de calidad (SGC)',
        'Se analizó el 100% de las partidas del presupuesto/APU adjunto y no se identificaron asignaciones financieras en Pesos Colombianos destinadas a control de calidad, ensayos de laboratorio o interventoría de calidad. Esta es una alerta técnica de coherencia presupuestal — no es una auditoría de cumplimiento contra ISO 9001 ni una certificación normativa.',
        'Revisar si los costos de aseguramiento de calidad fueron diluidos en el porcentaje de Administración (AIU), o si se requiere adjuntar el plan de calidad del proyecto antes de radicar.',
      ]
    ));
    return true;
  } catch {
    return false;
  }
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
      titulo: `Descuadre aritmético en "${(l.codigo_item || l.descripcion || '').slice(0, 60)}"`,
      detalle: `Cantidad (${l.cantidad}) × Valor Unitario ($${fmt(l.valor_unitario_cop)} COP) = $${fmt(esperado)} COP, pero el Valor Total registrado es $${fmt(l.valor_total_cop)} COP — diferencia de $${fmt(diferencia)} COP (tolerancia: $${TOLERANCIA_COP} COP).`,
    };
  });

  // INSERT multi-fila parametrizado ($1,$2,$3... por fila) — misma
  // transacción/rol RLS-escopado que el resto de este servicio.
  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const base = i * 6;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, 'VERIFICAR', 'DESCUADRE_FINANCIERO', 'DESCUADRE_FINANCIERO', 'ALTA', $${base + 4}, $${base + 5}, $${base + 6}, false)`);
    params.push(projectId, anexoId, orgId, r.titulo, r.detalle, 'Corregir la fórmula o el valor en el Excel de origen y volver a subir el presupuesto.');
  });

  try {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_hallazgos
        (project_id, anexo_id, org_id, fase_phva, tipo, tipo_hallazgo, severidad, titulo, detalle, accion_recomendada, resuelto)
       VALUES ${values.join(', ')}`,
      params
    ));
    return rows.length;
  } catch {
    return 0;
  }
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
  await limpiarHallazgoViabilidadPrevio(projectId, orgId);

  let count = 0;
  try {
    const res = await withTenant(orgId, client => client.query(
      'SELECT COUNT(*)::int AS cnt FROM project_apu_lineas WHERE project_id = $1',
      [projectId]
    ));
    count = res.rows?.[0]?.cnt ?? 0;
  } catch {
    return false; // no bloqueante — fallo de lectura no debe tumbar el cálculo de equilibrio
  }
  if (count > 0) return false; // sí hay presupuesto real ingerido — nada que reportar

  try {
    await withTenant(orgId, client => client.query(
      `INSERT INTO project_hallazgos
        (project_id, anexo_id, org_id, fase_phva, tipo, tipo_hallazgo, severidad, titulo, detalle, accion_recomendada, resuelto)
       VALUES ($1, NULL, $2, 'ACTUAR', 'VIABILIDAD_FINANCIERA_SIN_PRESUPUESTO', 'VIABILIDAD_FINANCIERA_SIN_PRESUPUESTO', 'ALTA', $3, $4, $5, false)`,
      [
        projectId, orgId,
        'Punto de equilibrio calculado sin presupuesto/APU real adjunto',
        'Se calculó el punto de equilibrio financiero pero el proyecto no tiene ningún presupuesto/APU ingerido en Anexos (project_apu_lineas vacío) — los costos variables totales fueron ingresados manualmente sin un documento real que los respalde.',
        'Adjuntar el presupuesto/APU real del proyecto en Anexos (categoría "presupuesto_apu", formato Excel) para que los costos variables se calculen automáticamente sobre datos verificables.',
      ]
    ));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ejecuta ambos motores de auditoría sobre las líneas de un anexo recién
 * ingerido. `lineas` son las filas ya insertadas por ExtractorService.js
 * (evita una relectura innecesaria a la base de datos).
 */
export async function ejecutarAuditoriaCompleta(projectId, anexoId, orgId, lineas) {
  await limpiarHallazgosPrevios(projectId, anexoId, orgId);
  const hallazgoHSEQ = await auditarHSEQ(projectId, anexoId, orgId, lineas);
  const hallazgoSGC = await auditarSGC(projectId, anexoId, orgId, lineas);
  const descuadresDetectados = await auditarDescuadres(projectId, anexoId, orgId, lineas);
  return { hallazgoHSEQ, hallazgoSGC, descuadresDetectados };
}
