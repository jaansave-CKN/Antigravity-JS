/**
 * payments/index.js — punto único de entrada a la pasarela de pago activa.
 *
 * subscriptions.routes.js importa `paymentProvider` de acá, nunca de
 * stripeProvider.js/wompiProvider.js directamente. Cambiar de pasarela es
 * cambiar PAYMENT_PROVIDER en .env — cero cambios en el resto del código.
 */
import { StripeProvider } from './stripeProvider.js';
import { WompiProvider } from './wompiProvider.js';

const PROVIDERS = {
  stripe: StripeProvider,
  wompi:  WompiProvider,
};

const activeName = (process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase();
const ProviderClass = PROVIDERS[activeName] || StripeProvider;

if (!PROVIDERS[activeName]) {
  console.warn(`[payments] PAYMENT_PROVIDER="${activeName}" desconocido — usando stripe por defecto.`);
}

export const paymentProvider = new ProviderClass();
export const activePaymentProviderName = paymentProvider.name;
