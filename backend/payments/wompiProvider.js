/**
 * wompiProvider.js — STUB, no implementado.
 *
 * Define la forma del contrato para cuando se integre Wompi de verdad
 * (soporta PSE y Nequi de forma nativa en Colombia, a diferencia de
 * Stripe). No se implementó la lógica real porque requiere credenciales de
 * comercio reales y verificar la documentación vigente de la API de Wompi
 * (esquema de firma de eventos, endpoints de sandbox/producción) — construir
 * eso a ciegas sin esa referencia sería adivinar, no integrar.
 *
 * Para activarlo de verdad:
 *   1. Implementar cada método de abajo contra la API real de Wompi
 *      (Payment Links / Web Checkout para el equivalente a Stripe Checkout,
 *      webhook de eventos con verificación de checksum SHA-256).
 *   2. Agregar WOMPI_PUBLIC_KEY / WOMPI_PRIVATE_KEY / WOMPI_EVENTS_SECRET
 *      a .env y .env.example.
 *   3. Montar una ruta propia en server.js, ej.
 *      app.post('/api/webhooks/wompi', express.json(), wompiWebhookHandler)
 *      — Wompi firma sobre JSON, no sobre raw body como Stripe, así que NO
 *      comparte el mismo middleware express.raw() que la ruta de Stripe.
 *   4. Cambiar PAYMENT_PROVIDER=wompi en .env (o correr ambas pasarelas en
 *      paralelo si se decide dar opción de pasarela al usuario en checkout).
 *
 * subscriptions.routes.js, SubscriptionContext.tsx y PlanesPage.tsx NO
 * requieren ningún cambio cuando esto se complete — ya hablan contra la
 * interfaz PaymentProvider, no contra Stripe directamente.
 */
import { PaymentProvider } from './PaymentProvider.js';

export class WompiProvider extends PaymentProvider {
  get name() { return 'wompi'; }
  get isConfigured() { return false; }

  async getOrCreateCustomer() {
    throw new Error('WompiProvider no implementado — ver comentario de cabecera de wompiProvider.js');
  }

  async createCheckoutSession() {
    throw new Error('WompiProvider no implementado — ver comentario de cabecera de wompiProvider.js');
  }

  async verifyAndParseWebhook() {
    throw new Error('WompiProvider no implementado — ver comentario de cabecera de wompiProvider.js');
  }
}
