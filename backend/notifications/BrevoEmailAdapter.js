// backend/notifications/BrevoEmailAdapter.js
/**
 * Adaptador para el servicio de email de Brevo (anteriormente Sendinblue)
 * Prepara la estructura para integración con credenciales reales de Brevo API
 */

class BrevoEmailAdapter {
  /**
   * Inicializa el adaptador con las credenciales de Brevo
   * @param {Object} config - Configuración de Brevo
   * @param {string} config.apiKey - API Key de Brevo
   * @param {string} config.senderEmail - Email del remitente verificado
   * @param {string} config.senderName - Nombre del remitente
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.BREVO_API_KEY;
    this.senderEmail = config.senderEmail || process.env.BREVO_SENDER_EMAIL;
    this.senderName = config.senderName || process.env.BREVO_SENDER_NAME || 'Radar de Fondos 360';
    this.apiUrl = 'https://api.brevo.com/v3/smtp/email';
    
    // Validar configuración básica
    if (!this.apiKey) {
      console.warn('[BrevoAdapter] API Key no configurada. Las notificaciones por email estarán desactivadas.');
    }
    
    if (!this.senderEmail) {
      console.warn('[BrevoAdapter] Email del remitente no configurado. Las notificaciones por email estarán desactivadas.');
    }
  }

  /**
   * Verifica si el adaptador está configurado correctamente
   * @returns {boolean} - True si está listo para enviar emails
   */
  isConfigured() {
    return !!this.apiKey && !!this.senderEmail;
  }

  /**
   * Envía un email usando la API de Brevo
   * @param {Object} emailData - Datos del email a enviar
   * @param {string} emailData.to - Email del destinatario
   * @param {string} emailData.subject - Asunto del email
   * @param {string} emailData.content - Contenido HTML del email
   * @param {string} emailData.templateId - ID de plantilla (opcional)
   * @returns {Promise<Object>} - Respuesta de la API
   */
  async sendEmail(emailData) {
    if (!this.isConfigured()) {
      throw new Error('BrevoAdapter no está configurado correctamente. Falta API Key o email del remitente.');
    }

    const emailPayload = {
      sender: {
        email: this.senderEmail,
        name: this.senderName
      },
      to: [
        {
          email: emailData.to
        }
      ],
      subject: emailData.subject,
      htmlContent: emailData.content
    };

    // Si se proporciona un ID de plantilla, usarlo en lugar de htmlContent
    if (emailData.templateId) {
      emailPayload.templateId = parseInt(emailData.templateId);
      delete emailPayload.htmlContent;
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'api-key': this.apiKey
        },
        body: JSON.stringify(emailPayload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Error al enviar email: ${response.status} - ${errorData.message || 'Error desconocido'}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[BrevoAdapter] Error enviando email:', error);
      throw error;
    }
  }

  /**
   * Envía una notificación de impacto detectado
   * @param {Object} notificationData - Datos de la notificación
   * @param {string} notificationData.userEmail - Email del usuario
   * @param {Object} notificationData.impactData - Datos del impacto detectado
   * @returns {Promise<Object>}
   */
  async sendImpactNotification(notificationData) {
    const { userEmail, impactData } = notificationData;
    
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">¡Nuevo Impacto Detectado! - Radar de Fondos 360</h2>
        <p>Se ha detectado una nueva oportunidad de financiación que coincide con tu perfil:</p>
        
        <div style="background-color: #ecf0f1; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #3498db; margin-top: 0;">${impactData.titulo || 'Oportunidad de Financiación'}</h3>
          <p><strong>Entidad:</strong> ${impactData.entidad || 'N/A'}</p>
          <p><strong>Sector:</strong> ${impactData.sector || 'N/A'}</p>
          <p><strong>Monto:</strong> ${impactData.monto ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(impactData.monto) : 'N/A'}</p>
          <p><strong>Estado:</strong> ${impactData.estado || 'N/A'}</p>
          ${impactData.fechaCierre ? `<p><strong>Fecha de cierre:</strong> ${impactData.fechaCierre}</p>` : ''}
        </div>
        
        <p>Para ver más detalles y acceder a la convocatoria completa, ingresa a tu panel de control en:</p>
        <a href="https://radarfondos360.com/dashboard" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Ver en Radar de Fondos 360</a>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 25px 0;">
        <p style="font-size: 12px; color: #7f8c8d;">
          Este es un mensaje automático del Radar de Fondos 360. <br>
          Para modificar tus preferencias de notificación, visita la sección de configuración en tu cuenta.
        </p>
      </div>
    `;

    return this.sendEmail({
      to: userEmail,
      subject: `🔔 Nueva oportunidad de impacto: ${impactData.titulo || 'Financiación Detectada'}`,
      content: emailContent
    });
  }

  /**
   * Envía una notificación de convocatoria favorita
   * @param {Object} notificationData - Datos de la notificación
   * @param {string} notificationData.userEmail - Email del usuario
   * @param {Object} notificationData.convocatoriaData - Datos de la convocatoria
   * @returns {Promise<Object>}
   */
  async sendFavoritoNotification(notificationData) {
    const { userEmail, convocatoriaData } = notificationData;
    
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c3e50;">¡Recordatorio de Convocatoria Favorita! - Radar de Fondos 360</h2>
        <p>Una de tus convocatorias favoritas está próxima a vencerse:</p>
        
        <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <h3 style="color: #856404; margin-top: 0;">${convocatoriaData.titulo || 'Convocatoria de Interés'}</h3>
          <p><strong>Entidad:</strong> ${convocatoriaData.entidad || 'N/A'}</p>
          <p><strong>Sector:</strong> ${convocatoriaData.sector || 'N/A'}</p>
          <p><strong>Monto disponible:</strong> ${convocatoriaData.monto ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(convocatoriaData.monto) : 'N/A'}</p>
          ${convocatoriaData.fechaCierre ? `<p><strong>Fecha de cierre:</strong> ${convocatoriaData.fechaCierre}</p>` : ''}
        </div>
        
        <p>No dejes pasar esta oportunidad. Accede a tu perfil para revisar los detalles completos:</p>
        <a href="https://radarfondos360.com/favoritos" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Ver Mis Favoritos</a>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 25px 0;">
        <p style="font-size: 12px; color: #7f8c8d;">
          Este es un mensaje automático del Radar de Fondos 360. <br>
          Gestiona tus convocatorias favoritas en tu panel de control.
        </p>
      </div>
    `;

    return this.sendEmail({
      to: userEmail,
      subject: `⏰ Recordatorio: ${convocatoriaData.titulo || 'Convocatoria Favorita'} está por vencerse`,
      content: emailContent
    });
  }
}

// Export para uso en otros módulos
module.exports = BrevoEmailAdapter;

// También soportar importación ES6 si es necesario
if (typeof module !== 'undefined' && module.exports) {
  module.exports.BrevoEmailAdapter = BrevoEmailAdapter;
}