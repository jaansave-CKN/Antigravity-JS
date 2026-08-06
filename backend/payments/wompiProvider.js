/**
 * wompiProvider.js — implementación real de PaymentProvider para Wompi
 * (Colombia — Bancolombia). Investigado contra docs.wompi.co (no asumido):
 * ambientes-y-llaves, transacciones, eventos, widget-checkout-web.
 *
 * Diferencias reales frente a StripeProvider que moldean este archivo:
 *   1. Wompi NO tiene objeto "Customer" persistente — los datos del
 *      comprador se envían inline en cada checkout, no se crean/consultan
 *      por API. getOrCreateCustomer() por eso es un passthrough de tenantId
 *      (documentado abajo), no una llamada HTTP.
 *   2. El "Web Checkout" hosteado (https://checkout.wompi.co/p/) es un
 *      redirect GET con query params firmados — NO requiere llamar a la API
 *      de Wompi para "crear" la sesión (a diferencia de Stripe Checkout).
 *      La firma de integridad se calcula localmente:
 *        SHA256(reference + amountInCents + currency + WOMPI_INTEGRITY_SECRET)
 *      Este es un secreto DISTINTO de WOMPI_PRIVATE_KEY y de
 *      WOMPI_EVENTS_SECRET — confirmado en docs.wompi.co/ambientes-y-llaves
 *      (prefijos reales: prod_integrity_ / test_integrity_).
 *   3. El webhook de Wompi ("eventos") firma sobre el JSON del body, no
 *      sobre bytes crudos como Stripe, y el checksum se calcula sobre una
 *      lista DINÁMICA de campos (`event.signature.properties`, un array de
 *      dot-paths que Wompi indica en cada evento) — nunca una lista fija de
 *      campos hardcodeada, la doc lo advierte explícitamente.
 *   4. Wompi no modela "suscripciones" recurrentes vía API pública del
 *      mismo modo que Stripe — cada checkout es una transacción única. Por
 *      eso el plan/tenantId se codifican en el campo `reference` (único
 *      campo de correlación libre que el comercio controla) en vez de
 *      metadata de suscripción.
 *
 * Ambiente (sandbox/producción) se infiere del prefijo de WOMPI_PUBLIC_KEY
 * (pub_test_ vs pub_prod_) — no de una env var aparte, así es imposible que
 * llaves de un ambiente apunten sin querer al checkout del otro.
 */
import crypto from 'crypto';
import { PaymentProvider } from './PaymentProvider.js';
import { PLANES } from '../config/planes.config.js';

const CHECKOUT_URL = 'https://checkout.wompi.co/p/';

export class WompiProvider extends PaymentProvider {
  constructor() {
    super();
    this._publicKey      = process.env.WOMPI_PUBLIC_KEY || null;
    this._privateKey     = process.env.WOMPI_PRIVATE_KEY || null;
    this._eventsSecret    = process.env.WOMPI_EVENTS_SECRET || null;
    this._integritySecret = process.env.WOMPI_INTEGRITY_SECRET || null;
  }

  get name() { return 'wompi'; }

  // publicKey + integritySecret son los únicos 2 que createCheckoutSession
  // usa de verdad (es un redirect firmado localmente, sin llamada HTTP).
  // privateKey queda reservado para una futura consulta server-to-server del
  // estado de la transacción (GET /v1/transactions/:id); eventsSecret se
  // valida aparte, dentro de verifyAndParseWebhook, igual que el patrón ya
  // usado por StripeProvider (que tampoco exige webhookSecret en isConfigured).
  get isConfigured() { return !!(this._publicKey && this._integritySecret); }

  /**
   * Wompi no tiene un "customer" persistente — no hay nada que crear ni
   * consultar por API. Se devuelve el tenantId tal cual: createCheckoutSession
   * lo usa para construir `reference` (el único correlator que Wompi
   * reenvía en el webhook), y _handleCheckoutCompleted (subscriptionEvents.js)
   * ya busca/actualiza por tenantId (user_id), no por este valor.
   */
  async getOrCreateCustomer(_email, _nombre, tenantId, _deps) {
    if (!this.isConfigured) throw new Error('WompiProvider: WOMPI_PUBLIC_KEY/WOMPI_INTEGRITY_SECRET no configuradas.');
    return tenantId;
  }

  /**
   * Construye la URL del Web Checkout hosteado de Wompi. No hay llamada de
   * red: la "sesión" es la propia URL firmada — Wompi resuelve todo en su
   * página de checkout (método GET del formulario, ver docs/widget-checkout-web).
   *
   * `cancelUrl` no tiene equivalente en Wompi (un solo `redirect-url` para
   * cualquier desenlace; Wompi le agrega `?id=<transactionId>` al volver, y
   * el estado real se confirma por el webhook, nunca por el query param del
   * redirect) — se recibe por paridad de interfaz pero no se usa.
   */
  async createCheckoutSession({ customerId, plan, tenantId, successUrl, cancelUrl: _cancelUrl }) {
    if (!this.isConfigured) throw new Error('WompiProvider: WOMPI_PUBLIC_KEY/WOMPI_INTEGRITY_SECRET no configuradas.');

    const planData = PLANES[plan];
    if (!planData || !planData.precio) {
      throw new Error(`WompiProvider.createCheckoutSession: no hay precio configurado para el plan "${plan}"`);
    }

    const tenant = customerId || tenantId;
    // Underscore como separador porque tenantId es un UUID (contiene '-');
    // parseReference() en este mismo archivo hace el split inverso.
    const reference = `radfor_${tenant}_${plan}_${Date.now()}`;
    const amountInCents = Math.round(planData.precio * 100);
    const currency = 'COP';

    const signature = crypto
      .createHash('sha256')
      .update(`${reference}${amountInCents}${currency}${this._integritySecret}`)
      .digest('hex');

    const params = new URLSearchParams({
      'public-key': this._publicKey,
      'currency': currency,
      'amount-in-cents': String(amountInCents),
      'reference': reference,
      'redirect-url': successUrl,
    });
    // signature:integrity lleva ':' literal en el nombre del campo — así lo
    // documenta Wompi (widget-checkout-web); URLSearchParams lo codifica en
    // la key igual que cualquier otro caracter, Wompi lo acepta así.
    params.set('signature:integrity', signature);

    return {
      url: `${CHECKOUT_URL}?${params.toString()}`,
      sessionId: reference,
    };
  }

  /**
   * Verifica el checksum del evento (JSON, no raw body — ver comentario de
   * cabecera) y lo normaliza a NormalizedPaymentEvent. Se registra en
   * server.js con express.json() normal, nunca express.raw() (eso es
   * exclusivo del webhook de Stripe).
   */
  async verifyAndParseWebhook(rawBody, _headers) {
    if (!this._eventsSecret) throw new Error('WompiProvider: WOMPI_EVENTS_SECRET no configurado.');

    const body = rawBody;
    const checksumRecibido = body?.signature?.checksum;
    const properties = body?.signature?.properties;
    const timestamp = body?.timestamp;
    if (!checksumRecibido || !Array.isArray(properties) || !timestamp) {
      throw new Error('Payload de Wompi inválido: falta signature.checksum/properties o timestamp.');
    }

    // Los campos a concatenar son DINÁMICOS (indicados por el propio evento
    // en `signature.properties`, p.ej. ["transaction.id","transaction.status",
    // "transaction.amount_in_cents"]) — nunca una lista fija hardcodeada,
    // Wompi documenta que el set de campos puede variar por tipo de evento.
    const valores = properties.map(path =>
      path.split('.').reduce((obj, key) => obj?.[key], body.data)
    );
    const cadena = valores.join('') + timestamp + this._eventsSecret;
    const checksumCalculado = crypto.createHash('sha256').update(cadena).digest('hex').toUpperCase();

    if (checksumCalculado !== String(checksumRecibido).toUpperCase()) {
      throw new Error('Firma de webhook Wompi inválida (checksum no coincide).');
    }

    const tx = body?.data?.transaction;
    const { tenantId, plan } = this._parseReference(tx?.reference);

    const base = { providerEventId: `${tx?.id || tx?.reference}:${timestamp}`, raw: body, tenantId, priceId: plan, customerId: tenantId };

    if (tx?.status === 'APPROVED') return { ...base, type: 'checkout.completed' };
    if (tx?.status === 'DECLINED' || tx?.status === 'ERROR') return { ...base, type: 'payment.failed' };
    // PENDING/VOIDED u otros estados intermedios: se registra pero no se aplica.
    return { ...base, type: 'unhandled' };
  }

  /** Inverso de la construcción de `reference` en createCheckoutSession(). */
  _parseReference(reference) {
    const m = /^radfor_(.+)_([a-z]+)_\d+$/.exec(reference || '');
    return m ? { tenantId: m[1], plan: m[2] } : { tenantId: null, plan: null };
  }

  /** Mismo rol que StripeProvider.resolvePlanFor, pero trivial: en Wompi el
   * "priceId" normalizado YA es el plan interno (no hay tabla de precios en
   * la pasarela, el plan se codifica en `reference`). */
  resolvePlanFor(planKey) {
    const p = PLANES[planKey];
    return p ? { plan: planKey, access_radar: p.access_radar, access_formulador: p.access_formulador } : { plan: 'free', access_radar: 0, access_formulador: 0 };
  }
}
