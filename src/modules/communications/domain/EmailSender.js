/**
 * Port (Interface) for Email Communications.
 * Decouples logic from technical implementations like Brevo.
 */
export class EmailSender {
  async send(to, subject, content) {
    throw new Error('Method not implemented');
  }

  async getAccountInfo() {
    throw new Error('Method not implemented');
  }

  async createCampaign(options) {
    throw new Error('Method not implemented');
  }
}
