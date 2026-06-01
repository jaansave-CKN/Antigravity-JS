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

  // 2. Persistir en system_logs (fire-and-forget, sin bloquear el flujo principal)
  getRunSql().then(runSql => {
    runSql(
      `INSERT INTO system_logs (id, origen, mensaje, payload, nivel, created_at)
       VALUES (?, ?, ?, ?, 'ERROR', ?)`,
      [id, origen, mensaje, payloadStr, timestamp]
    ).catch(dbErr => {
      // Si la BD también falla, al menos queda en stderr del proceso
      console.error('[logService] No se pudo persistir error en system_logs:', dbErr.message);
    });
  }).catch(() => {});

  // 3. Webhook opcional (Slack / Discord)
  const webhookUrl = process.env.ERROR_WEBHOOK_URL;
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

    fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    }).catch(whErr => {
      console.error('[logService] Webhook falló:', whErr.message);
    });
  }
}
