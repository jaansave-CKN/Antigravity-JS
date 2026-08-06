import 'dotenv/config';
import { db } from '../src/shared/infrastructure/FirebaseAdmin.js';
import { AuditLogger } from '../src/shared/infrastructure/AuditLogger.js';

async function syncTrelloCredentials() {
  const apiKey = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;

  if (!apiKey || !token) {
    console.error('ERROR: TRELLO_API_KEY or TRELLO_TOKEN not found in .env');
    process.exit(1);
  }

  try {
    await db.collection('settings').doc('trello').set({
      apiKey,
      token,
      updatedAt: new Date().toISOString()
    });

    AuditLogger.log('CONFIG_SYNCED', { service: 'Trello', action: 'Credentials synced from .env to Firestore' });
    
    console.log('✅ TRELLO CREDENTIALS SYNCED TO FIRESTORE');
    console.log('API Key:', apiKey.substring(0, 8) + '...');
    console.log('Token:', token.substring(0, 8) + '...');
  } catch (error) {
    console.error('ERROR:', error.message);
  } finally {
    process.exit();
  }
}

syncTrelloCredentials();