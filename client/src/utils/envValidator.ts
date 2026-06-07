// envValidator.ts — valida llaves de entorno críticas al arrancar el cliente.
// En producción, si falta una llave crítica, lanza un error explícito que
// impide el arranque silencioso de la app (en vez de fallar a medias en runtime).

const CRITICAL_KEYS = ['VITE_API_URL'] as const;
const RECOMMENDED_KEYS = ['VITE_SENTRY_DSN'] as const;

export function validateEnv(): void {
  const env = import.meta.env;
  const missingCritical = CRITICAL_KEYS.filter((key) => !env[key]);

  if (missingCritical.length > 0) {
    const message = `[envValidator] Variables de entorno CRÍTICAS faltantes: ${missingCritical.join(', ')}. ` +
      'La aplicación no puede arrancar de forma segura sin ellas. Configura el archivo .env.local.';
    console.error(message);
    throw new Error(message);
  }

  const missingRecommended = RECOMMENDED_KEYS.filter((key) => !env[key]);
  if (missingRecommended.length > 0) {
    console.warn(`[envValidator] Variables recomendadas no configuradas: ${missingRecommended.join(', ')} — telemetría remota desactivada.`);
  }
}
