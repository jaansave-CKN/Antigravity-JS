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
// wompi_events es un ledger de idempotencia GLOBAL, no dato de tenant —
// EXCEPCIÓN DELIBERADA a withTenant() (Fase 4 roadmap tenant, 2026-09-06).
// Ver nota de cabecera en backend/payments/subscriptionEvents.js.
import { runSql, getRow } from '../db.js';
import { paymentProvider } from '../payments/index.js';
import { applyPaymentEvent } from '../payments/subscriptionEvents.js';
import { logCriticalError } from '../services/logService.js';

// PAY-001 (2026-09-23): antes se creaba al IMPORTAR el módulo (server.js lo
// importa antes de loadEnv() y de que el pool pg exista) — el CREATE fallaba
// y solo quedaba un console.warn: wompi_events NO existe en la BD real.
// Ahora se asegura en el primer evento real, con el pool ya listo.
let _tablaLista = null;
function asegurarTabla() {
  if (!_tablaLista) _tablaLista = _ensureWompiEventsTable(runSql).then(ok => { if (!ok) _tablaLista = null; return ok; });
  return _tablaLista;
}

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
    return true;
  } catch (e) {
    console.warn('[wompi] No se pudo crear tabla wompi_events:', e.message);
    return false;
  }
}

// Fail-CLOSED (PAY-001): antes devolvía false ante cualquier error (p.ej. tabla
// inexistente) y el evento se procesaba de nuevo en cada reintento de Wompi.
// Ahora el error sube y el handler responde 500 → Wompi reintenta más tarde.
async function _isEventProcessed(eventId) {
  const row = await getRow('SELECT 1 FROM wompi_events WHERE wompi_event_id = $1', [eventId]);
  return !!row;
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
    // FIX (DIRECTIVA OMEGA-BUSINESS, 2026-09-07): antes solo console.error —
    // un webhook de pagos rechazado (firma invalida, secreto mal configurado)
    // no debe quedar solo en stdout efimero, queda persistido en system_logs.
    await logCriticalError('WompiWebhook', `Firma inválida o error de verificación: ${err.message}`, {});
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[wompi] Evento recibido: ${event.type} | id: ${event.providerEventId}`);
  if (event.montoInvalido) {
    // PAY-001: pago APPROVED cuyo monto/moneda no coincide con el plan — NO se
    // aplica (type=unhandled); queda en system_logs para revisión manual.
    await logCriticalError('WompiWebhook', 'Monto o moneda no coinciden con el plan — plan NO activado', { providerEventId: event.providerEventId, tenantId: event.tenantId, ...event.montoInvalido });
  }

  let yaProcesado;
  try {
    if (!(await asegurarTabla())) throw new Error('tabla wompi_events no disponible');
    yaProcesado = await _isEventProcessed(event.providerEventId);
  } catch (err) {
    await logCriticalError('WompiWebhook', `Idempotencia no verificable, se pide reintento: ${err.message}`, { providerEventId: event.providerEventId });
    return res.status(500).json({ error: 'Idempotencia no verificable, reintentar' });
  }
  if (yaProcesado) {
    console.log(`[wompi] Evento duplicado ignorado: ${event.providerEventId}`);
    return res.json({ received: true, idempotent: true });
  }

  try {
    if (!event.tenantId) {
      console.warn('[wompi] Evento sin tenantId resoluble desde `reference` — ignorando:', event.providerEventId);
    } else {
      const planConfig = paymentProvider.resolvePlanFor(event.priceId);
      await applyPaymentEvent(event, planConfig);
    }
    await _recordEvent(event.providerEventId, event.type, event.tenantId, event.raw);
  } catch (err) {
    // Persistido (antes solo console.error) — misma razón que el catch de
    // arriba: un fallo de negocio en un evento de pago debe quedar en
    // system_logs, no solo en stdout efímero.
    await logCriticalError('WompiWebhook', `Error procesando evento ${event.type}: ${err.message}`, { providerEventId: event.providerEventId, tenantId: event.tenantId });
    // Retornar 200 igual — no se debe reintentar por errores de lógica de
    // negocio. Ya quedó en logs; se puede reprocesar manualmente.
  }

  res.json({ received: true });
}
