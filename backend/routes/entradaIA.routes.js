/**
 * entradaIA.routes.js — "Generar con AI" de la ventana Entrada (M1).
 *
 * POST /api/proyectos/:id/entrada/generar-ai — lee la carpeta "Investigación"
 * de Anexos del proyecto y devuelve valores sugeridos para el formulario de
 * Entrada. Nunca escribe en el proyecto/ficha técnica — el frontend decide
 * qué hacer con el resultado (EntradaPage.tsx solo llena los campos que el
 * usuario dejó vacíos, nunca sobrescribe lo que ya escribió). Sí persiste
 * (2026-08-22) una caché best-effort del texto ya extraído de cada anexo en
 * project_anexos.{link_texto_cache, archivo_texto_cache} — evita re-fetch/
 * re-parseo si el anexo no cambió desde la última generación.
 */
import { generarEntradaDesdeInvestigacion } from '../services/EntradaIAService.js';
import { captureError } from '../config/sentry.config.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[entradaIA]', err.message);
      captureError(err, { route: 'entradaIA', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export function registerEntradaIARoutes(app, { authenticateToken, getRow, getRows, runSql, requireAccess, aiLimiter }) {
  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/entrada/generar-ai', authenticateToken, requireAccess('formulador'), aiLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const data = await generarEntradaDesdeInvestigacion(req.params.id, req.userId, { getRow, getRows, runSql });
    res.json({ success: true, data });
  }));
}
