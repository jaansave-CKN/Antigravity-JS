/**
 * raciService.js — Matriz RACI (módulo nuevo, 2026-08-24, diseño revisado por
 * el subagente architect antes de escribir código, según exige CLAUDE.md).
 *
 * calcularResumenRaci() vive AQUÍ, no inline en la ruta ni duplicada en
 * pdfGenerator.js/FichaTecnicaPage.tsx — condición de diseño explícita del
 * architect: el mismo cálculo (¿qué tarea no tiene "A"?, ¿qué rol no tiene
 * ninguna asignación?) se reusa en 3 lugares (GET /raci/resumen, Ficha
 * Técnica, PDF) y reimplementarlo por separado en cada uno es exactamente el
 * patrón de bug "fuente desconectada" que ya se encontró 3 veces en este
 * proyecto el mismo día.
 */

/**
 * @param {string} proyectoId
 * @param {{ getRows: Function }} deps
 */
export async function calcularResumenRaci(proyectoId, { getRows }) {
  const tareas = await getRows(
    'SELECT id, nombre FROM raci_tareas WHERE proyecto_id = ? ORDER BY orden ASC, created_at ASC',
    [proyectoId]
  );
  const roles = await getRows(
    'SELECT id, nombre FROM raci_roles WHERE proyecto_id = ? ORDER BY orden ASC, created_at ASC',
    [proyectoId]
  );
  // JOIN contra raci_tareas para filtrar por proyecto_id — raci_asignaciones
  // no tiene columna propia de proyecto (por diseño, ver migración 046).
  const asignaciones = await getRows(
    `SELECT ra.tarea_id, ra.rol_id, ra.sigla
       FROM raci_asignaciones ra
       JOIN raci_tareas t ON t.id = ra.tarea_id
      WHERE t.proyecto_id = ?`,
    [proyectoId]
  );

  const siglasPorTarea = new Map(tareas.map(t => [t.id, []]));
  const conteoPorRol = new Map(roles.map(r => [r.id, 0]));
  for (const a of asignaciones) {
    siglasPorTarea.get(a.tarea_id)?.push(a.sigla);
    if (conteoPorRol.has(a.rol_id)) conteoPorRol.set(a.rol_id, conteoPorRol.get(a.rol_id) + 1);
  }

  const tareasSinA = tareas.filter(t => !(siglasPorTarea.get(t.id) || []).includes('A'));
  const tareasConMultiplesA = tareas.filter(t => (siglasPorTarea.get(t.id) || []).filter(s => s === 'A').length > 1);
  const tareasSinR = tareas.filter(t => !(siglasPorTarea.get(t.id) || []).includes('R'));
  const rolesSinAsignacion = roles.filter(r => (conteoPorRol.get(r.id) || 0) === 0);

  const celdasPosibles = tareas.length * roles.length;

  return {
    totalTareas: tareas.length,
    totalRoles: roles.length,
    totalAsignaciones: asignaciones.length,
    celdasPosibles,
    porcentajeCompletitud: celdasPosibles > 0 ? Math.round((asignaciones.length / celdasPosibles) * 100) : 0,
    tareasSinA: tareasSinA.map(t => ({ id: t.id, nombre: t.nombre })),
    tareasConMultiplesA: tareasConMultiplesA.map(t => ({ id: t.id, nombre: t.nombre })),
    tareasSinR: tareasSinR.map(t => ({ id: t.id, nombre: t.nombre })),
    rolesSinAsignacion: rolesSinAsignacion.map(r => ({ id: r.id, nombre: r.nombre })),
  };
}
