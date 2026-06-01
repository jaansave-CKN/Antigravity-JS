/**
 * BrevoEmailAdapter.js — Adaptador ESM para Brevo (ex-Sendinblue)
 * Envío de emails transaccionales desde el backend Node.js (ESM).
 */

export class BrevoEmailAdapter {
  constructor(config = {}) {
    this.apiKey      = config.apiKey      || process.env.BREVO_API_KEY      || '';
    this.senderEmail = config.senderEmail || process.env.BREVO_SENDER_EMAIL || '';
    this.senderName  = config.senderName  || process.env.BREVO_SENDER_NAME  || 'Radar Formulador 360';
    this.apiUrl      = 'https://api.brevo.com/v3/smtp/email';

    if (!this.apiKey)      console.warn('[BrevoAdapter] BREVO_API_KEY no configurada — emails desactivados.');
    if (!this.senderEmail) console.warn('[BrevoAdapter] BREVO_SENDER_EMAIL no configurado — emails desactivados.');
  }

  isConfigured() {
    return !!this.apiKey && !!this.senderEmail;
  }

  async sendEmail({ to, subject, content, templateId } = {}) {
    if (!this.isConfigured()) {
      console.warn('[BrevoAdapter] Email no enviado — adaptador sin credenciales.');
      return { skipped: true };
    }

    const payload = {
      sender:      { email: this.senderEmail, name: this.senderName },
      to:          [{ email: to }],
      subject,
      htmlContent: content,
    };

    if (templateId) {
      payload.templateId = parseInt(templateId, 10);
      delete payload.htmlContent;
    }

    const response = await fetch(this.apiUrl, {
      method:  'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
        'api-key':      this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`[BrevoAdapter] HTTP ${response.status}: ${err.message || 'Error desconocido'}`);
    }

    return response.json();
  }

  async sendPasswordReset(userEmail, resetLink) {
    return this.sendEmail({
      to:      userEmail,
      subject: 'Recuperación de contraseña — Radar Formulador 360',
      content: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
          <h2 style="color:#191c1e;margin-bottom:0.5rem;">Recuperar contraseña</h2>
          <p style="color:#45464d;">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong>Radar Formulador 360</strong>.</p>
          <p style="color:#45464d;">Si no realizaste esta solicitud, ignora este correo — tu cuenta está segura.</p>
          <a href="${resetLink}"
             style="display:inline-block;margin:1.5rem 0;padding:12px 28px;background:#0058be;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:700;font-family:monospace;
                    letter-spacing:0.05em;text-transform:uppercase;font-size:12px;">
            Restablecer contraseña
          </a>
          <p style="color:#9ca3af;font-size:11px;margin-top:2rem;">
            Este enlace expira en 1 hora. Si tienes problemas, copia y pega en tu navegador:<br/>
            <span style="color:#0058be;word-break:break-all;">${resetLink}</span>
          </p>
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:2rem 0;"/>
          <p style="color:#c6c6cd;font-size:10px;font-family:monospace;">Radar Formulador 360 · Sistema de Formulación de Proyectos</p>
        </div>
      `,
    });
  }

  async sendImpactNotification(userEmail, impactData) {
    const monto = impactData.monto
      ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(impactData.monto)
      : 'N/A';

    return this.sendEmail({
      to:      userEmail,
      subject: `Nueva oportunidad detectada: ${impactData.titulo || 'Convocatoria disponible'}`,
      content: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:2rem;">
          <h2 style="color:#191c1e;">Nueva oportunidad de financiación</h2>
          <div style="background:#f0f4ff;border:1px solid #dbeafe;border-radius:8px;padding:1rem;margin:1rem 0;">
            <h3 style="color:#0058be;margin-top:0;">${impactData.titulo || 'Oportunidad detectada'}</h3>
            <p><strong>Entidad:</strong> ${impactData.entidad || 'N/A'}</p>
            <p><strong>Sector:</strong>  ${impactData.sector  || 'N/A'}</p>
            <p><strong>Monto:</strong>   ${monto}</p>
            <p><strong>Estado:</strong>  ${impactData.estado  || 'N/A'}</p>
            ${impactData.fechaCierre ? `<p><strong>Cierre:</strong> ${impactData.fechaCierre}</p>` : ''}
          </div>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/radar"
             style="display:inline-block;padding:12px 24px;background:#0058be;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:700;font-size:12px;
                    font-family:monospace;letter-spacing:0.05em;">
            Ver en Radar 360
          </a>
        </div>
      `,
    });
  }
}

// Instancia singleton lista para usar desde server.js
export const emailAdapter = new BrevoEmailAdapter();
