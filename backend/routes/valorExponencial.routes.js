/**
 * valorExponencial.routes.js — Sprint 4: SROI (ratio explícito) + mapeo ODS heurístico.
 *
 * POST /api/proyectos/:id/calcular-sroi   { ratioConversion } — obligatorio, sin default
 * GET  /api/proyectos/:id/impacto-social  — última métrica SROI + mapeo ODS vigente
 */
import { calcularSROI, calcularMapeoODS, obtenerImpactoSocial } from '../services/ValorExponencialService.js';
import { captureError } from '../config/sentry.config.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): mismo criterio
      // que copiloto.routes.js — err.status presente = mensaje controlado y
      // seguro (ver ValorExponencialService.js, status=422); ausente = no
      // exponer err.message crudo.
      console.error('[valorExponencial]', err.message);
      captureError(err, { route: 'valorExponencial', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerValorExponencialRoutes(app, { authenticateToken, getRow, financialPipelineLimiter }) {
  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/calcular-sroi', authenticateToken, financialPipelineLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const sroi = await calcularSROI(req.params.id, req.userId, { ratioConversion: req.body?.ratioConversion });
    const ods = await calcularMapeoODS(req.params.id, req.userId);
    res.status(201).json({ success: true, data: { sroi, ods } });
  }));

  app.get('/api/proyectos/:id/impacto-social', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const data = await obtenerImpactoSocial(req.params.id, req.userId);
    res.json({ success: true, data });
  }));
}
