/**
 * wompi.webhook.js — capa HTTP del webhook de Wompi ("eventos").
 *
 * Mismo patrón que stripe.webhook.js: verifica firma, revisa idempotencia,
 * aplica el evento normalizado vía subscriptionEvents.js, registra para
 * auditoría/reintentos. Única diferencia real de transporte: Wompi firma
 * sobre el JSON ya parseado (no bytes crudos) — se registra en server.js
 * con express.json() normal, JAMÁS con express.raw() (eso es exclusivo de
 * /api/stripe/webhook).
 *
 * Variables requeridas: WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET,
 * WOMPI_EVENTS_SECRET (ver backend/payments/wompiProvider.js).
 */
import { pool, runSql, getRow } from '../db.js';
import { paymentProvider } from '../payments/index.js';
import { applyPaymentEvent } from '../payments/subscriptionEvents.js';

_ensureWompiEventsTable(runSql);

async function _ensureWompiEventsTable(runSqlFn) {
  try {
    await runSqlFn(`
      CREATE TABLE IF NOT EXISTS wompi_events (
        wompi_event_id   TEXT        PRIMARY KEY,
        event_type       TEXT        NOT NULL,
        tenant_id        TEXT,
        processed_at     TIMESTAMPTZ DEFAULT NOW(),
        raw_payload      JSONB
      )
    `);
  } catch (e) {
    console.warn('[wompi] No se pudo crear tabla wompi_events:', e.message);
  }
}

async function _isEventProcessed(eventId) {
  try {
    const row = await getRow('SELECT 1 FROM wompi_events WHERE wompi_event_id = $1', [eventId]);
    return !!row;
  } catch {
    return false; // tabla aún no existe — no bloquear el procesamiento
  }
}

async function _recordEvent(providerEventId, eventType, tenantId, rawPayload) {
  try {
    await runSql(
      `INSERT INTO wompi_events (wompi_event_id, event_type, tenant_id, raw_payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (wompi_event_id) DO NOTHING`,
      [providerEventId, eventType, tenantId || null, JSON.stringify(rawPayload)]
    );
  } catch (e) {
    console.warn('[wompi] Error registrando evento en wompi_events:', e.message);
  }
}

/** Handler standalone — registrado en server.js con express.json() normal. */
export async function wompiWebhookHandler(req, res) {
  if (!paymentProvider.isConfigured || paymentProvider.name !== 'wompi') {
    return res.status(503).json({ error: 'Wompi no configurado como pasarela activa en este entorno' });
  }

  let event;
  try {
    event = await paymentProvider.verifyAndParseWebhook(req.body, req.headers);
  } catch (err) {
    console.error('[wompi] Firma inválida o error de verificación:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[wompi] Evento recibido: ${event.type} | id: ${event.providerEventId}`);

  if (await _isEventProcessed(event.providerEventId)) {
    console.log(`[wompi] Evento duplicado ignorado: ${event.providerEventId}`);
    return res.json({ received: true, idempotent: true });
  }

  try {
    if (!event.tenantId) {
      console.warn('[wompi] Evento sin tenantId resoluble desde `reference` — ignorando:', event.providerEventId);
    } else {
      const planConfig = paymentProvider.resolvePlanFor(event.priceId);
      await applyPaymentEvent(event, planConfig, { pool });
    }
    await _recordEvent(event.providerEventId, event.type, event.tenantId, event.raw);
  } catch (err) {
    console.error('[wompi] Error procesando evento:', err.message);
    // Retornar 200 igual — no se debe reintentar por errores de lógica de
    // negocio. Ya quedó en logs; se puede reprocesar manualmente.
  }

  res.json({ received: true });
}
