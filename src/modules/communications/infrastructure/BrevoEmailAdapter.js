import { EmailSender } from '../domain/EmailSender.js';

/**
 * Infrastructure Adapter for Brevo API.
 */
export class BrevoEmailAdapter extends EmailSender {
  constructor(apiKey, senderEmail) {
    super();
    this.apiKey = apiKey;
    this.senderEmail = senderEmail;
    this.baseUrl = 'https://api.brevo.com/v3';
  }

  async send(to, subject, content) {
    const response = await fetch(`${this.baseUrl}/smtp/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey
      },
      body: JSON.stringify({
        sender: { name: 'Antigravity OS', email: this.senderEmail },
        to: [{ email: to }],
        subject: subject,
        htmlContent: content
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'Error sending email via Brevo');
    }
    return result;
  }

  async getAccountInfo() {
    const response = await fetch(`${this.baseUrl}/account`, {
      headers: { 'api-key': this.apiKey }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'Error fetching Brevo account info');
    }
    return data;
  }

  async createCampaign({ name, subject, senderName, senderEmail, htmlContent, listIds, scheduledAt }) {
    const response = await fetch(`${this.baseUrl}/emailCampaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey
      },
      body: JSON.stringify({
        name,
        subject,
        sender: {
          name: senderName || 'Antigravity OS',
          email: senderEmail || this.senderEmail
        },
        type: 'classic',
        htmlContent,
        recipients: { listIds },
        scheduledAt
      })
    });

    // Brevo API devuelve 201 con { id }, o 204 sin cuerpo.
    let data = {};
    if (response.status !== 204) {
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = { response: text };
      }
    }

    if (!response.ok) {
      throw new Error(data.message || 'Error creating Brevo campaign');
    }
    return data;
  }
}
