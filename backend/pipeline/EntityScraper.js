/**
 * EntityScraper.js — Rastreo 1: Scraping genérico por entidades del Directorio
 *
 * Flujo por entidad:
 *   1. Fetch url_convocatorias (o sitio_web como fallback)
 *   2. Extracción genérica en 4 estrategias (tabla → article → li → links sueltos)
 *   3. Filtrado por palabras clave de fondos/convocatorias
 *   4. Retorno de items normalizados {titulo, url, descripcion}
 */

import crypto from 'crypto';
import { runSql, getRow, getRows } from '../db.js';
import { sanitizeInput } from '../middlewares/SecurityMiddleware.js';
import { invalidateRadarCache } from '../middlewares/radarCache.js';
import { classifySectors } from '../services/sectorClassifier.js';
import { getApexDomain } from '../utils/domainUtils.js';
import { isPdfOrDoc, convertUrlToMarkdown, extractConvocatoriaFields } from '../services/markitdownService.js';

// ── Scrapers especiales para entidades SPA o portales paginados ──────────────

// APC Colombia: Portal de Servicios — server-rendered, paginado (?page=N)
// Estructura: div.card.tarjeta-curso con campos Título / Modalidad / Fuente
const APC_PORTAL_BASE = 'https://portalservicios-apccolombia.gov.co/externo/Convocatoria';
const APC_MAX_PAGES   = 40; // tope de seguridad

async function fetchApcPortalItems() {
  const all = [];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,*/*',
    'Accept-Language': 'es-CO,es;q=0.9',
  };

  const decode = (s = '') => s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  for (let page = 1; page <= APC_MAX_PAGES; page++) {
    const pageUrl = page === 1 ? APC_PORTAL_BASE : `${APC_PORTAL_BASE}?page=${page}`;
    try {
      const res = await fetch(pageUrl, { signal: AbortSignal.timeout(15_000), headers });
      if (!res.ok) break;
      const html = await res.text();

      // Dividir por tarjeta — cada bloque empieza en class="card tarjeta-curso"
      const chunks = html.split('class="card tarjeta-curso"').slice(1);
      let pageCount = 0;

      for (const chunk of chunks) {
        // Título: está en card-header: <strong>Título:</strong> TEXT</div>
        const tM = chunk.match(/T[íi]tulo:\s*<\/strong>\s*([\s\S]*?)<\/div>/i);
        const titulo = tM ? decode(tM[1]).slice(0, 255) : '';
        if (!titulo || titulo.length < 8) continue;

        // Modalidad
        const modM = chunk.match(/Modalidad:\s*<\/strong>\s*([\s\S]*?)<\/p>/i);
        const modalidad = modM ? decode(modM[1]).slice(0, 100) : '';

        // Fuente (donante)
        const fM = chunk.match(/Fuente:\s*<\/strong>\s*([\s\S]*?)<\/p>/i);
        const donante = fM ? decode(fM[1]).slice(0, 150) : 'APC Colombia';

        // URL externa (excluir el propio portal y el sitio APC)
        const uM = chunk.match(/href="(https?:\/\/(?!portalservicios-apccolombia)(?!www\.apccolombia)[^"]+)"/i);
        const url = uM ? uM[1] : '';

        // Fecha límite de inscripción
        const flM = chunk.match(/Fecha\s+L[íi]mite[^:]*:\s*<\/strong>\s*([\s\S]*?)<\/p>/i);
        const fecha_limite = flM ? decode(flM[1]).replace(/\.$/, '').trim() : '';

        const desc = [modalidad, donante].filter(Boolean).join(' — ');
        all.push({ titulo, descripcion: desc.slice(0, 300), url, fecha_limite });
        pageCount++;
      }

      if (pageCount === 0) break;
      console.log(`[APC Portal] p${page}: ${pageCount} items`);

      // Paginación: buscar link a la siguiente página
      if (!html.includes(`page=${page + 1}`)) break;
    } catch (e) {
      console.warn(`[APC Portal] Error p${page}:`, e.message);
      break;
    }
  }

  console.log(`[APC Portal] Total extraídas: ${all.length}`);
  return all;
}

// NOTA: el conector de Banco Mundial (fetchBancoMundialItems) que existía aquí
// fue eliminado — confirmado en vivo que search.worldbank.org/api/v2/projects
// es la base de datos de PROYECTOS ejecutados por gobiernos nacionales
// (préstamos/DPO a ministerios, ej. "Colombia Green and Resilient DPO 2"),
// no convocatorias abiertas a las que ONG/fundaciones/personas naturales o
// jurídicas puedan aplicar — el propósito central de este Radar. Por diseño
// esa fuente NUNCA produce el tipo de contenido correcto; no es un problema
// de filtrado fino, toda la fuente está fuera de alcance.

// Calcula estado según fecha_limite (formato YYYY/MM/DD o YYYY-MM-DD)
function calcEstado(fechaLimite) {
  if (!fechaLimite) return 'abierta';
  // Normalizar separadores para comparación lexicográfica YYYY/MM/DD
  const norm = fechaLimite.trim().replace(/-/g, '/').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return norm < today ? 'cerrada' : 'abierta';
}

// ── WePropel: curador de oportunidades para América Latina ────────────────────
const WP_OPORTUNIDADES_URL = 'https://www.wepropel.org/oportunidades';

const MESES_ES = {
  enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6,
  julio:7, agosto:8, septiembre:9, octubre:10, noviembre:11, diciembre:12,
};

function parseSpanishDate(text = '') {
  const m = text.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+(\d{4})/i);
  if (!m) return '';
  const mon = MESES_ES[m[2].toLowerCase()];
  if (!mon) return '';
  return `${m[3]}/${String(mon).padStart(2,'0')}/${String(parseInt(m[1])).padStart(2,'0')}`;
}

async function fetchWePropelItems() {
  const res = await fetch(WP_OPORTUNIDADES_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'es,en;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Intento A: Next.js __NEXT_DATA__ (SSR JSON embebido en el HTML)
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const parsed = JSON.parse(nextDataMatch[1]);
      // Búsqueda recursiva de un array de grants en el árbol de props.
      // Límites: depth ≤ 5, max 30 keys por nodo, sin re-visitar objetos.
      const findGrants = (obj, depth = 0, visited = new WeakSet()) => {
        if (!obj || typeof obj !== 'object' || depth > 5) return null;
        if (visited.has(obj)) return null;
        visited.add(obj);
        const keys = Object.keys(obj).slice(0, 30); // cap branching factor
        for (const key of keys) {
          const val = obj[key];
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
            const first = val[0];
            if (first.title || first.titulo || first.nombre || first.name) return val;
          }
          // Solo recursar en objetos planos, no en arrays directamente
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            const deeper = findGrants(val, depth + 1, visited);
            if (deeper) return deeper;
          }
        }
        return null;
      };
      const grants = findGrants(parsed);
      if (grants && grants.length > 0) {
        return grants.slice(0, MAX_PER_ENTITY).map(g => ({
          titulo: (g.title || g.titulo || g.nombre || g.name || '').slice(0, 255),
          url: g.url || g.link || g.href || g.applicationUrl || '',
          descripcion: (g.description || g.descripcion || g.summary || '').slice(0, 800),
          fecha_limite: g.deadline || g.fecha_limite || parseSpanishDate(g.description || g.descripcion || ''),
        })).filter(g => g.titulo.length >= MIN_TITLE_LEN);
      }
    } catch {}
  }

  // Intento B: extracción HTML estándar + enriquecimiento de fechas en español
  let items = extractTableRows(html, WP_OPORTUNIDADES_URL);
  if (items.length < 2) items = [...items, ...extractCards(html, WP_OPORTUNIDADES_URL)];
  if (items.length < 2) items = [...items, ...extractListItems(html, WP_OPORTUNIDADES_URL)];
  if (items.length < 2) items = [...items, ...extractKeywordLinks(html, WP_OPORTUNIDADES_URL)];

  for (const item of items) {
    if (!item.fecha_limite) item.fecha_limite = parseSpanishDate(item.descripcion || '');
  }

  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (isNoisyTitle(item.titulo)) continue;
    const key = item.titulo.toLowerCase().slice(0, 80);
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }

  console.log(`[WePropel] ${unique.length} oportunidades extraídas`);
  return unique.slice(0, MAX_PER_ENTITY);
}

// Darwin Initiative: UK Government biodiversity/conservation grants
// Site: plain HTML Bootstrap — scrapes /apply/ + /funded-projects/
const DI_APPLY_URL     = 'https://www.darwininitiative.org.uk/apply/';
const DI_PROJECTS_URL  = 'https://www.darwininitiative.org.uk/funded-projects/';
const DI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

async function fetchDarwinInitiativeItems() {
  const results = [];

  for (const pageUrl of [DI_APPLY_URL, DI_PROJECTS_URL]) {
    try {
      const res = await fetch(pageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: DI_HEADERS });
      if (!res.ok && res.status !== 404) continue;
      const html = await res.text();

      let items = extractCards(html, pageUrl);
      if (items.length < 2) items = [...items, ...extractListItems(html, pageUrl)];
      if (items.length < 2) items = [...items, ...extractKeywordLinks(html, pageUrl)];

      const seen = new Set();
      for (const item of items) {
        if (isNoisyTitle(item.titulo)) continue;
        const key = item.titulo.toLowerCase().slice(0, 80);
        if (!seen.has(key)) { seen.add(key); results.push(item); }
      }
      console.log(`[DarwinInitiative] ${pageUrl}: ${items.length} items`);
    } catch (e) {
      console.warn(`[DarwinInitiative] Error en ${pageUrl}:`, e.message);
    }
  }

  console.log(`[DarwinInitiative] Total: ${results.length} oportunidades`);
  return results.slice(0, MAX_PER_ENTITY);
}

// Mapa sigla → scraper especial para entidades SPA del directorio
const ENTITY_API_SCRAPERS = {
  APC:       fetchApcPortalItems,
  WePropel:  fetchWePropelItems,
  DI:        fetchDarwinInitiativeItems,
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PARALLEL     = 5;     // entidades simultáneas (evita rate-limit)
const MAX_PER_ENTITY   = 80;    // máximo convocatorias extraídas por entidad
const MAX_PAGES        = 5;     // páginas de paginación a seguir
const MIN_TITLE_LEN    = 12;    // ignorar títulos muy cortos

// ── Extracción de nombre oficial de entidad (anti-ruido de título de pestaña) ─
const NOISY_ENTITY_NAME = /^(home|homepage|inicio|index|welcome|bienvenid|error\s*\d{3}|page\s+not\s+found|convocatoria|grants?\s*[-|]|funding\s*[-|]|opportunities\s*[-|])/i;

function extractOfficialNameFromHtml(html, domainFallback) {
  // 1. JSON-LD schema.org Organization.name — fuente más autoritativa
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(m[1]);
      const nodes = Array.isArray(json) ? json : [json, ...(json['@graph'] ?? [])];
      for (const node of nodes) {
        if (/Organization|NGO|GovernmentOrg|Educational|Corporation|Foundation/i.test(node['@type'] ?? '')) {
          if (typeof node.name === 'string' && node.name.trim().length >= 3)
            return node.name.trim().slice(0, 120);
        }
      }
    } catch { /* JSON inválido */ }
  }
  // 2. og:site_name
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
              ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  if (ogSite?.[1]?.trim() && !NOISY_ENTITY_NAME.test(ogSite[1])) return ogSite[1].trim().slice(0, 120);
  // 3. <title> limpio: tomar la parte que NO es navegación
  const rawTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '';
  if (rawTitle) {
    const clean = rawTitle.split(/\s*[\|–\-—]\s*/).find(p => !NOISY_ENTITY_NAME.test(p.trim()) && p.trim().length >= 3);
    if (clean) return clean.trim().slice(0, 120);
  }
  // 4. meta application-name
  const appName = html.match(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (appName?.trim() && !NOISY_ENTITY_NAME.test(appName)) return appName.trim().slice(0, 120);
  return domainFallback;
}

async function fixEntityNameIfNoisy(entity) {
  if (!NOISY_ENTITY_NAME.test(entity.nombre?.trim() ?? '')) return;
  const url = entity.sitio_web || entity.url_convocatorias;
  if (!url) return;
  let html = '';
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { 'User-Agent': 'Mozilla/5.0 RadarFondos/1.0' },
    });
    html = await res.text();
  } catch { return; }
  let domainFallback;
  try { domainFallback = new URL(url).hostname.replace(/^www\./, ''); } catch { domainFallback = url; }
  const newName = extractOfficialNameFromHtml(html, domainFallback);
  if (!newName || newName === entity.nombre || NOISY_ENTITY_NAME.test(newName)) return;
  try {
    await runSql(
      'UPDATE directorio_entidades SET nombre = ?, updated_at = ? WHERE id = ?',
      [newName, new Date().toISOString(), entity.id]
    );
    console.log(`[Rastreo1] Nombre corregido: "${entity.nombre}" → "${newName}" (${entity.id})`);
  } catch (e) {
    console.warn(`[Rastreo1] No se pudo corregir nombre de ${entity.id}: ${e.message}`);
  }
}

// ── Palabras clave para filtrado (inglés + español) ───────────────────────────
// Solo términos específicos de convocatorias. Se eliminaron 'proyecto', 'programa',
// 'solicitud', 'aplicacion', 'abierto', 'open', 'invitation' por ser demasiado
// genéricos y causar falsos positivos con documentos institucionales.
const FUNDING_KEYWORDS = [
  'convocatoria','call for proposal','call for application','grant',
  'funding opportunity','fondo','financiamiento','financiacion','beca','subvenci',
  'open call','proposal','rfp','fellowship','award','tender',
  'postulaci','concurso de',
];

function hasFundingKeyword(text) {
  const t = text.toLowerCase();
  return FUNDING_KEYWORDS.some(k => t.includes(k));
}

// Títulos que son ruido de navegación/footer o documentos institucionales
const NOISE_TITLES = [
  // Navegación / footer
  'información de contacto','informacion de contacto',
  'política de privacidad','politica de privacidad',
  'aviso legal','términos y condiciones','terminos y condiciones',
  'términos de uso','terminos de uso',
  'cookie','newsletter','suscr',
  'inicio','home','about us','acerca de',
  'mapa del sitio','sitemap','accesibilidad',
  'redes sociales','síguenos','siguenos',
  'contáctenos','contactenos','contáctanos','contactanos',
  'footer','enlaces rápidos','enlaces rapidos',
  'líneas de atención','lineas de atencion',
  'líneas de crédito','lineas de credito',
  'línea de atención','linea de atencion',
  // Navegación — español (no presentes en la lista inglesa)
  'saltar al contenido','ir al contenido','pasar al contenido',
  'menú principal','menu principal','menú de navegación','menu de navegacion',
  'tabla de contenidos','volver a','regresar a','volver al inicio',
  'más información','mas informacion','ver más','ver mas',
  'leer más','leer mas','haga clic','descargue el','descargue los',
  'nuestros criterios','nuestros proyectos','nuestra misión','nuestra vision',
  // Navegación — francés
  'télécharger ','telecharger ','consulter le','consulter nos','accéder au',
  'aller au contenu','retour à','retour a','lire la suite','nos critères',
  'notre sélection','notre selection','notre mission','nos projets',
  'formulaire de contact','formulaire de candidature',
  // Portales UE — nav/breadcrumb/idioma
  'skip to main content','have your say','funding and tenders',
  'before you apply','eligibility: who can','eu open data',
  'financial instruments: equity','funding by management',
  'find calls for funding','eu funding programmes',
  'seal of excellence','in budget and funding',
  ' Nederlands',' português',' slovenčina',' slovenščina',
  ' español',' français',' italiano',' deutsch',
  ' română',' polski',' česky',' magyar',
  // Documentos / reportes institucionales — no son convocatorias abiertas
  'resolución no','resolucion no','decreto no','circular no',
  'informe de gestión','informe de actividades','informe anual','informe final',
  'nota de prensa','comunicado de prensa','boletín informativo','boletin informativo',
  'guía de uso','manual de usuario','manual de operaciones',
  'plan de acción','plan de trabajo','marco de referencia','documento de trabajo',
  'política pública','politica publica','reglamento de',
  // Ayuda y preguntas genéricas
  'the application process','what is the difference','for beginners',
  'eligibility: who','how to apply','frequently asked','faq',
  // Páginas institucionales genéricas de donantes (falsos positivos frecuentes)
  'funding faq','grants faq','grants data','grants database',
  'funding portfolio','funding opportunities overview',
  'about the iaf','about the foundation','about the program','about the grant',
  'our funding portfolio','our grants data','our global presence',
  'our focus areas','our project stories','our results in',
  'descarga ','download our','brochure',
  'learn more','read more','see more','view more','explore more',
  'sign in','log in','register','subscribe',
  'press release','media release','news release',
  // Portales gob.co colombianos — navegación estándar por ley de transparencia
  // (Ley 1712/2014), presente en prácticamente todas las entidades públicas.
  // Confirmado en vivo: FENOGE y Fondo Emprender devolvían esto como si fueran
  // convocatorias — no eran casos aislados, es el patrón de cualquier .gov.co.
  'transparencia','rendición de cuentas','rendicion de cuentas',
  'trámites y servicios','tramites y servicios',
  'quiénes somos','quienes somos','nuestra organización','nuestra organizacion',
  'sistema integrado de gestión','sistema integrado de gestion',
  'preguntas frecuentes','notificaciones anónimas','notificaciones anonimas',
  'conflicto de intereses','manuales y otros actos administrativos',
  'histórico de procesos de contratación','historico de procesos de contratacion',
  'plan anual de necesidades','actas de comité directivo','actas de comite directivo',
  'gestión del conocimiento','gestion del conocimiento',
  'urna de cristal','proyectos ejecutados',
  'observaciones acreditación','observaciones acreditacion',
  'observaciones evaluación','observaciones evaluacion',
  // Enlaces cruzados a otras entidades de gobierno (footer/menú compartido) —
  // formato abreviado de portal ("MinEducación"), no el nombre completo que
  // usaría un título real de convocatoria ("Ministerio de Educación")
  'minrelaciones','mineducación','mineducacion','mintransporte','minagricultura',
  'mincomercio','minsalud','mintrabajo','minambiente','mindefensa','minjusticia',
  'minhacienda','mintic','minvivienda','mincultura','mindeporte',
  'vicepresidencia',
];

// Patrón de frases institucionales que NO son convocatorias
const NOISE_TITLE_RE = /^(our|their|its|the)\s\w|^about\s(us|the\s|our\s)|^(who|what)\s(we|is)\s/i;

function isNoisyTitle(title) {
  const t = title.toLowerCase().trim();
  if (NOISE_TITLES.some(n => t.includes(n))) return true;
  if (t.endsWith(':') && t.length < 40) return true;
  // "Our X", "Their X", "The X" frases institucionales de nav
  if (NOISE_TITLE_RE.test(title.trim())) return true;
  return false;
}

// ── Extractor de monto por regex (sin Gemini) ────────────────────────────────
// Busca patrones como "$50,000", "USD 1M", "€500K", "hasta 200.000 EUR",
// "up to 100,000", "prize of $30K", "máximo 500.000 COP", "5 million USD", etc.
const MONTO_RE = /(?:up\s+to|hasta|máximo|maximum|prize(?:\s+of)?|award(?:\s+of)?|fund(?:ing)?\s+of|total\s+de?|value\s+of|por\s+valor\s+de|subsidio\s+de|grant\s+of|monto\s+máximo|monto\s+de)\s*:?\s*(?:USD|EUR|COP|GBP|CAD|\$|€|£)\s*([\d,. ]+)\s*(M(?:illion)?|B(?:illion)?|K)?|(?:USD|EUR|COP|GBP|CAD|\$|€|£)\s*([\d,. ]+)\s*(M(?:illion)?|B(?:illion)?|K)?(?:\s*(?:USD|EUR|COP|GBP))?\b|([\d,. ]+)\s*(M(?:illion)?|B(?:illion)?|K)?\s+(?:USD|EUR|COP|GBP|CAD|dólares?|dollars?|euros?|pesos?)/i;

const CURRENCY_MAP = { '$': 'USD', '€': 'EUR', '£': 'GBP' };
function extractMontoFromText(text) {
  if (!text || text.length < 3) return null;
  const m = text.match(MONTO_RE);
  if (!m) return null;
  // Determinar moneda
  let currency = 'USD';
  const sym = m[0].match(/EUR|COP|GBP|CAD|USD|€|£|\$/i)?.[0] || '';
  if (/EUR|€/.test(sym)) currency = 'EUR';
  else if (/GBP|£/.test(sym)) currency = 'GBP';
  else if (/COP/.test(sym)) currency = 'COP';
  else if (/CAD/.test(sym)) currency = 'CAD';
  // Determinar número
  const numRaw = (m[1] || m[3] || m[5] || '').replace(/\s/g, '').replace(/,/g, '');
  const num = parseFloat(numRaw);
  if (!num || isNaN(num) || num <= 0) return null;
  const suffix = (m[2] || m[4] || m[6] || '').toUpperCase();
  const mult = suffix.startsWith('B') ? 1e9 : suffix.startsWith('M') ? 1e6 : suffix.startsWith('K') ? 1e3 : 1;
  return { value: Math.round(num * mult), currency };
}

// Retorna true si itemUrl es la misma página de listado que sourceUrl,
// o un antecesor de ella (link de navegación como homepage o sección padre).
// Previene almacenar breadcrumbs o el propio directorio como url_convocatoria.
export function isSameOrParentUrl(itemUrl, sourceUrl) {
  if (!itemUrl || !sourceUrl) return !itemUrl;
  try {
    const item = new URL(itemUrl);
    const src  = new URL(sourceUrl);
    const ip = item.origin + item.pathname.replace(/\/$/, '');
    const sp = src.origin  + src.pathname.replace(/\/$/, '');
    if (ip === sp) return true;
    // Si mismo origen y sourceUrl comienza por itemUrl/... → itemUrl es antecesor (nav link)
    if (item.origin === src.origin && sp.startsWith(ip + '/')) return true;
    return false;
  } catch { return itemUrl === sourceUrl; }
}

// ── Helpers HTML ──────────────────────────────────────────────────────────────
function stripTags(s = '') {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function extractHref(html, baseUrl) {
  const m = html.match(/href=["']([^"']+)['"]/i);
  if (!m) return null;
  const href = m[1].trim();
  if (href.startsWith('#') || href.startsWith('javascript')) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href.startsWith('http') ? href : null;
  }
}

// Verdadero si la URL fuente ya es una página de convocatorias/grants.
// Cuando es true, relajamos hasFundingKeyword por ítem individual.
function isGrantPageUrl(url = '') {
  return /convocator|becas?|grant|fund(?!ament)|financiami|cooperaci|postulaci|llamado|oportunidad|iniciativa|fellowship|award|apply|edital|opportunity/i.test(url);
}

// ── Estrategia 1: filas de tabla (como Minciencias) ───────────────────────────
function extractTableRows(html, baseUrl, skipFundingKw = false) {
  const results = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return results;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRegex.exec(tbodyMatch[1])) !== null) {
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRegex.exec(rm[1])) !== null) cells.push(cm[1]);
    if (cells.length < 2) continue;
    const titulo = stripTags(cells[0] || cells[1]);
    if (!titulo || titulo.length < MIN_TITLE_LEN) continue;
    const allText = titulo + ' ' + stripTags(cells.join(' '));
    if (!skipFundingKw && !hasFundingKeyword(allText)) continue;
    const url = extractHref(cells[0] + cells[1], baseUrl);
    const montoInfo = extractMontoFromText(allText);
    results.push({ titulo, url, descripcion: stripTags(cells[2] || ''),
                   monto_max: montoInfo?.value || 0, moneda: montoInfo?.currency || '' });
  }
  return results;
}

// ── Estrategia 2: tarjetas article/section/div con heading ───────────────────
const DIV_CARD_CLASS = /\b(?:card|item|entry|grant|opportunity|convocatoria|resultado|result|post|news|noticia|proyecto|project|funding|fondo)\b/i;

function extractCards(html, baseUrl, skipFundingKw = false) {
  const results = [];

  // Bloques semánticos: article / section
  const semanticRegex = /<(?:article|section)[^>]*>([\s\S]*?)<\/(?:article|section)>/gi;
  let m;
  while ((m = semanticRegex.exec(html)) !== null) {
    const block = m[1];
    const h = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (!h) continue;
    const titulo = stripTags(h[1]);
    if (!titulo || titulo.length < MIN_TITLE_LEN) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const descText = stripTags(p ? p[1] : '');
    if (!skipFundingKw && !hasFundingKeyword(titulo + ' ' + descText)) continue;
    const url = extractHref(block, baseUrl);
    const blockText = stripTags(block);
    const montoInfo = extractMontoFromText(blockText);
    results.push({ titulo, url, descripcion: descText.slice(0, 300),
                   monto_max: montoInfo?.value || 0, moneda: montoInfo?.currency || '' });
  }

  // Divs con clases de tarjeta (div.card, div.item, div.entry, etc.)
  const divRegex = /<div[^>]+class=["'][^"']*\b(card|item|entry|grant|opportunity|convocatoria|resultado|result|post|news|noticia|proyecto|project|funding|fondo)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  while ((m = divRegex.exec(html)) !== null) {
    const block = m[2];
    const h = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (!h) continue;
    const titulo = stripTags(h[1]);
    if (!titulo || titulo.length < MIN_TITLE_LEN) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const descText = stripTags(p ? p[1] : '');
    if (!skipFundingKw && !hasFundingKeyword(titulo + ' ' + descText)) continue;
    const url = extractHref(block, baseUrl);
    const blockText = stripTags(block);
    const montoInfo = extractMontoFromText(blockText);
    results.push({ titulo, url, descripcion: descText.slice(0, 300),
                   monto_max: montoInfo?.value || 0, moneda: montoInfo?.currency || '' });
  }

  return results;
}

// ── Estrategia 3: lista <li> con links ────────────────────────────────────────
function extractListItems(html, baseUrl, skipFundingKw = false) {
  const results = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRegex.exec(html)) !== null) {
    const block = m[1];
    const a = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const titulo = stripTags(a[1]);
    if (!titulo || titulo.length < MIN_TITLE_LEN) continue;
    if (!skipFundingKw && !hasFundingKeyword(titulo + ' ' + block)) continue;
    const url = extractHref(block, baseUrl);
    results.push({ titulo, url, descripcion: stripTags(block).slice(0, 300) });
  }
  return results;
}

// ── Estrategia 4: links sueltos con keywords ─────────────────────────────────
function extractKeywordLinks(html, baseUrl) {
  const results = [];
  const aRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRegex.exec(html)) !== null) {
    const href = m[1].trim();
    const text = stripTags(m[2]);
    if (!text || text.length < MIN_TITLE_LEN) continue;
    if (!hasFundingKeyword(text)) continue;
    let url = null;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      url = href.startsWith('http') ? href : null;
    }
    if (!url) continue;
    results.push({ titulo: text, url, descripcion: '' });
  }
  return results;
}

// ── Estrategia 5: links a PDF/DOCX con keyword de convocatoria ───────────────
function extractPdfLinks(html, baseUrl) {
  const results = [];
  const aRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRegex.exec(html)) !== null) {
    const href = m[1].trim();
    if (!isPdfOrDoc(href)) continue;
    const text = stripTags(m[2]).slice(0, 255);
    let url = null;
    try { url = new URL(href, baseUrl).toString(); } catch { url = href.startsWith('http') ? href : null; }
    if (!url) continue;
    results.push({ titulo: text || 'Documento', url, descripcion: '', isPdf: true });
  }
  return results;
}

// Enriquece ítems marcados con isPdf usando MarkItDown + Gemini (máx MAX_PDF_ENRICH por entidad)
const MAX_PDF_ENRICH = 3;

async function enrichPdfItems(items) {
  let enriched = 0;
  for (const item of items) {
    if (!item.isPdf || enriched >= MAX_PDF_ENRICH) continue;
    try {
      const md = await convertUrlToMarkdown(item.url);
      const fields = await extractConvocatoriaFields(md);
      if (fields) {
        if (fields.titulo  && fields.titulo.length >= MIN_TITLE_LEN)  item.titulo       = fields.titulo;
        if (fields.descripcion)  item.descripcion  = fields.descripcion;
        if (fields.fecha_limite) item.fecha_limite = fields.fecha_limite;
        if (fields.monto_max)    item.monto_max    = fields.monto_max;
        if (fields.moneda)       item.moneda       = fields.moneda;
      }
      enriched++;
    } catch (e) {
      console.warn(`[MarkItDown] No se pudo enriquecer ${item.url}: ${e.message?.slice(0, 100)}`);
    }
  }
}

// ── Detección de URL de siguiente página ─────────────────────────────────────
const NEXT_PAGE_PATTERNS = [
  /rel=["']next["'][^>]*href=["']([^"']+)["']/i,
  /href=["']([^"']+)["'][^>]*rel=["']next["']/i,
  /<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:siguiente|next|›|»|&rsaquo;|&raquo;|\d+\s*›)\s*<\/a>/i,
  /href=["']([^"'?#]+[?&](?:page|p|pg|paged|offset)=(\d+)[^"']*)["']/gi,
];

function detectNextPageUrl(html, visitedUrls, baseUrl) {
  // 1. rel=next link — más fiable
  for (const pat of NEXT_PAGE_PATTERNS.slice(0, 3)) {
    const m = html.match(pat);
    if (m) {
      try {
        const resolved = new URL(m[1], baseUrl).href;
        if (!visitedUrls.has(resolved)) return resolved;
      } catch { /* URL inválida */ }
    }
  }

  // 2. Links de paginación numérica — buscar número mayor al último visitado
  const pageNumRegex = /href=["']([^"']+[?&](?:page|p|pg|paged)=(\d+)[^"']*)["']/gi;
  let maxPage = 0;
  let maxUrl = null;
  let m;
  while ((m = pageNumRegex.exec(html)) !== null) {
    const n = parseInt(m[2], 10);
    try {
      const resolved = new URL(m[1], baseUrl).href;
      if (!visitedUrls.has(resolved) && n > maxPage) {
        maxPage = n;
        maxUrl = resolved;
      }
    } catch { /* URL inválida */ }
  }
  return maxUrl;
}

// ── Scraper principal de una entidad ─────────────────────────────────────────
export async function fetchEntityConvocatorias(entity) {
  // Usar scraper API especial si la entidad es SPA
  const specialScraper = ENTITY_API_SCRAPERS[entity.sigla];
  if (specialScraper) {
    return await specialScraper(entity);
  }

  const url = entity.url_convocatorias || entity.sitio_web;
  if (!url) return [];

  let html;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
      },
    });
    html = await res.text();
    // Rechazar solo si error real (no soft-404: sitios CDN devuelven 404 pero tienen HTML)
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    if (!res.ok && html.length < 5000) throw new Error(`HTTP ${res.status} (sin contenido)`);
  } catch (e) {
    if (e.message.startsWith(entity.sigla || entity.nombre)) throw e;
    throw new Error(`${entity.sigla || entity.nombre}: ${e.message}`);
  }

  // Extraer todas las páginas (paginación)
  const allHtmlPages = [html];
  const visitedUrls = new Set([url]);

  for (let page = 1; page < MAX_PAGES; page++) {
    const lastHtml = allHtmlPages[allHtmlPages.length - 1];
    const nextUrl = detectNextPageUrl(lastHtml, visitedUrls, url);
    if (!nextUrl) break;
    visitedUrls.add(nextUrl);
    try {
      const res = await fetch(nextUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
        },
      });
      if (!res.ok) break;
      const pageHtml = await res.text();
      if (pageHtml.length < 2000) break;
      allHtmlPages.push(pageHtml);
    } catch { break; }
  }

  // Si la URL fuente ya ES una página de convocatorias/grants, relajamos el filtro
  // keyword por ítem: todos los bloques en esa página se presumen convocatorias.
  const skipFundingKw = isGrantPageUrl(url);

  // Aplicar estrategias en todas las páginas
  let items = [];
  for (const pageHtml of allHtmlPages) {
    items = [...items, ...extractTableRows(pageHtml, url, skipFundingKw)];
    items = [...items, ...extractCards(pageHtml, url, skipFundingKw)];
    items = [...items, ...extractListItems(pageHtml, url, skipFundingKw)];
    if (items.length < 4) items = [...items, ...extractKeywordLinks(pageHtml, url)];
    items = [...items, ...extractPdfLinks(pageHtml, url)];
  }

  // Filtrar ruido de navegación/footer y deduplicar por título + URL
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (isNoisyTitle(item.titulo)) continue;
    const key = (item.url || item.titulo).toLowerCase().slice(0, 120);
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }

  // Enriquecer PDFs con MarkItDown + Gemini antes de devolver
  await enrichPdfItems(unique);

  return unique.slice(0, MAX_PER_ENTITY);
}

// ── Ingesta masiva desde el Directorio (Rastreo 1) ───────────────────────────
export async function ingestDirectorioConvocatorias({ soloEntidadId } = {}) {
  const report = {
    entidades_procesadas: 0,
    entidades_con_error: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    timestamp: new Date().toISOString(),
  };

  // Obtener entidades activas con URL (o solo la entidad indicada)
  const entidades = soloEntidadId
    ? await getRows(
        `SELECT id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias
         FROM directorio_entidades
         WHERE deleted_at IS NULL
           AND (url_convocatorias != '' OR sitio_web != '')
           AND id = ?
         ORDER BY nombre`,
        [soloEntidadId]
      )
    : await getRows(
        `SELECT id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias
         FROM directorio_entidades
         WHERE deleted_at IS NULL
           AND (url_convocatorias != '' OR sitio_web != '')
         ORDER BY nombre`
      );

  console.log(`[Rastreo1] Procesando ${entidades.length} entidades del Directorio...`);

  // Procesar en lotes para no saturar (MAX_PARALLEL entidades a la vez)
  for (let i = 0; i < entidades.length; i += MAX_PARALLEL) {
    const batch = entidades.slice(i, i + MAX_PARALLEL);

    const results = await Promise.allSettled(
      batch.map(async (entity) => {
        await fixEntityNameIfNoisy(entity);
        const items = await fetchEntityConvocatorias(entity);
        let entityInserted = 0;
        let entityUpdated  = 0;
        let entitySkipped  = 0;
        // Trackear IDs vistos en esta pasada para detectar desapariciones
        const foundExternoIds = new Set();

        for (const item of items) {
          try {
            const titulo = sanitizeInput(item.titulo || '').slice(0, 255);
            if (!titulo || titulo.length < MIN_TITLE_LEN) continue;

            const urlConv = item.url || '';
            const sourceUrl = entity.url_convocatorias || entity.sitio_web || '';
            const urlConvToStore = isSameOrParentUrl(urlConv, sourceUrl) ? '' : urlConv;
            if (!urlConvToStore) { entitySkipped++; continue; }

            const externoId = crypto
              .createHash('sha256')
              .update(`${entity.id}::${urlConv || titulo}`)
              .digest('hex')
              .slice(0, 64);

            foundExternoIds.add(externoId);

            const fechaLimite = sanitizeInput(item.fecha_limite || '').slice(0, 20);
            const estado = calcEstado(fechaLimite);

            const existing = await getRow(
              'SELECT id, fecha_limite FROM convocatorias WHERE externo_id = ? LIMIT 1',
              [externoId]
            );

            if (existing) {
              // Actualizar fecha_limite y estado si el scraper trajo un valor nuevo
              if (fechaLimite && fechaLimite !== (existing.fecha_limite || '')) {
                await runSql(
                  'UPDATE convocatorias SET fecha_limite = ?, estado = ? WHERE id = ?',
                  [fechaLimite, estado, existing.id]
                );
                entityUpdated++;
              } else {
                entitySkipped++;
              }
              continue;
            }

            // Dedup por url_convocatoria: si DataIngestor ya capturó esta URL,
            // vincularla a esta entidad (entidad_id) sin insertar duplicado.
            const byUrl = await getRow(
              `SELECT id, entidad_id FROM convocatorias WHERE url_convocatoria = ? AND url_convocatoria != '' LIMIT 1`,
              [urlConvToStore]
            );
            if (byUrl) {
              if (!byUrl.entidad_id) {
                await runSql(
                  `UPDATE convocatorias SET entidad_id = ?, fuente = 'RASTREO_DIRECTORIO' WHERE id = ?`,
                  [entity.id, byUrl.id]
                );
              }
              entitySkipped++;
              continue;
            }

            const sectoresClasificados = await classifySectors(titulo, item.descripcion || '', entity.nombre || entity.sigla || '');
            // root_domain: usar el de la entidad (ya normalizado) o extraer de la URL
            const convRootDomain = entity.root_domain || getApexDomain(urlConvToStore) || getApexDomain(entity.sitio_web) || null;
            const montoMax = Number(item.monto_max ?? 0) || 0;
            const monedaBase = entity.pais === 'Colombia' ? 'COP' : 'USD';
            const moneda    = item.moneda || monedaBase;
            await runSql(
              `INSERT INTO convocatorias
                 (id, externo_id, titulo, donante, entidad_id, fuente, descripcion,
                  monto_min, monto_max, moneda,
                  paises_elegibles, sectores,
                  url_convocatoria, url_fuente,
                  fecha_limite, fecha_publicacion,
                  requisitos, estado, score_probabilidad, root_domain, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                crypto.randomUUID(),
                externoId,
                titulo,
                entity.sigla || entity.nombre,
                entity.id,
                'RASTREO_DIRECTORIO',
                sanitizeInput(item.descripcion || '').slice(0, 800),
                0, montoMax,
                moneda,
                JSON.stringify([entity.pais || 'Colombia']),
                JSON.stringify(sectoresClasificados),
                urlConvToStore,
                entity.url_convocatorias || entity.sitio_web,
                fechaLimite, '',
                '[]',
                estado,
                80,
                convRootDomain,
                new Date().toISOString(),
              ]
            );
            entityInserted++;
          } catch (e) {
            if (!e.message?.includes('duplicate key') && !e.message?.includes('UNIQUE')) {
              report.errors.push(`${entity.sigla}: ${e.message}`);
            }
          }
        }

        // Detección de desaparición: si el scrape devolvió ≥1 item, cerrar los que
        // ya no aparecen en la fuente (se retiraron o vencieron sin fecha explícita).
        if (items.length > 0 && foundExternoIds.size > 0) {
          try {
            const allOpen = await getRows(
              `SELECT id, externo_id FROM convocatorias WHERE entidad_id = ? AND estado = 'abierta' AND deleted_at IS NULL`,
              [entity.id]
            );
            for (const conv of allOpen) {
              if (conv.externo_id && !foundExternoIds.has(conv.externo_id)) {
                await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', ['cerrada', conv.id]);
                entityUpdated++;
              }
            }
          } catch (e) {
            console.warn(`[Rastreo1] Detección de desaparición fallida para ${entity.sigla}: ${e.message?.slice(0, 80)}`);
          }
        }

        console.log(`[Rastreo1/${entity.sigla || entity.nombre}] +${entityInserted} nuevas, ~${entityUpdated} actualizadas/cerradas, ${entitySkipped} omitidas`);
        report.entidades_procesadas++;
        report.inserted  += entityInserted;
        report.skipped   += entitySkipped;
      })
    );

    // Registrar errores de fetch
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'rejected') {
        const reason = results[j].reason?.message || 'Error desconocido';
        report.entidades_con_error++;
        report.errors.push(reason);
        console.warn(`[Rastreo1] Error: ${reason}`);
      }
    }
  }

  console.log(`[Rastreo1] Completado: ${report.inserted} insertadas, ${report.entidades_procesadas} entidades, ${report.entidades_con_error} errores`);

  if (report.inserted > 0) {
    invalidateRadarCache();
  }

  return report;
}
