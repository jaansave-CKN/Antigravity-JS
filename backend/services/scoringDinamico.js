/**
 * scoringDinamico.js — Cálculo real de las 5 dimensiones de impacto del
 * Dashboard Formulador (Ambiental / Social / Económico / Normativo / Operativo),
 * en reemplazo del mock estático `SECTIONS` de DashboardFormuladorPage.tsx.
 *
 * Todo el cálculo es determinista (sin IA) y se basa en datos reales ya
 * persistidos por otros módulos del sistema:
 *   - projects.audit_result        → scores de M9 (auditarFormulacion.js), si ya corrió
 *   - compliance_data (M10)        → sostenibilidad_ambiental/social, enfoque_genero
 *   - marco_normativo (M9)         → normas_aplicables, citas_bibliograficas
 *   - project_budgets (M4)         → completitud de items de presupuesto (APU)
 *   - project_indicators (013)     → indicadores MGA/BPIN estructurados
 *
 * Cada dimensión retorna { score: number|null, pendiente: boolean, fuente: string|null }.
 * pendiente=true (score=null) cuando ningún dato real está disponible todavía —
 * el frontend debe mostrar "Pendiente de cálculo", nunca inventar un número.
 */

function textCompleteness(text, minLen = 40) {
  const t = (text || '').trim();
  if (!t) return 0;
  const proportional = Math.min(60, Math.round((t.length / minLen) * 60));
  return Math.min(100, proportional + (t.length >= minLen ? 40 : 0));
}

function safeParseArray(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} proyectoId
 * @param {{ getRow: Function, getRows: Function }} db
 * @returns {Promise<object|null>} null si el proyecto no existe
 */
export async function calcularScoringDinamico(proyectoId, { getRow, getRows }) {
  // `projects` (inglés) es la tabla fantasma de la migración 003 — nunca
  // aplicada a la BD real y siempre vacía (ver hallazgo de la Fase de
  // migraciones). Esta consulta SIEMPRE devolvía null aquí, y por lo tanto
  // GET /api/proyectos/:id/scoring-dinamico SIEMPRE respondía 404 para
  // cualquier proyecto real. La tabla real es `proyectos`; no tiene columna
  // `audit_result` (ese dato de M9 tampoco llegó a persistirse ahí), pero
  // bajo Capa 2 REST el SELECT ignora la lista de columnas explícita — el
  // resto del código ya maneja `project.audit_result === undefined` con
  // gracia (auditScores queda {} y cada dimensión cae a su fuente real).
  const project = await getRow(
    'SELECT id, audit_result FROM proyectos WHERE id = ?',
    [proyectoId]
  );
  if (!project) return null;

  let auditScores = {};
  try {
    const ar = typeof project.audit_result === 'string'
      ? JSON.parse(project.audit_result || '{}')
      : (project.audit_result || {});
    auditScores = ar?.scores || {};
  } catch {
    auditScores = {};
  }

  const [compliance, normativo, budgetItems, indicators] = await Promise.all([
    getRow(
      'SELECT sostenibilidad_ambiental, sostenibilidad_social, enfoque_genero FROM compliance_data WHERE proyecto_id = ? LIMIT 1',
      [proyectoId]
    ).catch(() => null),
    getRow(
      'SELECT normas_aplicables, citas_bibliograficas FROM marco_normativo WHERE proyecto_id = ? LIMIT 1',
      [proyectoId]
    ).catch(() => null),
    getRows('SELECT valor_total FROM project_budgets WHERE proyecto_id = ?', [proyectoId]).catch(() => []),
    getRows('SELECT meta_total, fuente_verificacion FROM project_indicators WHERE project_id = ?', [proyectoId]).catch(() => []),
  ]);

  // ── Ambiental — compliance_data.sostenibilidad_ambiental (M10) ─────────────
  const ambiental = compliance?.sostenibilidad_ambiental?.trim()
    ? { score: textCompleteness(compliance.sostenibilidad_ambiental), pendiente: false, fuente: 'compliance_data.sostenibilidad_ambiental' }
    : { score: null, pendiente: true, fuente: null };

  // ── Social — compliance_data.sostenibilidad_social + enfoque_genero (M10) ──
  let social;
  if (compliance?.sostenibilidad_social?.trim()) {
    const base = textCompleteness(compliance.sostenibilidad_social);
    const generoBonus = compliance.enfoque_genero ? 10 : 0;
    social = { score: Math.min(100, base + generoBonus), pendiente: false, fuente: 'compliance_data.sostenibilidad_social' };
  } else {
    social = { score: null, pendiente: true, fuente: null };
  }

  // ── Económico — audit M9 > completitud de project_budgets (M4) ─────────────
  let economico;
  if (typeof auditScores.suficiencia_presupuesto === 'number') {
    economico = { score: Math.round(auditScores.suficiencia_presupuesto), pendiente: false, fuente: 'audit_result.scores.suficiencia_presupuesto' };
  } else if (budgetItems.length > 0) {
    const conValor = budgetItems.filter(b => Number(b.valor_total) > 0).length;
    economico = { score: Math.round((conValor / budgetItems.length) * 100), pendiente: false, fuente: 'project_budgets (completitud APU)' };
  } else {
    economico = { score: null, pendiente: true, fuente: null };
  }

  // ── Normativo — audit M9 > marco_normativo (M9) ─────────────────────────────
  let normativoResult;
  if (typeof auditScores.pertinencia_normativa === 'number') {
    normativoResult = { score: Math.round(auditScores.pertinencia_normativa), pendiente: false, fuente: 'audit_result.scores.pertinencia_normativa' };
  } else if (normativo) {
    const normas = safeParseArray(normativo.normas_aplicables);
    const citas  = safeParseArray(normativo.citas_bibliograficas);
    const score  = Math.min(100, normas.length * 15 + citas.length * 10);
    normativoResult = score > 0
      ? { score, pendiente: false, fuente: 'marco_normativo (normas + citas bibliográficas)' }
      : { score: null, pendiente: true, fuente: null };
  } else {
    normativoResult = { score: null, pendiente: true, fuente: null };
  }

  // ── Operativo — audit M9 (viabilidad_tecnica) > completitud de indicadores ──
  let operativo;
  if (typeof auditScores.viabilidad_tecnica === 'number') {
    operativo = { score: Math.round(auditScores.viabilidad_tecnica), pendiente: false, fuente: 'audit_result.scores.viabilidad_tecnica' };
  } else if (indicators.length > 0) {
    const completos = indicators.filter(i => Number(i.meta_total) > 0 && (i.fuente_verificacion || '').trim()).length;
    operativo = { score: Math.round((completos / indicators.length) * 100), pendiente: false, fuente: 'project_indicators (completitud MGA/BPIN)' };
  } else {
    operativo = { score: null, pendiente: true, fuente: null };
  }

  return {
    proyectoId,
    calculadoEn: new Date().toISOString(),
    dimensiones: { ambiental, social, economico, normativo: normativoResult, operativo },
  };
}
