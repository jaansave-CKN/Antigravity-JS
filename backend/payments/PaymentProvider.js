/**
 * PaymentProvider.js — contrato común de pasarela de pago.
 *
 * Objetivo: que subscriptions.routes.js, server.js y el frontend
 * (SubscriptionContext.tsx / PlanesPage.tsx) hablen SIEMPRE contra esta
 * interfaz, nunca contra un SDK de pasarela específico. Agregar una
 * pasarela nueva (ej. Wompi) es implementar esta clase — cero cambios en
 * los consumidores.
 *
 * Cada método real (StripeProvider, futuro WompiProvider) implementa estos
 * mismos 4 métodos. Los eventos de webhook, sea cual sea la pasarela, se
 * normalizan a la forma común definida en `subscriptionEvents.js` antes de
 * tocar la base de datos — así la lógica de negocio (activar plan, revocar
 * sesión al cancelar, etc.) vive en un solo lugar, no duplicada por pasarela.
 *
 * @typedef {Object} CheckoutSessionResult
 * @property {string} url        - URL de checkout hosteado al que redirigir al usuario.
 * @property {string} sessionId  - Id de la sesión/transacción en la pasarela.
 *
 * @typedef {Object} NormalizedPaymentEvent
 * @property {'subscription.active'|'subscription.canceled'|'payment.succeeded'|'payment.failed'|'checkout.completed'|'unhandled'} type
 * @property {string}  providerEventId   - Id único del evento en la pasarela (para idempotencia).
 * @property {string=} customerId        - Id del cliente en la pasarela.
 * @property {string=} priceId           - Id del precio/plan en la pasarela (se mapea a un plan interno).
 * @property {string=} subscriptionId    - Id de la suscripción en la pasarela, si aplica.
 * @property {string=} tenantId          - user_id interno, si el evento lo trae en metadata.
 * @property {number=} periodEnd         - Epoch seconds de fin del período actual, si aplica.
 * @property {boolean=} cancelAtPeriodEnd
 * @property {unknown}  raw              - Payload crudo, para auditoría (columna raw_payload).
 */
export class PaymentProvider {
  /** Nombre corto usado en logs y en la env var PAYMENT_PROVIDER. @returns {string} */
  get name() { throw new Error(`${this.constructor.name}.name no implementado`); }

  /** ¿Están configuradas las credenciales reales de esta pasarela? @returns {boolean} */
  get isConfigured() { throw new Error(`${this.constructor.name}.isConfigured no implementado`); }

  /**
   * Busca o crea el cliente en la pasarela para este usuario.
   * @returns {Promise<string>} id de cliente en la pasarela.
   */
  async getOrCreateCustomer(_email, _nombre, _tenantId, _deps) {
    throw new Error(`${this.constructor.name}.getOrCreateCustomer no implementado`);
  }

  /**
   * Crea una sesión de checkout hosteado (Stripe Checkout, Wompi Web
   * Checkout, etc.) para una suscripción recurrente.
   * @returns {Promise<CheckoutSessionResult>}
   */
  async createCheckoutSession(_params) {
    throw new Error(`${this.constructor.name}.createCheckoutSession no implementado`);
  }

  /**
   * Verifica la firma del webhook entrante y devuelve el evento normalizado.
   * Debe lanzar si la firma es inválida.
   * @returns {Promise<NormalizedPaymentEvent>}
   */
  async verifyAndParseWebhook(_rawBody, _headers) {
    throw new Error(`${this.constructor.name}.verifyAndParseWebhook no implementado`);
  }
}
