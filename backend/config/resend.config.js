/**
 * resend.config.js — Instancia Resend SDK + constantes de configuración
 *
 * Variables requeridas:
 *   RESEND_API_KEY  — re_xxxx
 *   EMAIL_FROM      — "RadarFondos 360 <noreply@tudominio.co>"
 *
 * Uso:
 *   import { resend, FROM_ADDRESS, APP_URL } from '../config/resend.config.js';
 *   await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
 */

import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('[resend.config] RESEND_API_KEY no definida — emails transaccionales desactivados');
}

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export const FROM_ADDRESS = process.env.EMAIL_FROM
  || 'RadarFondos 360 <noreply@radarfondos.co>';

export const APP_URL = (process.env.FRONTEND_URL || process.env.VITE_API_URL || '').replace(/\/api$/, '') || 'http://localhost:5173';

export const isEmailConfigured = () => !!process.env.RESEND_API_KEY;

/**
 * Envía un email con graceful fallback cuando Resend no está configurado.
 * @param {Object} options — { to, subject, html }
 */
export async function sendEmail({ to, subject, html }) {
  if (!resend) {
    console.warn(`[resend.config] Email omitido (no configurado): "${subject}" → ${to}`);
    return { skipped: true };
  }
  return resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
}

export default resend;
