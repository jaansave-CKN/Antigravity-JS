/**
 * CronScheduler.js — Actualización programada de convocatorias cada 24h
 * GGIE · Radar de Fondos 360
 */

import cron from 'node-cron';
import { ingestConvocatorias } from './DataIngestor.js';
import { ingestDirectorioConvocatorias } from './EntityScraper.js';
import { runSql } from '../db.js';
import { runS3Backup } from '../scripts/s3backup.js';

async function logCrawl(tipo, resultado) {
  try {
    // R1: RASTREO_DIRECTORIO | R2: fuentes web externas al directorio
    const fuente = tipo.includes('rastreo1') ? 'RASTREO_DIRECTORIO' : 'RASTREO_WEB_EXTERNO';
    const insertadas = tipo.includes('rastreo1')
      ? (resultado?.inserted || 0)
      : (resultado?.totalInserted || 0);
    await runSql(
      `INSERT INTO crawl_log (tipo, fuente, subvenciones_encontradas, resultado, ejecutada_en)
       VALUES (?,?,?,?,?)`,
      [tipo, fuente, insertadas, JSON.stringify(resultado), new Date().toISOString()]
    );
  } catch (e) {
    console.error('[Cron] Error al registrar log:', e.message);
  }
}

export function startScheduler() {
  // Rastreo 2: Fuentes web EXTERNAS al Directorio — 02:00 AM COT
  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] ▶ Rastreo 2: fuentes web externas al Directorio...');
    const start = Date.now();
    try {
      const result = await ingestConvocatorias();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[Cron] ✓ Rastreo 2 completado en ${elapsed}s · ${result.totalInserted} nuevas`);
      await logCrawl('cron_rastreo2', result);
    } catch (err) {
      console.error('[Cron] ✗ Error Rastreo 2:', err.message);
      await logCrawl('cron_rastreo2_error', { error: err.message });
    }
  }, { timezone: 'America/Bogota' });

  // Rastreo 1: Directorio de entidades — 02:30 AM COT (30 min después del Rastreo 2)
  cron.schedule('30 2 * * *', async () => {
    console.log('[Cron] ▶ Rastreo 1: entidades del Directorio...');
    const start = Date.now();
    try {
      const result = await ingestDirectorioConvocatorias();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[Cron] ✓ Rastreo 1 completado en ${elapsed}s · ${result.inserted} nuevas de ${result.entidades_procesadas} entidades`);
      await logCrawl('cron_rastreo1', result);
    } catch (err) {
      console.error('[Cron] ✗ Error Rastreo 1:', err.message);
      await logCrawl('cron_rastreo1_error', { error: err.message });
    }
  }, { timezone: 'America/Bogota' });

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

  console.log('[Cron] Programador activo · Rastreo2 02:00 · Rastreo1 02:30 · Backup S3 03:00 COT');
}

// Permite ejecutar la ingesta manualmente (llamado desde /api/convocatorias/refresh)
export async function runManualIngest() {
  const result = await ingestConvocatorias();
  await logCrawl('manual', result);
  return result;
}
