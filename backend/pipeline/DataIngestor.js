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
import { runSql, getRow } from '../db.js';
import { sanitizeInput } from '../middlewares/SecurityMiddleware.js';
import { invalidateRadarCache } from '../middlewares/radarCache.js';
import { fetchEntityConvocatorias, isSameOrParentUrl } from './EntityScraper.js';

const FETCH_TIMEOUT_MS = 15000;

function calcEstadoR2(fechaLimite) {
  if (!fechaLimite) return 'abierta';
  const norm = fechaLimite.trim().replace(/-/g, '/').slice(0, 10);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return norm < today ? 'cerrada' : 'abierta';
}

// ── Portales R2 — NO deben ser entidades listadas en el Directorio ────────────
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
];

// ── Ingesta R2 ────────────────────────────────────────────────────────────────
export async function ingestConvocatorias() {
  const report = {
    fuentes: [],
    totalInserted: 0,
    totalSkipped: 0,
    totalErrors: 0,
    timestamp: new Date().toISOString(),
  };

  for (const source of R2_SOURCES) {
    const fuenteReport = { sigla: source.sigla, inserted: 0, skipped: 0, error: null };

    try {
      const items = await fetchEntityConvocatorias(source);

      for (const item of items) {
        try {
          const titulo = sanitizeInput(item.titulo || '').slice(0, 255);
          if (!titulo || titulo.length < 12) continue;

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
              source.nombre,
              null,
              'RASTREO_WEB_EXTERNO',
              sanitizeInput(item.descripcion || '').slice(0, 800),
              0, 0,
              'USD',
              JSON.stringify([source.pais]),
              '[]',
              urlConvToStore,
              source.url_convocatorias,
              fechaLimite, '',
              '[]',
              estado,
              75,
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
  }

  return report;
}

// ── Seed del Directorio ───────────────────────────────────────────────────────
// Las 30 entidades ya están en la BD; esta función es un no-op de compatibilidad.
export async function seedDirectorio() {}
