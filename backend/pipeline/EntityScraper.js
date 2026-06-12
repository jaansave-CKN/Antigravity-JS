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

// Banco Mundial: el sitio es React-SPA, se usa la API JSON oficial
async function fetchBancoMundialItems() {
  const url = 'https://search.worldbank.org/api/v2/projects?format=json&countrycode=CO&status=Active&rows=50';
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'Accept': 'application/json', 'User-Agent': 'RadarFondos/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const projectsObj = data?.projects || {};
  const results = [];
  for (const [id, proj] of Object.entries(projectsObj)) {
    if (!proj || typeof proj !== 'object') continue;
    const countrycodes = Array.isArray(proj.countrycode) ? proj.countrycode : [proj.countrycode];
    if (!countrycodes.some(c => String(c).toUpperCase() === 'CO')) continue;
    results.push({
      titulo: (proj.project_name || `Proyecto BM ${id}`).slice(0, 255),
      url: `https://projects.worldbank.org/en/projects-operations/project-detail/${id}`,
      descripcion: String(proj.pdo || proj.project_abstract?.cdata || '').slice(0, 800),
    });
  }
  return results;
}

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
      // Búsqueda recursiva de un array de grants en el árbol de props
      const findGrants = (obj, depth = 0) => {
        if (!obj || typeof obj !== 'object' || depth > 6) return null;
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
            const first = val[0];
            if (first.title || first.titulo || first.nombre || first.name) return val;
          }
          const deeper = findGrants(val, depth + 1);
          if (deeper) return deeper;
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

// Mapa sigla → scraper especial para entidades SPA del directorio
const ENTITY_API_SCRAPERS = {
  BM:        fetchBancoMundialItems,
  APC:       fetchApcPortalItems,
  WePropel:  fetchWePropelItems,
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PARALLEL     = 4;     // entidades simultáneas (evita rate-limit)
const MAX_PER_ENTITY   = 15;    // máximo convocatorias extraídas por entidad
const MIN_TITLE_LEN    = 12;    // ignorar títulos muy cortos

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
];

function isNoisyTitle(title) {
  const t = title.toLowerCase().trim();
  return NOISE_TITLES.some(n => t.includes(n)) || (t.endsWith(':') && t.length < 40);
}

// Retorna true si itemUrl apunta a la misma página de listado que sourceUrl.
// Previene almacenar el directorio de convocatorias como url_convocatoria específica.
export function isSameOrParentUrl(itemUrl, sourceUrl) {
  if (!itemUrl || !sourceUrl) return !itemUrl;
  try {
    const item = new URL(itemUrl);
    const src  = new URL(sourceUrl);
    const ip = item.origin + item.pathname.replace(/\/$/, '');
    const sp = src.origin  + src.pathname.replace(/\/$/, '');
    return ip === sp;
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

// ── Estrategia 1: filas de tabla (como Minciencias) ───────────────────────────
function extractTableRows(html, baseUrl) {
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
    const url = extractHref(cells[0] + cells[1], baseUrl);
    results.push({ titulo, url, descripcion: stripTags(cells[2] || '') });
  }
  return results;
}

// ── Estrategia 2: tarjetas article/section/div con heading ───────────────────
function extractCards(html, baseUrl) {
  const results = [];
  const cardRegex = /<(?:article|section)[^>]*>([\s\S]*?)<\/(?:article|section)>/gi;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const block = m[1];
    const h = block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (!h) continue;
    const titulo = stripTags(h[1]);
    if (!titulo || titulo.length < MIN_TITLE_LEN) continue;
    const url = extractHref(block, baseUrl);
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({ titulo, url, descripcion: stripTags(p ? p[1] : '').slice(0, 300) });
  }
  return results;
}

// ── Estrategia 3: lista <li> con links ────────────────────────────────────────
function extractListItems(html, baseUrl) {
  const results = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRegex.exec(html)) !== null) {
    const block = m[1];
    const a = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const titulo = stripTags(a[1]);
    if (!titulo || titulo.length < MIN_TITLE_LEN) continue;
    if (!hasFundingKeyword(titulo + ' ' + block)) continue;
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

  // Intentar estrategias en orden de especificidad
  let items = extractTableRows(html, url);
  if (items.length < 3) items = [...items, ...extractCards(html, url)];
  if (items.length < 3) items = [...items, ...extractListItems(html, url)];
  if (items.length < 2) items = [...items, ...extractKeywordLinks(html, url)];

  // Filtrar ruido de navegación/footer y deduplicar por título
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (isNoisyTitle(item.titulo)) continue;
    const key = item.titulo.toLowerCase().slice(0, 80);
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }

  return unique.slice(0, MAX_PER_ENTITY);
}

// ── Ingesta masiva desde el Directorio (Rastreo 1) ───────────────────────────
export async function ingestDirectorioConvocatorias() {
  const report = {
    entidades_procesadas: 0,
    entidades_con_error: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    timestamp: new Date().toISOString(),
  };

  // Obtener todas las entidades activas con URL
  const entidades = await getRows(`
    SELECT id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias
    FROM directorio_entidades
    WHERE deleted_at IS NULL
      AND (url_convocatorias != '' OR sitio_web != '')
    ORDER BY nombre
  `);

  console.log(`[Rastreo1] Procesando ${entidades.length} entidades del Directorio...`);

  // Procesar en lotes para no saturar (MAX_PARALLEL entidades a la vez)
  for (let i = 0; i < entidades.length; i += MAX_PARALLEL) {
    const batch = entidades.slice(i, i + MAX_PARALLEL);

    const results = await Promise.allSettled(
      batch.map(async (entity) => {
        const items = await fetchEntityConvocatorias(entity);
        let entityInserted = 0;
        let entityUpdated  = 0;
        let entitySkipped  = 0;

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

            await runSql(
              `INSERT INTO convocatorias
                 (id, externo_id, titulo, donante, entidad_id, fuente, descripcion,
                  monto_min, monto_max, moneda,
                  paises_elegibles, sectores,
                  url_convocatoria, url_fuente,
                  fecha_limite, fecha_publicacion,
                  requisitos, estado, score_probabilidad, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                crypto.randomUUID(),
                externoId,
                titulo,
                entity.sigla || entity.nombre,
                entity.id,
                'RASTREO_DIRECTORIO',
                sanitizeInput(item.descripcion || '').slice(0, 800),
                0, 0,
                entity.pais === 'Colombia' ? 'COP' : 'USD',
                JSON.stringify([entity.pais || 'Colombia']),
                '[]',
                urlConvToStore,
                entity.url_convocatorias || entity.sitio_web,
                fechaLimite, '',
                '[]',
                estado,
                80,
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

        console.log(`[Rastreo1/${entity.sigla || entity.nombre}] +${entityInserted} nuevas, ~${entityUpdated} actualizadas, ${entitySkipped} omitidas`);
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
