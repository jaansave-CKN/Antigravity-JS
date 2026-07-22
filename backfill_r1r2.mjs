/**
 * backfill_r1r2.mjs — Siembra R2_SOURCES en directorio_entidades y
 *                     reclasifica convocatorias R2 → R1 por apex domain.
 *
 * Paso 1: Inserta las 6 fuentes conocidas en directorio_entidades (si no existen).
 * Paso 2: Reclasifica todas las convocatorias con entidad_id IS NULL cuyos URLs
 *         pertenecen a alguna entidad del Directorio.
 *
 * Uso:
 *   node backfill_r1r2.mjs [--dry-run] [--limit=N]
 *
 * --dry-run: muestra qué se haría sin escribir en BD.
 * --limit=N: procesa solo los primeros N registros en el paso 2.
 */

import 'dotenv/config';
import crypto from 'crypto';
import pg from 'pg';
import { getApexDomain } from './backend/utils/domainUtils.js';

const { Pool } = pg;
const DRY_RUN  = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const MAX_ROWS = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;

// Fuentes R2 conocidas que deben estar en el Directorio
const R2_SOURCES = [
  { sigla: 'MacArthur', nombre: 'MacArthur Foundation',                    pais: 'Estados Unidos', sitio_web: 'https://www.macfound.org',                   url_convocatorias: 'https://www.macfound.org/grants/' },
  { sigla: 'IDRC',      nombre: 'International Development Research Centre', pais: 'Canadá',         sitio_web: 'https://www.idrc.ca',                         url_convocatorias: 'https://www.idrc.ca/en/funding' },
  { sigla: 'IAF',       nombre: 'Inter-American Foundation',                pais: 'Estados Unidos', sitio_web: 'https://www.iaf.gov',                         url_convocatorias: 'https://www.iaf.gov/grants/' },
  { sigla: 'Wellcome',  nombre: 'Wellcome Trust',                           pais: 'Reino Unido',    sitio_web: 'https://wellcome.org',                        url_convocatorias: 'https://wellcome.org/grant-funding/schemes' },
  { sigla: 'Ford',      nombre: 'Ford Foundation',                          pais: 'Estados Unidos', sitio_web: 'https://www.fordfoundation.org',              url_convocatorias: 'https://www.fordfoundation.org/work/our-grants/grants-database/' },
  { sigla: 'OSF',       nombre: 'Open Society Foundations',                 pais: 'Estados Unidos', sitio_web: 'https://www.opensocietyfoundations.org',      url_convocatorias: 'https://www.opensocietyfoundations.org/grants' },
];

// ── Conexión PostgreSQL ───────────────────────────────────────────────────────
let connStr = process.env.DATABASE_URL || '';
try {
  const u = new URL(connStr);
  u.searchParams.delete('sslmode');
  connStr = u.toString();
} catch {}

const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.match(/localhost|127\.0\.0\.1/) ? false : { rejectUnauthorized: false },
  max: 3,
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(65)}`);
  console.log(`  backfill_r1r2.mjs${DRY_RUN ? ' [DRY-RUN — sin escritura]' : ''}`);
  console.log(`${'='.repeat(65)}\n`);

  const client = await pool.connect();
  try {

    // ── PASO 1: Sembrar R2_SOURCES en directorio_entidades ───────────────────
    console.log('PASO 1 — Verificar entidades en Directorio\n');
    const seedStats = { insertadas: 0, existentes: 0 };

    for (const src of R2_SOURCES) {
      const apex = getApexDomain(src.sitio_web);
      const { rows: exists } = await client.query(
        `SELECT id FROM directorio_entidades
         WHERE deleted_at IS NULL AND (
           LOWER(sigla) = LOWER($1) OR LOWER(nombre) = LOWER($2)
           OR (root_domain IS NOT NULL AND LOWER(root_domain) = LOWER($3))
         ) LIMIT 1`,
        [src.sigla, src.nombre, apex || '']
      );

      if (exists.length > 0) {
        console.log(`  [OK]  ${src.sigla.padEnd(12)} ya existe en Directorio (id: ${exists[0].id.slice(0,8)}...)`);
        // Asegurar que root_domain esté seteado
        if (!DRY_RUN && apex) {
          await client.query(
            `UPDATE directorio_entidades SET root_domain = $1 WHERE id = $2 AND (root_domain IS NULL OR root_domain = '')`,
            [apex, exists[0].id]
          );
        }
        seedStats.existentes++;
        continue;
      }

      console.log(`  [NEW] ${src.sigla.padEnd(12)} → insertando (${apex})`);
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO directorio_entidades
             (id, nombre, sigla, tipo, pais, sitio_web, url_convocatorias,
              status, root_domain, fuente, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
           ON CONFLICT DO NOTHING`,
          [
            crypto.randomUUID(),
            src.nombre,
            src.sigla,
            'Fundación / Organismo Internacional',
            src.pais,
            src.sitio_web,
            src.url_convocatorias,
            'activa',
            apex,
            'SEED_R2',
          ]
        );
      }
      seedStats.insertadas++;
    }

    console.log(`\n  Insertadas: ${seedStats.insertadas}  |  Ya existían: ${seedStats.existentes}\n`);

    // ── PASO 2: Cargar mapa completo de entidades ─────────────────────────────
    console.log('PASO 2 — Reclasificar convocatorias R2 → R1\n');

    const { rows: entidades } = await client.query(
      `SELECT id, nombre, sigla, root_domain, sitio_web
       FROM directorio_entidades WHERE deleted_at IS NULL`
    );

    const entMap = new Map();
    for (const ent of entidades) {
      const apex = ent.root_domain || getApexDomain(ent.sitio_web || '');
      if (apex) entMap.set(apex.toLowerCase(), { id: ent.id, nombre: ent.nombre || ent.sigla });
    }
    // En dry-run las entidades nuevas no están en BD aún → simularlas en el mapa
    for (const src of R2_SOURCES) {
      const apex = getApexDomain(src.sitio_web);
      if (apex && !entMap.has(apex.toLowerCase())) {
        entMap.set(apex.toLowerCase(), { id: '(dry-run)', nombre: src.nombre });
      }
    }
    console.log(`  Entidades con dominio en mapa: ${entMap.size}`);

    const { rows: r2 } = await client.query(
      `SELECT id, titulo, url_convocatoria, url_fuente, root_domain, donante
       FROM convocatorias
       WHERE deleted_at IS NULL AND entidad_id IS NULL
       ORDER BY created_at DESC`
    );

    const toProcess = MAX_ROWS === Infinity ? r2 : r2.slice(0, MAX_ROWS);
    console.log(`  Convocatorias en R2: ${r2.length}  |  Procesando: ${toProcess.length}\n`);

    const stats = { vinculadas: 0, sin_match: 0, errores: 0 };

    for (const row of toProcess) {
      const apex =
        getApexDomain(row.url_convocatoria || '') ||
        getApexDomain(row.url_fuente || '') ||
        (row.root_domain ? row.root_domain.toLowerCase() : null);

      const match = apex ? entMap.get(apex.toLowerCase()) : null;

      if (!match) {
        stats.sin_match++;
        continue;
      }

      const label = `"${(row.titulo || '').slice(0, 55)}"`;
      console.log(`  [→ R1] ${label}`);
      console.log(`         ${(apex || '').padEnd(35)} → ${match.nombre}`);

      if (DRY_RUN) {
        stats.vinculadas++;
        continue;
      }

      try {
        await client.query(
          `UPDATE convocatorias
           SET entidad_id = $1, fuente = 'RASTREO_DIRECTORIO'
           WHERE id = $2`,
          [match.id, row.id]
        );
        stats.vinculadas++;
      } catch (e) {
        console.error(`         ✗ Error BD: ${e.message}`);
        stats.errores++;
      }
    }

    console.log(`\n${'='.repeat(65)}`);
    console.log(`  Resultado${DRY_RUN ? ' (DRY-RUN — nada escrito)' : ''}`);
    console.log(`${'='.repeat(65)}`);
    console.log(`  Entidades sembradas en Directorio : ${seedStats.insertadas}`);
    console.log(`  Convocatorias vinculadas a R1     : ${stats.vinculadas}`);
    console.log(`  Convocatorias sin match (R2)      : ${stats.sin_match}`);
    console.log(`  Errores BD                        : ${stats.errores}`);
    console.log();

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('[backfill_r1r2] Error fatal:', e.message);
  process.exit(1);
});
