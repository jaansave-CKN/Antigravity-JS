/**
 * valorExponencial.routes.js — Sprint 4: SROI (ratio explícito) + mapeo ODS heurístico.
 *
 * POST /api/proyectos/:id/calcular-sroi   { ratioConversion } — obligatorio, sin default
 * GET  /api/proyectos/:id/impacto-social  — última métrica SROI + mapeo ODS vigente
 */
import { calcularSROI, calcularMapeoODS, obtenerImpactoSocial } from '../services/ValorExponencialService.js';
import { captureError } from '../config/sentry.config.js';
import { withTenantRow } from '../config/database.config.js';
import { validarBody, sroiSchema } from '../validators/zodSchemas.js';

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

// RESTAURADO (F-11, 2026-09-24) desde 18bc775^ — mismos cambios que
// estresFinanciero.routes.js: requireAccess('formulador') (B1) y 409 si el
// proyecto está Finalizado en el POST (B4). Lo consume /evaluacion-financiera.
export async function registerValorExponencialRoutes(app, { authenticateToken, requireAccess, financialPipelineLimiter }) {
  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, estado FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/calcular-sroi', authenticateToken, requireAccess('formulador'), financialPipelineLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });

    const validacionSroi = validarBody(sroiSchema, req.body);
    if (!validacionSroi.ok) return res.status(400).json({ success: false, message: validacionSroi.message });
    const sroi = await calcularSROI(req.params.id, req.userId, { ratioConversion: validacionSroi.data.ratioConversion });
    const ods = await calcularMapeoODS(req.params.id, req.userId);
    res.status(201).json({ success: true, data: { sroi, ods } });
  }));

  app.get('/api/proyectos/:id/impacto-social', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const data = await obtenerImpactoSocial(req.params.id, req.userId);
    res.json({ success: true, data });
  }));
}
