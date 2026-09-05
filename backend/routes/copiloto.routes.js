/**
 * copiloto.routes.js — Co-Piloto conversacional fijo del panel derecho.
 *
 * GET  /api/proyectos/:id/copiloto/historial — historial completo del proyecto
 * POST /api/proyectos/:id/copiloto/chat      — envía un mensaje, recibe respuesta de Gemini/Modo Respaldo
 */
import { obtenerHistorial, chatConCopiloto } from '../services/CopilotoService.js';
import { requireByokOrExento } from '../middlewares/byokGate.js';
import { captureError } from '../config/sentry.config.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): err.status
      // presente = error controlado (ver CopilotoService.js, clase con
      // status=422), mensaje seguro para el cliente. Ausente = error no
      // controlado (500) — no exponer err.message crudo (ej. detalle de BD).
      console.error('[copiloto]', err.message);
      captureError(err, { route: 'copiloto', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerCopilotoRoutes(app, { authenticateToken, getRow, getRows, aiLimiter }) {
  const byokGate = requireByokOrExento({ getRow, getRows });

  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.get('/api/proyectos/:id/copiloto/historial', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const historial = await obtenerHistorial(req.params.id, req.userId);
    res.json({ success: true, data: historial });
  }));

  // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 6): antes usaba
  // financialPipelineLimiter (20/15min = 80/hora efectivo), reservado para
  // cómputo pesado no-IA (extracción de Excel, cálculos deterministas) — el
  // único de sus consumidores que realmente invoca Gemini es este endpoint.
  // Confirmado en vivo: bloqueo exacto en el mensaje #21 de 25 disparados,
  // 4x más laxo que aiLimiter (20/hora), el limiter real usado en los otros
  // ~12 endpoints de IA del sistema.
  app.post('/api/proyectos/:id/copiloto/chat', authenticateToken, aiLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { mensaje, moduloActivo } = req.body || {};
    const resultado = await chatConCopiloto(req.params.id, req.userId, { mensaje, moduloActivo, userGeminiKeys: req.userGeminiKeys });
    res.status(201).json({ success: true, data: resultado });
  }));
}
