/**
 * fechasConvocatoria.js — fecha límite y estado de una convocatoria, UNA sola
 * implementación (antes calcEstado en EntityScraper.js y su copia calcEstadoR2
 * en DataIngestor.js; el importador de archivos era la tercera vía).
 */

/** 'cerrada' si la fecha límite (YYYY/MM/DD o YYYY-MM-DD) ya pasó; si no, 'abierta'. */
export function calcEstado(fechaLimite) {
  if (!fechaLimite) return 'abierta';
  // Normalizar separadores para comparación lexicográfica YYYY/MM/DD
  const norm = String(fechaLimite).trim().replace(/-/g, '/').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return norm < today ? 'cerrada' : 'abierta';
}

const aIso = (a, m, d) => {
  const f = new Date(Date.UTC(a, m - 1, d));
  // Rechaza fechas imposibles (31/02 se desbordaría a marzo).
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return '';
  return f.toISOString().slice(0, 10);
};

/**
 * Normaliza la fecha límite de un archivo importado a YYYY-MM-DD, o '' si no
 * se puede interpretar sin adivinar. Acepta: Date, serial de Excel (número),
 * ISO YYYY-MM-DD / YYYY/MM/DD y DD/MM/YYYY o DD-MM-YYYY (formato colombiano).
 */
export function normalizarFechaLimite(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? '' : valor.toISOString().slice(0, 10);
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    // Serial de Excel: días desde 1899-12-30 (rango razonable: 1990-2100).
    if (valor < 32874 || valor > 73051) return '';
    return new Date(Math.round((valor - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const s = String(valor ?? '').trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return aIso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return aIso(+m[3], +m[2], +m[1]);
  return '';
}
