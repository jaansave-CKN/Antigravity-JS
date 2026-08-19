/**
 * sectorClassifier.js — Asigna sectores del taxonomy a convocatorias.
 * Estrategia 1: Gemini (si disponible).
 * Estrategia 2: Clasificación por palabras clave (fallback sin API).
 *
 * v2: Acepta `donante` como tercer argumento para mejorar clasificación
 *     cuando el título/descripción son escuetos. KW_MAP expandido para
 *     cubrir idiomas internacionales (inglés, francés, alemán, portugués).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiCB, isQuotaError } from './geminiCircuitBreaker.js';

// Espejo plano del taxonomy del frontend (sectoresTaxonomy.ts).
// Actualizar aquí cuando se modifique el taxonomy en el cliente.
export const SECTOR_NAMES = [
  // Hábitat y Territorio
  'Construcción', 'Vivienda', 'Transporte', 'Ordenamiento Territorial',
  // Soberanía y Vida
  'Agua', 'Saneamiento', 'Salud', 'Medio Ambiente', 'Gestión de Riesgos',
  // Paz y Sociedad
  'Derechos Humanos', 'Cultura', 'Deporte', 'Justicia', 'Ayuda Humanitaria',
  // Autonomía Económica
  'Agricultura', 'Desarrollo Rural', 'Turismo', 'Emprendimiento y Cooperativismo',
  // Cooperación Internacional
  'Desarrollo Internacional', 'Derechos Humanos Internacionales', 'Medio Ambiente Global',
  // Futuro y Conocimiento
  'Educación', 'Ciencia, Tecnología e Innovación', 'Tecnologías', 'Energías Renovables',
];

const PROMPT_TEMPLATE = (titulo, descripcion, donante) =>
  `Clasifica esta convocatoria de financiamiento en 1-3 sectores del listado. ` +
  `Responde SOLO con un array JSON, sin texto extra.\n\n` +
  `Sectores válidos: ${JSON.stringify(SECTOR_NAMES)}\n\n` +
  `Donante: ${donante || '(no especificado)'}\nTítulo: ${titulo}\nDescripción: ${descripcion?.slice(0, 400) ?? '(sin descripción)'}`;

let _genAI = null;
function getGenAI() {
  if (_genAI) return _genAI;
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY_FALLBACK || process.env.GEMINI_API_KEY;
  if (!key) return null;
  _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

// ── Clasificador por palabras clave (fallback sin API) ────────────────────────
// IMPORTANTE: El orden de KW_MAP determina la prioridad cuando hay solapamiento.
// Las entradas más específicas van primero; el catch-all "Desarrollo Internacional"
// va al final para capturar convocatorias internacionales sin otro sector claro.
const KW_MAP = [
  // ── Ciencia y Tecnología ────────────────────────────────────────────────────
  { sector: 'Ciencia, Tecnología e Innovación', kw: /\b(ciencia|tecnolog[ií]a|innovaci[oó]n|investigaci[oó]n|I\+D|R&D|minciencias|COLCIENCIAS|laboratorio|patente|prototipo|CTI|STIC|ASCTeI|ASCTI|cienciometr[ií]a|transferencia tecnol[oó]gica|spin.?off|startup cient[ií]fico|recherche|forschung|wissenschaft|science|scientific|research grant|research program|knowledge|conocimiento|academic research|peer.review|publications?|revista cient|journal|indexaci[oó]n|publindex|journal article|open science|open access|data science|artificial intelligence|machine learning|deep learning|IA\b|inteligencia artificial)/i },

  // ── Educación ───────────────────────────────────────────────────────────────
  { sector: 'Educación', kw: /\b(educaci[oó]n|formaci[oó]n|capacitaci[oó]n|escuela|colegio|universidad|SENA|becas?|scholarship|fellowship|fellows?\b|becario|estudiante|docente|aula|comedor escolar|plan de estudios|programa acad[eé]mico|curso de|formation|bildung|ausbildung|étudiant|diplôme|apprentissage|literacy|alphabétisation|alfabetizaci[oó]n|enseignement|professeur|teacher|student|degree|masters?|doctorate|PhD|postdoc|training program|capacity.?building|fortalecimiento de capacidades|renforcement des capacités)/i },

  // ── Salud ───────────────────────────────────────────────────────────────────
  { sector: 'Salud', kw: /\b(salud|m[eé]dico|medicina|hospital|cl[ií]nica|enfermedad|vacuna|sanitario|salud p[uú]blica|healthcare|well-?being|wellcome|mercury|mercurio|skin lightening|productos cosm[eé]ticos|salud materna|salud infantil|santé|sanidad|Gesundheit|health system|mental health|salud mental|public health|epidem|pandemic|pandemia|nutrition|nutrici[oó]n|malnutrici[oó]n|disease|maternal|reproductive health|salud reproductiva|family planning|planificaci[oó]n familiar|child health|children.*health|pediatr|dentist|odontolog|pharmacy|farmac)/i },

  // ── Medio Ambiente ──────────────────────────────────────────────────────────
  { sector: 'Medio Ambiente', kw: /\b(medio ambiente|ambiental|biodiversidad|ecosistema|reforestaci[oó]n|sostenibilidad|cambio clim[aá]tico|climate change|climate justice|climate action|conservaci[oó]n|conservation|nature|mercury elimination|contaminaci[oó]n|environmental|ESG\b|net.?zero|low carbon|decarbonizaci[oó]n|emisiones|GHG\b|CO2\b|bosque|forest|deforestation|wildlife|ocean|marine|biodiv|ecosyst|environnement|Umwelt|green economy|econom[ií]a verde|circular economy|econom[ií]a circular|plastic|plas[ts]ico|waste management|gesti[oó]n de residuos|carbon credit|huella de carbono|carbon footprint)/i },

  // ── Agua y Saneamiento ──────────────────────────────────────────────────────
  { sector: 'Agua', kw: /\b(agua|acueducto|potabilizaci[oó]n|cuenca|h[ií]drica|water|r[ií]os?|WASH\b|saneamiento h[ií]drico|water supply|water sanitation|eau potable|drinking water|groundwater|watershed|irrigation|riego)/i },
  { sector: 'Saneamiento', kw: /\b(saneamiento|alcantarillado|aguas residuales|bateri[aá] de ba[nñ]o|unidad sanitaria|latrine|letr[ií]na|sewage|wastewater|assainissement)/i },

  // ── Energías Renovables ─────────────────────────────────────────────────────
  { sector: 'Energías Renovables', kw: /\b(energ[ií]a renovable|solar|fotovolt[aá]|e[oó]lica|biog[aá]s|hidr[oó]el[eé]ctrica|paneles solares|transici[oó]n energ[eé]tica|clean energy|renewable energy|energy transition|biomasa|wind energy|geothermal|tidal|hydrogen|hidr[oó]geno|energies renouvelables|Erneuerbare Energie|off.?grid)/i },

  // ── Agricultura y Desarrollo Rural ─────────────────────────────────────────
  { sector: 'Agricultura', kw: /\b(agricultura|agropecuario|cosecha|riego|semillas?|cultivo|campo|ganadero|campesino|AGROSAVIA|ICA\b|agroin|food security|seguridad alimentaria|sistemas alimentarios|cadenas productivas agro|agroecolog|organic farming|agricultura org[aá]nica|piscicultura|acuicultura|aquaculture|fishery|pesca|livestock|ganado|dairy|l[aá]cteo|poultry|aves de corral|crop|harvest|sowing|plantac[ií]on)/i },
  { sector: 'Desarrollo Rural', kw: /\b(rural|campesino|campo|vereda|municipio|comunidad rural|productor agr[oó]|asociaci[oó]n campesina|proyectos productivos|territorios rurales|d[eé]veloppement rural|ländliche Entwicklung|small farmer|peque[nñ]o agricultor|smallholder|rural community|desarrollo territorial|territorial development)/i },

  // ── Vivienda e Infraestructura ──────────────────────────────────────────────
  { sector: 'Vivienda', kw: /\b(vivienda|VIS\b|VIP\b|habitacional|mejoramiento de vivienda|housing|asentamientos|h[aá]bitat|logement|shelter|sin techo|homeless|urban housing|vivienda social)/i },
  { sector: 'Construcción', kw: /\b(infraestructura|construcci[oó]n|obra civil|vial|carretera|puente|pavimento|edificaci[oó]n|transport|transporte|mobility|movilidad|road|highway|airport|puerto|port|rail|ferroviario)/i },

  // ── Derechos Humanos, Paz, Justicia ────────────────────────────────────────
  { sector: 'Derechos Humanos', kw: /\b(derechos humanos|human rights|v[ií]ctimas|g[eé]nero|gender equality|gender.based violence|violencia de g[eé]nero|equidad|inclusi[oó]n|inclusion|paz|peacebuilding|reconciliaci[oó]n|reintegraci[oó]n|desplazados|feminist|feminista|participatory action|racial justice|justicia racial|justicia de g[eé]nero|LGBTQ|diversidad sexual|disability|discapacidad|indigenous|ind[ií]gena|minority|minor[ií]a|droits humains|menschenrechte|women.*rights|derechos.*mujeres|children.*rights|derechos.*ni[nñ]os|freedom|libertad|democrac)/i },
  { sector: 'Justicia', kw: /\b(justicia|access to justice|acceso a la justicia|legal aid|asistencia jur[ií]dica|rule of law|estado de derecho|tribunal|court|juzgado|fiscal|prosecutor|judicial|governance|gobernanza|anticorrupci[oó]n|anticorruption|transparency|transparencia|accountability|rendici[oó]n de cuentas)/i },

  // ── Ayuda Humanitaria ───────────────────────────────────────────────────────
  { sector: 'Ayuda Humanitaria', kw: /\b(humanitaria|humanitarian|emergencia|desastre|disaster|albergue|food security|atenci[oó]n humanitaria|migrante|refugiado|refugee|crisis humanitaria|IDP|internally displaced|desplazado interno|UNHCR|ACNUR|WFP|PMA\b|relief|aide humanitaire|humanitäre Hilfe|catastrophe|conflict.affected|crisis response)/i },

  // ── Gestión de Riesgos ──────────────────────────────────────────────────────
  { sector: 'Gestión de Riesgos', kw: /\b(gesti[oó]n de riesgos|desastres naturales|prevenci[oó]n de riesgos|mitigaci[oó]n|derrumbe|inundaci[oó]n|sismos?|terremoto|disaster risk|resilience|resiliencia|early warning|alerta temprana|DRR\b|UNDRR|preparedness|preparaci[oó]n ante desastres)/i },

  // ── Emprendimiento y Economía ───────────────────────────────────────────────
  { sector: 'Emprendimiento y Cooperativismo', kw: /\b(emprendimiento|mipyme|pyme|cooperativa|asociaci[oó]n|capital semilla|microempresa|startups?|formaliz|microfinance|microcr[eé]dito|impact invest|venture|accelerat|scale.?up|fintech|entrepreneurship|social enterprise|empresa social|business incubator|incubadora|economic inclusion|inclusi[oó]n econ[oó]mica|livelihoods?|income generation|generaci[oó]n de ingresos|value chain|cadena de valor|fair trade|comercio justo|cooperative)/i },

  // ── Cultura, Arte, Deporte ──────────────────────────────────────────────────
  { sector: 'Cultura', kw: /\b(cultura|cultural heritage|patrimonio|artes?|m[uú]sica|danza|teatro|casas? de cultura|formaci[oó]n art[ií]stica|heritage|creative|artisan|artesano|folklore|identidad cultural|libro|library|biblioteca|media|periodismo|journalism|cinema|cine|architecture|arquitectura)/i },
  { sector: 'Deporte', kw: /\b(deporte|sport|athletes?|deportistas?|olimp[ií]c|par[aá]limpic|recreational|recreaci[oó]n|actividad f[ií]sica|physical activity|stadium|f[uú]tbol|soccer|basketball|swimming)/i },

  // ── Turismo ─────────────────────────────────────────────────────────────────
  { sector: 'Turismo', kw: /\b(turismo|ecoturismo|destino tur[ií]stico|infraestructura tur[ií]stica|agroturismo|tourisme|tourism|touris[mt]|hospitality|hotel|gastronomia|gastronomía)/i },

  // ── Tecnologías digitales (distinto de CTI) ─────────────────────────────────
  { sector: 'Tecnologías', kw: /\b(digital transform|transformaci[oó]n digital|e-government|gobierno digital|digitalizaci[oó]n|ICT4D|tecnolog[ií]as de informaci[oó]n|software development|desarrollo de software|app development|platform|plataforma digital|internet access|conectividad|broadband|banda ancha|cybersecurity|ciberseguridad|blockchain|IoT|cloud)/i },

  // ── Catch-all: Desarrollo Internacional ─────────────────────────────────────
  // Se evalúa al final — captura convocatorias de cooperación internacional
  // cuyo título/descripción usa lenguaje de fondos pero no encaja en sectores anteriores.
  { sector: 'Desarrollo Internacional', kw: /\b(cooperaci[oó]n internacional|international cooperation|multilateral|bilateral|ODA\b|USAID|GIZ\b|UE\b|uni[oó]n europea|banco mundial|world bank|IDRC|IAF\b|MacArthur|Ford Foundation|Ford Global|Open Society|UNFCCC|GEF\b|UNDP|UNICEF|UNESCO|WHO\b|FAO\b|IDB\b|IADB|JICA|AECID|AFD\b|KfW|Enabel|DFID|FCDO|Norad|Sida\b|Danida|SDC\b|DGIS|EuropeAid|Devco|grant|funding program|global fellowship|international fellowship|global program|call for project|call for proposal|appel [aà] projet|appel [aà] candidatures|open call|open application|financing.*project|project.*financing|solidarity.*project|projet solidaire|projets solidaires|fonds de d[eé]veloppement|development fund|global fund|international fund|subvenci[oó]n|subvention|subvencionar|financiamiento de proyecto|projet de d[eé]veloppement|international grant|global grant|overseas development|aid program|ayuda al desarrollo|fondo internacional|global initiative|international initiative|solidarity fund|fondo de solidaridad|projet d'appui|support project|apoyo internacional|international support)/i },
];

function classifyByKeywords(titulo, descripcion, donante) {
  const text = `${titulo || ''} ${descripcion || ''} ${donante || ''}`;
  const found = [];
  for (const { sector, kw } of KW_MAP) {
    if (kw.test(text) && !found.includes(sector)) {
      found.push(sector);
      if (found.length >= 3) break;
    }
  }
  return found;
}

/**
 * Clasifica una convocatoria y retorna un array de sectores válidos.
 * Intenta Gemini primero; si falla (quota, red, sin key), usa palabras clave.
 *
 * @param {string} titulo
 * @param {string} [descripcion]
 * @param {string} [donante]  — nombre del donante/entidad para enriquecer la clasificación
 * @returns {Promise<string[]>}
 */
export async function classifySectors(titulo, descripcion, donante = '') {
  const genAI = getGenAI();
  if (genAI && geminiCB.canCall()) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
      const result = await model.generateContent(PROMPT_TEMPLATE(titulo, descripcion, donante));
      const text = result.response.text().trim();
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(s => SECTOR_NAMES.includes(String(s).trim())).slice(0, 3);
          if (valid.length > 0) { geminiCB.recordSuccess(); return valid; }
        }
      }
    } catch (err) {
      if (isQuotaError(err)) geminiCB.recordQuotaError();
    }
  }
  return classifyByKeywords(titulo, descripcion, donante);
}
