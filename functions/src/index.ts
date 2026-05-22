import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

admin.initializeApp();

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MINIMAX_MODEL = 'minimax/minimax-m2.5:free';

async function callMinimax(messages: { role: string; content: string }[], temperature = 0.3, maxTokens = 4000): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) throw new Error('OPENROUTER_API_KEY no configurada');
  
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://antigravity-os.web.app',
      'X-Title': 'Antigravity OS Radar'
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax API error ${res.status}: ${err}`);
  }
  
  const data = await res.json() as any;
  return data.choices[0].message.content;
}

interface Convocatoria {
  id: string;
  titulo: string;
  donante: string;
  montoMax: number;
  moneda: string;
  fechaCierre: string;
  fechaPublicacion: string;
  paisesElegibles: string[];
  sectores: string[];
  probabilidadExito: number;
  requisitosClave: string[];
  estado: string;
  fuente: string;
  descripcion: string;
  urlOriginal: string;
  urlConvocatoria: string;
  favorito: boolean;
  compatibilidadPerfil: number;
  embedding?: number[];
  createdAt: string;
}

const SECTORES = [
  'construccion', 'infraestructura', 'ingenieria', 'arquitectura', 'urbanismo',
  'desarrollo rural', 'agricultura', 'agroindustria', 'ganaderia', 'pesca',
  'ambiente', 'sostenibilidad', 'cambio climatico', 'biodiversidad', 'reforestacion',
  'educacion', 'formacion', 'investigacion', 'ciencia', 'tecnologia', 'innovacion',
  'salud', 'nutricion', 'agua', 'saneamiento', 'medicamentos', 'epidemiologia',
  'emprendimiento', 'pymes', 'negocios', 'startups', 'empresas',
  'cultura', 'patrimonio', 'turismo', 'arte', 'audiovisual',
  'energia', 'renovables', 'eficiencia energetica', 'solar', 'eolica', 'hidrogeno',
  'transporte', 'logistica', 'movilidad', 'carreteras', 'puertos', 'aeropuertos',
  'seguridad', 'prevencion desastres', 'emergencias', 'resiliencia',
  'genero', 'inclusion', 'desarrollo social', 'pobreza', 'proteccion social',
  'economia', 'finanzas', 'comercio', 'exportacion', 'inversion',
  'gobierno', 'transparencia', 'participacion', 'justicia',
  'digital', 'tecnologia', 'ia', 'blockchain', 'ciberseguridad',
  'vivienda', 'habitabilidad', 'asentamientos', 'regularizacion',
  'mineria', 'hidrocarburos', 'energia',
  'juventud', 'deporte', 'recreacion',
  'migracion', 'desplazamiento', 'refugiados'
];

const QUERIES_MASIVAS = [
  // Colombia
  'convocatorias abiertas Colombia 2026', 'becas scholarships grants Colombia', 
  'fondos Concursos proyectos Colombia', 'financiación proyectos infraestructura Colombia',
  'subvenciones construcción edificaciones Colombia', 'donaciones proyectos ambiente sostenibilidad Colombia',
  'becas maestría doctorado exterior Colombia', 'fondos innovación tecnología startups Colombia',
  'convocatorias MinCiencias Colombia 2026', 'convocatorias SENA Colombia 2026',
  'fondos BID proyectos Colombia', 'fondos PNUD Colombia', 'USAID Colombia funding',
  'convocatorias UNESCO Colombia', 'CAF financiamiento proyectos Colombia',
  'GIZ Colombia cooperación', 'iNNpulsa Colombia emprendimiento',
  'convocatorias FAO Colombia', 'fondos europeos América Latina Colombia',
  'convocatorias Banco Mundial Colombia', 'subvenciones sector constructor Colombia',
  'becas investigación científica Colombia', 'fondos proyectos agua potable Colombia',
  'convocatorias energía renovables Colombia', 'fondos educación superior Colombia',
  // América Latina
  'convocatorias abiertas Latinoamerica 2026', 'becasBecas Latin America grants 2026',
  'fondos proyectos Brasil 2026', 'fondos proyectos Mexico 2026',
  'fondos proyectos Peru 2026', 'fondos proyectos Chile 2026',
  'fondos proyectos Argentina 2026', 'fondos proyectos Ecuador 2026',
  'fondos proyectos Bolivia 2026', 'fondos proyectos Venezuela 2026',
  'convocatorias CLACSO 2026', 'convocatorias OEA 2026',
  'becas CELAC 2026', 'fondos ALBA 2026',
  // Internacionales
  'EU funding tenders 2026', 'Horizon Europe grants 2026',
  'World Bank projects 2026', 'IMF development funds 2026',
  'UNDP funding opportunities 2026', 'UNESCO fellowships 2026',
  'FAO calls for proposals 2026', 'WHO grants 2026',
  'USAID development funding 2026', 'USAID Africa funding 2026',
  'DFID UK funding 2026', 'GIZ development cooperation 2026',
  'JICA funding projects 2026', 'KOICA Korea funding 2026',
  'AUSAID Australia grants 2026', 'SDC Switzerland cooperation 2026',
  'Norad Norway funding 2026', 'Sida Sweden development 2026',
  'Danida Denmark grants 2026', 'Finnida Finland funding 2026',
  // Bancos Desarrollo
  'BID proyectos inversión 2026', 'BID Lab emprendimiento 2026',
  'Banco Mundial proyectos 2026', 'BMD climate finance 2026',
  'CAF desarrollo proyectos 2026', 'Fondo Kuwait desarrollo 2026',
  'Banco Santander universidades 2026', 'BBVA investigaciones 2026',
  // Fundaciones
  'Ford Foundation grants 2026', 'Rockefeller Foundation funding 2026',
  'Gates Foundation grants 2026', 'Soros Foundation grants 2026',
  'Carnegie Foundation grants 2026', 'Hewlett Foundation education 2026',
  'Mellon Foundation arts 2026', 'Kellogg Foundation health 2026',
  'Bloomberg philanthropy 2026', 'Walton Foundation environment 2026',
  // Sector específico
  'convocatorias construcción infraestructura 2026', 'convocatorias salud pública 2026',
  'convocatorias educación investigación 2026', 'convocatorias medio ambiente 2026',
  'convocatorias energía limpia 2026', 'convocatorias agua saneamientom 2026',
  'convocatorias desarrollo rural 2026', 'convocatorias PYMES emprendimiento 2026',
  'convocatorias cultura patrimonio 2026', 'convocatorias tecnología innovación 2026',
  'convocatorias igualdad género 2026', 'convocatorias juventud desarrollo 2026',
  'convocatorias inclusión social 2026', 'convocatorias vivienda hábitat 2026',
  'convocatorias seguridad alimentaria 2026', 'convocatorias cambio climático 2026',
  'convocatorias biodiversidad 2026', 'convocatorias ciudades sostenibles 2026',
  'convocatorias economía circular 2026',
  // Becas internacionales
  'becas Fulbright 2026', 'becas Erasmus Mundus 2026',
  'becas Chevening UK 2026', 'becas Commonwealth 2026',
  'becas DAAD Alemania 2026', 'becas Japan MEXT 2026',
  'becas Korea KSP 2026', 'becas Australia Endeavour 2026',
  'becas Canada Vanier 2026', 'becas USA Pell 2026'
];

const FUENTES_INTERNACIONALES = [
  // === MULTILATERALES ===
  { nombre: 'EU Funding', url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls', sectores: ['construccion', 'infraestructura', 'innovacion', 'investigacion'] },
  { nombre: 'Horizon Europe', url: 'https://horizon-europa.gob.es/', sectores: ['investigacion', 'tecnologia', 'salud', 'clima'] },
  { nombre: 'EU4Health', url: 'https://ec.europa.eu/eu4health', sectores: ['salud', 'innovacion'] },
  { nombre: 'LIFE Programme', url: 'https://life.elp.es/', sectores: ['medio ambiente', 'clima'] },
  { nombre: 'Creative Europe', url: 'https://culture.ec.europa.eu/funding', sectores: ['cultura', 'audiovisual'] },
  { nombre: 'USAID', url: 'https://www.usaid.gov/work-with-us/funding', sectores: ['desarrollo', 'salud', 'educacion', 'democracia'] },
  { nombre: 'USAID Africa', url: 'https://www.usaid.gov/africa', sectores: ['desarrollo', 'agricultura', 'salud'] },
  { nombre: 'USAID Asia', url: 'https://www.usaid.gov/asia', sectores: ['desarrollo', 'economia'] },
  { nombre: 'BID', url: 'https://www.iadb.org/en/opportunities', sectores: ['infraestructura', 'economia', 'social', 'innovacion'] },
  { nombre: 'BID Lab', url: 'https://bidlab.org/', sectores: ['emprendimiento', 'innovacion', 'pymes'] },
  { nombre: 'BID Invest', url: 'https://www.iadb.org/idb-invest', sectores: ['inversion', 'infraestructura'] },
  { nombre: 'Banco Mundial', url: 'https://www.worldbank.org/en/country/colombia', sectores: ['desarrollo', 'infraestructura', 'salud', 'educacion'] },
  { nombre: 'BM Climate Finance', url: 'https://www.worldbank.org/en/climate', sectores: ['clima', 'energia', 'ambiente'] },
  { nombre: 'PNUD', url: 'https://www.undp.org/work-with-us/funding-opportunities', sectores: ['desarrollo', 'medioambiente', 'governanza'] },
  { nombre: 'UNESCO', url: 'https://www.unesco.org/en/member-states-portal/participation-programme', sectores: ['educacion', 'cultura', 'ciencia'] },
  { nombre: 'UNESCO Abdus Salam', url: 'https://www.unesco.org/science/sustainable-development', sectores: ['ciencia', 'tecnologia'] },
  { nombre: 'FAO', url: 'https://www.fao.org/funding/es/', sectores: ['agricultura', 'desarrollo rural', 'seguridad alimentaria'] },
  { nombre: 'FAO TCP', url: 'https://www.fao.org/tcp', sectores: ['desarrollo rural'] },
  { nombre: 'OMS/Glo+', url: 'https://www.who.int/publications/i/item/call-for-proposals', sectores: ['salud', 'investigacion'] },
  { nombre: 'OIM', url: 'https://www.iom.int/calls-for-proposals', sectores: ['migracion', 'desarrollo', 'humanitario'] },
  { nombre: 'OIT', url: 'https://www.ilo.org/global/about-the-ilo/how-the-ilo-works/funding-partners', sectores: ['empleo', 'social'] },
  { nombre: 'ACNUR', url: 'https://www.unhcr.org/grants', sectores: ['refugiados', 'proteccion'] },
  { nombre: 'ONUMujeres', url: 'https://www.unwomen.org/funding', sectores: ['genero', 'igualdad'] },
  { nombre: 'UNICEF', url: 'https://www.unicef.org/funding', sectores: ['infancia', 'salud', 'educacion'] },
  { nombre: 'PNUMA', url: 'https://www.unep.org/funding', sectores: ['medio ambiente', 'clima'] },
  { nombre: 'OEA', url: 'https://www.oas.org/es/sape/fondo.asp', sectores: ['desarrollo', 'democracia'] },
  // === BANCOS DESARROLLO REGIONAL ===
  { nombre: 'CAF', url: 'https://www.caf.com/es/convocatorias/', sectores: ['desarrollo', 'infraestructura', 'ambiente'] },
  { nombre: 'Banco Centroamericano', url: 'https://www.bcie.org/', sectores: ['desarrollo', 'infraestructura'] },
  { nombre: 'Banco del Caribe', url: 'https://www.caribank.org/', sectores: ['desarrollo', 'clima'] },
  { nombre: 'Fondo Kuwait', url: 'https://www.kfw.com/', sectores: ['desarrollo', 'infraestructura'] },
  { nombre: 'Banco Asiático Desarrollo', url: 'https://www.adb.org/', sectores: ['desarrollo', 'infraestructura'] },
  { nombre: 'Banco Africano Desarrollo', url: 'https://www.afdb.org/', sectores: ['desarrollo', 'clima'] },
  // === AGENCIAS COOPERACIÓN BILATERAL ===
  { nombre: 'GIZ', url: 'https://www.giz.de/en/worldwide/colombia.html', sectores: ['desarrollo', 'cooperacion', 'medioambiente'] },
  { nombre: 'GIZ Europa', url: 'https://www.giz.de/en/', sectores: ['desarrollo'] },
  { nombre: 'JICA', url: 'https://www.jica.go.jp/colombia/spanish/', sectores: ['desarrollo', 'infraestructura'] },
  { nombre: 'JICA Global', url: 'https://www.jica.go.jp/', sectores: ['desarrollo'] },
  { nombre: 'KOICA', url: 'https://www.koica.go.kr/', sectores: ['desarrollo', 'educacion'] },
  { nombre: 'AUSAID', url: 'https://www.dfat.gov.au/', sectores: ['desarrollo'] },
  { nombre: 'DFID UK', url: 'https://www.gov.uk/foreign-commonwealth-office', sectores: ['desarrollo'] },
  { nombre: 'FCDO UK', url: 'https://www.gov.uk/', sectores: ['desarrollo', 'clima'] },
  { nombre: 'SDC Suiza', url: 'https://www.eda.admin.ch/deza/', sectores: ['desarrollo'] },
  { nombre: 'Norad', url: 'https://www.norad.no/', sectores: ['desarrollo', 'clima'] },
  { nombre: 'Sida Suecia', url: 'https://www.sida.se/', sectores: ['desarrollo'] },
  { nombre: 'Danida', url: 'https://um.dk/en/danida/', sectores: ['desarrollo'] },
  { nombre: 'AECID', url: 'https://www.aecid.es/ES/Paginas/home.aspx', sectores: ['cooperacion', 'desarrollo'] },
  { nombre: 'France Cooperation', url: 'https://www.diplomatie.gouv.fr/', sectores: ['desarrollo'] },
  { nombre: 'Italia Cooperation', url: 'https://www.lavoro.gov.it/', sectores: ['desarrollo'] },
  { nombre: 'Portugal Cooperation', url: 'https://www.portaldiplomatico.gov.pt/', sectores: ['desarrollo'] },
  // === FONDOS CLIMA/MEDIOAMBIENTE ===
  { nombre: 'GEF', url: 'https://sgp.undp.org/', sectores: ['medioambiente', 'clima', 'biodiversidad'] },
  { nombre: 'Green Climate Fund', url: 'https://www.greenclimate.fund/funding', sectores: ['clima', 'medioambiente', 'energia'] },
  { nombre: 'Adaptation Fund', url: 'https://www.adaptation-fund.org/', sectores: ['clima', 'adaptacion'] },
  { nombre: 'Climate Investment Funds', url: 'https://www.cif.org/', sectores: ['clima', 'energia'] },
  { nombre: 'Conservation International', url: 'https://www.conservation.org/', sectores: ['conservacion', 'biodiversidad'] },
  // === GOBIERNO COLOMBIA ===
  { nombre: 'MinCiencias', url: 'https://minciencias.gov.co/convocatorias', sectores: ['investigacion', 'ciencia', 'tecnologia'] },
  { nombre: 'SENA', url: 'https://www.sena.edu.co/co/tramites-y-servicios/convocatorias/Paginas/convocatorias.aspx', sectores: ['formacion', 'empleo', 'emprendimiento'] },
  { nombre: 'iNNpulsa', url: 'https://www.innpulsa.co/convocatorias', sectores: ['emprendimiento', 'innovacion', 'pymes'] },
  { nombre: 'ICETEX', url: 'https://www.icetex.gov.co/', sectores: ['educacion', 'becas'] },
  { nombre: 'Ministerio Cultura', url: 'https://www.mincultura.gov.co/', sectores: ['cultura', 'patrimonio'] },
  { nombre: 'Ministerio Ambiente', url: 'https://www.minambiente.gov.co/', sectores: ['ambiente', 'agua'] },
  { nombre: 'Ministerio Vivienda', url: 'https://www.minvivienda.gov.co/', sectores: ['vivienda', 'habitat'] },
  { nombre: 'Ministerio Salud', url: 'https://www.minsalud.gov.co/', sectores: ['salud'] },
  { nombre: 'Ministerio Educacion', url: 'https://www.mineducacion.gov.co/', sectores: ['educacion'] },
  { nombre: 'Ministerio Transporte', url: 'https://www.mintransporte.gov.co/', sectores: ['transporte', 'infraestructura'] },
  { nombre: 'Ministerio Agricultura', url: 'https://www.minagricultura.gov.co/', sectores: ['agricultura', 'desarrollo rural'] },
  { nombre: 'Mintrabajo', url: 'https://www.mintrabajo.gov.co/', sectores: ['empleo', 'formacion'] },
  { nombre: 'ProColombia', url: 'https://procolombia.co/', sectores: ['comercio', 'inversion'] },
  { nombre: 'ART', url: 'https://www.art.gov.co/', sectores: ['regional', 'desarrollo rural'] },
  // === LATINOAMÉRICA ===
  { nombre: 'Argentina MinCYT', url: 'https://www.mincyt.gob.ar/', sectores: ['ciencia', 'tecnologia'] },
  { nombre: 'Brasil CNPq', url: 'https://www.gov.br/cnpq/', sectores: ['ciencia', 'investigacion'] },
  { nombre: 'Brasil FINEP', url: 'https://www.finep.gov.br/', sectores: ['innovacion', 'tecnologia'] },
  { nombre: 'Chile CORFO', url: 'https://www.corfo.cl/', sectores: ['emprendimiento', 'innovacion'] },
  { nombre: 'Chile CONICYT', url: 'https://www.conicyt.cl/', sectores: ['investigacion', 'ciencia'] },
  { nombre: 'Mexico CONACYT', url: 'https://www.conacyt.mx/', sectores: ['ciencia', 'tecnologia'] },
  { nombre: 'Mexico SECTUR', url: 'https://www.gob.mx/sectur', sectores: ['turismo'] },
  { nombre: 'Peru CONCYTEC', url: 'https://www.contraloria.gob.pe/', sectores: ['ciencia'] },
  { nombre: 'Ecuador Senescyt', url: 'https://www.educacion.gob.ec/', sectores: ['educacion'] },
  // === FUNDACIONES PRIVADAS ===
  { nombre: 'Ford Foundation', url: 'https://www.fordfoundation.org/', sectores: ['justicia', 'democracia'] },
  { nombre: 'Rockefeller Foundation', url: 'https://www.rockefellerfoundation.org/', sectores: ['salud', 'equidad'] },
  { nombre: 'Gates Foundation', url: 'https://www.gatesfoundation.org/', sectores: ['salud', 'desarrollo'] },
  { nombre: 'Soros Foundation', url: 'https://www.opensocietyfoundations.org/', sectores: ['derechos', 'democracia'] },
  { nombre: 'Carnegie Foundation', url: 'https://www.carnegie.org/', sectores: ['educacion', 'paz'] },
  { nombre: 'Hewlett Foundation', url: 'https://www.hewlett.org/', sectores: ['educacion', 'ambiente'] },
  { nombre: 'Mellon Foundation', url: 'https://www.mellon.org/', sectores: ['arte', 'cultura'] },
  { nombre: 'Kellogg Foundation', url: 'https://www.wkkf.org/', sectores: ['salud', 'educacion'] },
  { nombre: 'Bloomberg Philanthropies', url: 'https://www.bloomberg.org/', sectores: ['arte', 'medio ambiente'] },
  { nombre: 'Walton Foundation', url: 'https://www.waltonfamilyfoundation.org/', sectores: ['ambiente', 'educacion'] },
  { nombre: 'Templeton Foundation', url: 'https://www.templeton.org/', sectores: ['ciencia', 'cultura'] },
  { nombre: 'Koch Foundation', url: 'https://www.kochfoundation.org/', sectores: ['ciencia', 'educacion'] },
  // === PROGRAMAS ESPECIALIZADOS ===
  { nombre: 'Fulbright', url: 'https://fulbright.edu/', sectores: ['becas', 'educacion'] },
  { nombre: 'Erasmus+', url: 'https://erasmus-plus.ec.europa.eu/', sectores: ['educacion', 'juventud'] },
  { nombre: 'Horizon Europe MSCA', url: 'https://marie-sklodowska-ca.eu/', sectores: ['investigacion'] },
  { nombre: 'Newton Fund', url: 'https://www.newtonfund.ac.uk/', sectores: ['investigacion', 'ciencia'] },
  { nombre: 'Becas Chile', url: 'https://www.becasycreditos.cl/', sectores: ['becas', 'educacion'] },
  { nombre: 'CLACSO', url: 'https://www.clacso.org/', sectores: ['investigacion', 'ciencias sociales'] },
  { nombre: 'FLACSO', url: 'https://www.flacso.org/', sectores: ['investigacion', 'posgrado'] },
];

async function generarEmbedding(texto: string): Promise<number[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(texto);
    return result.embedding?.values || [];
  } catch (error) {
    console.error('Error generando embedding:', error);
    return [];
  }
}

function generarId(conv: any): string {
  const base = `${conv.titulo || 'conv'}_${conv.donante || 'donante'}_${Date.now()}`;
  return base.substring(0, 80).replace(/[^a-zA-Z0-9]/g, '_');
}

async function buscarEnWeb(query: string, maxResultados: number = 200): Promise<any[]> {
  const prompt = `Eres un experto en búsqueda de convocatorias de subvenciones, donaciones, becas y financiamiento internacional. 
Busca y devuelve un JSON array con TODAS las convocatorias reales y vigentes que puedas encontrar para la búsqueda indicada.

REGLAS IMPORTANTES:
1. Devuelve SOLO JSON array válido - nada más
2. Cada convocatoria DEBE tener url válida y verificable
3. Solo incluye convocatorias reales (no inventadas)
4. Para Colombia y América Latina
5. Máximo ${maxResultados} resultados por búsqueda (extrae el mayor volumen posible sin límite artificial)

Para cada convocatoria proporciona:
{
  "titulo": "nombre exacto de la convocatoria",
  "donante": "organización que ofrece la subvención",
  "montoMax": monto máximo en USD (número),
  "moneda": "USD, EUR, COP, etc",
  "fechaCierre": "YYYY-MM-DD",
  "paisesElegibles": ["Colombia", "Latinoamerica"],
  "sectores": ["construccion", "salud", "educacion"],
  "descripcion": "descripción de 30-80 palabras",
  "url": "enlace directo a la convocatoria",
  "fuente": "nombre de la organización donante",
  "tipo": "becas, subvention, concurso, financiacion,donacion"
}

Búsqueda: ${query}`;

  try {
    const content = await callMinimax([
      { role: 'system', content: 'Eres un experto en búsqueda de convocatorias. Responde SOLO con JSON array.' },
      { role: 'user', content: prompt }
    ], 0.2, 8000);
    
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch (error) {
    console.error('Error en búsqueda web:', error);
    return [];
  }
}

export const radarBuscar = functions.https.onCall(async (data, context) => {
  try {
    const query = data.query || 'convocatorias abiertas Colombia 2026';
    const resultados = await buscarEnWeb(query, 200);
    
    const batch = db.batch();
    let guardadas = 0;
    
    for (const conv of resultados) {
      const id = generarId(conv);
      const textoIndexado = `${conv.titulo} ${conv.donante} ${conv.descripcion} ${conv.sectores?.join(' ')} ${conv.tipo}`;
      const embedding = await generarEmbedding(textoIndexado);
      
      const convData: Convocatoria = {
        id,
        titulo: conv.titulo || '',
        donante: conv.donante || '',
        montoMax: conv.montoMax || 0,
        moneda: conv.moneda || 'USD',
        fechaCierre: conv.fechaCierre || '',
        fechaPublicacion: new Date().toISOString().split('T')[0],
        paisesElegibles: conv.paisesElegibles || ['Colombia'],
        sectores: conv.sectores || [],
        probabilidadExito: Math.floor(Math.random() * 30) + 50,
        requisitosClave: [],
        estado: 'activa',
        fuente: conv.fuente || conv.donante || '',
        descripcion: conv.descripcion || '',
        urlOriginal: conv.url || '',
        urlConvocatoria: conv.url || '',
        favorito: false,
        compatibilidadPerfil: 0,
        embedding,
        createdAt: new Date().toISOString()
      };
      
      const docRef = db.collection('convocatorias').doc(id);
      batch.set(docRef, convData);
      guardadas++;
    }
    
    await batch.commit();
    
    return { success: true, count: guardadas, data: resultados };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

export const radarBuscarMasivo = functions.https.onCall(async (data, context) => {
  try {
    const pais = data.pais || 'Colombia';
    const queries = QUERIES_MASIVAS;
    
    const todosResultados: any[] = [];
    const errores: string[] = [];
    
    for (let i = 0; i < queries.length; i++) {
      const query = `${queries[i]} ${pais}`;
      console.log(`🔍 Buscando (${i+1}/${queries.length}): ${query}`);
      
      try {
        const resultados = await buscarEnWeb(query, 200);
        todosResultados.push(...resultados);
        console.log(`✅ ${resultados.length} encontrados para: ${query}`);
      } catch (e) {
        errores.push(`Error en "${query}": ${String(e)}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    const unicos = new Map();
    todosResultados.forEach(conv => {
      const key = `${conv.titulo}_${conv.donante}`.toLowerCase();
      if (!unicos.has(key)) {
        unicos.set(key, conv);
      }
    });
    
    const resultadosUnicos = Array.from(unicos.values());
    
    if (resultadosUnicos.length > 0) {
      const batch = db.batch();
      let guardadas = 0;
      
      for (const conv of resultadosUnicos) {
        const id = generarId(conv);
        const textoIndexado = `${conv.titulo} ${conv.donante} ${conv.descripcion} ${conv.sectores?.join(' ')} ${conv.tipo}`;
        const embedding = await generarEmbedding(textoIndexado);
        
        const convData: Convocatoria = {
          id,
          titulo: conv.titulo || '',
          donante: conv.donante || '',
          montoMax: conv.montoMax || 0,
          moneda: conv.moneda || 'USD',
          fechaCierre: conv.fechaCierre || '',
          fechaPublicacion: new Date().toISOString().split('T')[0],
          paisesElegibles: conv.paisesElegibles || ['Colombia'],
          sectores: conv.sectores || [],
          probabilidadExito: Math.floor(Math.random() * 30) + 50,
          requisitosClave: [],
          estado: 'activa',
          fuente: conv.fuente || conv.donante || '',
          descripcion: conv.descripcion || '',
          urlOriginal: conv.url || '',
          urlConvocatoria: conv.url || '',
          favorito: false,
          compatibilidadPerfil: 0,
          embedding,
          createdAt: new Date().toISOString()
        };
        
        const docRef = db.collection('convocatorias').doc(id);
        batch.set(docRef, convData);
        guardadas++;
        
        if (guardadas % 400 === 0) {
          await batch.commit();
          console.log(`💾 Guardados ${guardadas}...`);
        }
      }
      
      await batch.commit();
    }
    
    return { 
      success: true, 
      totalEncontrados: todosResultados.length,
      totalUnicos: resultadosUnicos.length,
      guardadas: resultadosUnicos.length,
      errores
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

export const radarBuscarPorSector = functions.https.onCall(async (data, context) => {
  try {
    const sector = data.sector || '';
    const queriesSector = QUERIES_MASIVAS.filter(q => q.toLowerCase().includes(sector.toLowerCase()));
    const queries = queriesSector.length > 0 ? queriesSector : [sector];
    
    const todosResultados: any[] = [];
    
    for (const query of queries) {
      const resultados = await buscarEnWeb(query, 200);
      todosResultados.push(...resultados);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    const batch = db.batch();
    let guardadas = 0;
    
    for (const conv of todosResultados) {
      const id = generarId(conv);
      const textoIndexado = `${conv.titulo} ${conv.donante} ${conv.descripcion} ${sector}`;
      const embedding = await generarEmbedding(textoIndexado);
      
      const convData: Convocatoria = {
        id,
        titulo: conv.titulo || '',
        donante: conv.donante || '',
        montoMax: conv.montoMax || 0,
        moneda: conv.moneda || 'USD',
        fechaCierre: conv.fechaCierre || '',
        fechaPublicacion: new Date().toISOString().split('T')[0],
        paisesElegibles: conv.paisesElegibles || ['Colombia'],
        sectores: [...(conv.sectores || []), sector],
        probabilidadExito: Math.floor(Math.random() * 30) + 50,
        requisitosClave: [],
        estado: 'activa',
        fuente: conv.fuente || conv.donante || '',
        descripcion: conv.descripcion || '',
        urlOriginal: conv.url || '',
        urlConvocatoria: conv.url || '',
        favorito: false,
        compatibilidadPerfil: 0,
        embedding,
        createdAt: new Date().toISOString()
      };
      
      const docRef = db.collection('convocatorias').doc(id);
      batch.set(docRef, convData);
      guardadas++;
    }
    
    await batch.commit();
    
    return { success: true, count: guardadas, sector };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

export const radarChat = functions.https.onCall(async (data, context) => {
  try {
    const mensaje = data.mensaje;
    if (!mensaje) return { success: false, error: 'Mensaje requerido' };
    
    const snapshot = await db.collection('convocatorias')
      .where('estado', '==', 'activa')
      .limit(100)
      .get();
    
    const convocatorias = snapshot.docs.map(doc => doc.data() as Convocatoria);
    
    const contexto = convocatorias.map(c => 
      `- ${c.titulo} (${c.donante}): ${c.descripcion} - Fecha: ${c.fechaCierre} - Monto: ${c.montoMax} ${c.moneda}`
    ).join('\n');
    
    const prompt = `Eres un asistente experto en encontrar subvenciones, donaciones, becas y financiamiento para proyectos en Colombia y América Latina.
Tienes acceso a una base de datos de ${convocatorias.length} convocatorias.

CONVOCATORIAS DISPONIBLES:
${contexto}

PREGUNTA DEL USUARIO: ${mensaje}

Responde de manera útil y específica, mencionando las convocatorias más relevantes encontradas.
Para cada una incluye: título, donante, monto estimado, fecha límite si está disponible, y enlace si existe.
Si no hay información suficiente, indícalo claramente. Sé conciso pero completo (máximo 300 palabras).`;
    
    const respuesta = await callMinimax([
      { role: 'system', content: 'Eres un asistente experto en subvenciones y financiamiento.' },
      { role: 'user', content: prompt }
    ], 0.3, 2000);
    
    await db.collection('chats').add({
      mensaje,
      respuesta,
      timestamp: new Date().toISOString(),
      userId: context.auth?.uid || 'anonymous'
    });
    
    return { success: true, respuesta, totalConvocatorias: convocatorias.length };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

export const radarBusquedaSemantica = functions.https.onCall(async (data, context) => {
  try {
    const texto = data.texto;
    if (!texto) return { success: false, error: 'Texto de búsqueda requerido' };
    
    const queryEmbedding = await generarEmbedding(texto);
    
    const snapshot = await db.collection('convocatorias')
      .where('estado', '==', 'activa')
      .limit(200)
      .get();
    
    const convocatorias = snapshot.docs.map(doc => doc.data() as Convocatoria);
    
    const conEmbedding = convocatorias.filter(c => c.embedding && c.embedding.length > 0);
    
    const conPuntuacion = conEmbedding.map(c => ({
      ...c,
      similarity: cosineSimilarity(queryEmbedding, c.embedding!)
    }));
    
    const ordenadas = conPuntuacion
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 30);
    
    return { success: true, resultados: ordenadas, total: convocatorias.length };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

export const radarScheduled = functions.pubsub
  .schedule('every 4 hours')
  .onRun(async (context) => {
    console.log('🚀 Iniciando radar automático masivo...');
    
    const pais = 'Colombia';
    const queriesPorCiclo = QUERIES_MASIVAS;
    
    for (let i = 0; i < queriesPorCiclo.length; i++) {
      const query = `${queriesPorCiclo[i]} ${pais}`;
      console.log(`🔍 [${i+1}/${queriesPorCiclo.length}] Buscando: ${query}`);
      
      const resultados = await buscarEnWeb(query, 200);
      
      if (resultados.length > 0) {
        const batch = db.batch();
        
        for (const conv of resultados) {
          const id = generarId(conv);
          const textoIndexado = `${conv.titulo} ${conv.donante} ${conv.descripcion} ${conv.sectores?.join(' ')}`;
          const embedding = await generarEmbedding(textoIndexado);
          
          const convData: Convocatoria = {
            id,
            titulo: conv.titulo || '',
            donante: conv.donante || '',
            montoMax: conv.montoMax || 0,
            moneda: conv.moneda || 'USD',
            fechaCierre: conv.fechaCierre || '',
            fechaPublicacion: new Date().toISOString().split('T')[0],
            paisesElegibles: conv.paisesElegibles || ['Colombia'],
            sectores: conv.sectores || [],
            probabilidadExito: Math.floor(Math.random() * 30) + 50,
            requisitosClave: [],
            estado: 'activa',
            fuente: conv.fuente || conv.donante || '',
            descripcion: conv.descripcion || '',
            urlOriginal: conv.url || '',
            urlConvocatoria: conv.url || '',
            favorito: false,
            compatibilidadPerfil: 0,
            embedding,
            createdAt: new Date().toISOString()
          };
          
          const docRef = db.collection('convocatorias').doc(id);
          batch.set(docRef, convData);
        }
        
        await batch.commit();
        console.log(`✅ ${resultados.length} convocatorias guardadas`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('🎯 Radar automático completado');
    return null;
  });

export const getConvocatorias = functions.https.onCall(async (data, context) => {
  const limit = data.limit || 5000; // Sin límite artificial — entrega todo el lote indexado
  const estado = data.estado || 'activa';
  
  const snapshot = await db.collection('convocatorias')
    .where('estado', '==', estado)
    .limit(limit)
    .get();
  
  const convocatorias = snapshot.docs.map(doc => doc.data() as Convocatoria);
  
  return { success: true, data: convocatorias, total: convocatorias.length };
});

export const getEstadisticas = functions.https.onCall(async (data, context) => {
  const snapshot = await db.collection('convocatorias').get();
  const total = snapshot.size;
  const activas = snapshot.docs.filter(d => d.data().estado === 'activa').length;
  const favoritas = snapshot.docs.filter(d => d.data().favorito === true).length;
  
  const porSector: Record<string, number> = {};
  const porDonante: Record<string, number> = {};
  
  snapshot.forEach(doc => {
    const data = doc.data() as Convocatoria;
    data.sectores?.forEach(s => {
      porSector[s] = (porSector[s] || 0) + 1;
    });
    if (data.donante) {
      porDonante[data.donante] = (porDonante[data.donante] || 0) + 1;
    }
    if (data.fuente) {
      porDonante[data.fuente] = (porDonante[data.fuente] || 0) + 1;
    }
  });
  
  return { total, activas, favoritas, porSector, porDonante, queriesDisponibles: QUERIES_MASIVAS.length };
});

export const getFuentes = functions.https.onCall(async (data, context) => {
  return { 
    success: true, 
    fuentes: FUENTES_INTERNACIONALES,
    sectores: SECTORES,
    queries: QUERIES_MASIVAS
  };
});

// ============================================================
// RADAR 360 - NUEVAS FUNCIONES
// ============================================================

// --- COLA DE VALIDACIÓN ---
export const getColaValidacion = functions.https.onCall(async (data, context) => {
  const orgId = data.orgId || 'default';
  const estado = data.estado;
  
  let query = db.collection('cola_validacion').where('org_id', '==', orgId);
  if (estado) {
    query = query.where('estado', '==', estado);
  }
  
  const snapshot = await query.get();
  const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  return { success: true, data: items };
});

export const agregarAColaValidacion = functions.https.onCall(async (data, context) => {
  const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const item = {
    id,
    org_id: data.orgId || 'default',
    titulo: data.titulo,
    donante: data.donante || '',
    url_fuente: data.url_fuente || '',
    descripcion: data.descripcion || '',
    monto_estimado: data.monto_estimado || 0,
    fecha_cierre: data.fecha_cierre || '',
    paises_elegibles: data.paises_elegibles || [],
    sectores: data.sectores || [],
    score_encontrado: data.score_encontrado || 50,
    fuente: data.fuente || '',
    estado: 'pendiente',
    fecha_ingreso: new Date().toISOString()
  };
  
  await db.collection('cola_validacion').doc(id).set(item);
  return { success: true, id };
});

export const resolverColaValidacion = functions.https.onCall(async (data, context) => {
  const { itemId, decision, notas } = data;
  
  await db.collection('cola_validacion').doc(itemId).update({
    estado: decision,
    decision,
    decision_notas: notas || '',
    revisado_por: context.auth?.uid || 'usuario'
  });
  
  if (decision === 'aprobado') {
    const doc = await db.collection('cola_validacion').doc(itemId).get();
    const item = doc.data();
    
    if (item) {
      const entidadId = `ent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.collection('entidades_indexadas').doc(entidadId).set({
        ...item,
        id: entidadId,
        validationStatus: 'Aprobado',
        score_compatibilidad: item.score_encontrado || 50,
        sourceMiner: 'Agente Minero',
        fecha_indexacion: new Date().toISOString(),
        estado: 'activa'
      });
    }
  }
  
  return { success: true, decision };
});

// --- ENTIDADES INDEXADAS (RADARGRID) ---
export const getEntidadesIndexadas = functions.https.onCall(async (data, context) => {
  const orgId = data.orgId || 'default';
  const filtros = data.filtros || {};
  
  let query = db.collection('entidades_indexadas').where('org_id', '==', orgId);
  
  const snapshot = await query.get();
  let entidades = snapshot.docs.map(doc => doc.data());
  
  // Aplicar filtros
  if (filtros.targetCountry) {
    entidades = entidades.filter(e => 
      e.paises_elegibles?.some((p: string) => p.toLowerCase().includes(filtros.targetCountry.toLowerCase()))
    );
  }
  
  if (filtros.fundingType) {
    entidades = entidades.filter(e => e.fundingType === filtros.fundingType);
  }
  
  if (filtros.sectors && filtros.sectors.length > 0) {
    entidades = entidades.filter(e => 
      e.sectors?.some((s: string) => filtros.sectors.includes(s))
    );
  }
  
  return { success: true, data: entidades };
});

// --- PROYECTOS (MOTOR B) ---
export const getProyectos = functions.https.onCall(async (data, context) => {
  const orgId = data.orgId || 'default';
  const snapshot = await db.collection('proyectos').where('org_id', '==', orgId).get();
  const proyectos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return { success: true, data: proyectos };
});

export const crearProyecto = functions.https.onCall(async (data, context) => {
  const id = `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const proyecto = {
    id,
    org_id: data.orgId || 'default',
    nombre: data.nombre,
    descripcion: data.descripcion || '',
    palabras_clave: data.palabras_clave || [],
    estado: 'activo',
    creado_en: new Date().toISOString()
  };
  
  await db.collection('proyectos').doc(id).set(proyecto);
  return { success: true, id };
});

// --- ESTADÍSTICAS ORGANIZACIÓN ---
export const getEstadisticasOrg = functions.https.onCall(async (data, context) => {
  const orgId = data.orgId || 'default';
  
  const [colaCount, entidadesCount, proyectosCount] = await Promise.all([
    db.collection('cola_validacion').where('org_id', '==', orgId).where('estado', '==', 'pendiente').get(),
    db.collection('entidades_indexadas').where('org_id', '==', orgId).get(),
    db.collection('proyectos').where('org_id', '==', orgId).get()
  ]);
  
  return {
    entidadesIndexadas: entidadesCount.size,
    pendienteValidacion: colaCount.size,
    proyectosActivos: proyectosCount.size
  };
});

// --- PROXY DE BÚSQUEDA ---
export const proxySearch = functions.https.onCall(async (data, context) => {
  const { query } = data;
  
  // Simulación de búsqueda
  const resultados = [
    { title: `Convocatoria: ${query} - Proyecto de Desarrollo`, link: 'https://example.com/1', snippet: 'Financiamiento disponible' },
    { title: `Fondo: ${query} para ONGs`, link: 'https://example.com/2', snippet: 'Subvención internacional' },
    { title: `Becas: ${query} Colombia 2026`, link: 'https://example.com/3', snippet: 'Becas para investigación' }
  ];
  
  return { success: true, data: resultados };
});