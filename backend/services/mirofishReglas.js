/**
 * mirofishReglas.js — F-09: reglas DETERMINISTAS del comité hostil MIROFISH.
 *
 * Puro (sin BD ni red). Cada hallazgo trae `evidencia` con los campos y
 * valores EXACTOS en que se apoya — nada se infiere sin dato.
 *
 * Lista PDET: backend/data/municipiosPdet.json — dataset oficial "Municipios
 * PDET" de Datos Abiertos Colombia (idrk-ba8y), 170 municipios / 16
 * subregiones (Decreto 893 de 2017), descargado 2026-09-24.
 *
 * La ubicación del proyecto es TEXTO LIBRE (Entrada: "MUNICIPIO /
 * DEPARTAMENTO"; Logística: departamento + municipio), sin código DANE. El
 * emparejamiento nunca adivina:
 *   exacta       nombre del municipio PDET + su departamento presentes
 *   solo_nombre  nombre presente y único en la lista PDET, sin departamento
 *   ambigua      nombre repetido en la lista PDET (MORALES, PUERTO RICO) o
 *                varios candidatos — se pide precisar el departamento
 *   no_pdet      hay ubicación y no coincide con ningún municipio PDET (o el
 *                departamento mencionado es otro: homónimo no PDET)
 *   sin_ubicacion  no hay ubicación registrada
 */
import { readFileSync } from 'fs';

const PDET = JSON.parse(readFileSync(new URL('../data/municipiosPdet.json', import.meta.url), 'utf8'));

export function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Departamentos de Colombia (+ alias usuales). Se buscan del más largo al más
// corto y se BORRAN del texto al encontrarlos: así "VALLE DEL CAUCA" no cuenta
// también como "CAUCA", ni "NORTE DE SANTANDER" como "SANTANDER".
const DEPARTAMENTOS = [
  ['AMAZONAS'], ['ANTIOQUIA'], ['ARAUCA'], ['ATLANTICO'], ['BOLIVAR'], ['BOYACA'], ['CALDAS'], ['CAQUETA'],
  ['CASANARE'], ['CAUCA'], ['CESAR'], ['CHOCO'], ['CORDOBA'], ['CUNDINAMARCA'], ['GUAINIA'], ['GUAVIARE'],
  ['HUILA'], ['LA GUAJIRA', 'GUAJIRA'], ['MAGDALENA'], ['META'], ['NARINO'], ['NORTE DE SANTANDER'],
  ['PUTUMAYO'], ['QUINDIO'], ['RISARALDA'], ['SAN ANDRES', 'ARCHIPIELAGO DE SAN ANDRES'], ['SANTANDER'],
  ['SUCRE'], ['TOLIMA'], ['VALLE DEL CAUCA', 'VALLE'], ['VAUPES'], ['VICHADA'], ['BOGOTA'],
];
const ALIAS_DEPTO = DEPARTAMENTOS.flatMap(([canon, ...alias]) => [canon, ...alias].map(a => [a, canon]))
  .sort((a, b) => b[0].length - a[0].length);

const contieneFrase = (texto, frase) => new RegExp(`(^| )${frase}( |$)`).test(texto);

function departamentosMencionados(texto) {
  let resto = ` ${texto} `;
  const encontrados = new Set();
  for (const [alias, canon] of ALIAS_DEPTO) {
    const re = new RegExp(` ${alias} `, 'g');
    if (re.test(resto)) { encontrados.add(canon); resto = resto.replace(re, ' '); }
  }
  return { encontrados, resto: resto.trim() };
}

/**
 * @param {Array<{campo: string, valor: string}>} fuentes textos de ubicación con su campo de origen
 */
export function emparejarMunicipioPdet(fuentes) {
  const conValor = fuentes.filter(f => normalizar(f.valor));
  if (!conValor.length) return { tipo: 'sin_ubicacion', candidatos: [], evidencia: [] };
  const texto = normalizar(conValor.map(f => f.valor).join(' '));
  const evidencia = conValor.map(f => ({ campo: f.campo, valor: f.valor }));
  const { encontrados: deptos, resto } = departamentosMencionados(texto);

  const candidatos = PDET.municipios.filter(m => contieneFrase(resto, normalizar(m.nom_muni)) || contieneFrase(texto, normalizar(m.nom_muni)));
  const resumen = (m) => ({ cod_muni: m.cod_muni, municipio: m.nom_muni, departamento: m.nom_depto, subregion: m.nom_subreg });

  if (!candidatos.length) return { tipo: 'no_pdet', candidatos: [], departamentos: [...deptos], evidencia };

  const exactos = candidatos.filter(m => deptos.has(normalizar(m.nom_depto)));
  if (exactos.length === 1) return { tipo: 'exacta', municipio: resumen(exactos[0]), candidatos: [resumen(exactos[0])], evidencia };
  if (exactos.length > 1) return { tipo: 'ambigua', candidatos: exactos.map(resumen), evidencia };

  // Se mencionó un departamento y ningún candidato es de él → homónimo no PDET
  // (p. ej. "Argelia, Valle del Cauca": ARGELIA PDET es del Cauca).
  if (deptos.size) return { tipo: 'no_pdet', nota: 'homonimo_otro_departamento', candidatos: candidatos.map(resumen), departamentos: [...deptos], evidencia };

  const nombres = new Set(candidatos.map(m => normalizar(m.nom_muni)));
  const repetido = candidatos.length > 1 || PDET.municipios.filter(m => nombres.has(normalizar(m.nom_muni))).length > 1;
  if (repetido) return { tipo: 'ambigua', candidatos: candidatos.map(resumen), evidencia };
  return { tipo: 'solo_nombre', municipio: resumen(candidatos[0]), candidatos: [resumen(candidatos[0])], evidencia };
}

// Rubro de seguridad FÍSICA / orden público. Antes de buscarlo se quitan las
// frases de seguridad OCUPACIONAL (EPP, SST): "Casco de seguridad industrial"
// no protege a nadie de un riesgo de orden público.
const OCUPACIONAL = /\b(SEGURIDAD (INDUSTRIAL|Y SALUD|OCUPACIONAL|EN EL TRABAJO)|ELEMENTOS? DE PROTECCION PERSONAL|PROTECCION PERSONAL|EPP|SST)\b/g;
const SEGURIDAD = /\b(SEGURIDAD|VIGILANCIA|VIGILANTES?|ESCOLTAS?|ORDEN PUBLICO|CUSTODIA|CELADURIA|ESQUEMA DE PROTECCION)\b/;

export function lineasDeSeguridad(lineas) {
  return lineas.filter(l => SEGURIDAD.test(normalizar(l.valor).replace(OCUPACIONAL, ' ')));
}

/**
 * @param {{ ubicacion: Array<{campo,valor}>, lineasPresupuesto: Array<{campo,valor}>, tramos: Array<{numero, origen, destino, orden_publico}> }} datos
 */
export function evaluarReglas({ ubicacion, lineasPresupuesto, tramos }) {
  const match = emparejarMunicipioPdet(ubicacion);
  const seguridad = lineasDeSeguridad(lineasPresupuesto);
  const haySeguridad = seguridad.length > 0;
  const hallazgos = [];

  const esPdet = match.tipo === 'exacta' || match.tipo === 'solo_nombre';
  if (esPdet) {
    if (!lineasPresupuesto.length) {
      hallazgos.push({
        regla: 'R1', severidad: 'INFO', titulo: 'Municipio PDET sin presupuesto cargado',
        detalle: `${match.municipio.municipio} (${match.municipio.departamento}) es municipio PDET, pero el proyecto aún no tiene líneas de presupuesto: no se puede verificar el rubro de seguridad.`,
        evidencia: match.evidencia, recomendacion: 'Carga el presupuesto (Presupuesto o APU en Anexos) y vuelve a convocar al comité.',
      });
    } else if (!haySeguridad) {
      hallazgos.push({
        regla: 'R1', severidad: 'CRITICA', titulo: 'Municipio PDET sin rubro de seguridad / orden público',
        detalle: `${match.municipio.municipio} (${match.municipio.departamento}, subregión ${match.municipio.subregion}) es municipio PDET y ninguna de las ${lineasPresupuesto.length} líneas del presupuesto contempla seguridad, vigilancia u orden público.`,
        evidencia: [...match.evidencia, { campo: 'presupuesto.lineas', valor: String(lineasPresupuesto.length) }],
        recomendacion: 'Incluir un rubro explícito de seguridad / gestión del riesgo de orden público (vigilancia, escoltas o plan de seguridad) acorde a la zona.',
      });
    }
  } else if (match.tipo === 'ambigua') {
    hallazgos.push({
      regla: 'R3', severidad: 'INFO', titulo: 'Ubicación ambigua frente a la lista PDET',
      detalle: `La ubicación coincide con ${match.candidatos.map(c => `${c.municipio} (${c.departamento})`).join(' / ')}. Precisa el departamento para evaluar la regla PDET.`,
      evidencia: match.evidencia, recomendacion: 'Escribe la ubicación como "Municipio, Departamento" en Entrada o Logística.',
    });
  } else if (match.tipo === 'sin_ubicacion') {
    hallazgos.push({
      regla: 'R3', severidad: 'INFO', titulo: 'Proyecto sin ubicación registrada',
      detalle: 'No hay municipio en Entrada ni en Logística: no se puede evaluar si es municipio PDET.',
      evidencia: [], recomendacion: 'Registra el municipio y departamento del proyecto.',
    });
  }

  const tramosRiesgo = tramos.filter(t => normalizar(t.orden_publico) === 'SI');
  if (tramosRiesgo.length && !haySeguridad) {
    hallazgos.push({
      regla: 'R2', severidad: 'ALTA', titulo: 'Tramos con riesgo de orden público sin rubro de seguridad',
      detalle: `${tramosRiesgo.length} tramo(s) logístico(s) marcan riesgo de orden público y el presupuesto no contempla seguridad.`,
      evidencia: tramosRiesgo.map(t => ({ campo: `tramo[${t.numero}].orden_publico`, valor: String(t.orden_publico) })),
      recomendacion: 'Presupuestar escolta / acompañamiento o rutas alternas para esos tramos.',
    });
  }

  return { municipio_match: match, lineas_seguridad: seguridad, hallazgos };
}
