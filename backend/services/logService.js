/**
 * logService.js — Registro de errores críticos
 * Persiste en tabla `system_logs` (PostgreSQL / SQLite).
 * Si ERROR_WEBHOOK_URL está configurado, envía a Slack/Discord vía webhook.
 */

import crypto from 'crypto';
import { appendFile, readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const SQL_INSERT_LOG = `INSERT INTO system_logs (id, origen, mensaje, payload, nivel, created_at)
       VALUES (?, ?, ?, ?, 'ERROR', ?) ON CONFLICT (id) DO NOTHING`;

// LOTE 9: respaldo interno. Sin SENTRY_DSN ni ERROR_WEBHOOK_URL, system_logs es
// el ÚNICO registro durable. Si la BD tampoco responde, el error se guarda en
// este archivo JSONL y reenviarPendientesSystemLogs() lo sube en el siguiente
// arranque (ON CONFLICT (id): un reenvío doble nunca duplica filas).
const RUTA_PENDIENTES = process.env.LOG_PENDIENTES_PATH
  || resolve(dirname(fileURLToPath(import.meta.url)), '../../logs/critical-pendientes.jsonl');

async function guardarPendiente(fila) {
  try {
    await mkdir(dirname(RUTA_PENDIENTES), { recursive: true });
    await appendFile(RUTA_PENDIENTES, JSON.stringify(fila) + '\n', 'utf8');
    console.error(`[logService] Error guardado en respaldo local (${RUTA_PENDIENTES}) — se reenviará a system_logs en el próximo arranque.`);
  } catch (e) {
    console.error('[logService] Tampoco se pudo escribir el respaldo local:', e.message);
  }
}

/** Reenvía a system_logs los errores que quedaron en el respaldo local. */
export async function reenviarPendientesSystemLogs() {
  let contenido;
  try { contenido = await readFile(RUTA_PENDIENTES, 'utf8'); } catch { return { reenviadas: 0, pendientes: 0 }; }
  const filas = contenido.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!filas.length) return { reenviadas: 0, pendientes: 0 };
  const runSql = await getRunSql();
  const resultados = await Promise.allSettled(
    filas.map(f => runSql(SQL_INSERT_LOG, [f.id, f.origen, f.mensaje, f.payload, f.created_at]))
  );
  const quedan = filas.filter((_, i) => resultados[i].status === 'rejected');
  await writeFile(RUTA_PENDIENTES, quedan.map(f => JSON.stringify(f) + '\n').join(''), 'utf8');
  console.log(`[logService] Respaldo local: ${filas.length - quedan.length} error(es) reenviado(s) a system_logs, ${quedan.length} pendiente(s).`);
  return { reenviadas: filas.length - quedan.length, pendientes: quedan.length };
}

// Importación lazy para evitar dependencia circular con db.js al arranque
let _runSql = null;
async function getRunSql() {
  if (!_runSql) {
    const mod = await import('../db.js');
    _runSql = mod.runSql;
  }
  return _runSql;
}

/**
 * Registra un error crítico de forma permanente.
 *
 * @param {string} origen    — Identificador del módulo (ej: 'MatchScore', 'Presupuesto')
 * @param {string} mensaje   — Descripción legible del error
 * @param {object} payload   — Datos de contexto (proyectoId, userId, etc.)
 */
export async function logCriticalError(origen, mensaje, payload = {}) {
  const timestamp = new Date().toISOString();
  const id        = crypto.randomUUID();
  const payloadStr = JSON.stringify(payload);

  // 1. Log en consola inmediato (nunca falla)
  console.error(`[CRITICAL][${origen}] ${mensaje}`, payload);

  // 2. Persistir en system_logs.
  // LOTE 8 (auditoría minera 2026-09-24, verificado en vivo): antes era
  // fire-and-forget y la promesa de esta función resolvía ANTES del INSERT.
  // backup-s3.yml hace `await logCriticalError(...)` y luego process.exit(1):
  // el INSERT moría con el proceso. Prueba: el run 36024369232 imprimió
  // "[CRITICAL][S3Backup]" con el DATABASE_URL real y system_logs tenía 0
  // filas. Ahora la promesa resuelve cuando el INSERT termina (tope 5 s, para
  // no colgar a quien la espere). Quien NO la espera no cambia en nada.
  const fila = { id, origen, mensaje, payload: payloadStr, created_at: timestamp };
  let persistido = false;
  const persistencia = getRunSql()
    .then(runSql => runSql(SQL_INSERT_LOG, [id, origen, mensaje, payloadStr, timestamp]))
    .then(() => { persistido = true; })
    .catch(dbErr => {
      // LOTE 9: si la BD también falla → respaldo local (no solo stderr).
      console.error('[logService] No se pudo persistir error en system_logs:', dbErr.message);
      return guardarPendiente(fila).then(() => { persistido = true; });
    });

  // 3. Webhook opcional (Slack / Discord)
  const webhookUrl = process.env.ERROR_WEBHOOK_URL;
  let aviso = Promise.resolve();
  if (webhookUrl) {
    const body = JSON.stringify({
      // Formato compatible con Slack y Discord (ambos aceptan "text")
      text: `🚨 *[${origen}]* ${mensaje}`,
      embeds: [{               // Discord embed
        title:       `Error Crítico — ${origen}`,
        description: mensaje,
        color:       0xba1a1a,
        fields: [
          { name: 'Timestamp', value: timestamp,  inline: true },
          { name: 'Payload',   value: `\`\`\`${payloadStr.slice(0, 500)}\`\`\``, inline: false },
        ],
      }],
    });

    aviso = fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    }).catch(whErr => {
      console.error('[logService] Webhook falló:', whErr.message);
    });
  }

  // Espera persistencia + aviso, con tope de 12 s: la primera consulta de un
  // proceso nuevo puede esperar el sondeo inicial de pg (hasta 8 s, Lote 9).
  // Si se agota sin persistir → respaldo local (ON CONFLICT evita duplicados
  // si el INSERT llegara a completarse después).
  let tope;
  await Promise.race([
    Promise.all([persistencia, aviso]),
    new Promise(res => { tope = setTimeout(res, TOPE_ESPERA_MS); tope.unref?.(); }),
  ]);
  clearTimeout(tope);
  if (!persistido) await guardarPendiente(fila);
}

const TOPE_ESPERA_MS = Number(process.env.LOG_TOPE_ESPERA_MS) || 12_000;
