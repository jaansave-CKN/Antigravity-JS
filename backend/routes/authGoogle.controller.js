/**
 * authGoogle.controller.js
 * Controlador de autenticación OAuth2 con Google.
 * Gestiona el flujo de consentimiento, el intercambio de tokens,
 * el almacenamiento cifrado y la renovación automática.
 */
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import { withTenantRow, withTenantRun } from '../config/database.config.js';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  || 'http://localhost:3000/api/auth/google/callback';
const FRONTEND_URL         = process.env.FRONTEND_URL         || 'http://localhost:5173';

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/generative-language',
];

export const googleOAuth2Client = (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  : null;

/**
 * Obtiene un access_token válido para el usuario, refrescándolo automáticamente si está por vencer.
 *
 * NOTA (Fase 3 Lote 2, 2026-09-06): esta función no tiene ningún caller real
 * en el repo (verificado con grep -rn "getGoogleAccessToken(" — solo aparece
 * su propia definición; server.js la importa en la línea 24 pero nunca la
 * invoca). Se migra igual a withTenant* por consistencia del archivo y
 * porque toca user_credentials, pero es código muerto hoy.
 *
 * @param {string} userId
 * @param {{ encryptKey, decryptKey, JWT_SECRET }} deps
 * @returns {Promise<string|null>}
 */
export async function getGoogleAccessToken(userId, { encryptKey, decryptKey, JWT_SECRET }) {
  if (!googleOAuth2Client) return null;

  const row = await withTenantRow(userId,
    'SELECT encrypted_key FROM user_credentials WHERE user_id = ? AND service = ?',
    [userId, 'google_oauth']
  );
  if (!row) return null;

  try {
    const tokens = JSON.parse(decryptKey(row.encrypted_key, JWT_SECRET));

    if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
      googleOAuth2Client.setCredentials(tokens);
      const { credentials } = await googleOAuth2Client.refreshAccessToken();
      const updated = JSON.stringify({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token || tokens.refresh_token,
        expiry_date: credentials.expiry_date,
      });
      const encrypted = encryptKey(updated, JWT_SECRET);
      const now = new Date().toISOString();
      await withTenantRun(userId,
        'UPDATE user_credentials SET encrypted_key=?, updated_at=? WHERE user_id=? AND service=?',
        [encrypted, now, userId, 'google_oauth']
      );
      return credentials.access_token;
    }

    return tokens.access_token;
  } catch (err) {
    console.error('[getGoogleAccessToken]', err.message);
    return null;
  }
}

// FIX (auditoría PROTOCOLO 5x5 2026-08-22, Vector 2, hallazgo #1): el
// `state` era `base64url(userId)` sin firmar ni atado a sesión — cualquiera
// que completara SU PROPIO consentimiento de Google podía llamar al
// callback con `state=base64url(uuid_de_otro_usuario)` y sobreescribir las
// credenciales OAuth de la víctima con las del atacante. Ahora el state
// lleva una firma HMAC (con JWT_SECRET, ya inyectado como dependencia de
// este módulo) atada al userId y a un timestamp de expiración corta (10 min
// — el flujo real de consentimiento de Google completa en segundos) — sin
// conocer JWT_SECRET no se puede forjar un state válido para otro usuario.
function firmarState(userId, JWT_SECRET) {
  const payload = `${userId}.${Date.now()}`;
  const firma = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${firma}`).toString('base64url');
}

function verificarState(state, JWT_SECRET) {
  let decoded;
  try { decoded = Buffer.from(String(state), 'base64url').toString('utf8'); }
  catch { return null; }

  const partes = decoded.split('.');
  if (partes.length !== 3) return null;
  const [userId, ts, firma] = partes;
  if (!userId || !ts || !firma) return null;

  const esperada = crypto.createHmac('sha256', JWT_SECRET).update(`${userId}.${ts}`).digest('base64url');
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(ts) > 10 * 60_000) return null; // expiración: 10 min

  return userId;
}

/**
 * Registra las 4 rutas OAuth2 en la instancia Express.
 * @param {import('express').Express} app
 * @param {{ authenticateToken, encryptKey, JWT_SECRET }} deps
 */
export function registerGoogleAuthRoutes(app, { authenticateToken, encryptKey, JWT_SECRET }) {

  // GET /api/auth/google — redirige al consentimiento de Google
  app.get('/api/auth/google', authenticateToken, (req, res) => {
    if (!googleOAuth2Client) {
      return res.status(503).json({
        success: false,
        message: 'Google OAuth no configurado. Configure GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.',
      });
    }
    const state = firmarState(req.userId, JWT_SECRET);
    const authUrl = googleOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_OAUTH_SCOPES,
      state,
      prompt: 'consent',
    });
    res.redirect(authUrl);
  });

  // GET /api/auth/google/callback — recibe code de Google, guarda tokens cifrados
  app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(
        `${FRONTEND_URL}/apis?status=error&reason=${encodeURIComponent(String(error))}`
      );
    }
    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/apis?status=error&reason=invalid_request`);
    }

    const userId = verificarState(state, JWT_SECRET);
    if (!userId) {
      return res.redirect(`${FRONTEND_URL}/apis?status=error&reason=invalid_state`);
    }

    try {
      const { tokens } = await googleOAuth2Client.getToken(String(code));

      // Serializa y cifra tokens antes de persistir
      const tokenJson = JSON.stringify({
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date:   tokens.expiry_date,
      });
      const encrypted = encryptKey(tokenJson, JWT_SECRET);
      const id  = crypto.randomUUID();
      const now = new Date().toISOString();

      await withTenantRun(userId,
        `INSERT INTO user_credentials (id, user_id, service, encrypted_key, label, created_at, updated_at)
         VALUES (?, ?, 'google_oauth', ?, 'Google OAuth2 — Radar Fondos 360', ?, ?)
         ON CONFLICT(user_id, service)
         DO UPDATE SET encrypted_key=excluded.encrypted_key, updated_at=excluded.updated_at`,
        [id, userId, encrypted, now, now]
      );

      res.redirect(`${FRONTEND_URL}/apis?status=success`);
    } catch (err) {
      console.error('[google-oauth callback]', err.message);
      res.redirect(`${FRONTEND_URL}/apis?status=error&reason=server_error`);
    }
  });

  // GET /api/auth/google/status — devuelve si el usuario ya tiene tokens vinculados
  app.get('/api/auth/google/status', authenticateToken, async (req, res) => {
    try {
      const row = await withTenantRow(req.userId,
        'SELECT updated_at FROM user_credentials WHERE user_id = ? AND service = ?',
        [req.userId, 'google_oauth']
      );
      res.json({ success: true, connected: !!row, connectedAt: row?.updated_at || null });
    } catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): no exponer
      // err.message crudo al cliente.
      console.error('[google-oauth status]', err.message);
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  });

  // DELETE /api/auth/google/revoke — elimina tokens del usuario
  app.delete('/api/auth/google/revoke', authenticateToken, async (req, res) => {
    try {
      await withTenantRun(req.userId,
        'DELETE FROM user_credentials WHERE user_id = ? AND service = ?',
        [req.userId, 'google_oauth']
      );
      res.json({ success: true, message: 'Conexión con Google revocada.' });
    } catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): no exponer
      // err.message crudo al cliente.
      console.error('[google-oauth revoke]', err.message);
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  });
}
