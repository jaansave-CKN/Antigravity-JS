/**
 * DataIngestor.js — Rastreo 2: Fuentes web EXTERNAS al Directorio
 * GGIE · Radar de Fondos 360
 *
 * REGLA ARQUITECTURAL:
 *   R1 (EntityScraper) = rastrea SOLO entidades del Directorio
 *   R2 (DataIngestor)  = rastrea portales web que NO son entidades del Directorio
 *
 * fuente en BD: 'RASTREO_WEB_EXTERNO'
 */

import crypto from 'crypto';
import { runSql, getRow, getRows } from '../db.js';
import { sanitizeInput } from '../middlewares/SecurityMiddleware.js';
import { invalidateRadarCache } from '../middlewares/radarCache.js';
import { fetchEntityConvocatorias, isSameOrParentUrl } from './EntityScraper.js';
import { classifySectors } from '../services/sectorClassifier.js';
import { getApexDomain } from '../utils/domainUtils.js';
import { sweepEndsWith } from '../services/sweepService.js';

const FETCH_TIMEOUT_MS = 15000;

function calcEstadoR2(fechaLimite) {
  if (!fechaLimite) return 'abierta';
  const norm = fechaLimite.trim().replace(/-/g, '/').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return norm < today ? 'cerrada' : 'abierta';
}

// ── Portales R2 — fuentes externas; seedDirectorio() las integra al Directorio ──
// Estas 6 fundaciones son conocidas y rastreadas activamente.
// seedDirectorio() las inserta en directorio_entidades al arranque (si no existen),
// y sweepEndsWith() vincula sus convocatorias a R1 automáticamente.
const R2_SOURCES = [
  {
    sigla: 'MacArthur',
    nombre: 'MacArthur Foundation',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://www.macfound.org/grants/',
    sitio_web: 'https://www.macfound.org',
  },
  {
    sigla: 'IDRC',
    nombre: 'International Development Research Centre',
    pais: 'Canadá',
    url_convocatorias: 'https://www.idrc.ca/en/funding',
    sitio_web: 'https://www.idrc.ca',
  },
  {
    sigla: 'IAF',
    nombre: 'Inter-American Foundation',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://www.iaf.gov/grants/',
    sitio_web: 'https://www.iaf.gov',
  },
  {
    sigla: 'Wellcome',
    nombre: 'Wellcome Trust',
    pais: 'Reino Unido',
    url_convocatorias: 'https://wellcome.org/grant-funding/schemes',
    sitio_web: 'https://wellcome.org',
  },
  {
    sigla: 'Ford',
    nombre: 'Ford Foundation',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://www.fordfoundation.org/work/our-grants/grants-database/',
    sitio_web: 'https://www.fordfoundation.org',
  },
  {
    sigla: 'OSF',
    nombre: 'Open Society Foundations',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://www.opensocietyfoundations.org/grants',
    sitio_web: 'https://www.opensocietyfoundations.org',
  },
  {
    sigla: 'Skoll',
    nombre: 'Skoll Foundation',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://skoll.org/apply/',
    sitio_web: 'https://skoll.org',
  },
  {
    sigla: 'Omidyar',
    nombre: 'Omidyar Network',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://omidyar.com/our-work/',
    sitio_web: 'https://omidyar.com',
  },
  {
    sigla: 'CIVICUS',
    nombre: 'CIVICUS World Alliance for Citizen Participation',
    pais: 'Internacional',
    url_convocatorias: 'https://www.civicus.org/index.php/media-resources/funding-opportunities',
    sitio_web: 'https://www.civicus.org',
  },
  {
    sigla: 'GlobalGiving',
    nombre: 'GlobalGiving Foundation',
    pais: 'Estados Unidos',
    url_convocatorias: 'https://www.globalgiving.org/learn/grants/',
    sitio_web: 'https://www.globalgiving.org',
  },
  {
    sigla: 'Horizons',
    nombre: 'Horizon Europe — European Commission',
    pais: 'Europa',
    url_convocatorias: 'https://eic.ec.europa.eu/eic-open-calls_en',
    sitio_web: 'https://eic.ec.europa.eu',
  },
  {
    sigla: 'NWO',
    nombre: 'NWO Dutch Research Council',
    pais: 'Países Bajos',
    url_convocatorias: 'https://www.nwo.nl/en/calls-for-proposals',
    sitio_web: 'https://www.nwo.nl',
  },
];

// ── Ingesta R2 ────────────────────────────────────────────────────────────────
export async function ingestConvocatorias() {
  // Lee keywords activas desde app_settings para filtrar al escanear
  let activeTerms = [];
  try {
    const row = await getRow(`SELECT value FROM app_settings WHERE key = 'radar_keywords'`);
    if (row) {
      const stored = JSON.parse(row.value);
      activeTerms = stored.filter(k => k.enabled).map(k => k.term.toLowerCase());
    }
  } catch {}
  if (activeTerms.length > 0) {
    console.log(`[Rastreo2] Filtrando por ${activeTerms.length} palabra(s) clave: ${activeTerms.join(', ')}`);
  }

  const report = {
    fuentes: [],
    totalInserted: 0,
    totalSkipped: 0,
    totalErrors: 0,
    timestamp: new Date().toISOString(),
  };

  // Precarga mapa apex-domain → entidad_id para vinculación R1 inmediata (una sola query)
  const entidadByDomain = new Map(); // lowercase root_domain → entidad_id
  try {
    const allEnts = await getRows(
      `SELECT id, root_domain, sitio_web FROM directorio_entidades WHERE deleted_at IS NULL`
    );
    for (const ent of allEnts) {
      const apex = ent.root_domain || getApexDomain(ent.sitio_web || '');
      if (apex) entidadByDomain.set(apex.toLowerCase(), ent.id);
    }
  } catch (e) {
    console.warn('[Rastreo2] No se pudo cargar mapa de entidades:', e.message?.slice(0, 120));
  }

  for (const source of R2_SOURCES) {
    const fuenteReport = { sigla: source.sigla, inserted: 0, skipped: 0, error: null };

    try {
      const items = await fetchEntityConvocatorias(source);

      for (const item of items) {
        try {
          const titulo = sanitizeInput(item.titulo || '').slice(0, 255);
          if (!titulo || titulo.length < 12) continue;

          // Filtrar por keywords del Panel (si hay alguna activa)
          if (activeTerms.length > 0) {
            const haystack = `${titulo} ${item.descripcion || ''}`.toLowerCase();
            if (!activeTerms.some(t => haystack.includes(t))) { fuenteReport.skipped++; continue; }
          }

          const urlConv = item.url || '';
          const sourceUrl = source.url_convocatorias || '';
          // Solo almacenar url_convocatoria si apunta a una página específica,
          // no al directorio de listado de origen.
          const urlConvToStore = isSameOrParentUrl(urlConv, sourceUrl) ? '' : urlConv;

          // Sin URL específica = convocatoria no verificable → omitir
          if (!urlConvToStore) { fuenteReport.skipped++; continue; }

          const externoId = crypto
            .createHash('sha256')
            .update(`R2::${source.sigla}::${urlConv || titulo}`)
            .digest('hex')
            .slice(0, 64);

          const fechaLimite = sanitizeInput(item.fecha_limite || '').slice(0, 20);
          const estado = calcEstadoR2(fechaLimite);

          const existing = await getRow(
            'SELECT id, fecha_limite FROM convocatorias WHERE externo_id = ? LIMIT 1',
            [externoId]
          );

          if (existing) {
            if (fechaLimite && fechaLimite !== (existing.fecha_limite || '')) {
              await runSql(
                'UPDATE convocatorias SET fecha_limite = ?, estado = ? WHERE id = ?',
                [fechaLimite, estado, existing.id]
              );
              fuenteReport.inserted++; // reusa contador como "actualizadas"
            } else {
              fuenteReport.skipped++;
            }
            continue;
          }

          const sectoresClasificados = await classifySectors(titulo, item.descripcion || '');
          // root_domain normalizado desde la URL de la convocatoria → T2a exacto en GREEDY_EXISTS
          const convRootDomain = getApexDomain(urlConvToStore) || getApexDomain(source.url_convocatorias) || null;

          // Vinculación directa R1: consulta el mapa precargado por apex domain
          const directEntidadId = convRootDomain
            ? (entidadByDomain.get(convRootDomain.toLowerCase()) ?? null)
            : null;

          const montoMax = Number(item.monto_max ?? 0) || 0;
          const moneda   = item.moneda || 'USD';
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
              source.nombre,
              directEntidadId,
              'RASTREO_WEB_EXTERNO',
              sanitizeInput(item.descripcion || '').slice(0, 800),
              0, montoMax,
              moneda,
              JSON.stringify([source.pais]),
              JSON.stringify(sectoresClasificados),
              urlConvToStore,
              source.url_convocatorias,
              fechaLimite, '',
              '[]',
              estado,
              75,
              convRootDomain,
              new Date().toISOString(),
            ]
          );
          fuenteReport.inserted++;
        } catch (e) {
          if (!e.message?.includes('duplicate') && !e.message?.includes('UNIQUE')) {
            fuenteReport.error = e.message;
          }
        }
      }
      console.log(`[Rastreo2/${source.sigla}] +${fuenteReport.inserted} nuevas, ${fuenteReport.skipped} omitidas`);
    } catch (e) {
      fuenteReport.error = e.message;
      console.warn(`[Rastreo2/${source.sigla}] Error: ${e.message}`);
      report.totalErrors++;
    }

    report.fuentes.push(fuenteReport);
    report.totalInserted += fuenteReport.inserted;
    report.totalSkipped  += fuenteReport.skipped;
  }

  console.log(`[Rastreo2] Completado: ${report.totalInserted} insertadas, ${report.totalErrors} errores`);

  if (report.totalInserted > 0) {
    invalidateRadarCache();
    // Vincula inmediatamente nuevas convocatorias al Directorio por Regla endsWith
    sweepEndsWith().catch(e => console.warn('[DataIngestor/sweep]', e.message?.slice(0, 120)));
  }

  return report;
}

// ── Seed del Directorio ───────────────────────────────────────────────────────
// Las entidades del Directorio se gestionan manualmente desde la UI.
// Los R2_SOURCES (DataIngestor) NO se seedean aquí — tienen fuente propia.
export async function seedDirectorio() {}
