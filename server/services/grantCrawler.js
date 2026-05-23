import { getDb, getRow, getRows, getCount, runSql, closeDb } from '../db.js';

const KEYWORDS = [
  'subvenciones pyme', 'fondos europeos', 'ayudas gubernamentales',
  'convocatorias abiertas', 'financiacion proyectos', 'grants innovation',
  'startup funding spain', 'horizon europe', 'next generation eu'
];

const GRANT_TEMPLATES = [
  { titulo: "Horizon Europe - Cluster 6: Alimentacion, Bioeconomia, Agricultura", entidad: "Comision Europea", descripcion: "Convocatoria para proyectos de investigacion e innovacion en bioeconomia y agricultura sostenible dentro del programa marco Horizon Europe.", cuantia: "Hasta 15M EUR", sector: "I+D+i", pais: "EU" },
  { titulo: "Programa Kit Digital - Ayudas para digitalizacion de pymes", entidad: "Red.es / Ministerio de Asuntos Economicos", descripcion: "Subvenciones destinadas a la digitalizacion de pequenas y medianas empresas espanolas. Cubre desde presencia web hasta inteligencia empresarial.", cuantia: "Hasta 12.000 EUR", sector: "Digitalizacion", pais: "Espana" },
  { titulo: "LINEA ICO - Emprendedores y Empresas 2026", entidad: "Instituto de Credito Oficial", descripcion: "Linea de financiacion para emprendedores y empresas que deseen invertir en proyectos de crecimiento, innovacion y digitalizacion.", cuantia: "Hasta 10M EUR", sector: "Financiacion", pais: "Espana" },
  { titulo: "Next Generation EU - PERTE Agroalimentario", entidad: "Ministerio de Agricultura", descripcion: "Proyecto Estrategico para la Recuperacion y Transformacion Economica del sector agroalimentario con fondos europeos.", cuantia: "Hasta 50M EUR", sector: "Agroalimentario", pais: "Espana" },
  { titulo: "ENISA - Prestamos Participativos para Startups", entidad: "Empresa Nacional de Innovacion", descripcion: "Prestamos participativos para empresas de base tecnologica e innovadoras en etapas tempranas con alto potencial de crecimiento.", cuantia: "Hasta 1.5M EUR", sector: "Startups", pais: "Espana" },
  { titulo: "EIC Accelerator - European Innovation Council", entidad: "Comision Europea", descripcion: "Financiacion para startups y pymes con tecnologias disruptivas listas para escalar a mercado. Incluye grant + equity.", cuantia: "Hasta 17.5M EUR", sector: "Deep Tech", pais: "EU" },
  { titulo: "Programa NEOTEC - Centro para el Desarrollo Tecnologico Industrial", entidad: "CDTI", descripcion: "Ayudas destinadas a la creacion y consolidacion de empresas de base tecnologica con proyectos innovadores y viabilidad comercial.", cuantia: "Hasta 350.000 EUR", sector: "Tecnologico", pais: "Espana" },
  { titulo: "LIFE Programme - Environment and Climate Action", entidad: "Comision Europea", descripcion: "Convocatoria para proyectos de accion por el clima, conservacion de la naturaleza y economia circular en la Union Europea.", cuantia: "Hasta 10M EUR", sector: "Medio Ambiente", pais: "EU" },
  { titulo: "Erasmus for Young Entrepreneurs", entidad: "Comision Europea", descripcion: "Programa de intercambio que permite a nuevos emprendedores adquirir habilidades trabajando con empresarios experimentados en otro pais de la UE.", cuantia: "Hasta 3.000 EUR", sector: "Emprendimiento", pais: "EU" },
  { titulo: "Creative Europe - MEDIA Programme", entidad: "Comision Europea", descripcion: "Apoyo a los sectores audiovisual, cultural y creativo europeo para el desarrollo de contenidos, distribucion y formacion.", cuantia: "Hasta 500.000 EUR", sector: "Cultura", pais: "EU" }
];

const CRAWL_LOG = [];

export function getLastCrawlLog() {
  const db = getDb();
  try {
    return getRows(db, 'SELECT * FROM crawl_log ORDER BY ejecutada_en DESC LIMIT 10');
  } finally { closeDb(db); }
}

export function getSubvenciones(filtros = {}) {
  const db = getDb();
  try {
    let where = '1=1';
    const params = [];
    if (filtros.sector) { where += ' AND sector = ?'; params.push(filtros.sector); }
    if (filtros.pais) { where += ' AND pais = ?'; params.push(filtros.pais); }
    if (filtros.estado) { where += ' AND estado = ?'; params.push(filtros.estado); }
    const limit = parseInt(filtros.limit || '50', 10);
    const page = parseInt(filtros.page || '1', 10);
    const offset = (page - 1) * limit;
    const rows = getRows(db, `SELECT * FROM subvenciones WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const total = getCount(db, `SELECT COUNT(*) as c FROM subvenciones WHERE ${where}`, params);
    return { data: rows, total, page, limit };
  } finally { closeDb(db); }
}

export async function ejecutarBarrido(apiKey) {
  const db = getDb();
  const encontradas = [];
  const ahora = new Date().toISOString();

  try {
    console.log(`[Crawler] Iniciando barrido: ${ahora}`);

    if (apiKey) {
      try {
        const serper = await buscarConSerper(apiKey);
        encontradas.push(...serper);
        console.log(`[Crawler] Serper devolvio ${serper.length} resultados`);
      } catch (e) {
        console.log(`[Crawler] Serper fallo: ${e.message}, usando datos simulados`);
      }
    }

    if (encontradas.length === 0) {
      const randomGrants = [...GRANT_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 5 + Math.floor(Math.random() * 4));
      for (const g of randomGrants) {
        const dias = 15 + Math.floor(Math.random() * 120);
        const fini = new Date();
        fini.setDate(fini.getDate() + dias);
        encontradas.push({
          titulo: g.titulo, entidad: g.entidad,
          descripcion: g.descripcion, fecha_limite: fini.toISOString().split('T')[0],
          cuantia: g.cuantia, requisitos: g.sector,
          url: `https://ejemplo.com/${g.titulo.toLowerCase().replace(/\s+/g, '-')}`,
          sector: g.sector, pais: g.pais, source: 'simulado'
        });
      }
    }

    let insertadas = 0;
    for (const g of encontradas) {
      const existente = getRow(db, 'SELECT id FROM subvenciones WHERE titulo = ? AND entidad = ?', [g.titulo, g.entidad]);
      if (!existente) {
        runSql(db, `INSERT INTO subvenciones (titulo, entidad, descripcion, fecha_limite, cuantia, requisitos, url, sector, pais, source, estado)
          VALUES (?,?,?,?,?,?,?,?,?,?,'activa')`,
          [g.titulo, g.entidad, g.descripcion || '', g.fecha_limite || '', g.cuantia || '',
           g.requisitos || '', g.url || '', g.sector || '', g.pais || '', g.source || 'crawler']);
        insertadas++;
      }
    }

    runSql(db, `INSERT INTO crawl_log (tipo, fuente, subvenciones_encontradas, resultado, ejecutada_en)
      VALUES ('barrido', ?, ?, ?, ?)`,
      [apiKey ? 'serper' : 'simulado', encontradas.length, `OK: ${insertadas} nuevas insertadas`, ahora]);

    console.log(`[Crawler] Barrido completado: ${encontradas.length} encontradas, ${insertadas} nuevas`);
    return { success: true, encontradas: encontradas.length, nuevas: insertadas, timestamp: ahora };
  } finally { closeDb(db); }
}

async function buscarConSerper(apiKey) {
  const resultados = [];
  for (const kw of KEYWORDS.slice(0, 3)) {
    const url = `https://google.serper.dev/search?q=${encodeURIComponent(kw + ' 2026')}&num=10`;
    const res = await fetch(url, { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } });
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of (data.organic || [])) {
      if (item.title && item.link) {
        resultados.push({
          titulo: item.title.slice(0, 300),
          entidad: item.source || 'Desconocido',
          descripcion: (item.snippet || '').slice(0, 500),
          fecha_limite: '',
          cuantia: '',
          requisitos: '',
          url: item.link,
          sector: 'General',
          pais: 'Internacional',
          source: 'serper'
        });
      }
    }
  }
  return resultados;
}
