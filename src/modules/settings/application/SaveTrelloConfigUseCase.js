import { AuditLogger } from '../../../shared/infrastructure/AuditLogger.js';
import { db } from '../../../shared/infrastructure/FirebaseAdmin.js';

/**
 * Use Case: Save Trello Credentials.
 * Standard: Secrets are never logged or exposed.
 * Using Cloud Firestore for persistence.
 */
export class SaveTrelloConfigUseCase {
  async execute(config) {
    const { apiKey, token } = config || {};
    if (!apiKey || !token) {
      throw new Error('API Key and Token are mandatory');
    }

    try {
      await db.collection('settings').doc('trello').set({
        apiKey,
        token,
        updatedAt: new Date().toISOString()
      });

      // Audita la acción sin loguear los secretos.
      AuditLogger.log('CONFIG_UPDATED', { service: 'Trello', action: 'Keys saved to Cloud Firestore' });

      return { saved: true, config: { apiKey: '***', token: '***' } };
    } catch (error) {
      AuditLogger.log('CONFIG_ERROR', { service: 'Trello', error: error.message });
      throw error;
    }
  }

  async getStatus() {
    const doc = await db.collection('settings').doc('trello').get();
    return { linked: doc.exists };
  }
}
