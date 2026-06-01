/**
 * CronScheduler.js — Actualización programada de convocatorias cada 24h
 * GGIE · Radar de Fondos 360
 */

import cron from 'node-cron';
import { ingestConvocatorias } from './DataIngestor.js';
import { runSql } from '../db.js';
import { runS3Backup } from '../scripts/s3backup.js';

async function logCrawl(tipo, resultado) {
  try {
    await runSql(
      `INSERT INTO crawl_log (tipo, fuente, subvenciones_encontradas, resultado, ejecutada_en)
       VALUES (?,?,?,?,?)`,
      [
        tipo,
        'SECOP_II + WORLD_BANK',
        (resultado?.secop?.inserted || 0) + (resultado?.worldbank?.inserted || 0),
        JSON.stringify(resultado),
        new Date().toISOString(),
      ]
    );
  } catch (e) {
    console.error('[Cron] Error al registrar log:', e.message);
  }
}

export function startScheduler() {
  // Ejecución diaria a las 02:00 AM (zona Colombia UTC-5 → 07:00 UTC)
  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] ▶ Iniciando ingesta programada de convocatorias...');
    const start = Date.now();
    try {
      const result = await ingestConvocatorias();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const total = (result?.secop?.inserted || 0) + (result?.worldbank?.inserted || 0);
      console.log(`[Cron] ✓ Ingesta completada en ${elapsed}s · ${total} convocatorias nuevas`);
      await logCrawl('cron_diario', result);
    } catch (err) {
      console.error('[Cron] ✗ Error en ingesta programada:', err.message);
      await logCrawl('cron_diario_error', { error: err.message });
    }
  }, {
    timezone: 'America/Bogota',
  });

  // Backup S3 diario a las 03:00 AM COT (una hora después de la ingesta)
  cron.schedule('0 3 * * *', async () => {
    console.log('[Cron] ▶ Iniciando backup S3...');
    try {
      const result = await runS3Backup();
      if (result.skipped) console.log('[Cron] Backup S3 omitido:', result.reason);
      else console.log('[Cron] ✓ Backup S3 completado:', result.key || result.error);
    } catch (err) {
      console.error('[Cron] ✗ Error en backup S3:', err.message);
    }
  }, { timezone: 'America/Bogota' });

  console.log('[Cron] Programador activo · Ingesta 02:00 + Backup S3 03:00 COT');
}

// Permite ejecutar la ingesta manualmente (llamado desde /api/convocatorias/refresh)
export async function runManualIngest() {
  const result = await ingestConvocatorias();
  await logCrawl('manual', result);
  return result;
}
