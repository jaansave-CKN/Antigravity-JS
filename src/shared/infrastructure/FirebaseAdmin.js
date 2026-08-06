import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Path: src/shared/infrastructure/ -> ../../../config/serviceAccountKey.json
const serviceAccountPath = path.join(__dirname, '../../../config/serviceAccountKey.json');

if (!admin.apps.length) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[FirebaseAdmin] SDK inicializado — proyecto:', serviceAccount.project_id);
  } catch (err) {
    console.warn('[FirebaseAdmin] No se pudo inicializar con serviceAccount:', err.message);
    console.warn('[FirebaseAdmin] Sin credenciales válidas: verifyIdToken() fallará y el middleware rechazará TODAS las requests (fail-closed), no hay bypass.');
    try {
      admin.initializeApp();
    } catch (_) {
      // ya inicializado
    }
  }
}

export default admin;

let _db = null;
try { _db = admin.firestore(); } catch (err) {
  console.warn('[FirebaseAdmin] Firestore no disponible:', err.message);
}
export const db = _db;
