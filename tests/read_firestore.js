
import { db } from '../src/shared/infrastructure/FirebaseAdmin.js';

async function getTrelloConfig() {
  try {
    const doc = await db.collection('settings').doc('trello').get();
    if (doc.exists) {
      console.log('Trello Config in Firestore:');
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.log('Trello config not found in Firestore');
    }
  } catch (error) {
    console.error('Error reading Firestore:', error);
  } finally {
    process.exit();
  }
}

getTrelloConfig();
