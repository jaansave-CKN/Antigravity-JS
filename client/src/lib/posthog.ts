import posthog from 'posthog-js';

// posthog.ts — Telemetría y Session Replay (PostHog).
// Mismo patrón que client/src/lib/sentry.ts: init como efecto de módulo al
// importarse desde main.tsx, no-op si VITE_POSTHOG_KEY no está configurada
// (no debe romper el arranque local ni depender de una cuenta de PostHog
// para poder desarrollar).
//
// mask_all_text/mask_all_element_attributes en true es OBLIGATORIO y no
// configurable — RadFor-360 maneja cifras en COP, formularios financieros
// y credenciales; una grabación de sesión sin enmascarar expondría esos
// datos a cualquiera con acceso al proyecto de PostHog.
const POSTHOG_KEY  = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
    },
    mask_all_text: true,
    mask_all_element_attributes: true,
    capture_pageview: true,
    capture_pageleave: true,
  });
}

/** Identifica al usuario autenticado ante PostHog (llamar tras login). No-op si no está activo. */
export function identifyPostHogUser(userId: string, props?: Record<string, unknown>) {
  if (!POSTHOG_KEY) return;
  posthog.identify(userId, props);
}

/** Limpia la identidad de PostHog (llamar en logout). No-op si no está activo. */
export function resetPostHog() {
  if (!POSTHOG_KEY) return;
  posthog.reset();
}

export { posthog, POSTHOG_HOST };
