import admin from 'firebase-admin';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function testConnection() {
    try {
        console.log('Testing connection to AuditLogs collection in project:', serviceAccount.project_id);
        const docRef = await db.collection('AuditLogs').add({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action: 'Test Connection',
            status: 'Success',
            details: 'Testing explicit AuditLogs collection creation.'
        });
        console.log('Successfully wrote to AuditLogs with ID:', docRef.id);
        
        const snapshot = await db.collection('AuditLogs').limit(1).get();
        if (snapshot.empty) {
            console.log('Collection is empty (unexpected).');
        } else {
            console.log('Successfully read from AuditLogs.');
        }
        process.exit(0);
    } catch (error) {
        console.error('Error connecting to Firestore AuditLogs:', error);
        process.exit(1);
    }
}

testConnection();
