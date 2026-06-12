/**
 * credentialVault.js — Bünker de Credenciales con AES-256-GCM
 *
 * GARANTÍAS DE SEGURIDAD:
 *   · Cifrado AES-256-GCM: autenticado, evita tampering silencioso
 *   · IV de 12 bytes (NIST SP 800-38D para GCM): único por operación
 *   · ENCRYPTION_KEY leída únicamente desde env — nunca de evento o payload
 *   · Descifrado ocurre solo en memoria, en el momento de uso (no en BD)
 *   · Versión de prefijo ("v1.") permite rotación futura de esquema sin downtime
 *   · Fallo de descifrado retorna null (no lanza excepción en callers) — evita
 *     revelar estructura interna en logs de Inngest
 *
 * DDL REQUERIDO (ejecutar como migración antes de usar):
 *   CREATE TABLE IF NOT EXISTS user_credentials (
 *     id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     key_name        TEXT NOT NULL,
 *     encrypted_value TEXT NOT NULL,
 *     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     UNIQUE (user_id, key_name)
 *   );
 *   CREATE INDEX idx_user_credentials_user ON user_credentials(user_id);
 *
 * USO:
 *   import { storeApiKey, retrieveApiKey } from '../services/credentialVault.js';
 *
 *   // Cifrar y guardar
 *   await storeApiKey(userId, 'google_api_key', plaintextKey, { runSql });
 *
 *   // Recuperar y descifrar (solo en memoria)
 *   const key = await retrieveApiKey(userId, 'google_api_key', { getRow });
 */

import crypto from 'node:crypto';

const ALGO        = 'aes-256-gcm';
const IV_LEN      = 12;   // NIST GCM: 96 bits es el tamaño estándar
const TAG_LEN     = 16;   // GCM auth tag: 128 bits
const VERSION_PREFIX = 'v1';

// ── Derivación de clave maestra desde variable de entorno ────────────────────
function getMasterKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('VAULT_ERROR: ENCRYPTION_KEY no configurada en el entorno');
  }
  if (raw.length < 32) {
    throw new Error('VAULT_ERROR: ENCRYPTION_KEY debe tener al menos 32 caracteres');
  }
  // SHA-256 del env var para obtener exactamente 32 bytes de clave
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

// ── encrypt ──────────────────────────────────────────────────────────────────
/**
 * Cifra un texto plano usando AES-256-GCM.
 * @param {string} plaintext
 * @returns {string} Formato: "v1.<base64url(iv|tag|ciphertext)>"
 * @throws si ENCRYPTION_KEY no está configurada o el input es inválido
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext.trim()) {
    throw new Error('VAULT_ERROR: plaintext vacío o inválido');
  }

  const key    = getMasterKey();
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  // Layout compacto: [iv(12)] [tag(16)] [ciphertext(variable)]
  const blob = Buffer.concat([iv, tag, enc]).toString('base64url');
  return `${VERSION_PREFIX}.${blob}`;
}

// ── decrypt ──────────────────────────────────────────────────────────────────
/**
 * Descifra un ciphertext producido por encrypt().
 * @param {string} ciphertext — "v1.<base64url>"
 * @returns {string} plaintext original
 * @throws si la integridad GCM falla (tampering detectado)
 */
export function decrypt(ciphertext) {
  if (typeof ciphertext !== 'string') {
    throw new Error('VAULT_ERROR: ciphertext inválido (no es string)');
  }

  const dot = ciphertext.indexOf('.');
  if (dot === -1) {
    throw new Error('VAULT_ERROR: formato de ciphertext sin prefijo de versión');
  }

  const blob = ciphertext.slice(dot + 1);
  const key  = getMasterKey();
  const buf  = Buffer.from(blob, 'base64url');

  const minLen = IV_LEN + TAG_LEN + 1;
  if (buf.length < minLen) {
    throw new Error(`VAULT_ERROR: ciphertext demasiado corto (${buf.length} < ${minLen})`);
  }

  const iv  = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  // GCM verifica la integridad aquí — lanza si hay tampering
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

// ── storeApiKey ──────────────────────────────────────────────────────────────
/**
 * Cifra y persiste una API key de usuario en BD.
 * Upsert por (user_id, key_name) — sobrescribe si ya existe.
 *
 * @param {string}   userId       — UUID del usuario
 * @param {string}   keyName      — Identificador lógico (ej: 'google_api_key')
 * @param {string}   plaintextKey — Clave en claro; se cifra antes de guardar
 * @param {object}   db           — { runSql } de database.config.js
 */
export async function storeApiKey(userId, keyName, plaintextKey, { runSql }) {
  if (!userId)       throw new Error('VAULT_ERROR: userId es obligatorio');
  if (!keyName)      throw new Error('VAULT_ERROR: keyName es obligatorio');
  if (!plaintextKey) throw new Error('VAULT_ERROR: plaintextKey es obligatorio');

  const encrypted = encrypt(plaintextKey);

  await runSql(
    `INSERT INTO user_credentials (user_id, key_name, encrypted_value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, key_name)
     DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                   updated_at      = NOW()`,
    [userId, keyName, encrypted]
  );
}

// ── retrieveApiKey ───────────────────────────────────────────────────────────
/**
 * Recupera y descifra una API key de usuario desde BD.
 * El plaintext NUNCA se persiste — existe solo durante la ejecución en memoria.
 *
 * @param {string}   userId   — UUID del usuario
 * @param {string}   keyName  — Identificador lógico (ej: 'google_api_key')
 * @param {object}   db       — { getRow } de database.config.js
 * @returns {string|null}     — Plaintext descifrado, o null si no existe
 */
export async function retrieveApiKey(userId, keyName, { getRow }) {
  if (!userId || !keyName) return null;

  const row = await getRow(
    `SELECT encrypted_value
     FROM   user_credentials
     WHERE  user_id  = $1
       AND  key_name = $2`,
    [userId, keyName]
  );

  if (!row?.encrypted_value) return null;

  try {
    return decrypt(row.encrypted_value);
  } catch (err) {
    // Loguear sin exponer detalles del cipher — previene data leakage en logs
    console.error(`[credentialVault] Descifrado fallido user=${userId} key=${keyName}:`, err.message);
    return null;
  }
}

// ── deleteApiKey ─────────────────────────────────────────────────────────────
/**
 * Elimina una credencial cifrada de la BD (ej: cuando el usuario revoca su key).
 */
export async function deleteApiKey(userId, keyName, { runSql }) {
  if (!userId || !keyName) return;
  await runSql(
    `DELETE FROM user_credentials WHERE user_id = $1 AND key_name = $2`,
    [userId, keyName]
  );
}
