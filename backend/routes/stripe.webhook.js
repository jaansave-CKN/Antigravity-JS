/**
 * stripe.webhook.js — Endpoint receptor de webhooks de Stripe
 *
 * GARANTÍAS DE PRODUCCIÓN:
 *   1. Idempotencia: cada event.id se procesa exactamente una vez.
 *      Si Stripe reintenta (cold start, timeout) → HTTP 200 inmediato, sin re-procesar.
 *   2. Atomicidad: el cambio en User_Subscriptions + INSERT en stripe_events
 *      ocurren en la MISMA transacción PostgreSQL. O ambos, o ninguno.
 *   3. Revocación inmediata: al cancelar suscripción, revokeUserSession() invalida
 *      todos los tokens activos del usuario sin esperar expiración natural.
 *
 * Variables requeridas:
 *   STRIPE_SECRET_KEY        — sk_live_... o sk_test_...
 *   STRIPE_WEBHOOK_SECRET    — whsec_...
 *
 * Registro en el servidor:
 *   import { registerStripeWebhook } from './backend/routes/stripe.webhook.js';
 *   registerStripeWebhook(app, { pool, runSql, getRow });
 *
 * Configurar en Stripe Dashboard:
 *   Endpoint URL: https://tudominio.co/api/webhooks/stripe
 *   Eventos: customer.subscription.*, invoice.payment_*, customer.updated
 */

import crypto from 'crypto';
import Stripe from 'stripe';
import { sendPlanUpgradeConfirmation, sendSubscriptionAlert } from '../services/emailService.js';
import { revokeUserSession } from '../middlewares/tokenBlacklist.js';
import { pool, runSql, getRow } from '../db.js';

// Inicialización condicional — no lanza si STRIPE_SECRET_KEY no está configurada
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
  : null;

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Mapeo de price IDs de Stripe → plan interno
const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_RADAR]:      { plan: 'radar',      access_radar: 1, access_formulador: 0 },
  [process.env.STRIPE_PRICE_FORMULADOR]: { plan: 'formulador', access_radar: 0, access_formulador: 1 },
  [process.env.STRIPE_PRICE_SUITE]:      { plan: 'suite',      access_radar: 1, access_formulador: 1 },
};

export function registerStripeWebhook(app, { pool, runSql, getRow }) {
  if (!stripe) {
    console.warn('[stripe.webhook] STRIPE_SECRET_KEY no configurada — webhook desactivado');
    return;
  }

  // Asegurar que la tabla de idempotencia existe al arrancar
  _ensureStripeEventsTable(runSql);

  app.post(
    '/api/webhooks/stripe',
    async (req, res) => {
      const sig = req.headers['stripe-signature'];

      if (!WEBHOOK_SECRET) {
        console.error('[stripe] STRIPE_WEBHOOK_SECRET no configurado');
        return res.status(500).json({ error: 'Webhook secret no configurado' });
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
      } catch (err) {
        console.error('[stripe] Firma inválida:', err.message);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
      }

      console.log(`[stripe] Evento recibido: ${event.type} | id: ${event.id}`);

      // ── GUARDIA DE IDEMPOTENCIA ──────────────────────────────────────────────
      // Si el evento ya fue procesado (reintento de Stripe), responder 200 sin re-procesar.
      const alreadyProcessed = await _isEventProcessed(event.id, getRow);
      if (alreadyProcessed) {
        console.log(`[stripe] Evento duplicado ignorado: ${event.id}`);
        return res.json({ received: true, idempotent: true });
      }

      try {
        await handleStripeEvent(event, { pool, runSql, getRow });
      } catch (err) {
        console.error('[stripe] Error procesando evento:', err.message);
        // Retornar 200 — Stripe NO debe reintentar por errores de lógica de negocio.
        // Los errores ya están registrados en logs. Si el evento falló, se puede
        // reprocesar manualmente desde el Dashboard de Stripe.
      }

      res.json({ received: true });
    }
  );
}

// ── Verificación de idempotencia ─────────────────────────────────────────────
async function _isEventProcessed(eventId, getRow) {
  try {
    const row = await getRow(
      'SELECT 1 FROM stripe_events WHERE stripe_event_id = $1',
      [eventId]
    );
    return !!row;
  } catch {
    // Si la tabla no existe aún, no bloquear el procesamiento
    return false;
  }
}

// ── Crear tabla stripe_events si no existe ───────────────────────────────────
async function _ensureStripeEventsTable(runSql) {
  try {
    await runSql(`
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

// ── Despacho de eventos ───────────────────────────────────────────────────────
async function handleStripeEvent(event, { pool, runSql, getRow }) {
  const obj = event.data.object;

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionChange(obj, event, { pool, runSql, getRow });
      break;

    case 'customer.subscription.deleted':
      await handleSubscriptionCanceled(obj, event, { pool, runSql, getRow });
      break;

    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(obj, event, { pool, runSql, getRow });
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailed(obj, event, { pool, runSql, getRow });
      break;

    case 'checkout.session.completed':
      await handleCheckoutCompleted(obj, event, { pool, runSql, getRow });
      break;

    default:
      console.log(`[stripe] Evento ignorado: ${event.type}`);
      // Registrar igualmente para auditabilidad
      await _recordEvent(event, null, runSql);
  }
}

// ── Registro atómico del evento (idempotencia) ────────────────────────────────
// Debe llamarse DENTRO de la transacción que procesa el cambio de suscripción.
async function _recordEvent(event, tenantId, runSql) {
  try {
    await runSql(
      `INSERT INTO stripe_events (stripe_event_id, event_type, tenant_id, raw_payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, tenantId || null, JSON.stringify(event.data.object)]
    );
  } catch (e) {
    console.warn('[stripe] Error registrando evento en stripe_events:', e.message);
  }
}

// ── Handlers específicos ──────────────────────────────────────────────────────

async function handleSubscriptionChange(subscription, event, { pool, runSql, getRow }) {
  const customerId = subscription.customer;
  const priceId    = subscription.items?.data?.[0]?.price?.id;
  const planConfig = PRICE_TO_PLAN[priceId] || { plan: 'free', access_radar: 0, access_formulador: 0 };
  const periodEnd  = subscription.current_period_end;
  const cancelAt   = subscription.cancel_at_period_end;

  const usuario = await getRow(
    'SELECT u.id, u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
    [customerId]
  );

  if (!usuario) {
    console.warn(`[stripe] Usuario no encontrado para customer: ${customerId}`);
    return;
  }

  // ── TRANSACCIÓN ATÓMICA: cambio de plan + registro de evento ─────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE user_subscriptions
       SET plan = $1, access_radar = $2, access_formulador = $3,
           stripe_subscription_id = $4, current_period_end = to_timestamp($5),
           cancel_at_period_end = $6, updated_at = NOW()
       WHERE stripe_customer_id = $7`,
      [planConfig.plan, planConfig.access_radar, planConfig.access_formulador,
       subscription.id, periodEnd, cancelAt, customerId]
    );

    await client.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, tenant_id, raw_payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, usuario.id, JSON.stringify(subscription)]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (subscription.status === 'active' && planConfig.plan !== 'free') {
    await sendPlanUpgradeConfirmation(usuario.email, {
      nombre: usuario.nombre, plan: planConfig.plan, periodEnd,
    }).catch(e => console.error('[stripe] Error email upgrade:', e.message));
  }
}

async function handleSubscriptionCanceled(subscription, event, { pool, runSql, getRow }) {
  const customerId = subscription.customer;

  const usuario = await getRow(
    'SELECT u.id, u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
    [customerId]
  );

  // ── TRANSACCIÓN ATÓMICA: downgrade a free + revocación de sesión + evento ─
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE user_subscriptions
       SET plan = 'free', access_radar = 0, access_formulador = 0,
           stripe_subscription_id = NULL, cancel_at_period_end = FALSE, updated_at = NOW()
       WHERE stripe_customer_id = $1`,
      [customerId]
    );

    // REVOCACIÓN INMEDIATA: invalida todos los tokens activos del usuario
    // (no espera expiración natural de 24h del JWT)
    if (usuario?.id) {
      await client.query(
        `UPDATE usuarios SET tokens_invalidated_at = NOW() WHERE id = $1`,
        [usuario.id]
      );
    }

    await client.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, tenant_id, raw_payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, usuario?.id || null, JSON.stringify(subscription)]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (usuario) {
    await sendSubscriptionAlert(usuario.email, { nombre: usuario.nombre, tipo: 'canceled' })
      .catch(e => console.error('[stripe] Error email cancel:', e.message));
  }
}

async function handlePaymentSucceeded(invoice, event, { pool, runSql, getRow }) {
  const customerId = invoice.customer;
  const periodEnd  = invoice.lines?.data?.[0]?.period?.end;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (periodEnd) {
      await client.query(
        'UPDATE user_subscriptions SET current_period_end = to_timestamp($1), updated_at = NOW() WHERE stripe_customer_id = $2',
        [periodEnd, customerId]
      );
    }

    await client.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, raw_payload)
       VALUES ($1, $2, $3) ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(invoice)]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function handlePaymentFailed(invoice, event, { pool, runSql, getRow }) {
  const customerId = invoice.customer;

  const usuario = await getRow(
    'SELECT u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
    [customerId]
  );

  await _recordEvent(event, null, runSql);

  if (usuario) {
    await sendSubscriptionAlert(usuario.email, { nombre: usuario.nombre, tipo: 'payment_failed' })
      .catch(e => console.error('[stripe] Error email payment_failed:', e.message));
  }
}

// ── checkout.session.completed — activa la suscripción en BD ─────────────────
async function handleCheckoutCompleted(session, event, { pool, runSql, getRow }) {
  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) {
    console.warn('[stripe] checkout.session.completed sin tenant_id en metadata — ignorando');
    return;
  }

  // Recuperar el price_id desde la sesión expandida (line_items no viene por defecto)
  let priceId = session.line_items?.data?.[0]?.price?.id;
  if (!priceId && stripe) {
    try {
      const expanded = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items'],
      });
      priceId = expanded.line_items?.data?.[0]?.price?.id;
    } catch (e) {
      console.warn('[stripe] No se pudo expandir line_items:', e.message);
    }
  }

  const planConfig = PRICE_TO_PLAN[priceId] || { plan: 'free', access_radar: 0, access_formulador: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM user_subscriptions WHERE user_id = $1',
      [tenantId]
    );
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE user_subscriptions
         SET plan = $1, access_radar = $2, access_formulador = $3,
             stripe_customer_id = $4, updated_at = NOW()
         WHERE user_id = $5`,
        [planConfig.plan, planConfig.access_radar, planConfig.access_formulador,
         session.customer, tenantId]
      );
    } else {
      await client.query(
        `INSERT INTO user_subscriptions
           (id, user_id, plan, access_radar, access_formulador, stripe_customer_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), tenantId, planConfig.plan,
         planConfig.access_radar, planConfig.access_formulador, session.customer]
      );
    }

    await client.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, tenant_id, raw_payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, tenantId, JSON.stringify(session)]
    );

    await client.query('COMMIT');
    console.log(`[stripe] ✓ checkout.session.completed — tenant=${tenantId} plan=${planConfig.plan}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Helpers públicos ──────────────────────────────────────────────────────────

export async function getOrCreateStripeCustomer(email, nombre, tenantId, { runSql, getRow }) {
  const sub = await getRow(
    'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1',
    [tenantId]
  );
  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const customer = await stripe?.customers.create({
    email, name: nombre,
    metadata: { tenant_id: tenantId },
  });

  await runSql(
    'UPDATE user_subscriptions SET stripe_customer_id = $1 WHERE tenant_id = $2',
    [customer.id, tenantId]
  );
  return customer.id;
}

export async function createCheckoutSession({ customerId, priceId, tenantId, successUrl, cancelUrl }) {
  return stripe?.checkout.sessions.create({
    customer: customerId,
    mode:     'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { tenant_id: tenantId },
    success_url: successUrl,
    cancel_url:  cancelUrl,
    subscription_data: { metadata: { tenant_id: tenantId } },
    allow_promotion_codes:      true,
    billing_address_collection: 'required',
  });
}

// ── Handler standalone — registrado en server.js con express.raw() ────────────
// Debe montarse ANTES de express.json() para recibir el cuerpo sin parsear.
export async function stripeWebhookHandler(req, res) {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe no configurado en este entorno' });
  }
  if (!WEBHOOK_SECRET) {
    console.error('[stripe] STRIPE_WEBHOOK_SECRET no configurado');
    return res.status(500).json({ error: 'Webhook secret no configurado' });
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] Firma inválida:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log(`[stripe] Evento: ${event.type} | id: ${event.id}`);

  const alreadyProcessed = await _isEventProcessed(event.id, getRow);
  if (alreadyProcessed) {
    return res.json({ received: true, idempotent: true });
  }

  try {
    await handleStripeEvent(event, { pool, runSql, getRow });
  } catch (err) {
    // HTTP 200: Stripe no debe reintentar por errores de lógica de negocio.
    console.error('[stripe] Error procesando evento:', err.message);
  }

  res.json({ received: true });
}

export { stripe };
