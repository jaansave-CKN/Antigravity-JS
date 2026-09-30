/**
 * auditoriaVectores.js — Fase B de la directiva "Audit de Impacto Integral"
 * (dueño 2026-09-30; dictamen architect APROBADO CON CAMBIOS): pruebas
 * DETERMINISTAS del "auditor red team" según los ejes del financiador.
 *
 * Se integran como reglas V0–V6 del Comité MIROFISH (mismo formato de
 * hallazgo que mirofishReglas.js → la UI de Viabilidad ya las pinta como
 * "Regla Vn", sin cambio visual). Se combinan en la RUTA, nunca dentro de
 * evaluarReglas (tests de R1–R3 intactos).
 *
 * PURO (sin BD ni red). Honestidad de las reglas por anexo: buscan en el
 * NOMBRE y la DESCRIPCIÓN de los anexos — el detalle dice "no se detectó",
 * nunca "no existe" (un documento mal nombrado es un falso positivo posible).
 *
 * Citas normativas de V6 verificadas el 2026-09-30 en fuentes oficiales:
 * - Ley 1551 de 2012, art. 48 (sana posesión), modificado por la Ley 2140 de
 *   2021: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=48267
 *   y https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=168386
 * - Res. 0661 de 2019 MinVivienda (viabilización de proyectos de agua y
 *   saneamiento; DEROGÓ la Res. 1063 de 2016 que citaba la directiva):
 *   https://www.minvivienda.gov.co/normativa/resolucion-0661-2019-0
 */
import { normalizar } from './mirofishReglas.js';
import { calcularVigencia } from './vigenciaDocumental.js';

const sinTildesMayus = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Moneda extranjera (sobre texto sin tildes y en mayúsculas, conservando símbolos).
const MONEDA_EXTRANJERA = /(US\$|U\$S|€)|\b(USD|EUR|EUROS?|DOLAR(ES)?)\b/;
// Problema redactado como ausencia de la solución (regla MGA/DNP).
export const PROBLEMA_COMO_AUSENCIA = /\b(FALTA DE|AUSENCIA DE|CARENCIA DE|INEXISTENCIA DE|NO EXISTE|NO EXISTEN|NO HAY|NO CUENTA CON|NO CUENTAN CON)\b/;

const ANEXO_TOC = /\b(TEORIA DEL CAMBIO|THEORY OF CHANGE)\b/;
const ANEXO_MEL = /\b(MEL|MONITOREO|SEGUIMIENTO Y EVALUACION|MONITORING)\b/;
const ANEXO_PMI = /\b(RIESGOS?|RISKS?|WBS|EDT)\b/;
const ANEXO_SALVAGUARDAS = /\b(SALVAGUARDAS?|SAFEGUARDS?|AMBIENTAL Y SOCIAL|PGAS|PLAN DE MANEJO AMBIENTAL)\b/;
// ESS con límite de palabra y SIN insensibilidad a mayúsculas: "process",
// "access" o "business" no cuentan (architect, cond. 7).
const ANEXO_ESS = /\bESS ?(?:10|[1-9])?\b/;
// Fase E (2026-09-30).
const ANEXO_HSEQ = /\b(HSEQ|ISO ?9001|ISO ?14001|ISO ?45001|SST|SG SST|PLAN DE MANEJO AMBIENTAL|PMA|PLAN DE CALIDAD)\b/;
const ANEXO_MARCO_LOGICO = /\b(MARCO LOGICO|MATRIZ DE MARCO|MML|ARBOL DE PROBLEMAS)\b/;
const ANEXO_OYM = /\b(OPERACION Y MANTENIMIENTO|O M|SOSTENIBILIDAD|PLAN DE MANTENIMIENTO)\b/;
const ANEXO_PREDIAL = /\b(LIBERTAD Y TRADICION|SANA POSESION|POSESION|ESCRITURA|COMODATO)\b/;

const textoAnexo = (a) => `${a?.nombre_archivo ?? ''} ${a?.descripcion ?? ''}`;

/** Referencia normativa del soporte predial (verificada, ver cabecera). */
export function referenciaPredial(sectorAgua) {
  return `Ley 1551 de 2012, art. 48 (modificado por la Ley 2140 de 2021: basta acreditar la posesión y la destinación al uso público)${sectorAgua ? '; para agua y saneamiento, Res. 0661 de 2019 de MinVivienda' : ''}`;
}

/**
 * Soporte predial entre los anexos: certificado de libertad y tradición
 * (tipo_vigencia) o documento de posesión/escritura/comodato por nombre.
 * @returns {{ anexo: string|null, vencido: boolean }} vencido = solo hay certificados de libertad y tradición vencidos
 */
export function soportePredial(anexos, hoy) {
  const libertad = anexos.filter(a => a?.tipo_vigencia === 'libertad_tradicion');
  const otros = anexos.filter(a => a?.tipo_vigencia !== 'libertad_tradicion' && ANEXO_PREDIAL.test(normalizar(textoAnexo(a))));
  const vigente = libertad.find(a => calcularVigencia(a, hoy).estado !== 'vencido');
  const elegido = otros[0] || vigente || libertad[0] || null;
  return { anexo: elegido ? (elegido.nombre_archivo || elegido.descripcion || 'Documento sin título') : null, vencido: !otros.length && !!libertad.length && !vigente };
}
const anexoCumple = (anexos, re) => anexos.some(a => re.test(normalizar(textoAnexo(a))));

/**
 * @param {object} p
 * @param {ReturnType<import('./directivasFormulacion.js').resolverDirectivas>} p.directivas
 * @param {Array<{campo: string, valor: string}>} p.problemas   textos del problema central
 * @param {Array<{campo: string, valor: string}>} p.textosMoneda textos donde buscar moneda extranjera
 * @param {Array<{nombre_archivo?: string, descripcion?: string, categoria?: string, tipo_vigencia?: string, fecha_documento?: string}>} p.anexos
 * @param {boolean|null} p.teoriaCambioRegistrada true/false, o null si no se pudo verificar
 * @param {boolean} [p.arbolObjetivos] true si objetivos_arbol tiene objetivo central + específicos (V7 baja a MEDIA)
 * @param {Record<string, boolean>} [p.expediente]secciones del Expediente del Financiador con contenido verificable (teoria_cambio, mel, riesgos_pmi, salvaguardas)
 * @param {string} p.hoy 'YYYY-MM-DD' (hora Colombia)
 * @returns {Array<object>} hallazgos con el formato de mirofishReglas.js
 */
export function evaluarVectores({ directivas, problemas = [], textosMoneda = [], anexos = [], teoriaCambioRegistrada = null, expediente = {}, arbolObjetivos = false, hoy }) {
  const d = directivas;
  if (!d) return [];
  const v = d.vectores;
  const evFuente = [
    ...(v.fuente ? [{ campo: 'entrada.fuente_financiacion', valor: v.fuente }] : []),
    ...(v.formato ? [{ campo: 'entrada.formato_financiador', valor: v.formato }] : []),
  ];
  const evMetodologias = v.metodologias.length ? [{ campo: 'entrada.metodologias', valor: v.metodologias.join('; ') }] : [];
  const evAnexos = { campo: 'anexos.revisados', valor: String(anexos.length) };
  const hallazgos = [];

  // V0 — ejes incoherentes entre sí.
  for (const c of d.conflictos) {
    hallazgos.push({
      regla: 'V0', severidad: 'ALTA', titulo: 'Fuente y formato del financiador incoherentes',
      detalle: c.detalle, evidencia: evFuente,
      recomendacion: 'Corrige en Entrada la Fuente de Financiación o el Formato del Financiador para que correspondan a la misma convocatoria.',
    });
  }

  // V1 — régimen nacional con cifras en moneda extranjera.
  if (d.esquema === 'nacional') {
    const conMoneda = textosMoneda.filter(t => MONEDA_EXTRANJERA.test(sinTildesMayus(t.valor)));
    if (conMoneda.length) {
      hallazgos.push({
        regla: 'V1', severidad: 'ALTA', titulo: 'Moneda extranjera en un proyecto de régimen nacional',
        detalle: `La fuente/formato elegidos exigen cifras exclusivamente en Pesos Colombianos (COP) y ${conMoneda.length} texto(s) del proyecto mencionan dólares, euros u otra divisa.`,
        evidencia: [...evFuente, ...conMoneda.slice(0, 3).map(t => ({ campo: t.campo, valor: t.valor }))],
        recomendacion: 'Expresa esas cifras en COP (con la tasa y fecha de la fuente, si vienen de otra moneda) o revisa si la fuente de financiación elegida es la correcta.',
      });
    }
  }

  // V1b — régimen internacional sin documento financiero del usuario (INFO:
  // el presupuesto de RadFor-360 es COP por construcción; el del financiador
  // lo aporta el usuario en su documento externo — decisión del dueño).
  if (d.esquema === 'internacional' && !anexos.some(a => a?.categoria === 'financiero')) {
    hallazgos.push({
      regla: 'V1b', severidad: 'INFO', titulo: 'Financiador internacional: falta el presupuesto en su formato',
      detalle: 'El financiador elegido exige presupuesto en su moneda con costos directos, indirectos (overhead) y contrapartida, y no se detectó ningún anexo en la categoría Financiero.',
      evidencia: [...evFuente, evAnexos],
      recomendacion: 'Adjunta en Anexos (categoría Financiero) el presupuesto elaborado en el formato y la moneda del financiador.',
    });
  }

  // V2 — problema central redactado como ausencia de la solución.
  const malRedactados = problemas.filter(p => p.valor && PROBLEMA_COMO_AUSENCIA.test(normalizar(p.valor)));
  if (malRedactados.length) {
    hallazgos.push({
      regla: 'V2', severidad: 'MEDIA', titulo: 'Problema redactado como "falta de" la solución',
      detalle: 'El problema central debe ser una condición negativa medible de la población, no la ausencia de la obra o del servicio (criterio de Marco Lógico/MGA). Los evaluadores lo rechazan porque presupone la solución.',
      evidencia: malRedactados.map(p => ({ campo: p.campo, valor: p.valor })),
      recomendacion: 'Reescríbelo como el efecto medible sobre la población (ej. "El 80 % de las viviendas consume agua no apta" en vez de "Falta de acueducto").',
    });
  }

  // V3 — Teoría del Cambio exigida sin ruta causal.
  if (d.exige.teoriaCambio && teoriaCambioRegistrada !== true && !expediente.teoria_cambio && !anexoCumple(anexos, ANEXO_TOC)) {
    hallazgos.push({
      regla: 'V3', severidad: 'ALTA', titulo: 'Teoría del Cambio seleccionada sin ruta causal',
      detalle: 'Se marcó Teoría del Cambio y no se detectó la ruta causal (impacto → resultados intermedios → precondiciones → intervenciones, con supuestos críticos) ni en el proyecto ni en el nombre/descripción de los anexos.',
      evidencia: [...evMetodologias, evAnexos],
      recomendacion: 'Genera la ruta causal en Viabilidad → Expediente del Financiador, o adjunta el documento de Teoría del Cambio en Anexos.',
    });
  }

  // V4 — MEL / PMI exigidos sin soporte.
  if (d.exige.mel && !expediente.mel && !anexoCumple(anexos, ANEXO_MEL)) {
    hallazgos.push({
      regla: 'V4', severidad: 'ALTA', titulo: 'MEL seleccionado sin plan de monitoreo',
      detalle: 'Se marcó MEL y no se detectó un plan de Monitoreo, Evaluación y Aprendizaje (indicadores con línea base, meta, método, frecuencia y responsable) en el nombre/descripción de los anexos.',
      evidencia: [...evMetodologias, evAnexos],
      recomendacion: 'Genera el plan MEL en Viabilidad → Expediente del Financiador, o adjúntalo en Anexos (indicadores con línea base, meta, método, frecuencia y responsable).',
    });
  }
  if (d.exige.pmi && !expediente.riesgos_pmi && !anexoCumple(anexos, ANEXO_PMI)) {
    hallazgos.push({
      regla: 'V4b', severidad: 'MEDIA', titulo: 'PMI seleccionado sin registro de riesgos ni EDT',
      detalle: 'Se marcó PMI y no se detectó un registro de riesgos ni una EDT/WBS en el nombre/descripción de los anexos.',
      evidencia: [...evMetodologias, evAnexos],
      recomendacion: 'Genera el registro de riesgos en Viabilidad → Expediente del Financiador, o adjunta la EDT/WBS y la matriz de riesgos en Anexos.',
    });
  }

  // V5 — salvaguardas ambientales y sociales.
  if (d.exige.salvaguardas && !expediente.salvaguardas && !anexoCumple(anexos, ANEXO_SALVAGUARDAS) && !anexos.some(a => ANEXO_ESS.test(textoAnexo(a)))) {
    hallazgos.push({
      regla: 'V5', severidad: 'ALTA', titulo: 'Salvaguardas ambientales y sociales sin soporte',
      detalle: `${d.esquema === 'internacional' ? 'El financiador internacional exige' : 'Se marcó Salvaguardas, que exige'} la categorización de riesgo ambiental y social (A/B/C) y las medidas por impacto; no se detectó ese análisis en el nombre/descripción de los anexos.`,
      evidencia: [...evFuente, ...evMetodologias, evAnexos],
      recomendacion: 'Genera las salvaguardas en Viabilidad → Expediente del Financiador, o adjunta en Anexos el análisis ambiental y social (categoría A/B/C y medidas por impacto).',
    });
  }

  // V6 — soporte predial en infraestructura de régimen nacional.
  if (d.exige.saneamientoPredial) {
    const libertad = anexos.filter(a => a?.tipo_vigencia === 'libertad_tradicion');
    const soporte = soportePredial(anexos, hoy);
    const normas = referenciaPredial(d.sectorAgua);
    const evTipo = { campo: 'entrada.tipo_proyecto', valor: v.tipoProyecto };
    if (!soporte.anexo) {
      hallazgos.push({
        regla: 'V6', severidad: 'ALTA', titulo: 'Infraestructura sin soporte predial',
        detalle: 'Proyecto de infraestructura con financiación nacional: no se detectó certificado de libertad y tradición, acreditación de posesión, escritura ni comodato en los anexos.',
        evidencia: [evTipo, ...evFuente, evAnexos],
        recomendacion: `Adjunta el soporte predial del predio a intervenir (${normas}).`,
      });
    } else if (soporte.vencido) {
      hallazgos.push({
        regla: 'V6', severidad: 'MEDIA', titulo: 'Certificado de libertad y tradición vencido',
        detalle: `El soporte predial es un certificado de libertad y tradición con más de 30 días de expedido (${libertad.map(a => a.fecha_documento).join(', ')}).`,
        evidencia: [evTipo, ...libertad.slice(0, 3).map(a => ({ campo: 'anexo.fecha_documento', valor: String(a.fecha_documento) }))],
        recomendacion: `Solicita un certificado actualizado antes de radicar (${normas}).`,
      });
    }
  }

  // ── Fase E (2026-09-30) ──────────────────────────────────────────────────
  const evTipoProyecto = v.tipoProyecto ? [{ campo: 'entrada.tipo_proyecto', valor: v.tipoProyecto }] : [];
  // V7 — Marco Lógico marcado sin matriz (árbol de problemas + 4×4). Si el árbol de
  // objetivos YA está registrado (objetivos_arbol), solo falta la matriz → MEDIA (architect, cond. 1).
  if (d.exige.marcoLogico && !expediente.marco_logico && !anexoCumple(anexos, ANEXO_MARCO_LOGICO)) {
    hallazgos.push(arbolObjetivos ? {
      regla: 'V7', severidad: 'MEDIA', titulo: 'Marco Lógico: falta la matriz 4×4',
      detalle: 'El árbol de objetivos está registrado, pero no se detectó el árbol de problemas ni la matriz 4×4 (fin, propósito, componentes y actividades con indicadores, medios de verificación y supuestos) en el expediente ni en el nombre/descripción de los anexos.',
      evidencia: [...evMetodologias, { campo: 'arbol_objetivos', valor: 'registrado' }, evAnexos],
      recomendacion: 'Genera la matriz en Viabilidad → Expediente del Financiador (usa el árbol de objetivos registrado como fuente), o adjunta en Anexos la matriz de Marco Lógico.',
    } : {
      regla: 'V7', severidad: 'ALTA', titulo: 'Marco Lógico sin matriz',
      detalle: 'Se marcó Marco Lógico y no se detectó el árbol de objetivos, el árbol de problemas ni la matriz 4×4 (fin, propósito, componentes, actividades con indicadores, medios de verificación y supuestos) en el proyecto ni en el nombre/descripción de los anexos.',
      evidencia: [...evMetodologias, evAnexos],
      recomendacion: 'Genera el Árbol de Objetivos y luego la matriz en Viabilidad → Expediente del Financiador, o adjunta en Anexos la matriz de Marco Lógico.',
    });
  }
  // V8 — obra física sin controles HSEQ.
  if (d.exige.hseq && !expediente.hseq && !anexoCumple(anexos, ANEXO_HSEQ)) {
    hallazgos.push({
      regla: 'V8', severidad: 'MEDIA', titulo: 'Obra física sin controles HSEQ',
      detalle: 'Proyecto de infraestructura: no se detectaron controles de calidad (ISO 9001), ambiente (ISO 14001) ni seguridad y salud en el trabajo (ISO 45001) en el proyecto ni en el nombre/descripción de los anexos.',
      evidencia: [...evTipoProyecto, evAnexos],
      recomendacion: 'Genera la matriz HSEQ en Viabilidad → Expediente del Financiador, o adjunta en Anexos el plan de calidad, el plan de manejo ambiental y el SG-SST.',
    });
  }
  // V9 — obra física sin esquema de operación y mantenimiento.
  if (d.exige.sostenibilidadOym && !expediente.sostenibilidad_oym && !anexoCumple(anexos, ANEXO_OYM)) {
    hallazgos.push({
      regla: 'V9', severidad: 'MEDIA', titulo: 'Infraestructura sin esquema de operación y mantenimiento',
      detalle: 'No se detectó quién opera y mantiene la obra ni con qué recursos recurrentes (tarifas, cuotas, SGP, presupuesto institucional) en el proyecto ni en el nombre/descripción de los anexos.',
      evidencia: [...evTipoProyecto, evAnexos],
      recomendacion: 'Genera la sección de sostenibilidad en Viabilidad → Expediente del Financiador, o adjunta en Anexos el plan de operación y mantenimiento.',
    });
  }

  return hallazgos;
}
