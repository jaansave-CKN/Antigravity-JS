/**
 * montos.js — parser ÚNICO de montos de convocatorias (higiene de datos,
 * 2026-09-29; dictamen architect condiciones B y C1). Lo usan
 * EntityScraper.js, DataIngestor.js, el enriquecedor de montos de server.js y
 * backend/scripts/sanearCatalogo.mjs — antes había dos copias del mismo regex
 * con los mismos defectos, y en producción quedaron 191 montos absurdos:
 *   - "30 millones de pesos" → 30 COP (no conocía "millones");
 *   - "$ 45.249.000" → 45,249 (trataba el punto de miles como decimal);
 *   - "$" siempre USD, también en sitios colombianos;
 *   - años (2026) leídos como monto.
 *
 * extraerMonto() NO decide la moneda de un "$" suelto: devuelve ambigua=true y
 * la moneda final se resuelve donde ya se conoce el país (resolverMoneda),
 * ANTES de evaluar montoPlausible (un "$ 50.000.000" colombiano leído como USD
 * pasaría como válido).
 */

const SUFIJO = String.raw`(mil\s+millones|millones|mill[oó]n|millions?|billions?|billones|bill[oó]n|mil|MM|M|B|K)`;
const MONEDA = String.raw`(USD|EUR|COP|GBP|CAD|US\$|\$|€|£)`;
const PALABRA_MONEDA = String.raw`(USD|EUR|COP|GBP|CAD|d[oó]lares?|dollars?|euros?|pesos?|libras?)`;
const NUMERO = String.raw`(\d[\d.,\s]*\d|\d)`;

// 1) símbolo/código antes del número; 2) número (+sufijo) antes del código o palabra.
const MONTO_RE = new RegExp(
  String.raw`${MONEDA}\s*${NUMERO}(?:\s*${SUFIJO}\b)?(?:\s*(?:de\s+)?${PALABRA_MONEDA})?` +
  String.raw`|${NUMERO}(?:\s*${SUFIJO}\b)?\s+(?:de\s+)?${PALABRA_MONEDA}\b`,
  'i',
);

/** "1.000.000" "1,000,000" "45.249" "2,5" "1.5" "50 000" → número. */
export function parsearNumero(crudo) {
  let s = String(crudo ?? '').replace(/\s+/g, '');
  if (!s) return NaN;
  const puntos = (s.match(/\./g) || []).length;
  const comas = (s.match(/,/g) || []).length;
  if (puntos && comas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    s = s.split(miles).join('').replace(decimal, '.');
  } else if (puntos || comas) {
    const sep = puntos ? '.' : ',';
    const partes = s.split(sep);
    // Varias apariciones, o exactamente 3 dígitos tras la única → separador de miles.
    const esMiles = partes.length > 2 || partes[partes.length - 1].length === 3;
    s = esMiles ? partes.join('') : partes.join('.');
  }
  return Number(s);
}

export function multiplicador(sufijo) {
  const s = String(sufijo || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return 1;
  if (s === 'mil millones' || s.startsWith('billion') || s === 'b') return 1e9;
  if (s === 'billones' || s === 'billón' || s === 'billon') return 1e12;
  if (s.startsWith('mill') || s === 'mm' || s === 'm') return 1e6;
  if (s === 'mil' || s === 'k') return 1e3;
  return 1;
}

function monedaDe(simbolo, palabra) {
  const t = `${simbolo || ''} ${palabra || ''}`.toLowerCase();
  if (/eur|€/.test(t)) return { moneda: 'EUR', ambigua: false };
  if (/gbp|£|libra/.test(t)) return { moneda: 'GBP', ambigua: false };
  if (/cop|peso/.test(t)) return { moneda: 'COP', ambigua: false };
  if (/cad/.test(t)) return { moneda: 'CAD', ambigua: false };
  if (/usd|us\$|d[oó]lar|dollar/.test(t)) return { moneda: 'USD', ambigua: false };
  return { moneda: 'USD', ambigua: true }; // "$" suelto: se resuelve con el país
}

/** Primer monto del texto → { valor, moneda, ambigua } o null. No aplica plausibilidad. */
export function extraerMonto(texto) {
  if (!texto || texto.length < 3) return null;
  const m = String(texto).match(MONTO_RE);
  if (!m) return null;
  const [, sim1, num1, suf1, pal1, num2, suf2, pal2] = m;
  const numero = parsearNumero(num1 ?? num2);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  const { moneda, ambigua } = num1 !== undefined ? monedaDe(sim1, pal1) : monedaDe('', pal2);
  return { valor: Math.round(numero * multiplicador(suf1 ?? suf2)), moneda, ambigua };
}

/** Moneda final: un "$" ambiguo en un contexto colombiano es COP. */
export function resolverMoneda(info, pais) {
  if (!info) return '';
  return info.ambigua && /colombia/i.test(String(pais || '')) ? 'COP' : info.moneda;
}

const PISO = { COP: 1_000_000 };
const PISO_GENERAL = 1_000;
const TECHO = 1e13;

/** false para montos imposibles: bajo el piso de su moneda, años sueltos o > 1e13. */
export function montoPlausible(valor, moneda) {
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0 || v > TECHO) return false;
  if (Number.isInteger(v) && v >= 2000 && v <= 2035) return false;
  return v >= (PISO[String(moneda || '').toUpperCase()] ?? PISO_GENERAL);
}

/** Monto listo para guardar: el valor si es plausible, 0 ("Monto no especificado") si no. */
export function montoParaGuardar(valor, moneda) {
  return montoPlausible(valor, moneda) ? Math.round(Number(valor)) : 0;
}
