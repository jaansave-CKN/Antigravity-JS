/**
 * backfill_sectors.mjs — Clasifica sectores para convocatorias sin sector.
 *
 * Usa Gemini para asignar 1-3 sectores del taxonomy a cada convocatoria
 * cuyo campo `sectores` sea vacío ('[]' o null).
 *
 * Uso:
 *   node backfill_sectors.mjs [--dry-run] [--limit=N]
 *
 * --dry-run: muestra clasificaciones propuestas sin escribir en BD.
 * --limit=N: procesa solo los primeros N registros (útil para pruebas).
 */

import 'dotenv/config';
import pg from 'pg';
import { classifySectors } from './backend/services/sectorClassifier.js';

const { Pool } = pg;
const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const MAX_ROWS = limitArg ? parseInt(limitArg.split('=')[1]) : Infinity;
const DELAY_MS = 150;

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  backfill_sectors.mjs${DRY_RUN ? ' [DRY-RUN — sin escritura]' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  const client = await pool.connect();
  try {
    const { rows: targets } = await client.query(
      `SELECT id, titulo, descripcion FROM convocatorias
       WHERE deleted_at IS NULL
         AND (sectores IS NULL OR sectores = '[]' OR sectores = '')
         AND LENGTH(titulo) >= 15
       ORDER BY created_at DESC`
    );

    const toProcess = targets.slice(0, MAX_ROWS === Infinity ? targets.length : MAX_ROWS);
    console.log(`Convocatorias sin sector: ${targets.length}`);
    console.log(`Procesando:              ${toProcess.length}\n`);

    const stats = { updated: 0, skipped: 0, errors: 0 };

    for (let i = 0; i < toProcess.length; i++) {
      const row = toProcess[i];
      const prefix = `[${i + 1}/${toProcess.length}]`;
      console.log(`${prefix} "${row.titulo?.slice(0, 70)}..."`);

      const sectors = await classifySectors(row.titulo, row.descripcion);
      if (sectors.length === 0) {
        console.log(`         → Sin clasificación — omitido`);
        stats.skipped++;
        await sleep(DELAY_MS);
        continue;
      }

      console.log(`         → ${JSON.stringify(sectors)}`);

      if (DRY_RUN) {
        stats.updated++;
        await sleep(DELAY_MS);
        continue;
      }

      try {
        await client.query(
          `UPDATE convocatorias SET sectores = $1 WHERE id = $2`,
          [JSON.stringify(sectors), row.id]
        );
        stats.updated++;
      } catch (e) {
        console.error(`         ✗ Error BD: ${e.message}`);
        stats.errors++;
      }

      await sleep(DELAY_MS);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Resultado${DRY_RUN ? ' (DRY-RUN)' : ''}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Clasificadas: ${stats.updated}`);
    console.log(`  Omitidas:     ${stats.skipped}`);
    console.log(`  Errores BD:   ${stats.errors}`);
    console.log(`${'='.repeat(60)}\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
