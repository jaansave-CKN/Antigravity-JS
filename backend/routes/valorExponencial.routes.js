/**
 * valorExponencial.routes.js — Sprint 4: SROI (ratio explícito) + mapeo ODS heurístico.
 *
 * POST /api/proyectos/:id/calcular-sroi   { ratioConversion } — obligatorio, sin default
 * GET  /api/proyectos/:id/impacto-social  — última métrica SROI + mapeo ODS vigente
 */
import { calcularSROI, calcularMapeoODS, obtenerImpactoSocial } from '../services/ValorExponencialService.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[valorExponencial]', err.message);
      res.status(err.status || 500).json({ success: false, message: err.message });
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

    const data = await obtenerImpactoSocial(req.params.id);
    res.json({ success: true, data });
  }));
}
