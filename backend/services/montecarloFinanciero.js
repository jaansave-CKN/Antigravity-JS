/**
 * montecarloFinanciero.js — F-06: simulación Montecarlo de VAN y TIR (COP).
 *
 * Decisión del dueño (2026-09-24): la inversión inicial sale del presupuesto
 * real del proyecto (project_apu_lineas, la misma fuente del punto de
 * equilibrio y del SROI — ver evaluacionFinanciera.routes.js); el usuario
 * da 3 valores del beneficio/ahorro anual (mínimo, probable, máximo) y el
 * horizonte en años; tasa social de descuento fija del 12%.
 *
 * Módulo PURO (sin BD ni red), determinista dado `semilla`: la misma entrada
 * con la misma semilla produce exactamente el mismo resultado — requisito de
 * auditoría (cualquiera puede re-ejecutar una corrida guardada y comprobarla).
 *
 * Supuesto declarado en la salida: el beneficio de CADA año se muestrea de
 * forma independiente de una distribución triangular(min, probable, max).
 * Ese supuesto reduce la dispersión relativa del VAN a medida que crece el
 * horizonte (los años "malos" y "buenos" se compensan) — por eso viaja
 * explícito en `supuesto`, no solo en este comentario.
 */

export const TASA_SOCIAL_DESCUENTO = 0.12;
export const ITERACIONES = 10000;      // fijo en servidor: el cálculo es síncrono
const MONTO_MAXIMO_COP = 1e15;
const BINS_HISTOGRAMA = 30;
const TIR_MIN = -0.99, TIR_MAX = 10;   // búsqueda de la TIR en (-99%, 1000%]

export class MontecarloError extends Error {
  constructor(message) { super(message); this.status = 422; this.code = 'MONTECARLO_ENTRADA_INVALIDA'; }
}

// PRNG mulberry32 — pequeño, rápido y reproducible con semilla de 32 bits.
function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Muestra de una triangular(a, c, b) por transformada inversa. a === b es un
// valor fijo (sin esto la fórmula divide por 0 y devuelve NaN).
function triangular(u, a, c, b) {
  if (b === a) return a;
  const fc = (c - a) / (b - a);
  return u < fc
    ? a + Math.sqrt(u * (b - a) * (c - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

// VAN de un flujo convencional [-inversion, b1..bn] a la tasa r.
function van(inversion, beneficios, r) {
  let total = -inversion, factor = 1;
  const d = 1 / (1 + r);
  for (let t = 0; t < beneficios.length; t++) { factor *= d; total += beneficios[t] * factor; }
  return total;
}

// TIR por bisección. Con -I en t=0 y beneficios >= 0, el VAN es estrictamente
// decreciente en r > -1, así que la raíz (si existe en el intervalo) es única.
// Devuelve null si no hay cambio de signo en [TIR_MIN, TIR_MAX].
export function tir(inversion, beneficios) {
  let lo = TIR_MIN, hi = TIR_MAX;
  let vLo = van(inversion, beneficios, lo);
  const vHi = van(inversion, beneficios, hi);
  if (!(vLo > 0 && vHi < 0)) return null;
  for (let i = 0; i < 100 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    const vMid = van(inversion, beneficios, mid);
    if (vMid > 0) { lo = mid; vLo = vMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// Percentil con interpolación lineal sobre un arreglo YA ordenado.
function percentil(ordenado, p) {
  if (!ordenado.length) return null;
  const idx = (ordenado.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (idx - lo);
}

const cop2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
const pct4 = (n) => (n === null || n === undefined ? null : Math.round(n * 10000) / 10000);

function validar({ inversionCop, beneficioMin, beneficioProbable, beneficioMax, horizonteAnios }) {
  const montos = { inversionCop, beneficioMin, beneficioProbable, beneficioMax };
  for (const [k, v] of Object.entries(montos)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new MontecarloError(`${k} debe ser un número finito en COP.`);
    if (v < 0) throw new MontecarloError(`${k} no puede ser negativo.`);
    if (v > MONTO_MAXIMO_COP) throw new MontecarloError(`${k} supera el máximo permitido (1.000 billones COP).`);
  }
  if (inversionCop <= 0) throw new MontecarloError('La inversión inicial debe ser mayor que 0.');
  if (!(beneficioMin <= beneficioProbable && beneficioProbable <= beneficioMax)) {
    throw new MontecarloError('Los beneficios deben cumplir mínimo ≤ probable ≤ máximo.');
  }
  if (!Number.isInteger(horizonteAnios) || horizonteAnios < 1 || horizonteAnios > 50) {
    throw new MontecarloError('El horizonte debe ser un número entero de años entre 1 y 50.');
  }
}

/**
 * @returns resultado serializable (se guarda tal cual en project_montecarlo_runs.resultado)
 */
export function simularVanTir({
  inversionCop, beneficioMin, beneficioProbable, beneficioMax, horizonteAnios,
  tasa = TASA_SOCIAL_DESCUENTO, iteraciones = ITERACIONES, semilla,
}) {
  validar({ inversionCop, beneficioMin, beneficioProbable, beneficioMax, horizonteAnios });
  if (!Number.isInteger(iteraciones) || iteraciones < 1 || iteraciones > ITERACIONES) {
    throw new MontecarloError(`iteraciones debe estar entre 1 y ${ITERACIONES}.`);
  }
  if (!Number.isInteger(semilla) || semilla < 0 || semilla > 0xFFFFFFFF) {
    throw new MontecarloError('semilla debe ser un entero de 32 bits sin signo.');
  }

  const rnd = mulberry32(semilla);
  const vans = new Float64Array(iteraciones);
  const tirs = [];
  let tirIndefinida = 0, vanPositivo = 0;
  const beneficios = new Float64Array(horizonteAnios);

  for (let i = 0; i < iteraciones; i++) {
    for (let t = 0; t < horizonteAnios; t++) beneficios[t] = triangular(rnd(), beneficioMin, beneficioProbable, beneficioMax);
    const v = van(inversionCop, beneficios, tasa);
    vans[i] = v;
    if (v > 0) vanPositivo++;
    const r = tir(inversionCop, beneficios);
    if (r === null) tirIndefinida++; else tirs.push(r);
  }

  const vansOrd = Float64Array.from(vans).sort();
  const tirsOrd = Float64Array.from(tirs).sort();
  let suma = 0;
  for (const v of vans) suma += v;

  // Histograma del VAN (bins iguales entre el mínimo y el máximo simulados).
  const vMin = vansOrd[0], vMax = vansOrd[vansOrd.length - 1];
  let histograma;
  if (vMax === vMin) {
    histograma = [{ desde: cop2(vMin), hasta: cop2(vMax), frecuencia: iteraciones }];
  } else {
    const ancho = (vMax - vMin) / BINS_HISTOGRAMA;
    const cuentas = new Array(BINS_HISTOGRAMA).fill(0);
    for (const v of vans) cuentas[Math.min(BINS_HISTOGRAMA - 1, Math.floor((v - vMin) / ancho))]++;
    histograma = cuentas.map((frecuencia, k) => ({ desde: cop2(vMin + k * ancho), hasta: cop2(vMin + (k + 1) * ancho), frecuencia }));
  }

  const beneficiosProbables = new Array(horizonteAnios).fill(beneficioProbable);

  return {
    moneda: 'COP',
    tasa_descuento: tasa,
    iteraciones,
    semilla,
    supuesto: 'beneficios_independientes_por_anio',
    distribucion: 'triangular',
    // Escenario determinista (beneficio = probable todos los años): NO es la
    // media simulada — se etiquetan por separado a propósito.
    van_escenario_probable_cop: cop2(van(inversionCop, beneficiosProbables, tasa)),
    tir_escenario_probable: pct4(tir(inversionCop, beneficiosProbables)),
    van: {
      media_cop: cop2(suma / iteraciones),
      p10_cop: cop2(percentil(vansOrd, 0.10)),
      p50_cop: cop2(percentil(vansOrd, 0.50)),
      p90_cop: cop2(percentil(vansOrd, 0.90)),
      min_cop: cop2(vMin),
      max_cop: cop2(vMax),
    },
    probabilidad_van_positivo: pct4(vanPositivo / iteraciones),
    tir: {
      p10: pct4(percentil(tirsOrd, 0.10)),
      p50: pct4(percentil(tirsOrd, 0.50)),
      p90: pct4(percentil(tirsOrd, 0.90)),
      iteraciones_sin_tir: tirIndefinida,
    },
    histograma_van: histograma,
  };
}
