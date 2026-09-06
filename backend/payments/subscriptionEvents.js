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
 *   · Revocación inmediata: al cancelar, invalida todos los tokens activos
 *     del usuario sin esperar expiración natural del JWT.
 *
 * withTenant() (Fase 4 roadmap tenant, 2026-09-06): un webhook de pasarela no
 * trae un JWT — no hay `req.userId` del que partir. Para subscription.active/
 * canceled/payment.succeeded/payment.failed el único dato disponible es
 * `event.customerId` (el customer id de la pasarela); el tenant real
 * (usuarios.id) se resuelve con UNA lectura sin escopar (mismo problema del
 * huevo y la gallina que authenticateToken o el admin-bypass de
 * compliance.routes.js: no se puede escopar una consulta por un tenant que
 * todavía no se conoce) y RECIÉN AHÍ se abre withTenant(tenantId, ...) para
 * la escritura real. checkout.completed es la excepción: `event.tenantId` ya
 * viene resuelto desde el checkout (metadata de Stripe / `reference` de
 * Wompi), así que escopa directo, sin lectura previa.
 *
 * EXCEPCIÓN DELIBERADA: la tabla de idempotencia (stripe_events/wompi_events,
 * en stripe.webhook.js/wompi.webhook.js) NO migra a withTenant() aunque
 * stripe_events sí tiene una política RLS real (tenant_id = app.org_id,
 * verificado en vivo) — su `tenant_id` es NULL para la mayoría de eventos
 * (solo checkout.completed lo trae), y el chequeo de idempotencia debe poder
 * ejecutarse ANTES de saber el tenant, para CUALQUIER evento. Escoparlo
 * habría bloqueado el INSERT bajo RLS (NULL no satisface `tenant_id = ?`) o
 * vuelto invisible el registro para futuros chequeos. Se queda en el pool
 * principal (mismo criterio que catalogo_rendimientos/gemini_key_state).
 */
import { sendPlanUpgradeConfirmation, sendSubscriptionAlert } from '../services/emailService.js';
import { getRow, withTenant } from '../config/database.config.js';

// Mapeo price/plan-id de la pasarela → plan interno. Cada provider construye
// su propio mapa (sus ids de precio son distintos) y lo pasa aquí — esta
// función no conoce Stripe ni Wompi, solo el resultado ya mapeado.
export function resolvePlan(priceId, priceToPlan) {
  return priceToPlan[priceId] || { plan: 'free', access_radar: 0, access_formulador: 0 };
}

/**
 * @param {import('./PaymentProvider.js').NormalizedPaymentEvent} event
 * @param {{ plan: string, access_radar: number, access_formulador: number }} planConfig
 */
export async function applyPaymentEvent(event, planConfig) {
  switch (event.type) {
    case 'subscription.active':
      return _handleSubscriptionActive(event, planConfig);
    case 'subscription.canceled':
      return _handleSubscriptionCanceled(event);
    case 'payment.succeeded':
      return _handlePaymentSucceeded(event);
    case 'checkout.completed':
      return _handleCheckoutCompleted(event, planConfig);
    case 'payment.failed':
      return _handlePaymentFailed(event);
    default:
      // 'unhandled': el provider ya registró el evento crudo para auditoría.
      return;
  }
}

// Resuelve el tenant (usuarios.id) a partir del customer id de la pasarela —
// consulta sin escopar a propósito, ver nota de cabecera del archivo.
async function _resolverTenantPorCustomerId(customerId) {
  return getRow(
    'SELECT u.id, u.email, u.nombre FROM usuarios u JOIN user_subscriptions s ON s.user_id = u.id WHERE s.stripe_customer_id = $1',
    [customerId]
  );
}

async function _handleSubscriptionActive(event, planConfig) {
  const usuario = await _resolverTenantPorCustomerId(event.customerId);
  if (!usuario) {
    console.warn(`[payments] Usuario no encontrado para customer: ${event.customerId}`);
    return;
  }

  // FIX (Fase 4 roadmap tenant, 2026-09-06): cancel_at_period_end es INTEGER
  // en la BD (igual que access_radar/access_formulador), no boolean -- el
  // driver pg rechaza un JS boolean bindeado por parámetro contra una columna
  // integer ("invalid input syntax for type integer"). Bug preexistente al
  // refactor de tenant (idéntico antes, vía pool.connect() crudo), nunca
  // ejecutado en este entorno porque Stripe está dormido (llaves vacías) --
  // habría fallado igual en el primer webhook real de Stripe.
  await withTenant(usuario.id, client => client.query(
    `UPDATE user_subscriptions
     SET plan = $1, access_radar = $2, access_formulador = $3,
         stripe_subscription_id = $4, current_period_end = to_timestamp($5),
         cancel_at_period_end = $6, updated_at = NOW()
     WHERE stripe_customer_id = $7`,
    [planConfig.plan, planConfig.access_radar, planConfig.access_formulador,
     event.subscriptionId, event.periodEnd, event.cancelAtPeriodEnd ? 1 : 0, event.customerId]
  ));

  if (planConfig.plan !== 'free') {
    await sendPlanUpgradeConfirmation(usuario.email, { nombre: usuario.nombre, plan: planConfig.plan, periodEnd: event.periodEnd })
      .catch(e => console.error('[payments] Error email upgrade:', e.message));
  }
}

async function _handleSubscriptionCanceled(event) {
  const usuario = await _resolverTenantPorCustomerId(event.customerId);
  if (!usuario) {
    console.warn(`[payments] Usuario no encontrado para customer: ${event.customerId}`);
    return;
  }

  await withTenant(usuario.id, async (client) => {
    // cancel_at_period_end es INTEGER (mismo hallazgo que _handleSubscriptionActive) --
    // FALSE como literal boolean tampoco castea implícito contra una columna integer.
    await client.query(
      `UPDATE user_subscriptions
       SET plan = 'free', access_radar = 0, access_formulador = 0,
           stripe_subscription_id = NULL, cancel_at_period_end = 0, updated_at = NOW()
       WHERE stripe_customer_id = $1`,
      [event.customerId]
    );
    // Revocación inmediata: no esperar expiración natural del JWT.
    await client.query(`UPDATE usuarios SET tokens_invalidated_at = NOW() WHERE id = $1`, [usuario.id]);
  });

  await sendSubscriptionAlert(usuario.email, { nombre: usuario.nombre, tipo: 'canceled' })
    .catch(e => console.error('[payments] Error email cancel:', e.message));
}

async function _handlePaymentSucceeded(event) {
  if (!event.periodEnd) return;
  const usuario = await _resolverTenantPorCustomerId(event.customerId);
  if (!usuario) {
    console.warn(`[payments] Usuario no encontrado para customer: ${event.customerId}`);
    return;
  }
  await withTenant(usuario.id, client => client.query(
    'UPDATE user_subscriptions SET current_period_end = to_timestamp($1), updated_at = NOW() WHERE stripe_customer_id = $2',
    [event.periodEnd, event.customerId]
  ));
}

// Sin escopar a propósito: es la ÚNICA consulta de este handler (una
// notificación por email, sin escritura), y ya filtra por stripe_customer_id
// — escoparla exigiría resolver el tenant primero solo para repetir la misma
// lectura, sin ganancia real de seguridad.
async function _handlePaymentFailed(event) {
  const usuario = await _resolverTenantPorCustomerId(event.customerId);
  if (usuario) {
    await sendSubscriptionAlert(usuario.email, { nombre: usuario.nombre, tipo: 'payment_failed' })
      .catch(e => console.error('[payments] Error email payment_failed:', e.message));
  }
}

async function _handleCheckoutCompleted(event, planConfig) {
  if (!event.tenantId) {
    console.warn('[payments] checkout.completed sin tenantId — ignorando');
    return;
  }
  await withTenant(event.tenantId, async (client) => {
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
  });
  console.log(`[payments] ✓ checkout completado — tenant=${event.tenantId} plan=${planConfig.plan}`);
}
