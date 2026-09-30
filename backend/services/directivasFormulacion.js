/**
 * directivasFormulacion.js — Fase A de la directiva "Audit de Impacto
 * Integral" (dueño 2026-09-30; dictamen architect APROBADO CON CAMBIOS).
 *
 * Traduce los 5 ejes que el usuario elige en Entrada (Tipo de Proyecto,
 * Fuente de Financiación, Nivel, Metodologías, Formato del Financiador —
 * catálogos reales en client/src/components/entrada/entradaModelo.ts) a
 * exigencias concretas para las IAs creadoras y para el auditor. Antes esos
 * ejes se guardaban en ficha_tecnica.entrada_completa y ninguna IA los leía.
 *
 * PURO (sin BD ni red). Reglas de diseño:
 * - Compara contra las etiquetas REALES de la UI, normalizadas (sin tildes,
 *   minúsculas): la directiva pegada comparaba contra 'BANCA MULTILATERAL' y
 *   la UI guarda 'Banca multilateral' → la rama internacional nunca corría.
 * - Ningún porcentaje, tasa de cambio ni valor financiero vive aquí: el AIU,
 *   el presupuesto y el presupuesto de interventoría los aporta el usuario en
 *   su propio documento (decisión del dueño 2026-09-30). Las tasas fijas
 *   (4000/4400) y porcentajes (12/5/5, 70/30) de la directiva se rechazaron
 *   por ser datos inventados.
 * - 'sin_definir' y 'nacional' dejan los prompts EXACTAMENTE como estaban
 *   (regla COP de siempre): solo la elección explícita de un esquema
 *   internacional cambia la regla monetaria.
 */

export function normalizarEje(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const FUENTES_NACIONALES = new Set(['mga / sgr', 'app / oxi']);
const FUENTES_INTERNACIONALES = new Set(['subvencion internacional', 'banca multilateral']);
const FORMATO_INTERNACIONAL = 'onu / bid / ue';
const FORMATO_NACIONAL = 'mga web';

/**
 * @param {object} entrada ficha_tecnica.entrada_completa (EntradaState del frontend)
 * @returns {{
 *   vectores: { tipoProyecto: string, fuente: string, nivel: string, metodologias: string[], formato: string },
 *   esquema: 'nacional'|'internacional'|'sin_definir',
 *   conflictos: Array<{ tipo: string, detalle: string }>,
 *   exige: { teoriaCambio: boolean, mel: boolean, pmi: boolean, salvaguardas: boolean, saneamientoPredial: boolean },
 *   sectorAgua: boolean,
 * }}
 */
export function resolverDirectivas(entrada = {}) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const vectores = {
    tipoProyecto: String(e.enfoque ?? '').trim(),
    fuente: String(e.tipoConvocatoria ?? '').trim(),
    nivel: String(e.nivelProyecto ?? '').trim(),
    metodologias: Array.isArray(e.metodologias) ? e.metodologias.map(m => String(m).trim()).filter(Boolean) : [],
    formato: String(e.formatoFinanciador ?? '').trim(),
  };
  const fuente = normalizarEje(vectores.fuente);
  const formato = normalizarEje(vectores.formato);
  const metodologias = new Set(vectores.metodologias.map(normalizarEje));

  let esquema = 'sin_definir';
  if (FUENTES_NACIONALES.has(fuente)) esquema = 'nacional';
  else if (FUENTES_INTERNACIONALES.has(fuente)) esquema = 'internacional';
  else if (fuente === 'cofinanciacion') {
    // Cofinanciación puede ser nacional o de cooperación: solo el formato la
    // define. Con "Formato propio" o vacío queda sin_definir (architect, cond. 6).
    if (formato === FORMATO_INTERNACIONAL) esquema = 'internacional';
    else if (formato === FORMATO_NACIONAL) esquema = 'nacional';
  } else if (!fuente) {
    if (formato === FORMATO_INTERNACIONAL) esquema = 'internacional';
    else if (formato === FORMATO_NACIONAL) esquema = 'nacional';
  }

  const conflictos = [];
  if (FUENTES_NACIONALES.has(fuente) && formato === FORMATO_INTERNACIONAL) {
    conflictos.push({ tipo: 'fuente_nacional_formato_internacional', detalle: `La fuente "${vectores.fuente}" es de régimen nacional (COP) pero el formato elegido es "${vectores.formato}".` });
  }
  if (FUENTES_INTERNACIONALES.has(fuente) && formato === FORMATO_NACIONAL) {
    conflictos.push({ tipo: 'fuente_internacional_formato_nacional', detalle: `La fuente "${vectores.fuente}" es internacional pero el formato elegido es "${vectores.formato}" (MGA Web es del DNP).` });
  }

  const sectores = Array.isArray(e.sectores) ? e.sectores : [];
  const exige = {
    teoriaCambio: metodologias.has('teoria del cambio'),
    mel: metodologias.has('mel'),
    pmi: metodologias.has('pmi'),
    salvaguardas: metodologias.has('salvaguardas') || esquema === 'internacional',
    saneamientoPredial: normalizarEje(vectores.tipoProyecto) === 'infraestructura' && esquema === 'nacional',
  };
  return { vectores, esquema, conflictos, exige, sectorAgua: sectores.some(s => SECTORES_AGUA.has(normalizarEje(s))) };
}

// Opciones reales del grupo "Agua y Saneamiento" (entradaModelo.ts SECTORES_SUB).
const SECTORES_AGUA = new Set(['acueductos', 'sistema de potabilizacion', 'recoleccion de aguas lluvias', 'baterias sanitarias', 'alcantarillado', 'tratamiento de agua residual']);

// Literales EXACTOS de la regla COP en cada prompt de EntradaIAService.js
// (no son iguales entre sí: 'completa' trae la cláusula de conversión/ND).
export const REGLA_COP = Object.freeze({
  completa: 'Toda cifra de presupuesto, costo o viabilidad financiera debe expresarse EXCLUSIVAMENTE en Pesos Colombianos (COP) — prohibido usar o mencionar dólares u otra divisa. Si el material fuente trae una cifra en otra moneda, conviértela a COP solo si el material mismo da la tasa de conversión; si no la da, márcala como "ND (No Disponible en la investigación)" en vez de asumir una tasa.',
  corta: 'Toda cifra de presupuesto, costo o viabilidad financiera debe expresarse EXCLUSIVAMENTE en Pesos Colombianos (COP).',
});

const REGLA_INTERNACIONAL = 'El financiador elegido es internacional (subvención, banca multilateral u ONU/BID/UE): expresa cada cifra de presupuesto o costo en la moneda en que la trae el material o la convocatoria (USD, EUR o COP), declarando SIEMPRE la moneda junto al número. Nunca conviertas entre monedas salvo que el material dé la tasa y su fecha, y nunca asumas una tasa de cambio. Menciona costos directos, costos indirectos (overhead) o contrapartida local SOLO si el material los trae; si no, "ND (No Disponible en la investigación)".';

/**
 * Regla monetaria para un prompt. `variante` elige el literal COP de ese
 * prompt, para que nacional/sin_definir no cambien ni un byte.
 * @param {ReturnType<typeof resolverDirectivas>|null} d
 * @param {'completa'|'corta'} variante
 */
export function reglaMonetaria(d, variante = 'corta') {
  if (d?.esquema === 'internacional') return REGLA_INTERNACIONAL;
  return REGLA_COP[variante] ?? REGLA_COP.corta;
}

/** Regla MGA/DNP de redacción del problema (no es "la ausencia de la solución"). */
export const REGLA_PROBLEMA_MGA = 'Formula cada problema como una condición negativa MEDIBLE que sufre la población (ej. "El 80 % de las viviendas consume agua no apta para consumo humano"), NUNCA como la ausencia de la solución: prohibido redactarlo como "falta de…", "ausencia de…", "carencia de…" o "no existe/no hay" la obra, el servicio o el equipo.';

/** Bloque legible de los ejes y sus exigencias (Viabilidad y MIROFISH). */
export function bloqueVectores(d) {
  if (!d) return '';
  const v = d.vectores;
  const exigencias = [];
  if (d.esquema === 'nacional') exigencias.push('Régimen nacional: cifras exclusivamente en COP.');
  if (d.esquema === 'internacional') exigencias.push('Régimen internacional: presupuesto en la moneda del financiador, con costos directos, indirectos (overhead) y contrapartida identificables.');
  if (d.exige.teoriaCambio) exigencias.push('Teoría del Cambio: impacto de largo plazo → resultados intermedios → precondiciones → intervenciones, con supuestos críticos.');
  if (d.exige.mel) exigencias.push('Plan MEL: indicadores con línea base, meta, método de recolección, frecuencia y responsable.');
  if (d.exige.pmi) exigencias.push('PMI: EDT/WBS y registro de riesgos con probabilidad, impacto, respuesta y reserva de contingencia.');
  if (d.exige.salvaguardas) exigencias.push('Salvaguardas ambientales y sociales: categoría de riesgo (A/B/C) y medidas por impacto.');
  if (d.exige.saneamientoPredial) exigencias.push('Infraestructura nacional: soporte predial (propiedad o posesión acreditada) del predio a intervenir.');
  for (const c of d.conflictos) exigencias.push(`INCOHERENCIA DE EJES: ${c.detalle}`);
  return `VECTORES DEL FINANCIADOR (elegidos por el usuario en Entrada):
Tipo de proyecto: ${v.tipoProyecto || '(sin definir)'}
Fuente de financiación: ${v.fuente || '(sin definir)'}
Nivel del proyecto: ${v.nivel || '(sin definir)'}
Metodologías: ${v.metodologias.join('; ') || '(sin definir)'}
Formato del financiador: ${v.formato || '(sin definir)'}
Exigencias que se derivan:
${exigencias.length ? exigencias.map(x => `- ${x}`).join('\n') : '- (ninguna adicional)'}`;
}
