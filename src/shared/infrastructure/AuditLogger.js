import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './FirebaseAdmin.js';
import { capturarEnSentry } from './SentryMonitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const LOG_DIR    = path.join(__dirname, '../../../logs');
const LOG_FILE   = path.join(LOG_DIR, 'audit.log');

// Respaldo local append-only — nunca se reescribe ni se borra una línea ya escrita.
function appendLocal(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[AuditLogger] No se pudo escribir el respaldo local:', err.message);
  }
}

export const AuditLogger = {
  log(event, data = {}) {
    const entry = { event, data, timestamp: new Date().toISOString() };

    appendLocal(entry);

    // Reenvío a Sentry — AuditLogger ya decide qué es un error por el nombre
    // del evento (convención *_ERROR ya usada en todo el código, ej.
    // CLAUDE_CHAT_ERROR); esto no duplica esa decisión, solo la propaga a
    // donde alguien realmente se entera sin ir a revisar logs a mano.
    if (event.endsWith('_ERROR')) {
      capturarEnSentry(event, data);
    }

    if (db) {
      db.collection('audit_logs').add(entry).catch(err => {
        console.error('[AuditLogger] Firestore write falló, queda solo el respaldo local:', err.message);
      });
    } else {
      console.error('[AuditLogger] Firestore no disponible (admin sin credenciales) — queda solo el respaldo local.');
    }
  }
};
