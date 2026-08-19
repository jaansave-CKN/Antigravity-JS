/**
 * currencyFormat.ts — formateador único de Pesos Colombianos (COP).
 *
 * AXIOMA COP: todo formateo de moneda en pesos colombianos usa
 * Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP',
 * maximumFractionDigits: 0 }) — antes duplicado byte-a-byte en
 * PresupuestoPage.tsx, ViabilidadFinancieraPage.tsx y PlanesPage.tsx.
 * Centralizado 2026-08-17 (mandato de unificación DRY de moneda).
 *
 * NO reemplaza otros formateadores de este repo que sirven un propósito
 * distinto (no son duplicados de este mismo patrón):
 *   - Dashboard.tsx `formatMoney(amount, currency)` — soporta multi-moneda
 *     (USD/EUR/etc.), no solo COP.
 *   - LayoutPadre.tsx `fmtCOP`/`formatMonto` — formato COMPACTO en millones
 *     ("123 (MM)") para las tarjetas densas del Radar, no moneda completa.
 */
export const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatCOP(value: number): string {
  return cop.format(value);
}
