/**
 * logService.js — Registro de errores críticos
 * Persiste en tabla `system_logs` (PostgreSQL / SQLite).
 * Si ERROR_WEBHOOK_URL está configurado, envía a Slack/Discord vía webhook.
 */

import crypto from 'crypto';

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
  const persistencia = getRunSql()
    .then(runSql => runSql(
      `INSERT INTO system_logs (id, origen, mensaje, payload, nivel, created_at)
       VALUES (?, ?, ?, ?, 'ERROR', ?)`,
      [id, origen, mensaje, payloadStr, timestamp]
    ))
    .catch(dbErr => {
      // Si la BD también falla, al menos queda en stderr del proceso
      console.error('[logService] No se pudo persistir error en system_logs:', dbErr.message);
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

  // Espera persistencia + aviso, con tope de 5 s (el timer no retiene el proceso).
  let tope;
  await Promise.race([
    Promise.all([persistencia, aviso]),
    new Promise(res => { tope = setTimeout(res, 5000); tope.unref?.(); }),
  ]);
  clearTimeout(tope);
}
