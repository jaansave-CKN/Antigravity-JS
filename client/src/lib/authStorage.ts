/**
 * authStorage.ts — punto único de lectura/escritura de la sesión en
 * localStorage (react-doctor client-localstorage-no-version, 2026-09-05).
 *
 * `auth_token`/`auth_user` tienen 7 lectores/escritores directos e
 * independientes en este repo (AuthContextNew.tsx, apiClient.ts,
 * services/api.ts, main.tsx, SubscriptionContext.tsx, FavoritosContext.tsx,
 * Dashboard.tsx) — ninguno recibe el valor vía props/contexto de React.
 * Cambiar la clave en un solo archivo habría dejado a los otros 6 sin poder
 * encontrar el token (401 generalizado) o sin sincronizar entre pestañas.
 * Diseño verificado por `architect` (agentId aa4b3d6892a0d41dd, 2026-09-05).
 *
 * Migración de un solo sentido al leer (mismo patrón ya usado en 8 archivos
 * de este repo): si la clave nueva no tiene valor, lee la vieja, la copia a
 * la nueva y borra la vieja — nunca un renombre ciego que desloguee sesiones
 * reales ya activas en producción.
 *
 * Sin dependencias (ni React, ni apiClient.ts, ni AuthContextNew.tsx) — cero
 * riesgo de import circular contra cualquiera de los 7 consumidores.
 */
const AUTH_TOKEN_KEY        = 'auth_token:v1';
const AUTH_TOKEN_KEY_LEGACY = 'auth_token';
const AUTH_USER_KEY         = 'auth_user:v1';
const AUTH_USER_KEY_LEGACY  = 'auth_user';

function leerConMigracion(actualKey: string, legadoKey: string): string | null {
  const actual = localStorage.getItem(actualKey);
  if (actual) return actual;
  const legado = localStorage.getItem(legadoKey);
  if (legado) {
    localStorage.setItem(actualKey, legado);
    localStorage.removeItem(legadoKey);
  }
  return legado;
}

/** Token crudo (JWT o 'demo-mode-token') — migra la clave vieja si hace falta. */
export function leerAuthToken(): string | null {
  return leerConMigracion(AUTH_TOKEN_KEY, AUTH_TOKEN_KEY_LEGACY);
}

/** Perfil de usuario como string JSON crudo — el caller sigue haciendo su propio JSON.parse/try-catch, igual que antes. */
export function leerAuthUser(): string | null {
  return leerConMigracion(AUTH_USER_KEY, AUTH_USER_KEY_LEGACY);
}

export function escribirAuthToken(t: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, t);
  localStorage.removeItem(AUTH_TOKEN_KEY_LEGACY);
}

export function escribirAuthUser(u: unknown): void {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(u));
  localStorage.removeItem(AUTH_USER_KEY_LEGACY);
}

/** Logout/clearSession — borra las 4 claves físicas (nueva+legada de token
 *  y de user), no solo las nuevas: un residuo legado no debe poder
 *  resucitar una sesión ya cerrada en la siguiente carga. */
export function borrarAuthSession(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY_LEGACY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_USER_KEY_LEGACY);
}

/** Para listeners de `window.addEventListener('storage', ...)`: durante la
 *  transición, una pestaña con el bundle viejo todavía escribe bajo la
 *  clave legada — comparar solo contra la nueva dejaría un hueco de
 *  sincronización entre pestañas hasta que ambas recarguen. */
export function esEventoDeSesion(e: StorageEvent): boolean {
  return e.key === AUTH_TOKEN_KEY || e.key === AUTH_TOKEN_KEY_LEGACY;
}
