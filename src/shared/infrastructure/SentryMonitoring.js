import * as Sentry from '@sentry/node';

// Captura de errores en producción — antes de esto, un error no atrapado
// explícitamente en un try/catch (o cualquier throw dentro de un handler
// async sin manejo) desaparecía en los logs de Render sin que nadie se
// enterara salvo revisando manualmente. Gratis hasta 5k eventos/mes.
//
// Sin SENTRY_DSN configurado, initSentry() no hace nada — el servidor
// arranca igual, sin captura de errores, con una advertencia visible en el
// log de arranque (no falla silenciosamente, no falla el arranque tampoco).
let _habilitado = false;

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn('[Sentry] SENTRY_DSN no configurado — captura de errores deshabilitada.');
    return;
  }
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // 10% de las requests con tracing de performance — suficiente para ver
    // tendencias sin agotar la cuota gratuita solo con tracing.
    tracesSampleRate: 0.1,
  });
  _habilitado = true;
  console.log('[Sentry] Inicializado — entorno:', process.env.NODE_ENV || 'development');
}

export function sentryHabilitado() {
  return _habilitado;
}

// Enganche para AuditLogger: cualquier evento *_ERROR que ya se registraba
// localmente/Firestore ahora también llega a Sentry, sin duplicar la
// decisión de "qué es un error" — AuditLogger ya la toma por su nombre de
// evento, esto solo reenvía.
export function capturarEnSentry(event, data) {
  if (!_habilitado) return;
  Sentry.captureMessage(`${event}: ${JSON.stringify(data)}`, 'error');
}

export function capturarExcepcion(err, contexto = {}) {
  if (!_habilitado) return;
  Sentry.captureException(err, { extra: contexto });
}

export { Sentry };
