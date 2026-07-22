/**
 * sweepService.js — Barrido global endsWith
 * Vincula convocatorias sin entidad_id a entidades del Directorio
 * usando la Regla de Pertenencia por Inclusión (hostname.endsWith).
 *
 * Importado por: server.js (startup + endpoint), DataIngestor.js (post-ingesta)
 *
 * Pruebas implementadas (mismas que GREEDY_EXISTS en server.js):
 *   T2a · root_domain exacto (case-insensitive)
 *   T2b · hostname de url_fuente / url_convocatoria endsWith root_domain
 *   T2c · root_domain de conv aparece en sitio_web de entidad
 *   T2e · sitio_web de entidad aparece en URL de convocatoria (ILIKE — más robusto)
 *   T3  · fuzzy nombre vs donante (ILIKE)
 *   T4  · fuzzy sigla vs donante (ILIKE)
 */

import { pool } from '../db.js';
import { invalidateRadarCache } from '../middlewares/radarCache.js';

/**
 * Itera todas las convocatorias sin entidad_id y aplica las pruebas de coincidencia
 * contra todas las entidades del Directorio. Actualiza entidad_id donde hay match.
 * Llama a invalidateRadarCache() si se realizaron cambios.
 *
 * @returns {Promise<number>} número de convocatorias vinculadas
 */
export async function sweepEndsWith() {
  try {
    const res = await pool.query(`
      UPDATE convocatorias
      SET
        entidad_id  = matches.ent_id,
        root_domain = COALESCE(convocatorias.root_domain, matches.ent_root)
      FROM (
        SELECT DISTINCT ON (c.id)
          c.id            AS conv_id,
          _de.id          AS ent_id,
          _de.root_domain AS ent_root
        FROM convocatorias c
        CROSS JOIN directorio_entidades _de
        WHERE c.deleted_at IS NULL
          AND c.entidad_id IS NULL
          AND _de.deleted_at IS NULL
          AND (
            -- T2a: root_domain exacto (case-insensitive)
            (
              _de.root_domain IS NOT NULL AND _de.root_domain != ''
              AND c.root_domain  IS NOT NULL AND c.root_domain  != ''
              AND LOWER(c.root_domain) = LOWER(_de.root_domain)
            )
            -- T2b: root_domain subdominio de entidad
            OR (
              _de.root_domain IS NOT NULL AND _de.root_domain != ''
              AND c.root_domain  IS NOT NULL AND c.root_domain  != ''
              AND LOWER(c.root_domain) LIKE '%.' || LOWER(_de.root_domain)
            )
            -- T2b ext: hostname de url_fuente (exact o subdominio)
            OR (
              _de.root_domain IS NOT NULL AND _de.root_domain != ''
              AND c.url_fuente IS NOT NULL AND c.url_fuente != ''
              AND (
                SPLIT_PART(REGEXP_REPLACE(LOWER(c.url_fuente), '^https?://(www\\.)?', ''), '/', 1) = LOWER(_de.root_domain)
                OR SPLIT_PART(REGEXP_REPLACE(LOWER(c.url_fuente), '^https?://(www\\.)?', ''), '/', 1) LIKE '%.' || LOWER(_de.root_domain)
              )
            )
            -- T2b ext: hostname de url_convocatoria (exact o subdominio)
            OR (
              _de.root_domain IS NOT NULL AND _de.root_domain != ''
              AND c.url_convocatoria IS NOT NULL AND c.url_convocatoria != ''
              AND (
                SPLIT_PART(REGEXP_REPLACE(LOWER(c.url_convocatoria), '^https?://(www\\.)?', ''), '/', 1) = LOWER(_de.root_domain)
                OR SPLIT_PART(REGEXP_REPLACE(LOWER(c.url_convocatoria), '^https?://(www\\.)?', ''), '/', 1) LIKE '%.' || LOWER(_de.root_domain)
              )
            )
            -- T2c: root_domain de conv aparece en sitio_web de entidad
            OR (
              c.root_domain IS NOT NULL AND c.root_domain != ''
              AND _de.sitio_web IS NOT NULL AND _de.sitio_web != ''
              AND LOWER(_de.sitio_web) LIKE '%' || LOWER(c.root_domain) || '%'
            )
            -- T2e: sitio_web de entidad aparece directamente en URLs de convocatoria (ILIKE — más robusto)
            --      Caso: entidad.sitio_web='wellcome.org', url_fuente contiene 'wellcome.org'
            --      También: url_convocatoria='https://funding.wellcome.org/...' contiene 'wellcome.org'
            OR (
              _de.sitio_web IS NOT NULL AND _de.sitio_web != ''
              AND (
                (c.url_fuente IS NOT NULL AND c.url_fuente != ''
                  AND c.url_fuente ILIKE '%' || REGEXP_REPLACE(_de.sitio_web, '^https?://(www\\.)?', '') || '%')
                OR (c.url_convocatoria IS NOT NULL AND c.url_convocatoria != ''
                  AND c.url_convocatoria ILIKE '%' || REGEXP_REPLACE(_de.sitio_web, '^https?://(www\\.)?', '') || '%')
              )
            )
            -- T3: fuzzy texto donante vs nombre (ILIKE = case-insensitive)
            OR (
              _de.nombre IS NOT NULL AND LENGTH(_de.nombre) > 3
              AND c.donante IS NOT NULL AND c.donante != ''
              AND (
                c.donante ILIKE '%' || _de.nombre || '%'
                OR (LENGTH(c.donante) > 4 AND _de.nombre ILIKE '%' || c.donante || '%')
              )
            )
            -- T4: fuzzy sigla donante vs sigla (ILIKE, guard >2 chars)
            OR (
              _de.sigla IS NOT NULL AND _de.sigla != '' AND LENGTH(_de.sigla) > 2
              AND c.donante IS NOT NULL
              AND c.donante ILIKE '%' || _de.sigla || '%'
            )
          )
        ORDER BY c.id, _de.id
      ) matches
      WHERE convocatorias.id = matches.conv_id
    `);
    const n = res.rowCount ?? 0;
    if (n > 0) {
      console.info(`[sweep/endsWith] ${n} convocatoria(s) vinculadas al Directorio.`);
      invalidateRadarCache();
    }
    return n;
  } catch (e) {
    console.warn('[sweep/endsWith]', e.message?.slice(0, 200));
    return 0;
  }
}
