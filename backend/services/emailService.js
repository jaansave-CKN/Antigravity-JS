/**
 * emailService.js — Servicio de correos transaccionales vía Resend
 * SDK: resend  |  Docs: resend.com/docs
 *
 * Variables de entorno requeridas:
 *   RESEND_API_KEY   — clave de API de Resend
 *   EMAIL_FROM       — dirección remitente (ej: "RadarFondos <noreply@tudominio.co>")
 *   FRONTEND_URL     — base URL del frontend para links en emails
 */

import { Resend } from 'resend';

// ── Inicialización condicional — no lanza si RESEND_API_KEY no está configurada ──
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const FROM    = process.env.EMAIL_FROM    || 'RadarFondos 360 <noreply@radarfondos.co>';
const APP_URL = (process.env.FRONTEND_URL || process.env.VITE_API_URL || '').replace(/\/api$/, '') || 'http://localhost:5173';

// Estado del módulo al cargar — visible en logs de producción
if (resend) {
  console.log('[emailService] Resend ACTIVO — emails transaccionales habilitados.');
} else {
  console.warn('[emailService] MÓDULO INACTIVO — Resend no configurado. Faltan credenciales en .env: RESEND_API_KEY');
  console.warn('[emailService] El Auth, el Formulador y el Radar funcionan al 100%. Solo los emails están desactivados.');
}

const isConfigured = () => !!resend;

// Retorna un objeto dummy consistente cuando el módulo está inactivo
function noop(method) {
  console.warn(`[emailService] Email omitido (módulo inactivo): ${method}`);
  return Promise.resolve({ skipped: true, reason: 'RESEND_API_KEY not set' });
}

// ── Verificación de cuenta (registro) ────────────────────────────────────────
export async function sendVerificationEmail(to, { nombre, verificationToken }) {
  if (!isConfigured()) return noop('sendVerificationEmail');

  const link = `${APP_URL}/verificar-email?token=${verificationToken}`;

  return resend?.emails.send({
    from: FROM,
    to,
    subject: 'Verifica tu cuenta en RadarFondos 360',
    html: `
      <h2>¡Bienvenido, ${nombre}!</h2>
      <p>Verifica tu cuenta haciendo clic en el siguiente enlace:</p>
      <p><a href="${link}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Verificar cuenta
      </a></p>
      <p>Este enlace expira en 24 horas.</p>
      <hr/>
      <small>Si no creaste esta cuenta, puedes ignorar este correo.</small>
    `,
  });
}

// ── Recuperación de contraseña ────────────────────────────────────────────────
export async function sendPasswordReset(to, resetLink) {
  if (!isConfigured()) return noop('sendPasswordReset');

  return resend?.emails.send({
    from: FROM,
    to,
    subject: 'Recupera tu contraseña — RadarFondos 360',
    html: `
      <h2>Recuperación de contraseña</h2>
      <p>Haz clic en el siguiente enlace para restablecer tu contraseña. El enlace expira en 1 hora.</p>
      <p><a href="${resetLink}" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Restablecer contraseña
      </a></p>
      <hr/>
      <small>Si no solicitaste esto, ignora este correo. Tu contraseña no cambiará.</small>
    `,
  });
}

// ── Alerta del Radar: nueva convocatoria relevante ────────────────────────────
export async function sendRadarAlert(to, { nombre, convocatorias }) {
  if (!isConfigured()) return noop('sendRadarAlert');

  const items = convocatorias
    .map(c => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">
          <strong>${c.titulo}</strong><br/>
          <small>${c.donante} · Cierre: ${c.fecha_limite || 'Sin fecha'}</small>
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;color:#16a34a;">
          ${Math.round(c.similitud * 100)}% match
        </td>
      </tr>
    `)
    .join('');

  return resend?.emails.send({
    from: FROM,
    to,
    subject: `🎯 ${convocatorias.length} nuevas convocatorias para ti — RadarFondos 360`,
    html: `
      <h2>Hola, ${nombre}</h2>
      <p>El Radar encontró <strong>${convocatorias.length} convocatoria(s)</strong> que coinciden con tus proyectos:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;text-align:left;">Convocatoria</th>
            <th style="padding:8px;text-align:right;">Compatibilidad</th>
          </tr>
        </thead>
        <tbody>${items}</tbody>
      </table>
      <br/>
      <p><a href="${APP_URL}/radar" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Ver en el Radar
      </a></p>
    `,
  });
}

// ── Notificación de cambio de plan (Stripe) ───────────────────────────────────
export async function sendPlanUpgradeConfirmation(to, { nombre, plan, periodEnd }) {
  if (!isConfigured()) return noop('sendPlanUpgradeConfirmation');

  const planNames = { radar: 'Plan Radar', formulador: 'Plan Formulador', suite: 'Plan Suite Completo' };
  const planLabel = planNames[plan] || plan;

  return resend?.emails.send({
    from: FROM,
    to,
    subject: `✅ Suscripción activada: ${planLabel}`,
    html: `
      <h2>¡Tu plan fue activado, ${nombre}!</h2>
      <p>Ahora tienes acceso al <strong>${planLabel}</strong>.</p>
      <p>Tu período de facturación se renueva el <strong>${new Date(periodEnd * 1000).toLocaleDateString('es-CO')}</strong>.</p>
      <p><a href="${APP_URL}/dashboard" style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Ir al dashboard
      </a></p>
    `,
  });
}

// ── Notificación de cancelación / pago fallido ────────────────────────────────
export async function sendSubscriptionAlert(to, { nombre, tipo }) {
  if (!isConfigured()) return noop('sendSubscriptionAlert');

  const subjects = {
    canceled:       'Tu suscripción fue cancelada — RadarFondos 360',
    payment_failed: '⚠️ Pago fallido — Actualiza tu método de pago',
  };
  const bodies = {
    canceled: `
      <h2>Hola, ${nombre}</h2>
      <p>Tu suscripción fue cancelada. Tu acceso se mantiene hasta el final del período actual.</p>
      <p><a href="${APP_URL}/planes">Ver planes disponibles</a></p>
    `,
    payment_failed: `
      <h2>Hola, ${nombre}</h2>
      <p>No pudimos procesar tu último pago. Por favor actualiza tu método de pago para mantener el acceso.</p>
      <p><a href="${APP_URL}/configuracion/facturacion" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
        Actualizar método de pago
      </a></p>
    `,
  };

  return resend?.emails.send({
    from:    FROM,
    to,
    subject: subjects[tipo] || 'Notificación de suscripción — RadarFondos 360',
    html:    bodies[tipo] || `<p>Hola ${nombre}, hay una novedad con tu suscripción.</p>`,
  });
}
