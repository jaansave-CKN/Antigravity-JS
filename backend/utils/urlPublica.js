/**
 * urlPublica.js — URL pública del FRONTEND para enlaces (correos, redirecciones
 * de OAuth y Stripe, CORS). Fuente ÚNICA (2026-09-29, dictamen architect C10):
 * antes cada sitio repetía `FRONTEND_URL || 'http://localhost:5173'`, así que si
 * FRONTEND_URL faltaba en producción los enlaces de recuperación de contraseña
 * o validación apuntaban a localhost.
 *
 * Orden: FRONTEND_URL (dominio propio cuando llegue) → en producción, la URL
 * pública de ESTE servicio (VITE_API_URL: un solo servicio Render sirve dist/
 * y /api, render.yaml) → en desarrollo, el vite local.
 * NO sirve para la URL del BACKEND (server.js usa VITE_API_URL a propósito en
 * los enlaces de aprobar/rechazar del admin). Nunca se deriva del Host de la
 * petición (inyección de host en enlaces de reset).
 * Se evalúa en cada uso (no al cargar el módulo).
 */
const limpiar = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/api$/, '').replace(/\/+$/, '');

export function urlPublica(env = process.env) {
  return limpiar(env.FRONTEND_URL)
    || (env.NODE_ENV === 'production' ? limpiar(env.VITE_API_URL) : '')
    || 'http://localhost:5173';
}
