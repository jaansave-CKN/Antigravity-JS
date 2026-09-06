/**
 * authStorage.ts — punto único de lectura/escritura de la sesión en
 * localStorage (react-doctor client-localstorage-no-version, 2026-09-05).
 *
 * FIX (Fase 1 frontend, Prioridad Amarilla, 2026-09-05): el JWT real de
 * sesión ya NO se guarda aquí — vive exclusivamente en la cookie httpOnly
 * `auth_token` que planta server.js (ver AUTH_COOKIE_NAME en
 * auth.middleware.js), invisible para JS por diseño. `auth_token:v1` en
 * localStorage sigue existiendo por una única razón: 'demo-mode-token', un
 * flag público (cadena hardcodeada en todo el repo, jamás un secreto) que
 * marca "modo demo sin backend real" y necesita sobrevivir un reload porque
 * no hay servidor del que revalidarlo. `auth_user:v1` cachea el PERFIL (no
 * sensible: nombre/email/rol) tanto para sesiones demo como reales — para
 * las reales es solo un espejo de lo último que devolvió /api/auth/verify,
 * nunca la fuente de verdad de autenticación.
 *
 * `auth_token`/`auth_user` tienen 7 lectores/escritores directos e
 * independientes en este repo (AuthContextNew.tsx, apiClient.ts,
 * services/api.ts, main.tsx, SubscriptionContext.tsx, FavoritosContext.tsx,
 * Dashboard.tsx) — ninguno recibe el valor vía props/contexto de React.
 * Cambiar la clave en un solo archivo habría dejado a los otros 6 sin poder
 * encontrar el token o sin sincronizar entre pestañas.
 *
 * Migración de un solo sentido al leer (mismo patrón ya usado en 8 archivos
 * de este repo): si la clave nueva no tiene valor, lee la vieja, la copia a
 * la nueva y borra la vieja.
 *
 * Sin dependencias de React/apiClient.ts/AuthContextNew.tsx — cero riesgo de
 * import circular contra cualquiera de los consumidores.
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

/** Solo devuelve 'demo-mode-token' o null ahora — nunca un JWT real. */
export function leerAuthToken(): string | null {
  return leerConMigracion(AUTH_TOKEN_KEY, AUTH_TOKEN_KEY_LEGACY);
}

/** Perfil de usuario como string JSON crudo — el caller sigue haciendo su propio JSON.parse/try-catch, igual que antes. */
export function leerAuthUser(): string | null {
  return leerConMigracion(AUTH_USER_KEY, AUTH_USER_KEY_LEGACY);
}

/** Solo debe invocarse con 'demo-mode-token' — ver docblock del archivo. */
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

/** Para listeners de `window.addEventListener('storage', ...)`: sigue
 *  disparando de verdad para 'demo-mode-token' (el único valor que todavía
 *  se escribe aquí). Para sesiones reales, ver suscribirCambioSesion() más
 *  abajo — el evento nativo `storage` ya no se dispara para ellas porque no
 *  escriben nada en Web Storage. */
export function esEventoDeSesion(e: StorageEvent): boolean {
  return e.key === AUTH_TOKEN_KEY || e.key === AUTH_TOKEN_KEY_LEGACY;
}

// ── Sincronización entre pestañas para sesiones reales (Fase 1, 2026-09-05) ──
// FIX: antes, escribirAuthToken(jwtReal) disparaba gratis el evento `storage`
// nativo en otras pestañas cuando alguien iniciaba/cerraba sesión — con el
// JWT fuera de Web Storage ese evento ya no ocurre para sesiones reales.
// BroadcastChannel es la señal explícita que lo reemplaza: no necesita que
// nada se escriba en localStorage para funcionar entre pestañas del mismo
// origen.
const SESSION_CHANNEL_NAME = 'rf360-auth-session';
let canalSesion: BroadcastChannel | null = null;

function obtenerCanalSesion(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null; // navegador sin soporte — degrada sin romper
  if (!canalSesion) canalSesion = new BroadcastChannel(SESSION_CHANNEL_NAME);
  return canalSesion;
}

/** Llamar tras cualquier cambio real de sesión (login/logout/activación/
 *  trial) para que otras pestañas se enteren y revaliden. */
export function emitirCambioSesion(): void {
  try { obtenerCanalSesion()?.postMessage({ tipo: 'cambio-sesion', ts: Date.now() }); }
  catch { /* BroadcastChannel no disponible — sin sincronización entre pestañas, no fatal */ }
}

/** Devuelve una función de limpieza, mismo contrato que un cleanup de useEffect. */
export function suscribirCambioSesion(cb: () => void): () => void {
  const canal = obtenerCanalSesion();
  if (!canal) return () => {};
  const handler = () => cb();
  canal.addEventListener('message', handler);
  return () => canal.removeEventListener('message', handler);
}

// ── CSRF de doble-submit cookie (Fase 2, 2026-09-05) ─────────────────────────
// Lee la cookie XSRF-TOKEN que server.js planta sin httpOnly (ver
// issueXsrfCookie en server.js) — a propósito legible por JS, es el punto
// del patrón: solo un cliente same-origin puede leerla y reenviarla como
// header, un atacante cross-site no puede. Vive aquí (no triplicado en
// apiClient.ts/services/api.ts/AuthContextNew.tsx) porque los tres ya
// importan de este archivo para el resto de la sesión.
const XSRF_COOKIE_NAME = 'XSRF-TOKEN';
const XSRF_HEADER_NAME = 'X-CSRF-Token';

export function leerCsrfToken(): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + XSRF_COOKIE_NAME + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Objeto listo para spread en headers de cualquier POST/PUT/PATCH/DELETE.
 *  Vacío si todavía no hay cookie — cubre el primer request de la sesión
 *  (login/registro/trial), que el backend tampoco exige (Regla 1 de
 *  verifyCsrf en server.js: sin cookie auth_token, no hay sesión que CSRF
 *  deba proteger). */
export function obtenerCsrfHeaders(): Record<string, string> {
  const token = leerCsrfToken();
  return token ? { [XSRF_HEADER_NAME]: token } : {};
}
