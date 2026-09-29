/** Rango de monto de una convocatoria en su propia moneda (sin conversión). */
const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function formatoMonto(min?: number | null, max?: number | null, moneda?: string | null): string {
  const mon = moneda ? ` ${moneda}` : '';
  const a = Number(min) || 0;
  const b = Number(max) || 0;
  if (a > 0 && b > 0 && a !== b) return `${NUMERO.format(a)} – ${NUMERO.format(b)}${mon}`;
  if (b > 0) return `Hasta ${NUMERO.format(b)}${mon}`;
  if (a > 0) return `Desde ${NUMERO.format(a)}${mon}`;
  return 'Monto no especificado';
}
