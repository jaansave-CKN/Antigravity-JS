import * as Sentry from '@sentry/react';

// ── Inicialización única del colector remoto — solo si hay DSN configurado ───
// Centralizado aquí (importado desde main.tsx al arranque) para garantizar que
// Sentry.init() corre una sola vez sin importar qué componentes se monten.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}

// Envío seguro a Sentry — no-op si VITE_SENTRY_DSN no está configurado.
// Centraliza el guard para no repetir `if (import.meta.env.VITE_SENTRY_DSN)` en cada catch.
export function captureError(error: unknown, extra?: Record<string, unknown>): void {
  if (!SENTRY_DSN) return;
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { extra });
}
