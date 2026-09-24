/**
 * estresFinanciero.routes.js — Sprint 3: simulación de estrés macroeconómico
 * sobre el presupuesto real ya ingerido (project_apu_lineas).
 *
 * POST /api/proyectos/:id/estres-financiero — corre un nuevo escenario
 * GET  /api/proyectos/:id/estres-financiero — lista los escenarios ya corridos
 */
import { simularEscenario, listarEscenarios } from '../services/EstresadoFinancieroService.js';
import { captureError } from '../config/sentry.config.js';
import { withTenantRow } from '../config/database.config.js';
import { validarBody, estresFinancieroSchema } from '../validators/zodSchemas.js';

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

// RESTAURADO (F-11, 2026-09-24) desde 18bc775^ — borrado ese día por no tener
// interfaz; ahora lo consume /evaluacion-financiera (EvaluacionFinancieraPage).
// Cambios frente al original, pedidos por la fiscalización de architect:
// requireAccess('formulador') en ambas rutas (B1: PlanGate del frontend no
// protege la API) y 409 si el proyecto está Finalizado en el POST (B4, mismo
// criterio que POST /viabilidad-financiera, proyectos.routes.js).
export async function registerEstresFinancieroRoutes(app, { authenticateToken, requireAccess, financialPipelineLimiter }) {
  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, estado FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/estres-financiero', authenticateToken, requireAccess('formulador'), financialPipelineLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });

    const validacionEstres = validarBody(estresFinancieroSchema, req.body);
    if (!validacionEstres.ok) return res.status(400).json({ success: false, message: validacionEstres.message });
    const { nombreEscenario, porcentajeIncremento } = validacionEstres.data;
    const resultado = await simularEscenario(req.params.id, req.userId, { nombreEscenario, porcentajeIncremento });
    res.status(201).json({ success: true, data: resultado });
  }));

  app.get('/api/proyectos/:id/estres-financiero', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const data = await listarEscenarios(req.params.id, req.userId);
    res.json({ success: true, data });
  }));
}
