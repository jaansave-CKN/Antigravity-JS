/**
 * estresFinanciero.routes.js — Sprint 3: simulación de estrés macroeconómico
 * sobre el presupuesto real ya ingerido (project_apu_lineas).
 *
 * POST /api/proyectos/:id/estres-financiero — corre un nuevo escenario
 * GET  /api/proyectos/:id/estres-financiero — lista los escenarios ya corridos
 */
import { simularEscenario, listarEscenarios } from '../services/EstresadoFinancieroService.js';
import { captureError } from '../config/sentry.config.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): mismo criterio
      // que copiloto.routes.js — err.status presente = mensaje controlado y
      // seguro (ver EstresadoFinancieroService.js, status=422); ausente = no
      // exponer err.message crudo.
      console.error('[estresFinanciero]', err.message);
      captureError(err, { route: 'estresFinanciero', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerEstresFinancieroRoutes(app, { authenticateToken, getRow, financialPipelineLimiter }) {
  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/estres-financiero', authenticateToken, financialPipelineLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { nombreEscenario, porcentajeIncremento } = req.body || {};
    const resultado = await simularEscenario(req.params.id, req.userId, { nombreEscenario, porcentajeIncremento });
    res.status(201).json({ success: true, data: resultado });
  }));

  app.get('/api/proyectos/:id/estres-financiero', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const data = await listarEscenarios(req.params.id, req.userId);
    res.json({ success: true, data });
  }));
}
