import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function deriveKey(masterKey) {
  return crypto.createHash('sha256').update(String(masterKey)).digest();
}

export function encryptKey(plaintext, masterKey) {
  const key = deriveKey(masterKey);
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc  = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  // Layout: [iv(16)] [tag(16)] [ciphertext]
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptKey(ciphertext, masterKey) {
  const key = deriveKey(masterKey);
  const buf = Buffer.from(ciphertext, 'base64');
  const iv  = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const enc = buf.subarray(32);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc).toString('utf8') + decipher.final('utf8');
}

export function maskKey(plaintext) {
  if (!plaintext || plaintext.length < 8) return '****';
  return plaintext.slice(0, 6) + '••••••••' + plaintext.slice(-4);
}
