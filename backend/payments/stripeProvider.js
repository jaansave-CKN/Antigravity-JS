/**
 * stripeProvider.js — implementación real de PaymentProvider para Stripe.
 *
 * Único archivo que conoce el SDK de Stripe. subscriptions.routes.js y
 * server.js hablan contra la interfaz genérica (ver PaymentProvider.js /
 * payments/index.js), nunca contra este archivo directamente.
 */
import Stripe from 'stripe';
import { PaymentProvider } from './PaymentProvider.js';
import { resolvePlan } from './subscriptionEvents.js';

export class StripeProvider extends PaymentProvider {
  constructor() {
    super();
    this._stripe = process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
      : null;
    this._webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    // Mapeo price_id de Stripe → plan interno (para eventos de webhook).
    this._priceToPlan = {
      [process.env.STRIPE_PRICE_RADAR]:      { plan: 'radar',      access_radar: 1, access_formulador: 0 },
      [process.env.STRIPE_PRICE_FORMULADOR]: { plan: 'formulador', access_radar: 0, access_formulador: 1 },
      [process.env.STRIPE_PRICE_SUITE]:      { plan: 'suite',      access_radar: 1, access_formulador: 1 },
    };
    // Mapeo inverso: plan interno → price_id de Stripe (para crear el
    // checkout). Vive acá, no en subscriptions.routes.js — "price_id" es un
    // concepto de Stripe, no del dominio de negocio.
    this._planToPriceId = {
      radar:      process.env.STRIPE_PRICE_RADAR,
      formulador: process.env.STRIPE_PRICE_FORMULADOR,
      suite:      process.env.STRIPE_PRICE_SUITE,
    };
  }

  get name() { return 'stripe'; }
  get isConfigured() { return !!this._stripe; }

  /** Resuelve el plan interno a partir de un price_id de Stripe. */
  resolvePlanFor(priceId) {
    return resolvePlan(priceId, this._priceToPlan);
  }

  async getOrCreateCustomer(email, nombre, tenantId, { withTenantRow, withTenantRun }) {
    const sub = await withTenantRow(tenantId, 'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1', [tenantId]);
    if (sub?.stripe_customer_id) return sub.stripe_customer_id;
    if (!this._stripe) throw new Error('Stripe no configurado en este entorno');

    const customer = await this._stripe.customers.create({
      email, name: nombre, metadata: { tenant_id: tenantId },
    });
    // FIX (auditoría SRE 2026-08-08): user_subscriptions no tiene columna
    // tenant_id — su policy RLS real usa user_id (ver línea 44 de este mismo
    // archivo, consistente con subscriptionEvents.js/subscriptions.routes.js).
    // Causaba "column tenant_id does not exist" cada vez que se ejecutaba.
    await withTenantRun(tenantId, 'UPDATE user_subscriptions SET stripe_customer_id = $1 WHERE user_id = $2', [customer.id, tenantId]);
    return customer.id;
  }

  async createCheckoutSession({ customerId, plan, tenantId, successUrl, cancelUrl }) {
    if (!this._stripe) throw new Error('Stripe no configurado en este entorno');
    const priceId = this._planToPriceId[plan];
    if (!priceId) throw new Error(`No hay price_id de Stripe configurado para el plan "${plan}"`);
    const session = await this._stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { tenant_id: tenantId },
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: { metadata: { tenant_id: tenantId } },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
    });
    return { url: session.url, sessionId: session.id };
  }

  async verifyAndParseWebhook(rawBody, headers) {
    if (!this._stripe) throw new Error('Stripe no configurado en este entorno');
    if (!this._webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET no configurado');
    const sig = headers['stripe-signature'];
    const event = this._stripe.webhooks.constructEvent(rawBody, sig, this._webhookSecret);
    return this._normalize(event);
  }

  _normalize(event) {
    const obj = event.data.object;
    const base = { providerEventId: event.id, raw: obj };
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const priceId = obj.items?.data?.[0]?.price?.id;
        return {
          ...base, type: 'subscription.active',
          customerId: obj.customer, priceId,
          subscriptionId: obj.id,
          periodEnd: obj.current_period_end,
          cancelAtPeriodEnd: obj.cancel_at_period_end,
        };
      }
      case 'customer.subscription.deleted':
        return { ...base, type: 'subscription.canceled', customerId: obj.customer };
      case 'invoice.payment_succeeded':
        return { ...base, type: 'payment.succeeded', customerId: obj.customer, periodEnd: obj.lines?.data?.[0]?.period?.end };
      case 'invoice.payment_failed':
        return { ...base, type: 'payment.failed', customerId: obj.customer };
      case 'checkout.session.completed':
        // priceId se resuelve aparte (ver resolveCheckoutPriceId) — Stripe no
        // siempre expande line_items en el payload crudo del webhook.
        return { ...base, type: 'checkout.completed', customerId: obj.customer, tenantId: obj.metadata?.tenant_id, _session: obj };
      default:
        return { ...base, type: 'unhandled' };
    }
  }

  /**
   * Detalle específico de Stripe: en checkout.session.completed, line_items
   * no siempre viene expandido en el evento crudo del webhook — hay que
   * volver a consultarlo. Se resuelve acá para no filtrar esta rareza de
   * Stripe hacia subscriptionEvents.js (que debe quedar agnóstico).
   */
  async resolveCheckoutPriceId(normalizedEvent) {
    const session = normalizedEvent._session;
    let priceId = session?.line_items?.data?.[0]?.price?.id;
    if (!priceId && this._stripe) {
      try {
        const expanded = await this._stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
        priceId = expanded.line_items?.data?.[0]?.price?.id;
      } catch (e) {
        console.warn('[stripe] No se pudo expandir line_items:', e.message);
      }
    }
    return priceId;
  }
}
