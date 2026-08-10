/**
 * copiloto.routes.js — Co-Piloto conversacional fijo del panel derecho.
 *
 * GET  /api/proyectos/:id/copiloto/historial — historial completo del proyecto
 * POST /api/proyectos/:id/copiloto/chat      — envía un mensaje, recibe respuesta de Gemini/Modo Respaldo
 */
import { obtenerHistorial, chatConCopiloto } from '../services/CopilotoService.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): err.status
      // presente = error controlado (ver CopilotoService.js, clase con
      // status=422), mensaje seguro para el cliente. Ausente = error no
      // controlado (500) — no exponer err.message crudo (ej. detalle de BD).
      console.error('[copiloto]', err.message);
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerCopilotoRoutes(app, { authenticateToken, getRow, financialPipelineLimiter }) {
  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.get('/api/proyectos/:id/copiloto/historial', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const historial = await obtenerHistorial(req.params.id);
    res.json({ success: true, data: historial });
  }));

  app.post('/api/proyectos/:id/copiloto/chat', authenticateToken, financialPipelineLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { mensaje, moduloActivo } = req.body || {};
    const resultado = await chatConCopiloto(req.params.id, req.userId, { mensaje, moduloActivo });
    res.status(201).json({ success: true, data: resultado });
  }));
}
