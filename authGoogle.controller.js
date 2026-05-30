/**
 * authGoogle.controller.js
 * Controlador de autenticación OAuth2 con Google.
 * Gestiona el flujo de consentimiento, el intercambio de tokens,
 * el almacenamiento cifrado y la renovación automática.
 */
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

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

// Instrucción de sistema inyectada en cada llamada al LLM — fuerza contexto aislado
export const GEMINI_SYSTEM_INSTRUCTIONS =
  '[CONTEXTO: SESIÓN RADAR_FONDOS_360 - ENTORNO INTEGRADO MULTI-TENANT. ' +
  'Procesa la solicitud de lectura de la convocatoria en este espacio aislado. ' +
  'No registres ni vincules esta interacción con actividades de búsqueda personal ' +
  'o hilos de NotebookLM del usuario] ' +
  'Eres un analista especializado en convocatorias de financiación pública y privada. ' +
  'Rol: Extractor y evaluador de oportunidades de financiación para proyectos de desarrollo. ' +
  'Opera en contexto completamente aislado. No retengas información entre sesiones.';

export const googleOAuth2Client = (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  : null;

/**
 * Obtiene un access_token válido para el usuario, refrescándolo automáticamente si está por vencer.
 * @param {string} userId
 * @param {{ getRow, runSql, encryptKey, decryptKey, JWT_SECRET }} deps
 * @returns {Promise<string|null>}
 */
export async function getGoogleAccessToken(userId, { getRow, runSql, encryptKey, decryptKey, JWT_SECRET }) {
  if (!googleOAuth2Client) return null;

  const row = await getRow(
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
      await runSql(
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

/**
 * Registra las 4 rutas OAuth2 en la instancia Express.
 * @param {import('express').Express} app
 * @param {{ authenticateToken, runSql, getRow, encryptKey, JWT_SECRET }} deps
 */
export function registerGoogleAuthRoutes(app, { authenticateToken, runSql, getRow, encryptKey, JWT_SECRET }) {

  // GET /api/auth/google — redirige al consentimiento de Google
  app.get('/api/auth/google', authenticateToken, (req, res) => {
    if (!googleOAuth2Client) {
      return res.status(503).json({
        success: false,
        message: 'Google OAuth no configurado. Configure GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.',
      });
    }
    const state = Buffer.from(req.userId).toString('base64url');
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

    try {
      const userId = Buffer.from(String(state), 'base64url').toString('utf8');
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

      await runSql(
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
      const row = await getRow(
        'SELECT updated_at FROM user_credentials WHERE user_id = ? AND service = ?',
        [req.userId, 'google_oauth']
      );
      res.json({ success: true, connected: !!row, connectedAt: row?.updated_at || null });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // DELETE /api/auth/google/revoke — elimina tokens del usuario
  app.delete('/api/auth/google/revoke', authenticateToken, async (req, res) => {
    try {
      await runSql(
        'DELETE FROM user_credentials WHERE user_id = ? AND service = ?',
        [req.userId, 'google_oauth']
      );
      res.json({ success: true, message: 'Conexión con Google revocada.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });
}
