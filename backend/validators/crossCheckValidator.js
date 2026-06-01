/**
 * F5-01 — Cross-Check Pipeline (Módulo 9)
 * Valida que la sumatoria de las fases presupuestales (Negra, Gris, Blanca)
 * coincida exactamente con la meta física declarada en la Ficha Técnica.
 * Discrepancia > $0.00 → CROSSCHECK_FAILED.
 */

function sumFase(items = []) {
  // Acepta tanto .valor (frontend directo) como .valor_total (calculado por apuEngine)
  return items.reduce((acc, item) => acc + (Number(item.valor_total ?? item.valor) || 0), 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{ metaFisicaTotal: number }} fichaTecnica  — datos del Módulo 3b
 * @param {{ fasesNegra: Array, fasesGris: Array, fasesBlanca: Array }} presupuesto — Módulo 4
 * @param {string} proyectoId
 * @returns {{ valid: boolean, code: string|null, discrepancy: number, detail: object }}
 */
export function runCrossCheck(fichaTecnica, presupuesto, proyectoId) {
  const metaDeclarada = round2(Number(fichaTecnica?.metaFisicaTotal) || 0);

  const totalNegra  = round2(sumFase(presupuesto?.fasesNegra));
  const totalGris   = round2(sumFase(presupuesto?.fasesGris));
  const totalBlanca = round2(sumFase(presupuesto?.fasesBlanca));
  const totalFases  = round2(totalNegra + totalGris + totalBlanca);

  const discrepancy = round2(totalFases - metaDeclarada);

  const detail = {
    proyectoId,
    metaFisicaDeclarada: metaDeclarada,
    totalFases,
    desglose: { fasesNegra: totalNegra, fasesGris: totalGris, fasesBlanca: totalBlanca },
    discrepancy,
    timestamp: new Date().toISOString(),
  };

  if (Math.abs(discrepancy) > 0) {
    console.error('[CROSSCHECK_FAILED]', JSON.stringify(detail));
    return { valid: false, code: 'CROSSCHECK_FAILED', discrepancy, detail };
  }

  return { valid: true, code: null, discrepancy: 0, detail };
}
