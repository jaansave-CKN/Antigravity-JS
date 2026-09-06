/**
 * stripe.webhook.js — capa HTTP del webhook de Stripe.
 *
 * Toda la lógica que SABE que es Stripe vive en backend/payments/stripeProvider.js.
 * Toda la lógica que NO sabe (ni le importa) qué pasarela fue vive en
 * backend/payments/subscriptionEvents.js. Este archivo solo conecta ambas
 * capas con Express: verifica la firma, revisa idempotencia, aplica el
 * evento normalizado, y registra el resultado para auditoría/reintentos.
 *
 * Variables requeridas:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_RADAR,
 *   STRIPE_PRICE_FORMULADOR, STRIPE_PRICE_SUITE
 *
 * Registrado en server.js con express.raw() ANTES de express.json()
 * (Stripe firma sobre el body crudo, no sobre JSON parseado).
 */
// stripe_events es un ledger de idempotencia GLOBAL, no dato de tenant —
// EXCEPCIÓN DELIBERADA a withTenant() (Fase 4 roadmap tenant, 2026-09-06).
// Ver nota de cabecera en backend/payments/subscriptionEvents.js.
import { runSql, getRow } from '../db.js';
import { paymentProvider } from '../payments/index.js';
import { applyPaymentEvent } from '../payments/subscriptionEvents.js';

_ensureStripeEventsTable(runSql);

async function _ensureStripeEventsTable(runSqlFn) {
  try {
    await runSqlFn(`
      CREATE TABLE IF NOT EXISTS stripe_events (
        stripe_event_id  TEXT        PRIMARY KEY,
        event_type       TEXT        NOT NULL,
        tenant_id        TEXT,
        processed_at     TIMESTAMPTZ DEFAULT NOW(),
        raw_payload      JSONB
      )
    `);
  } catch (e) {
    console.warn('[stripe] No se pudo crear tabla stripe_events:', e.message);
  }
}

async function _isEventProcessed(eventId) {
  try {
    const row = await getRow('SELECT 1 FROM stripe_events WHERE stripe_event_id = $1', [eventId]);
    return !!row;
  } catch {
    return false; // tabla aún no existe — no bloquear el procesamiento
  }
}

async function _recordEvent(providerEventId, eventType, tenantId, rawPayload) {
  try {
    await runSql(
      `INSERT INTO stripe_events (stripe_event_id, event_type, tenant_id, raw_payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (stripe_event_id) DO NOTHING`,
      [providerEventId, eventType, tenantId || null, JSON.stringify(rawPayload)]
    );
  } catch (e) {
    console.warn('[stripe] Error registrando evento en stripe_events:', e.message);
  }
}

/** Handler standalone — registrado en server.js con express.raw(). */
export async function stripeWebhookHandler(req, res) {
  if (!paymentProvider.isConfigured || paymentProvider.name !== 'stripe') {
    return res.status(503).json({ error: 'Stripe no configurado en este entorno' });
  }

  let event;
  try {
    event = await paymentProvider.verifyAndParseWebhook(req.body, req.headers);
  } catch (err) {
    console.error('[stripe] Firma inválida o error de verificación:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[stripe] Evento recibido: ${event.type} | id: ${event.providerEventId}`);

  if (await _isEventProcessed(event.providerEventId)) {
    console.log(`[stripe] Evento duplicado ignorado: ${event.providerEventId}`);
    return res.json({ received: true, idempotent: true });
  }

  try {
    let priceId = event.priceId;
    if (event.type === 'checkout.completed') {
      priceId = await paymentProvider.resolveCheckoutPriceId(event);
    }
    const planConfig = paymentProvider.resolvePlanFor(priceId);

    await applyPaymentEvent(event, planConfig);
    await _recordEvent(event.providerEventId, event.type, event.tenantId, event.raw);
  } catch (err) {
    console.error('[stripe] Error procesando evento:', err.message);
    // Retornar 200 igual — Stripe no debe reintentar por errores de lógica
    // de negocio. Ya quedó en logs; se puede reprocesar manualmente.
  }

  res.json({ received: true });
}
