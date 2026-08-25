/**
 * byokCredentials.routes.js — CRUD de llaves Gemini propias del usuario
 * (BYOK, migración 045). Reemplaza para este propósito a /api/credentials
 * (CredentialsPage.tsx / authGoogle.controller.js), que el Arquitecto
 * encontró funcionalmente roto para este caso de uso: GET /api/credentials
 * no existe (solo /api/credentials/status, que devuelve un booleano) y
 * POST /api/credentials ignora service/label y pisa la única fila de
 * user_credentials — tabla distinta, con su propio bug de constraint
 * documentado aparte (CLAUDE.md), no tocada por este cambio.
 *
 * GET    /api/credenciales/gemini        — exento + llaves propias (solo enmascaradas)
 * POST   /api/credenciales/gemini        — guarda/reemplaza la llave de un slot (1/2/3), con pre-flight real
 * DELETE /api/credenciales/gemini/:slot  — elimina la llave de un slot
 */
import {
  esExento,
  listarLlavesUsuario,
  guardarLlaveUsuario,
  eliminarLlaveUsuario,
} from '../services/byokService.js';
import { captureError } from '../config/sentry.config.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[byokCredentials]', err.message);
      captureError(err, { route: 'byokCredentials', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, code: err.code, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export function registerByokCredentialsRoutes(app, { authenticateToken, getRow, getRows, runSql, aiLimiter }) {
  app.get('/api/credenciales/gemini', authenticateToken, wrap(async (req, res) => {
    const exento = await esExento(req.userId, { getRow });
    const llaves = exento ? [] : await listarLlavesUsuario(req.userId, { getRows });
    res.json({
      success: true,
      data: {
        exento,
        llaves,
        has_active_key: llaves.some(l => l.is_valid),
      },
    });
  }));

  // FIX (auditoría PROTOCOLO 5x5, Fase 4 — Vector 4, 2026-08-22): este
  // endpoint hace una llamada de red real a Gemini en cada intento
  // (pre-flight de probarLlave, byokService.js) — sin límite, era un vector
  // abierto de saturación/proxy no throttled hacia la API de Google. Mismo
  // aiLimiter (20/h por usuario) ya usado en las 7 acciones de IA gateadas.
  app.post('/api/credenciales/gemini', authenticateToken, aiLimiter, wrap(async (req, res) => {
    const { key_slot, key, label } = req.body || {};
    if (!key_slot || !key) {
      return res.status(400).json({ success: false, message: 'key_slot y key son requeridos' });
    }
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const resultado = await guardarLlaveUsuario(req.userId, key_slot, key, label, ip, { runSql, getRow });
    res.status(201).json({ success: true, data: resultado });
  }));

  app.delete('/api/credenciales/gemini/:slot', authenticateToken, wrap(async (req, res) => {
    const slot = Number(req.params.slot);
    if (![1, 2, 3].includes(slot)) {
      return res.status(400).json({ success: false, message: 'slot debe ser 1, 2 o 3' });
    }
    await eliminarLlaveUsuario(req.userId, slot, { runSql });
    res.json({ success: true });
  }));
}
