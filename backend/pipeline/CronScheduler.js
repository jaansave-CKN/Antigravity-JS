/**
 * CronScheduler.js — Actualización programada de convocatorias cada 24h
 * GGIE · Radar de Fondos 360
 */

import cron from 'node-cron';
import { ingestConvocatorias } from './DataIngestor.js';
import { ingestDirectorioConvocatorias } from './EntityScraper.js';
import { runSql, getRows } from '../db.js';

const NOISE_CRON_RE = /^(our |their |its |the [\w])|^about\s(us|the\s|our\s)|^(who|what)\s(we|is)\s|^(learn|read|see|view|explore)\s(more|all)|^(sign|log)\s(in|out)|funding\sfaq|grants?\sfaq|grants?\sdata|grants?\sdatabase|^descarga |^download\sour\s|brochure$/i;

async function expirarConvocatorias() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Cerrar por fecha_limite vencida (explícita)
  const rowsFecha = await getRows(
    `SELECT id, fecha_limite FROM convocatorias WHERE estado = 'abierta' AND deleted_at IS NULL AND fecha_limite != ''`,
    []
  );
  let cerradas = 0;
  for (const row of rowsFecha) {
    const norm = (row.fecha_limite || '').replace(/\//g, '-');
    if (norm && norm < today) {
      await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', ['cerrada', row.id]);
      cerradas++;
    }
  }

  // 2. Cerrar por antigüedad: sin fecha_limite + más de 180 días ingresada
  //    Convocatorias sin deadline conocido que llevan 6 meses en el sistema
  //    son muy probablemente páginas históricas / proyectos cerrados.
  const corte180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const rowsAntiguas = await getRows(
    `SELECT id FROM convocatorias WHERE estado = 'abierta' AND deleted_at IS NULL AND (fecha_limite = '' OR fecha_limite IS NULL) AND created_at < ?`,
    [corte180]
  );
  let cerradasAntiguas = 0;
  for (const row of rowsAntiguas) {
    await runSql('UPDATE convocatorias SET estado = ? WHERE id = ?', ['cerrada', row.id]);
    cerradasAntiguas++;
  }

  // 3. Soft-delete falsos positivos de navegación (títulos de sección/nav)
  const allOpen = await getRows(
    `SELECT id, titulo FROM convocatorias WHERE deleted_at IS NULL AND estado != 'cerrada'`,
    []
  );
  let eliminados = 0;
  for (const row of allOpen) {
    if (NOISE_CRON_RE.test((row.titulo || '').trim())) {
      await runSql('UPDATE convocatorias SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
      eliminados++;
    }
  }

  return { cerradas, cerradas_antiguas: cerradasAntiguas, eliminados, revisadas: rowsFecha.length };
}

// Timeout estricto: mata la tarea si supera el límite (defecto 60 min para rastreos)
function withTimeout(fn, ms, name) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[Cron/${name}] Timeout: superó ${ms / 60000} min — proceso cancelado para evitar fugas de memoria`)), ms)
    ),
  ]);
}

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

// Referencias a las tareas cron activas — permiten pausar/reanudar en runtime
// desde /api/radar/start y /api/radar/stop (antes stubs 501, ahora control real).
const scheduledTasks = [];

/** Detiene todas las tareas cron programadas (node-cron .stop() real, no un flag decorativo). */
export function pauseScheduler() {
  for (const task of scheduledTasks) task.stop();
  console.log(`[Cron] Programador PAUSADO — ${scheduledTasks.length} tarea(s) detenida(s).`);
  return scheduledTasks.length;
}

/** Reanuda todas las tareas cron previamente pausadas. */
export function resumeScheduler() {
  for (const task of scheduledTasks) task.start();
  console.log(`[Cron] Programador REANUDADO — ${scheduledTasks.length} tarea(s) activa(s).`);
  return scheduledTasks.length;
}

export function startScheduler() {
  const RASTREO_TIMEOUT = 60 * 60_000; // 60 minutos máximo por rastreo

  // Rastreo 2: Fuentes web EXTERNAS al Directorio — 02:00 AM COT
  scheduledTasks.push(cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] ▶ Rastreo 2: fuentes web externas al Directorio...');
    const start = Date.now();
    try {
      const result = await withTimeout(() => ingestConvocatorias(), RASTREO_TIMEOUT, 'Rastreo2');
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[Cron] ✓ Rastreo 2 completado en ${elapsed}s · ${result.totalInserted} nuevas`);
      await logCrawl('cron_rastreo2', result);
    } catch (err) {
      console.error('[Cron] ✗ Error Rastreo 2:', err.message);
      await logCrawl('cron_rastreo2_error', { error: err.message });
    }
  }, { timezone: 'America/Bogota' }));

  // Rastreo 1: Directorio de entidades — 02:30 AM COT (30 min después del Rastreo 2)
  scheduledTasks.push(cron.schedule('30 2 * * *', async () => {
    console.log('[Cron] ▶ Rastreo 1: entidades del Directorio...');
    const start = Date.now();
    try {
      const result = await withTimeout(() => ingestDirectorioConvocatorias(), RASTREO_TIMEOUT, 'Rastreo1');
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[Cron] ✓ Rastreo 1 completado en ${elapsed}s · ${result.inserted} nuevas de ${result.entidades_procesadas} entidades`);
      await logCrawl('cron_rastreo1', result);
    } catch (err) {
      console.error('[Cron] ✗ Error Rastreo 1:', err.message);
      await logCrawl('cron_rastreo1_error', { error: err.message });
    }
  }, { timezone: 'America/Bogota' }));

  // Expiración diaria de convocatorias vencidas — 01:45 AM COT (antes de los rastreos)
  scheduledTasks.push(cron.schedule('45 1 * * *', async () => {
    console.log('[Cron] ▶ Expirando convocatorias vencidas...');
    try {
      const r = await expirarConvocatorias();
      console.log(`[Cron] ✓ Expiración: ${r.cerradas} cerradas de ${r.revisadas} revisadas`);
    } catch (err) {
      console.error('[Cron] ✗ Error en expiración:', err.message);
    }
  }, { timezone: 'America/Bogota' }));

  // Lote 6 T2 (2026-09-24): el backup S3 YA NO corre aquí. El único
  // responsable es .github/workflows/backup-s3.yml (pg_dump 17 + validación +
  // subida verificada, sale en rojo si no respalda). Este cron interno corría
  // en Render, donde no existe pg_dump: fallaba a diario y ensuciaba los logs
  // y system_logs con "✗ Backup S3 NO realizado" sin posibilidad de éxito.

  console.log('[Cron] Programador activo · Expiración 01:45 · Rastreo2 02:00 · Rastreo1 02:30 COT (backup S3: GitHub Actions backup-s3.yml)');
}

// Permite ejecutar la ingesta manualmente (llamado desde /api/convocatorias/refresh)
export async function runManualIngest() {
  const result = await ingestConvocatorias();
  await logCrawl('manual', result);
  return result;
}
