/**
 * stripe.config.js — Instancia Stripe SDK configurada
 *
 * Variables requeridas:
 *   STRIPE_SECRET_KEY      — sk_live_... o sk_test_...
 *   STRIPE_WEBHOOK_SECRET  — whsec_...
 *
 * Uso:
 *   import { stripe, WEBHOOK_SECRET, PRICE_MAP } from '../config/stripe.config.js';
 */

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe.config] STRIPE_SECRET_KEY no definida — pagos desactivados');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' })
  : null;

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Mapeo canónico price_id → configuración de plan interno
export const PRICE_MAP = {
  [process.env.STRIPE_PRICE_RADAR]:      { plan: 'radar',      access_radar: true, access_formulador: false },
  [process.env.STRIPE_PRICE_FORMULADOR]: { plan: 'formulador', access_radar: false, access_formulador: true },
  [process.env.STRIPE_PRICE_SUITE]:      { plan: 'suite',      access_radar: true, access_formulador: true },
};

export const PLAN_DISPLAY = {
  radar:      'Plan Radar',
  formulador: 'Plan Formulador',
  suite:      'Plan Suite Completo',
  free:       'Plan Gratuito',
};

export default stripe;
