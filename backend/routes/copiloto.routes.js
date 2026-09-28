/**
 * copiloto.routes.js — Co-Piloto conversacional fijo del panel derecho.
 *
 * GET  /api/proyectos/:id/copiloto/historial — historial completo del proyecto
 * POST /api/proyectos/:id/copiloto/chat      — envía un mensaje, recibe la respuesta de la IA (llmProveedor.js)
 */
import { obtenerHistorial, chatConCopiloto } from '../services/CopilotoService.js';
import { captureError } from '../config/sentry.config.js';
import { withTenantRow } from '../config/database.config.js';
import { validarBody, copilotoChatSchema } from '../validators/zodSchemas.js';

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
      // B1 (2026-09-28): IA_NO_DISPONIBLE (503) / IA_TOPE_AGOTADO (429) de
      // llmProveedor — code y retryAt viajan al cliente; nada se guardó.
      if (err.code === 'IA_NO_DISPONIBLE') res.set('X-RF-No-Retry', '1');
      const body = { success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' };
      if (err.code) body.code = err.code;
      if (err.retryAt) body.retryAt = new Date(err.retryAt).toISOString();
      res.status(err.status || 500).json(body);
    }
  };
}

export async function registerCopilotoRoutes(app, { authenticateToken, requireAccess, aiLimiter }) {

  // obtenerHistorial/chatConCopiloto (CopilotoService.js) ya usan withTenant()
  // internamente -- este checkOwnership era el único punto crudo del archivo.
  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
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
  // B1/B6 (2026-09-28): requireAccess('formulador') — sin el gate BYOK, este
  // endpoint consumiría IA pagada por el servidor para cualquier usuario
  // autenticado aunque no tenga plan Formulador.
  app.post('/api/proyectos/:id/copiloto/chat', authenticateToken, requireAccess('formulador'), aiLimiter, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const validacionChat = validarBody(copilotoChatSchema, req.body);
    if (!validacionChat.ok) return res.status(400).json({ success: false, message: validacionChat.message });
    const { mensaje, moduloActivo } = validacionChat.data;
    const resultado = await chatConCopiloto(req.params.id, req.userId, { mensaje, moduloActivo });
    res.status(201).json({ success: true, data: resultado });
  }));
}
