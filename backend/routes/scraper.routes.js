/**
 * scraper.routes.js — Scraping de portales oficiales de convocatorias
 * GET /api/scrape/minciencias  → extrae convocatorias de minciencias.gov.co
 */

const MINCIENCIAS_URL = 'https://minciencias.gov.co/convocatorias/todas';

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RadarFondos/1.0; +https://radarfondos.co)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CO,es;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar ${url}`);
  return res.text();
}

function parseMincienciasHTML(html) {
  const results = [];

  // Extrae filas de la tabla <tbody>
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return results;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 2) continue;

    const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const extractHref = (s) => { const m = s.match(/href="([^"]+)"/); return m ? m[1] : null; };

    const numero = stripTags(cells[0] || '');
    const tituloCell = cells[1] || '';
    const titulo = stripTags(tituloCell);
    const href = extractHref(tituloCell);
    const descripcion = stripTags(cells[2] || '');
    const recursos = stripTags(cells[3] || '');
    const fechaApertura = stripTags(cells[4] || '');

    if (!titulo) continue;

    results.push({
      numero: numero || null,
      titulo,
      descripcion: descripcion || null,
      recursos: recursos || null,
      fecha_apertura: fechaApertura || null,
      url: href
        ? (href.startsWith('http') ? href : `https://minciencias.gov.co${href}`)
        : null,
      fuente: 'Minciencias',
    });
  }
  return results;
}

async function scrapeMinciencias(maxPages = 3) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const url = page === 0 ? MINCIENCIAS_URL : `${MINCIENCIAS_URL}?page=${page}`;
    const html = await fetchPage(url);
    const items = parseMincienciasHTML(html);
    if (items.length === 0) break;
    all.push(...items);
  }
  return all;
}

export function registerScraperRoutes(app, _authenticate) {
  /**
   * GET /api/scrape/minciencias
   * Devuelve convocatorias activas desde minciencias.gov.co (datos públicos, sin auth)
   */
  app.get('/api/scrape/minciencias', async (req, res) => {
    try {
      const pages = Math.min(parseInt(req.query.pages || '3', 10), 10);
      const data = await scrapeMinciencias(pages);
      res.json({ ok: true, fuente: 'Minciencias', total: data.length, data });
    } catch (err) {
      console.error('[scraper] minciencias error:', err.message);
      res.status(502).json({ ok: false, message: `No se pudo conectar con Minciencias: ${err.message}` });
    }
  });
}
