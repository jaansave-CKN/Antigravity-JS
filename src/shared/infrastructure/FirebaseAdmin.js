import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Path: src/shared/infrastructure/ -> ../../../config/serviceAccountKey.json
const serviceAccountPath = path.join(__dirname, '../../../config/serviceAccountKey.json');

// Corregido 2026-08-12: config/serviceAccountKey.json está en .gitignore (correcto,
// es un secreto) — pero por eso mismo nunca llega a Render vía git deploy. "Secret
// Files" de Render se descartó explícitamente por el usuario ("da problemas"). Vía
// primaria ahora: 3 variables de entorno sueltas (FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY), que sí viajan como cualquier otra
// env var de Render. El archivo local queda como fallback de desarrollo, no como
// requisito — así no hace falta tocar el flujo de trabajo local existente.
function credencialesDesdeEnv() {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) return null;
  return {
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    // Los paneles de variables de entorno no preservan saltos de línea reales en un
    // valor multilinea (la PEM key los pierde) — llegan como "\n" literales de 2
    // caracteres. Sin este reemplazo, admin.credential.cert() falla al parsear la
    // llave y el error es críptico ("Failed to parse private key").
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

if (!admin.apps.length) {
  const credencialesEnv = credencialesDesdeEnv();
  try {
    if (credencialesEnv) {
      admin.initializeApp({ credential: admin.credential.cert(credencialesEnv) });
      console.log('[FirebaseAdmin] SDK inicializado vía variables de entorno — proyecto:', credencialesEnv.projectId);
    } else {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('[FirebaseAdmin] SDK inicializado vía archivo local (fallback de desarrollo) — proyecto:', serviceAccount.project_id);
    }
  } catch (err) {
    console.warn('[FirebaseAdmin] No se pudo inicializar (ni variables de entorno ni archivo local):', err.message);
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
