/**
 * expedienteFinanciador.js — Fase C de la directiva "Audit de Impacto
 * Integral" (dueño 2026-09-30): Expediente del Financiador en Viabilidad.
 *
 * Agente CREADOR (llmProveedor: Groq → OpenRouter → Gemini → BYOK) que arma,
 * sección por sección y SOLO las que exigen los ejes elegidos en Entrada
 * (directivasFormulacion.js):
 *   marco_logico        árbol de problemas + matriz 4×4 (Fase E; problema "falta de…" se descarta)
 *   teoria_cambio       ruta causal (impacto → resultados → precondiciones → intervenciones, supuestos)
 *   cadena_valor        objetivo/componente → producto/entregable → actividad, SIN montos (Fase E)
 *   hseq                controles ISO 9001 / 14001 / 45001 en obra física, sin afirmar certificación (Fase E)
 *   sostenibilidad_oym  operación y mantenimiento: responsable, recursos recurrentes, actividades (Fase E)
 *   salvaguardas        categoría de riesgo A/B/C + estándares ESS1–ESS10 con medida
 *   mel                 indicadores con línea base, meta, método, frecuencia, responsable
 *   riesgos_pmi         registro de riesgos (probabilidad/impacto 1–5, respuesta, reserva)
 *   checklist_juridico  documentos exigidos por la convocatoria y si hay anexo que los soporte
 *
 * Mismo contrato anti-invención que el Formulador MGA (formuladorMga.js):
 * - El modelo recibe un DICCIONARIO de fuentes (campos de Entrada y texto de
 *   cada anexo) y cada ítem debe citar `fuentes` con ids exactos; se DESCARTA
 *   todo ítem sin fuente, con fuente inexistente o con una cifra que no esté
 *   en sus fuentes (cifrasNoTrazables).
 * - Decisión del dueño (alcance jurídico): el checklist NUNCA declara un
 *   documento "soportado" sin un anexo real que lo pruebe — el estado lo
 *   calcula este módulo comparando contra los nombres de anexos, no la IA.
 * - AIU, presupuesto y presupuesto de interventoría los aporta el usuario en
 *   su documento externo: aquí no se calcula ningún valor financiero.
 */
import crypto from 'crypto';
import { generarConIA, IaNoDisponibleError, IaTopeAgotadoError } from './llmProveedor.js';
import { LlmLoopGuardError } from './geminiCircuitBreaker.js';
import { cifrasNoTrazables, extraerJson } from './formuladorMga.js';
import { bloqueVectores, normalizarEje } from './directivasFormulacion.js';
import { PROBLEMA_COMO_AUSENCIA } from './auditoriaVectores.js';
import { logger } from '../utils/logger.js';

export const AGENTE_EXPEDIENTE = 'expediente_financiador';
const MAX_ITEMS = 12;
const MAX_TEXTO = 800;
const MAX_CHARS_ANEXO = 6_000;
const MAX_CHARS_FUENTES = 60_000;

const ESTANDARES_ESS = ['ESS1', 'ESS2', 'ESS3', 'ESS4', 'ESS5', 'ESS6', 'ESS7', 'ESS8', 'ESS9', 'ESS10'];
const CATEGORIAS_RIESGO = ['Técnico', 'Financiero', 'Social', 'Ambiental', 'Climático', 'Legal', 'Orden público', 'Institucional'];
// Campos que admiten "ND" cuando la fuente no trae el dato (nunca un número inventado).
const ADMITE_ND = new Set(['linea_base', 'meta', 'reserva', 'responsable', 'frecuencia', 'medio_verificacion', 'supuesto']);
// Fase E: eslabones de la cadena de valor SIN montos (el presupuesto vive en el documento externo del usuario).
const ETAPAS = ['Preinversión', 'Inversión', 'Operación'];
const APORTES = ['Solicitado al financiador', 'Contrapartida', 'ND'];
const NIVELES_CAUSA = ['directa', 'indirecta'];
const NIVELES_EFECTO = ['directo', 'indirecto'];
const INSTRUMENTOS = ['PND', 'PDD', 'PDM', 'ODS', 'Plan sectorial', 'Estrategia del financiador'];
const FILA_MML = { resumen: 'texto', indicador: 'texto', medio_verificacion: 'texto', supuesto: 'texto' };
// Anclado a la RESOLUCIÓN (architect): "1063 viviendas en 2016" no es la norma.
const NORMA_DEROGADA = /\bres(olucion)?\.?\s*(n[o°º]\.?\s*)?1063\b/;
// Montos: símbolo o código de moneda, "millones de pesos/dólares/euros", "N pesos" o cifras
// largas con separador de miles (120.000.000). "2 millones de litros" o "pesos de carga" NO son montos.
const MONTO = /\$\s?\d|\b(COP|USD|EUR)\b|\bmill[oó]n(es)?\s+de\s+(pesos|d[oó]lares|euros)\b|\b\d+\s*(pesos|d[oó]lares|euros)\b|\b\d{1,3}(\.\d{3}){2,}\b/i;
// Autoevaluación (directiva del dueño 2026-09-30): el creador redacta, MIROFISH fiscaliza. Se descartan
// AFIRMACIONES de dictamen, no palabras sueltas: "Concepto de viabilidad técnica" o "certificado de
// elegibilidad" son documentos reales del checklist. Se evalúa sobre texto normalizado (sin tildes).
const AUTOEVALUACION = /\b(es|son|resulta|resultan|sera|seran|se considera|se consideran|se declara|se declaran)\s+(\w+mente\s+)?(viables?|elegibles?)\b|\b(el proyecto|la propuesta|la iniciativa|la solicitud|la postulacion|la financiacion|los recursos)\s+(\w+\s+){0,2}?(es|fue|sera|esta|queda|resulta|se considera)\s+(\w+mente\s+)?(aprobad[oa]s?|otorgad[oa]s?|favorables?)\b|\bviabilidad\s+(aprobada|otorgada|favorable|garantizada)\b|\bscore\b|\bpuntaje\s+de\s+(auditoria|evaluacion)\b/;
// Grupos donde no puede aparecer un monto (el presupuesto está en el documento externo del usuario); null = toda la sección.
const SIN_MONTOS = { cadena_valor: null, marco_logico: new Set(['actividades']), sostenibilidad_oym: null };

const ESCALA_ORDINAL = new Map([
  ['muy baja', 1], ['muy bajo', 1], ['baja', 2], ['bajo', 2], ['media', 3], ['medio', 3], ['moderada', 3], ['moderado', 3],
  ['alta', 4], ['alto', 4], ['muy alta', 5], ['muy alto', 5],
]);

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Catálogo de secciones. `grupos`: cada grupo es una lista de ítems con esos
 * campos. Tipos: 'texto' (se valida cifra por cifra), 'enum:<lista>',
 * 'ordinal' (entero 1–5, es una calificación, no un dato), 'bool'.
 */
export const SECCIONES = Object.freeze({
  marco_logico: {
    titulo: 'Marco Lógico — árbol de problemas y matriz 4×4',
    aplica: (d) => d.exige.marcoLogico,
    grupos: {
      problema_central: { max: 1, campos: { texto: 'texto' } },
      causas: { campos: { nivel: `enum:${NIVELES_CAUSA.join(',')}`, texto: 'texto' } },
      efectos: { campos: { nivel: `enum:${NIVELES_EFECTO.join(',')}`, texto: 'texto' } },
      objetivo_general: { max: 1, campos: { texto: 'texto' } },
      fin: { max: 1, campos: FILA_MML },
      proposito: { max: 1, campos: FILA_MML },
      componentes: { campos: FILA_MML },
      actividades: { campos: FILA_MML },
      alineacion: { campos: { instrumento: `enum:${INSTRUMENTOS.join(',')}`, texto: 'texto' } },
    },
    instrucciones: 'Estructura el árbol de problemas (problema central, causas directas e indirectas, efectos directos e indirectos) y su espejo positivo (objetivo general), y la matriz de Marco Lógico 4×4: fin, propósito, componentes y actividades, cada fila con indicador SMART (específico, medible, alcanzable, relevante y con plazo), medio de verificación y supuesto. Redacta el indicador como la VARIABLE medible con su unidad y su plazo (p. ej. "Porcentaje de viviendas con agua apta al cierre del proyecto", "Planta compacta construida y recibida por la interventoría"); pon una meta numérica SOLO si la cifra está en las fuentes — sin cifra, el indicador va sin número, pero la fila NO se omite por falta de meta. El indicador de una actividad mide su avance físico (obra ejecutada, estudio entregado), NUNCA su costo. El objetivo general es el problema central expresado en positivo (cita la misma fuente del problema); los componentes se derivan de la solución elegida y las actividades de la solución elegida y de los anexos técnicos. El problema central es una condición negativa MEDIBLE de la población, NUNCA "falta de…", "ausencia de…" ni "no existe" la obra o el servicio. Las actividades NO llevan costos (el presupuesto está en el documento del usuario). Si hay fuentes "arbol.*" (árbol de objetivos ya registrado en el proyecto) o "indicador[n]", el objetivo general, el propósito, los componentes y las actividades DEBEN ser coherentes con ellas — no inventes una jerarquía distinta. En "alineacion" relaciona el proyecto con el Plan Nacional/Departamental/Municipal de Desarrollo, los ODS o la estrategia del financiador SOLO si las fuentes lo mencionan.',
  },
  teoria_cambio: {
    titulo: 'Teoría del Cambio — ruta causal',
    aplica: (d) => d.exige.teoriaCambio,
    grupos: {
      impacto_largo_plazo: { max: 1, campos: { texto: 'texto' } },
      resultados_intermedios: { campos: { texto: 'texto' } },
      precondiciones: { campos: { texto: 'texto' } },
      intervenciones: { campos: { texto: 'texto' } },
      supuestos_criticos: { campos: { texto: 'texto' } },
    },
    instrucciones: 'Construye la ruta causal inversa (backwards mapping): el impacto de largo plazo, los resultados intermedios (outcomes) que lo producen, las precondiciones que deben cumplirse y las intervenciones del proyecto, más los supuestos críticos externos. Todo debe desprenderse de las fuentes (problema, línea base, meta, solución elegida y anexos).',
  },
  cadena_valor: {
    titulo: 'Cadena de valor / EDT (sin montos)',
    aplica: () => true,
    grupos: {
      eslabones: { campos: { objetivo_o_componente: 'texto', producto_o_entregable: 'texto', actividad: 'texto', etapa: `enum:${ETAPAS.join(',')}`, fuente_aporte: `enum:${APORTES.join(',')}` } },
    },
    instrucciones: 'Estructura la cadena de valor: si hay fuentes "arbol.*", respeta su jerarquía (específico → resultado → actividad); régimen nacional (MGA/OXI) → objetivo específico → producto (código del catálogo MGA SOLO si aparece en las fuentes) → actividad; régimen internacional → componente → entregable/paquete de trabajo (EDT/WBS) → actividad. PROHIBIDO escribir montos, costos, valores o porcentajes: el costo de cada actividad está en el presupuesto del documento externo del usuario. "fuente_aporte" es "Solicitado al financiador" o "Contrapartida" SOLO si las fuentes lo dicen; si no, "ND".',
  },
  salvaguardas: {
    titulo: 'Salvaguardas ambientales y sociales',
    aplica: (d) => d.exige.salvaguardas,
    grupos: {
      categoria: { max: 1, campos: { categoria: `enum:A,B,C`, justificacion: 'texto' } },
      estandares: { campos: { estandar: `enum:${ESTANDARES_ESS.join(',')}`, impacto: 'texto', medida: 'texto' } },
    },
    instrucciones: 'Categoriza el riesgo ambiental y social del proyecto (A = alto, B = medio, C = bajo) con su justificación, e identifica SOLO los estándares ESS1–ESS10 del Marco Ambiental y Social que las fuentes permitan sustentar (p. ej. ESS5 uso de tierras/reasentamiento, ESS7 pueblos indígenas, ESS6 biodiversidad, ESS4 salud y seguridad comunitaria), con el impacto concreto y la medida de mitigación.',
  },
  hseq: {
    titulo: 'Matriz HSEQ — calidad, ambiente y SST',
    aplica: (d) => d.exige.hseq,
    grupos: {
      iso_9001: { campos: { aspecto: 'texto', control: 'texto' } },
      iso_14001: { campos: { aspecto: 'texto', control: 'texto' } },
      iso_45001: { campos: { aspecto: 'texto', control: 'texto' } },
    },
    instrucciones: 'Para la obra física del proyecto, identifica los aspectos de calidad (ISO 9001: ensayos, interventoría de calidad, control de materiales), ambientales (ISO 14001: residuos, vertimientos, permisos) y de seguridad y salud en el trabajo (ISO 45001: trabajo en alturas, excavaciones, EPP) que las fuentes permitan sustentar, con el control concreto. NUNCA afirmes que el proyecto o el contratista está certificado ni que cumple: son controles a implementar.',
  },
  mel: {
    titulo: 'Plan MEL — Monitoreo, Evaluación y Aprendizaje',
    aplica: (d) => d.exige.mel,
    grupos: {
      indicadores: { campos: { indicador: 'texto', linea_base: 'texto', meta: 'texto', metodo: 'texto', frecuencia: 'texto', responsable: 'texto' } },
    },
    instrucciones: 'Diseña la matriz MEL: indicadores SMART con línea base, meta, método de recolección de datos, frecuencia y responsable. Línea base y meta SOLO con cifras presentes en las fuentes; si no están, "ND".',
  },
  riesgos_pmi: {
    titulo: 'Registro de riesgos (PMI)',
    aplica: (d) => d.exige.pmi,
    grupos: {
      riesgos: { campos: { evento: 'texto', categoria: `enum:${CATEGORIAS_RIESGO.join(',')}`, probabilidad: 'ordinal', impacto: 'ordinal', respuesta: 'texto', reserva: 'texto' } },
    },
    instrucciones: 'Construye el registro de riesgos: evento de riesgo sustentado en las fuentes, categoría, probabilidad e impacto, estrategia de respuesta y reserva de contingencia. La reserva SOLO si el monto está en las fuentes; si no, "ND". "probabilidad" e "impacto" NO son datos de las fuentes: son TU calificación experta del evento y van SIEMPRE como número entero de 1 a 5 (1 = muy baja, 2 = baja, 3 = media, 4 = alta, 5 = muy alta) — nunca "ND", nunca texto. "ND" solo es válido en "reserva".',
  },
  sostenibilidad_oym: {
    titulo: 'Sostenibilidad — operación y mantenimiento',
    aplica: (d) => d.exige.sostenibilidadOym,
    grupos: {
      responsable: { max: 1, campos: { entidad: 'texto', rol: 'texto' } },
      fuentes_recursos: { campos: { fuente_recurso: 'texto', mecanismo: 'texto' } },
      actividades_om: { campos: { actividad: 'texto', frecuencia: 'texto', responsable: 'texto' } },
    },
    instrucciones: 'Define el esquema de operación y mantenimiento para el horizonte de vida útil (referencia de 10 años): entidad u organismo responsable (p. ej. junta de acción comunal, empresa de servicios, municipio) y su rol, fuentes de recursos recurrentes (SGP, tarifas, cuotas, presupuesto institucional) con su mecanismo, y actividades de operación y mantenimiento con frecuencia y responsable. SOLO lo que las fuentes sustenten; sin montos.',
  },
  checklist_juridico: {
    titulo: 'Checklist jurídico y de radicación',
    aplica: () => true,
    grupos: {
      documentos: { campos: { documento: 'texto', obligatorio: 'bool', referencia: 'texto', anexo: 'texto' } },
    },
    instrucciones: 'Lista los documentos que la convocatoria o el financiador EXIGEN para radicar, tal como aparecen en las fuentes (términos de referencia, guías). En "referencia" copia la norma o numeral que lo exige SOLO si aparece en las fuentes (si no, cadena vacía). En "anexo" escribe el nombre EXACTO del anexo del proyecto que lo soporta, o cadena vacía si ninguno lo soporta. Nunca afirmes que un requisito está cumplido: eso lo verifica el sistema.',
  },
});

export const SECCIONES_IDS = Object.freeze(Object.keys(SECCIONES));

/** Secciones que exigen los ejes elegidos. */
export function seccionesAplicables(directivas) {
  return SECCIONES_IDS.filter(id => SECCIONES[id].aplica(directivas));
}

/**
 * Diccionario de fuentes: campos de Entrada + texto de cada anexo.
 * @param {object} entrada ficha_tecnica.entrada_completa
 * @param {Array<{nombre: string, texto: string}>} anexos de compilarAnexosProyecto()
 * @returns {{ datos: Record<string,string>, anexosIds: Record<string,string>, omitidos: string[] }}
 */
export function construirFuentes(entrada = {}, anexos = [], arbol = { nodos: [], indicadores: [] }) {
  const datos = {};
  const poner = (k, v) => { const t = texto(v); if (t) datos[k] = t; };
  // Árbol de objetivos e indicadores YA registrados en el proyecto (objetivos_arbol /
  // project_indicators): el Marco Lógico y la cadena de valor deben ser coherentes con ellos.
  const contadores = {};
  for (const n of arbol?.nodos || []) {
    const tipo = String(n.tipo || '').toLowerCase();
    contadores[tipo] = (contadores[tipo] || 0) + 1;
    poner(`arbol.${tipo}[${contadores[tipo]}]`, n.texto);
    if (texto(n.supuestos)) poner(`arbol.${tipo}[${contadores[tipo]}].supuestos`, n.supuestos);
  }
  (arbol?.indicadores || []).forEach((ind, i) => poner(`indicador[${i + 1}]`,
    [ind.nombre, ind.tipo && `tipo ${ind.tipo}`, ind.linea_base != null && `línea base ${ind.linea_base}`, ind.meta_total != null && `meta ${ind.meta_total}`, ind.unidad_medida, ind.fuente_verificacion && `verificación: ${ind.fuente_verificacion}`].filter(Boolean).join(' · ')));
  poner('entrada.pitch', entrada.pitch);
  poner('entrada.problema_seleccionado', entrada.contextoMeta?.problemaSeleccionado);
  for (const [k, v] of Object.entries(entrada.contexto || {})) poner(`entrada.contexto.${k}`, v);
  poner('entrada.beneficiarios', entrada.contextoMeta?.beneficiarios || entrada.numeroBeneficiarios);
  poner('entrada.cobertura', entrada.coberturaGeografica);
  poner('entrada.municipio', [entrada.municipio, entrada.vereda].filter(Boolean).join(' — '));
  poner('entrada.sectores', (entrada.sectores || []).join('; '));
  poner('entrada.poblacion', [entrada.categoriaPoblacion, ...(entrada.detallePoblacion || [])].filter(Boolean).join('; '));
  const sol = entrada.soluciones;
  if (sol?.seleccion?.tipo === 'ia') poner('entrada.solucion_elegida', sol.propuestasIA?.[sol.seleccion.index]);
  if (sol?.seleccion?.tipo === 'manual') poner('entrada.solucion_elegida', sol.propuestaManual);

  const anexosIds = {};
  const omitidos = [];
  let total = Object.values(datos).reduce((s, v) => s + v.length, 0);
  for (const a of anexos) {
    const t = texto(a?.texto).slice(0, MAX_CHARS_ANEXO);
    if (!t) continue;
    let id = `anexo:${texto(a.nombre) || 'Documento sin título'}`;
    for (let n = 2; id in datos; n++) id = `anexo:${texto(a.nombre)} (${n})`;
    if (total + t.length > MAX_CHARS_FUENTES) { omitidos.push(texto(a.nombre)); continue; }
    datos[id] = t;
    anexosIds[id] = texto(a.nombre);
    total += t.length;
  }
  return { datos, anexosIds, omitidos };
}

/**
 * Metadatos de anexos para la huella y el soporte predial. Usa ruta_storage
 * (estable) y NO archivo_cache_de: la primera extracción lo actualiza y la
 * sección quedaba "desactualizada" justo después de generarse (architect).
 */
export const SQL_ARBOL = 'SELECT tipo, nivel, texto, supuestos FROM objetivos_arbol WHERE proyecto_id = ? ORDER BY nivel ASC, created_at ASC, id ASC';
export const SQL_INDICADORES = 'SELECT nombre, tipo, linea_base, meta_total, unidad_medida, fuente_verificacion FROM project_indicators WHERE project_id = ? ORDER BY created_at ASC';

/**
 * Árbol de objetivos + indicadores del proyecto. try/catch: si la tabla no
 * existe o falla, el expediente sigue sin esas fuentes (con aviso en el log).
 * @param {(sql: string, params: any[]) => Promise<any[]>} getRows escopado por tenant
 */
export async function cargarArbol(getRows, proyectoId) {
  try {
    const [nodos, indicadores] = await Promise.all([getRows(SQL_ARBOL, [proyectoId]), getRows(SQL_INDICADORES, [proyectoId])]);
    return { nodos, indicadores };
  } catch (err) {
    logger.warn('[expediente] Árbol de objetivos/indicadores no disponibles — se continúa sin esas fuentes', { proyectoId, err: err.message });
    return { nodos: [], indicadores: [] };
  }
}

/** true si el proyecto ya tiene árbol de objetivos (objetivo central + al menos un específico). */
export function arbolObjetivosRegistrado(nodos = []) {
  return nodos.some(n => n.tipo === 'CENTRAL') && nodos.some(n => n.tipo === 'ESPECIFICO');
}

export const SQL_ANEXOS_META ="SELECT id, nombre_archivo, descripcion, ruta_storage, link, texto, categoria, tipo_vigencia, to_char(fecha_documento, 'YYYY-MM-DD') AS fecha_documento FROM project_anexos WHERE project_id = ?";

const hashTexto = (t) => (t ? crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 16) : '');

/** Huella barata de las fuentes (metadatos, sin descargar archivos): si cambia, la sección está desactualizada. */
export function huellaMetadatos(entrada, anexosMeta, arbol = null) {
  const meta = (anexosMeta || []).map(a => [a.id, a.nombre_archivo, hashTexto(a.descripcion), a.ruta_storage, a.link, hashTexto(a.texto), a.categoria, a.tipo_vigencia, a.fecha_documento])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  // Fase E: el árbol de objetivos y los indicadores también son fuentes (Marco Lógico, cadena de valor).
  const arbolMeta = arbol ? hashTexto(JSON.stringify([arbol.nodos || [], arbol.indicadores || []])) : '';
  return crypto.createHash('sha256').update(JSON.stringify([entrada || {}, meta, arbolMeta])).digest('hex');
}

// Grupos mínimos para que una sección cuente como soporte en las reglas V
// (una ToC con un solo supuesto no es una ruta causal — architect, cond. 3).
const GRUPOS_MINIMOS = {
  teoria_cambio: ['impacto_largo_plazo', 'resultados_intermedios', 'intervenciones'],
  salvaguardas: ['categoria'],
  mel: ['indicadores'],
  riesgos_pmi: ['riesgos'],
  checklist_juridico: ['documentos'],
  marco_logico: ['problema_central', 'objetivo_general', 'proposito', 'componentes'],
  cadena_valor: ['eslabones'],
  hseq: ['iso_9001', 'iso_14001', 'iso_45001'],
  sostenibilidad_oym: ['responsable', 'fuentes_recursos'],
};

/** true si la generación tiene contenido verificable en todos los grupos mínimos de la sección. */
export function seccionCumple(seccionId, generacion) {
  if (generacion?.estado !== 'ok') return false;
  const grupos = generacion?.contenido?.grupos || {};
  return (GRUPOS_MINIMOS[seccionId] || []).every(g => Array.isArray(grupos[g]) && grupos[g].length > 0);
}

export function construirPrompt(seccionId, directivas, datos) {
  const s = SECCIONES[seccionId];
  const forma = Object.fromEntries(Object.entries(s.grupos).map(([g, def]) => [g, [{ ...Object.fromEntries(Object.entries(def.campos).map(([c, tipo]) => [c, tipo.startsWith('enum:') ? tipo.slice(5).split(',').join('|') : tipo === 'ordinal' ? 3 : tipo === 'bool' ? true : 'string'])), fuentes: ['<id exacto del diccionario>'] }]]));
  const system = `Eres el agente "Expediente del Financiador" de RadFor-360. Sección: ${s.titulo}.
${s.instrucciones}

REGLAS INQUEBRANTABLES:
1. Usa EXCLUSIVAMENTE el DICCIONARIO DE FUENTES (id → texto). Cada ítem DEBE citar en "fuentes" los ids EXACTOS en que se apoya. Un ítem sin fuente válida se descarta.
2. NUNCA inventes cifras, montos, fechas, porcentajes, normas, entidades ni documentos: toda cifra de un ítem debe aparecer en sus fuentes. Si el dato no está, usa "ND" (o cadena vacía donde se indique).
3. Si las fuentes no alcanzan para un grupo, devuélvelo como lista vacía. Es preferible poco contenido verificable que contenido inventado.
4. Tu rol es REDACTAR, no evaluar: NUNCA declares que el proyecto es viable, elegible, aprobado u otorgado, ni asignes un score o puntaje. La fiscalización la hace el Comité MIROFISH con un modelo independiente.
5. Máximo ${MAX_ITEMS} ítems por grupo. Responde SOLO un objeto JSON con esta forma exacta, sin texto antes ni después:
${JSON.stringify(forma)}`;
  const user = `${bloqueVectores(directivas)}

DICCIONARIO DE FUENTES (id → texto, única fuente permitida):
${JSON.stringify(datos, null, 1)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function validarCampo(tipo, valor) {
  if (tipo === 'texto') return { ok: true, valor: texto(valor).slice(0, MAX_TEXTO) };
  if (tipo === 'bool') {
    // Verificado en vivo (gemini-3.6-flash, 2026-09-30): el modelo puede
    // devolver "true"/"false" como texto. Solo se aceptan formas inequívocas.
    if (typeof valor === 'boolean') return { ok: true, valor };
    const t = normalizarEje(valor);
    if (['true', 'si', 'yes'].includes(t)) return { ok: true, valor: true };
    if (['false', 'no'].includes(t)) return { ok: true, valor: false };
    return { ok: false };
  }
  if (tipo === 'ordinal') {
    // Calificación 1–5. Una escala verbal inequívoca se traduce ("alta" → 4); "ND" o texto libre
    // se descartan: convertir "no disponible" en un número sería inventar la calificación.
    const n = typeof valor === 'string' && ESCALA_ORDINAL.has(normalizarEje(valor)) ? ESCALA_ORDINAL.get(normalizarEje(valor)) : Number(valor);
    return { ok: Number.isInteger(n) && n >= 1 && n <= 5, valor: n };
  }
  const opciones = tipo.slice(5).split(',');
  const hallado = opciones.find(o => normalizarEje(o) === normalizarEje(valor));
  return { ok: !!hallado, valor: hallado };
}

/**
 * Valida la salida del modelo contra las fuentes. Nunca completa ni corrige
 * contenido: descarta. Exportada para test.
 * @returns {{ grupos: object, descartados: Array<{grupo, item, motivo, detalle?}>, itemsValidos: number }}
 */
export function validarSeccion(seccionId, salida, datos, anexosIds) {
  const s = SECCIONES[seccionId];
  const grupos = {};
  const descartados = [];
  let itemsValidos = 0;
  // Búsquedas por ítem en O(1): nombre normalizado → nombre real del anexo,
  // y el texto de cada fuente normalizado UNA sola vez por sección (hasta 60K caracteres).
  const nombresAnexo = new Map(Object.values(anexosIds).map(n => [normalizarEje(n), n]));
  // Verificado en vivo (gpt-oss-120b, 2026-09-30): el modelo cita "anexo:Diagnóstico tecnico.docx" sin la
  // tilde. Un id que solo difiere en tildes/mayúsculas/espacios se lleva a su id real; si dos ids reales
  // normalizan igual, es ambiguo y no se corrige (el ítem se descarta como fuente_inexistente).
  const idsCanonicos = new Map();
  for (const id of Object.keys(datos)) {
    const n = normalizarEje(id);
    idsCanonicos.set(n, idsCanonicos.has(n) ? null : id);
  }
  const canonico = (id) => (id in datos ? id : idsCanonicos.get(normalizarEje(id)) || id);
  const fuentesNormalizadas = new Map();
  const textoNormalizado = (id) => {
    if (!fuentesNormalizadas.has(id)) fuentesNormalizadas.set(id, normalizarEje(datos[id]));
    return fuentesNormalizadas.get(id);
  };
  for (const [g, def] of Object.entries(s.grupos)) {
    const crudos = Array.isArray(salida?.[g]) ? salida[g].slice(0, def.max ?? MAX_ITEMS) : [];
    const validos = [];
    // Campos de texto de la sección, calculados una vez por grupo (no por ítem).
    const camposTexto = Object.keys(def.campos).filter(c => def.campos[c] === 'texto');
    const camposCifras = camposTexto.filter(c => c !== 'anexo');
    const campoResumen = camposTexto[0];
    for (const it of crudos) {
      const resumen = texto(campoResumen ? it?.[campoResumen] : '').slice(0, 120);
      const fuentes = Array.isArray(it?.fuentes) ? [...new Set(it.fuentes.flatMap(f => (texto(f) ? canonico(texto(f)) : [])))] : [];
      if (!fuentes.length) { descartados.push({ grupo: g, item: resumen, motivo: 'sin_fuente' }); continue; }
      const inexistentes = fuentes.filter(id => !(id in datos));
      if (inexistentes.length) { descartados.push({ grupo: g, item: resumen, motivo: 'fuente_inexistente', detalle: inexistentes.join(', ') }); continue; }
      const item = {};
      let invalido = null;
      for (const [c, tipo] of Object.entries(def.campos)) {
        const r = validarCampo(tipo, it?.[c]);
        if (!r.ok) { invalido = c; break; }
        item[c] = r.valor;
      }
      if (invalido) { descartados.push({ grupo: g, item: resumen, motivo: 'valor_invalido', detalle: invalido }); continue; }
      const vacio = camposTexto.find(c => !ADMITE_ND.has(c) && c !== 'anexo' && c !== 'referencia' && !item[c]);
      if (vacio) { descartados.push({ grupo: g, item: resumen, motivo: 'campo_vacio', detalle: vacio }); continue; }
      for (const c of ADMITE_ND) if (c in item && !item[c]) item[c] = 'ND';
      // Res. 1063 de 2016 DEROGADA por la Res. 0661 de 2019 (verificado 2026-09-30): nunca se cita, aunque la
      // traiga una fuente vieja. En el checklist solo se vacía la referencia (el requisito puede ser real).
      if (item.referencia && NORMA_DEROGADA.test(normalizarEje(item.referencia))) item.referencia = '';
      const textoItem = camposTexto.map(c => item[c]).join(' \n ');
      if (NORMA_DEROGADA.test(normalizarEje(textoItem))) { descartados.push({ grupo: g, item: resumen, motivo: 'norma_derogada', detalle: 'Res. 1063 de 2016 (derogada por la Res. 0661 de 2019)' }); continue; }
      if (AUTOEVALUACION.test(normalizarEje(textoItem))) { descartados.push({ grupo: g, item: resumen, motivo: 'autoevaluacion' }); continue; }
      if (seccionId === 'marco_logico' && g === 'problema_central' && PROBLEMA_COMO_AUSENCIA.test(normalizarEje(item.texto).toUpperCase())) {
        descartados.push({ grupo: g, item: resumen, motivo: 'problema_como_ausencia' }); continue;
      }
      // Cadena de valor sin montos: el costo por actividad vive en el presupuesto del documento externo.
      if (seccionId in SIN_MONTOS && (SIN_MONTOS[seccionId] === null || SIN_MONTOS[seccionId].has(g)) && MONTO.test(textoItem)) { descartados.push({ grupo: g, item: resumen, motivo: 'monto_no_permitido' }); continue; }
      // Cifras: solo en campos de texto (las calificaciones 1–5 no son datos).
      const textos = camposCifras.map(c => item[c]).join(' \n ');
      const malas = cifrasNoTrazables(textos, fuentes, datos);
      if (malas.length) { descartados.push({ grupo: g, item: resumen, motivo: 'cifra_no_trazable', detalle: malas.join(', ') }); continue; }
      if (seccionId === 'checklist_juridico') {
        // Un requisito debe venir de un documento (TdR/guía), no solo de Entrada.
        if (!fuentes.some(id => id.startsWith('anexo:'))) { descartados.push({ grupo: g, item: resumen, motivo: 'sin_fuente_documental' }); continue; }
        // La norma citada debe aparecer LITERAL en sus fuentes; si no, se borra (no se inventan normas).
        const referencia = normalizarEje(item.referencia);
        if (referencia && !fuentes.some(id => textoNormalizado(id).includes(referencia))) item.referencia = '';
        // El estado lo decide el sistema, nunca la IA (decisión del dueño): un
        // anexo real que la IA propone como soporte queda "propuesto — verificar";
        // el anexo que EXIGE el documento (una de sus fuentes) no lo prueba.
        const citado = normalizarEje(item.anexo);
        const real = citado ? nombresAnexo.get(citado) : undefined;
        const esFuenteDelRequisito = real && fuentes.some(id => anexosIds[id] === real);
        item.anexo = real && !esFuenteDelRequisito ? real : '';
        item.estado = item.anexo ? 'anexo_propuesto_verificar' : 'no_detectado';
      }
      validos.push({ ...item, fuentes });
    }
    itemsValidos += validos.length;
    grupos[g] = validos;
  }
  return { grupos, descartados, itemsValidos };
}

/**
 * Genera una sección. Lanza IaNoDisponibleError (503), IaTopeAgotadoError
 * (429) o LlmLoopGuardError; el caller no persiste nada en ese caso.
 */
export async function generarSeccion({ seccionId, directivas, datos, anexosIds, userId }) {
  const r = await generarConIA({
    userId, agente: AGENTE_EXPEDIENTE, temperature: 0.2, maxTokens: 8192,
    messages: construirPrompt(seccionId, directivas, datos),
    responseFormat: { type: 'json_object' },
    validar: (t) => {
      const j = extraerJson(t);
      if (!j || typeof j !== 'object') throw new Error('respuesta sin JSON');
      if (!Object.keys(SECCIONES[seccionId].grupos).some(g => Array.isArray(j[g]))) throw new Error('respuesta sin los grupos de la sección');
      return j;
    },
  });
  const { grupos, descartados, itemsValidos } = validarSeccion(seccionId, r.valor, datos, anexosIds);
  return { estado: itemsValidos ? 'ok' : 'sin_contenido_verificable', grupos, descartados, modelo: r.modelo, proveedor: r.proveedor };
}

export { IaNoDisponibleError, IaTopeAgotadoError, LlmLoopGuardError };
