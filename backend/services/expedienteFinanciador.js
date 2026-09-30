/**
 * expedienteFinanciador.js — Fase C de la directiva "Audit de Impacto
 * Integral" (dueño 2026-09-30): Expediente del Financiador en Viabilidad.
 *
 * Agente CREADOR (llmProveedor: Groq → OpenRouter → Gemini → BYOK) que arma,
 * sección por sección y SOLO las que exigen los ejes elegidos en Entrada
 * (directivasFormulacion.js):
 *   teoria_cambio       ruta causal (impacto → resultados → precondiciones → intervenciones, supuestos)
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

export const AGENTE_EXPEDIENTE = 'expediente_financiador';
const MAX_ITEMS = 12;
const MAX_TEXTO = 800;
const MAX_CHARS_ANEXO = 6_000;
const MAX_CHARS_FUENTES = 60_000;

const ESTANDARES_ESS = ['ESS1', 'ESS2', 'ESS3', 'ESS4', 'ESS5', 'ESS6', 'ESS7', 'ESS8', 'ESS9', 'ESS10'];
const CATEGORIAS_RIESGO = ['Técnico', 'Financiero', 'Social', 'Ambiental', 'Climático', 'Legal', 'Orden público', 'Institucional'];
// Campos que admiten "ND" cuando la fuente no trae el dato (nunca un número inventado).
const ADMITE_ND = new Set(['linea_base', 'meta', 'reserva', 'responsable', 'frecuencia']);

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Catálogo de secciones. `grupos`: cada grupo es una lista de ítems con esos
 * campos. Tipos: 'texto' (se valida cifra por cifra), 'enum:<lista>',
 * 'ordinal' (entero 1–5, es una calificación, no un dato), 'bool'.
 */
export const SECCIONES = Object.freeze({
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
  salvaguardas: {
    titulo: 'Salvaguardas ambientales y sociales',
    aplica: (d) => d.exige.salvaguardas,
    grupos: {
      categoria: { max: 1, campos: { categoria: `enum:A,B,C`, justificacion: 'texto' } },
      estandares: { campos: { estandar: `enum:${ESTANDARES_ESS.join(',')}`, impacto: 'texto', medida: 'texto' } },
    },
    instrucciones: 'Categoriza el riesgo ambiental y social del proyecto (A = alto, B = medio, C = bajo) con su justificación, e identifica SOLO los estándares ESS1–ESS10 del Marco Ambiental y Social que las fuentes permitan sustentar (p. ej. ESS5 uso de tierras/reasentamiento, ESS7 pueblos indígenas, ESS6 biodiversidad, ESS4 salud y seguridad comunitaria), con el impacto concreto y la medida de mitigación.',
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
    instrucciones: 'Construye el registro de riesgos: evento de riesgo sustentado en las fuentes, categoría, probabilidad e impacto (calificación entera de 1 a 5), estrategia de respuesta y reserva de contingencia. La reserva SOLO si el monto está en las fuentes; si no, "ND".',
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
export function construirFuentes(entrada = {}, anexos = []) {
  const datos = {};
  const poner = (k, v) => { const t = texto(v); if (t) datos[k] = t; };
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
export const SQL_ANEXOS_META = "SELECT id, nombre_archivo, descripcion, ruta_storage, link, texto, categoria, tipo_vigencia, to_char(fecha_documento, 'YYYY-MM-DD') AS fecha_documento FROM project_anexos WHERE project_id = ?";

const hashTexto = (t) => (t ? crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 16) : '');

/** Huella barata de las fuentes (metadatos, sin descargar archivos): si cambia, la sección está desactualizada. */
export function huellaMetadatos(entrada, anexosMeta) {
  const meta = (anexosMeta || []).map(a => [a.id, a.nombre_archivo, hashTexto(a.descripcion), a.ruta_storage, a.link, hashTexto(a.texto), a.categoria, a.tipo_vigencia, a.fecha_documento])
    .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  return crypto.createHash('sha256').update(JSON.stringify([entrada || {}, meta])).digest('hex');
}

// Grupos mínimos para que una sección cuente como soporte en las reglas V
// (una ToC con un solo supuesto no es una ruta causal — architect, cond. 3).
const GRUPOS_MINIMOS = {
  teoria_cambio: ['impacto_largo_plazo', 'resultados_intermedios', 'intervenciones'],
  salvaguardas: ['categoria'],
  mel: ['indicadores'],
  riesgos_pmi: ['riesgos'],
  checklist_juridico: ['documentos'],
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
4. Máximo ${MAX_ITEMS} ítems por grupo. Responde SOLO un objeto JSON con esta forma exacta:
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
  if (tipo === 'ordinal') { const n = Number(valor); return { ok: Number.isInteger(n) && n >= 1 && n <= 5, valor: n }; }
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
  const nombresAnexo = Object.values(anexosIds).map(n => [normalizarEje(n), n]);
  for (const [g, def] of Object.entries(s.grupos)) {
    const crudos = Array.isArray(salida?.[g]) ? salida[g].slice(0, def.max ?? MAX_ITEMS) : [];
    const validos = [];
    for (const it of crudos) {
      const resumen = texto(Object.values(def.campos).includes('texto') ? it?.[Object.keys(def.campos).find(c => def.campos[c] === 'texto')] : '').slice(0, 120);
      const fuentes = Array.isArray(it?.fuentes) ? [...new Set(it.fuentes.map(texto).filter(Boolean))] : [];
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
      if (Object.entries(def.campos).some(([c, tipo]) => tipo === 'texto' && !ADMITE_ND.has(c) && c !== 'anexo' && c !== 'referencia' && !item[c])) {
        descartados.push({ grupo: g, item: resumen, motivo: 'campo_vacio' }); continue;
      }
      for (const c of ADMITE_ND) if (c in item && !item[c]) item[c] = 'ND';
      // Cifras: solo en campos de texto (las calificaciones 1–5 no son datos).
      const textos = Object.entries(def.campos).filter(([c, tipo]) => tipo === 'texto' && c !== 'anexo').map(([c]) => item[c]).join(' \n ');
      const malas = cifrasNoTrazables(textos, fuentes, datos);
      if (malas.length) { descartados.push({ grupo: g, item: resumen, motivo: 'cifra_no_trazable', detalle: malas.join(', ') }); continue; }
      if (seccionId === 'checklist_juridico') {
        // Un requisito debe venir de un documento (TdR/guía), no solo de Entrada.
        if (!fuentes.some(id => id.startsWith('anexo:'))) { descartados.push({ grupo: g, item: resumen, motivo: 'sin_fuente_documental' }); continue; }
        // La norma citada debe aparecer LITERAL en sus fuentes; si no, se borra (no se inventan normas).
        if (item.referencia && !fuentes.some(id => normalizarEje(datos[id]).includes(normalizarEje(item.referencia)))) item.referencia = '';
        // El estado lo decide el sistema, nunca la IA (decisión del dueño): un
        // anexo real que la IA propone como soporte queda "propuesto — verificar";
        // el anexo que EXIGE el documento (una de sus fuentes) no lo prueba.
        const citado = normalizarEje(item.anexo);
        const real = citado ? nombresAnexo.find(([n]) => n === citado) : null;
        const esFuenteDelRequisito = real && fuentes.some(id => anexosIds[id] === real[1]);
        item.anexo = real && !esFuenteDelRequisito ? real[1] : '';
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
