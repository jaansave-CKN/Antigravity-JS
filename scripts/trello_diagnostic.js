import 'dotenv/config';
import { db } from '../src/shared/infrastructure/FirebaseAdmin.js';
import { AuditLogger } from '../src/shared/infrastructure/AuditLogger.js';

const TRELLO_API_URL = 'https://api.trello.com/1/members/me/boards';

async function diagnoseTrello() {
  console.log('🔍 [TRELLO DIAGNOSTIC] Starting...');
  
  let apiKey = process.env.TRELLO_API_KEY;
  let token = process.env.TRELLO_TOKEN;

  if (!apiKey || !token) {
    console.log('❌ CREDENTIALS NOT FOUND IN .ENV');
    return { status: 'MISSING_ENV', action: 'ADD credentials to .env file' };
  }

  console.log(`📋 .env credentials loaded (key: ${apiKey.substring(0, 8)}...)`);

  const fsDoc = await db.collection('settings').doc('trello').get();
  if (fsDoc.exists) {
    apiKey = fsDoc.data().apiKey;
    token = fsDoc.data().token;
    console.log('📋 Firestore credentials loaded');
  }

  console.log('🧪 Testing Trello API...');
  
  try {
    const params = new URLSearchParams({ key: apiKey, token: token });
    const response = await fetch(`${TRELLO_API_URL}?${params}`);
    
    if (response.ok) {
      const boards = await response.json();
      console.log(`✅ TRELLO API CONNECTED - ${boards.length} boards found`);
      AuditLogger.log('TRELLO_DIAGNOSTIC', { status: 'SUCCESS', boards: boards.length });
      return { status: 'SUCCESS', boards: boards.length };
    } else {
      const error = await response.json();
      console.log(`❌ API ERROR: ${JSON.stringify(error)}`);
      console.log('💡 ACTION: Renew credentials at https://trello.com/app-key');
      AuditLogger.log('TRELLO_DIAGNOSTIC', { status: 'API_ERROR', error: error.message });
      return { status: 'API_ERROR', error: error.message, action: 'RENEW credentials at https://trello.com/app-key' };
    }
  } catch (err) {
    console.log(`❌ NETWORK ERROR: ${err.message}`);
    AuditLogger.log('TRELLO_DIAGNOSTIC', { status: 'NETWORK_ERROR', error: err.message });
    return { status: 'NETWORK_ERROR', error: err.message };
  }
}

async function fixCredentials(newApiKey, newToken) {
  if (!newApiKey || !newToken) {
    console.log('❌ Missing new credentials');
    return { success: false, error: 'API_KEY and TOKEN required' };
  }

  const envPath = './.env';
  const fs = await import('fs/promises');
  let envContent = await fs.readFile(envPath, 'utf-8');
  
  envContent = envContent.replace(/TRELLO_API_KEY=.*/g, `TRELLO_API_KEY=${newApiKey}`);
  envContent = envContent.replace(/TRELLO_TOKEN=.*/g, `TRELLO_TOKEN=${newToken}`);
  
  await fs.writeFile(envPath, envContent);
  console.log('✅ .env updated');

  await db.collection('settings').doc('trello').set({
    apiKey: newApiKey,
    token: newToken,
    updatedAt: new Date().toISOString()
  });
  console.log('✅ Firestore updated');

  AuditLogger.log('TRELLO_CREDENTIALS_FIXED', { timestamp: new Date().toISOString() });
  
  return { success: true };
}

diagnoseTrello();