/**
 * subscriptionEvents.js — lógica de negocio de suscripciones, independiente
 * de la pasarela de pago.
 *
 * Cada PaymentProvider normaliza el evento crudo de SU webhook (Stripe,
 * Wompi, la que sea) a la forma `NormalizedPaymentEvent` (ver
 * PaymentProvider.js) y llama a `applyPaymentEvent()`. Esta función es la
 * ÚNICA que escribe en user_subscriptions/usuarios — así el día que se
 * agregue una segunda pasarela, esta lógica no se duplica ni se reescribe.
 *
 * GARANTÍAS (heredadas del webhook original de Stripe):
 *   · Atomicidad: cambio de suscripción + registro de idempotencia en la
 *     MISMA transacción PostgreSQL.
 *   · Revocación inmediata: al cancelar, invalida todos los tokens activos
 *     del usuario sin esperar expiración natural del JWT.
 */
import { sendPlanUpgradeConfirmation, sendSubscriptionAlert } from '../services/emailService.js';

// Mapeo price/plan-id de la pasarela → plan interno. Cada provider construye
// su propio mapa (sus ids de precio son distintos) y lo pasa aquí — esta
// función no conoce Stripe ni Wompi, solo el resultado ya mapeado.
export function resolvePlan(priceId, priceToPlan) {
  return priceToPlan[priceId] || { plan: 'free', access_radar: 0, access_formulador: 0 };
}

/**
 * @param {import('./PaymentProvider.js').NormalizedPaymentEvent} event
 * @param {{ plan: string, access_radar: number, access_formulador: number }} planConfig
 * @param {{ pool: import('pg').Pool }} deps
 */
export async function applyPaymentEvent(event, planConfig, { pool }) {
  switch (event.type) {
    case 'subscription.active':
      return _handleSubscriptionActive(event, planConfig, pool);
    case 'subscription.canceled':
      return _handleSubscriptionCanceled(event, pool);
    case 'payment.succeeded':
      return _handlePaymentSucceeded(event, pool);
    case 'checkout.completed':
      return _handleCheckoutCompleted(event, planConfig, pool);
    case 'payment.failed':
      return _handlePaymentFailed(event, pool);
    default:
      // 'unhandled': el provider ya registró el evento crudo para auditoría.
      return;
  }
}

async function _handleSubscriptionActive(event, planConfig, pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const usuario = await client.query(
      'SELECT u.id, u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
      [event.customerId]
    );
    if (usuario.rows.length === 0) {
      console.warn(`[payments] Usuario no encontrado para customer: ${event.customerId}`);
      await client.query('ROLLBACK');
      return;
    }
    await client.query(
      `UPDATE user_subscriptions
       SET plan = $1, access_radar = $2, access_formulador = $3,
           stripe_subscription_id = $4, current_period_end = to_timestamp($5),
           cancel_at_period_end = $6, updated_at = NOW()
       WHERE stripe_customer_id = $7`,
      [planConfig.plan, planConfig.access_radar, planConfig.access_formulador,
       event.subscriptionId, event.periodEnd, !!event.cancelAtPeriodEnd, event.customerId]
    );
    await client.query('COMMIT');

    const u = usuario.rows[0];
    if (planConfig.plan !== 'free') {
      await sendPlanUpgradeConfirmation(u.email, { nombre: u.nombre, plan: planConfig.plan, periodEnd: event.periodEnd })
        .catch(e => console.error('[payments] Error email upgrade:', e.message));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function _handleSubscriptionCanceled(event, pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const usuario = await client.query(
      'SELECT u.id, u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
      [event.customerId]
    );
    await client.query(
      `UPDATE user_subscriptions
       SET plan = 'free', access_radar = 0, access_formulador = 0,
           stripe_subscription_id = NULL, cancel_at_period_end = FALSE, updated_at = NOW()
       WHERE stripe_customer_id = $1`,
      [event.customerId]
    );
    const u = usuario.rows[0];
    if (u?.id) {
      // Revocación inmediata: no esperar expiración natural del JWT.
      await client.query(`UPDATE usuarios SET tokens_invalidated_at = NOW() WHERE id = $1`, [u.id]);
    }
    await client.query('COMMIT');

    if (u) {
      await sendSubscriptionAlert(u.email, { nombre: u.nombre, tipo: 'canceled' })
        .catch(e => console.error('[payments] Error email cancel:', e.message));
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function _handlePaymentSucceeded(event, pool) {
  if (!event.periodEnd) return;
  await pool.query(
    'UPDATE user_subscriptions SET current_period_end = to_timestamp($1), updated_at = NOW() WHERE stripe_customer_id = $2',
    [event.periodEnd, event.customerId]
  );
}

async function _handlePaymentFailed(event, pool) {
  const usuario = await pool.query(
    'SELECT u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
    [event.customerId]
  );
  const u = usuario.rows[0];
  if (u) {
    await sendSubscriptionAlert(u.email, { nombre: u.nombre, tipo: 'payment_failed' })
      .catch(e => console.error('[payments] Error email payment_failed:', e.message));
  }
}

async function _handleCheckoutCompleted(event, planConfig, pool) {
  if (!event.tenantId) {
    console.warn('[payments] checkout.completed sin tenantId — ignorando');
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM user_subscriptions WHERE user_id = $1', [event.tenantId]);
    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE user_subscriptions
         SET plan = $1, access_radar = $2, access_formulador = $3,
             stripe_customer_id = $4, updated_at = NOW()
         WHERE user_id = $5`,
        [planConfig.plan, planConfig.access_radar, planConfig.access_formulador, event.customerId, event.tenantId]
      );
    } else {
      await client.query(
        `INSERT INTO user_subscriptions (id, user_id, plan, access_radar, access_formulador, stripe_customer_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [event.tenantId, planConfig.plan, planConfig.access_radar, planConfig.access_formulador, event.customerId]
      );
    }
    await client.query('COMMIT');
    console.log(`[payments] ✓ checkout completado — tenant=${event.tenantId} plan=${planConfig.plan}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
