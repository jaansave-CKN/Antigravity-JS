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
import { generarEntradaDesdeInvestigacion, generarCampoIndividual, generarProblematicasTerritorio, generarPosiblesSoluciones, generarNombreProyecto, generarPitchProyecto, CAMPOS_INDIVIDUALES } from '../services/EntradaIAService.js';
import { requireByokOrExento } from '../middlewares/byokGate.js';
import { captureError } from '../config/sentry.config.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[entradaIA]', err.message);
      captureError(err, { route: 'entradaIA', method: req.method, path: req.path, userId: req.userId });
      // retryAt (mandato 2026-08-24, "coloca un reloj con cuenta regresiva y
      // la hora exacta de reset"): se incluye en la respuesta cuando el error
      // lo trae (EntradaIAError propagado desde llamarGemini) para que el
      // frontend pueda mostrar el conteo real, no un "intenta en unos minutos"
      // genérico.
      const body = { success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' };
      if (err.retryAt) body.retryAt = new Date(err.retryAt).toISOString();
      res.status(err.status || 500).json(body);
    }
  };
}

export function registerEntradaIARoutes(app, { authenticateToken, getRow, getRows, runSql, requireAccess, aiLimiter, entradaCampoLimiter }) {
  const byokGate = requireByokOrExento({ getRow, getRows });

  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/entrada/generar-ai', authenticateToken, requireAccess('formulador'), aiLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const data = await generarEntradaDesdeInvestigacion(req.params.id, req.userId, { getRow, getRows, runSql, userGeminiKeys: req.userGeminiKeys });
    res.json({ success: true, data });
  }));

  // Botón ✨ individual (refactor 2026-08-22, mandato "flujo secuencial y
  // Campo C multi-componente") — reemplaza en la UI al botón global de
  // arriba para los 6 campos A,B,D,E,F,G. Body: { campo, contextoPrevio,
  // demografia: { beneficiarios, cobertura } }. Mismos gates que el bulk
  // (BYOK + ownership), limiter dedicado (30/h) en vez del aiLimiter global
  // compartido — ver comentario de entradaCampoLimiter en SecurityMiddleware.js.
  app.post('/api/proyectos/:id/entrada/generar-ai-campo', authenticateToken, requireAccess('formulador'), entradaCampoLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { campo, contextoPrevio, demografia } = req.body || {};
    if (!campo || !CAMPOS_INDIVIDUALES.includes(campo)) {
      return res.status(400).json({ success: false, message: `campo debe ser uno de: ${CAMPOS_INDIVIDUALES.join(', ')}` });
    }
    const data = await generarCampoIndividual(
      req.params.id, req.userId, campo,
      contextoPrevio && typeof contextoPrevio === 'object' ? contextoPrevio : {},
      demografia && typeof demografia === 'object' ? demografia : {},
      { getRows, runSql, userGeminiKeys: req.userGeminiKeys }
    );
    res.json({ success: true, data });
  }));

  // C1 del Campo C rediseñado — lista de problemáticas + déficit detectadas
  // en Anexos/Investigación. Esquema de array, endpoint separado a propósito
  // (ver revisión de architect: mezclar formas de respuesta en una sola ruta
  // es ambiguo). Body opcional: { demografia: { beneficiarios, cobertura } }.
  app.post('/api/proyectos/:id/entrada/generar-ai-problematicas', authenticateToken, requireAccess('formulador'), entradaCampoLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { demografia } = req.body || {};
    const data = await generarProblematicasTerritorio(
      req.params.id, req.userId,
      demografia && typeof demografia === 'object' ? demografia : {},
      { getRows, runSql, userGeminiKeys: req.userGeminiKeys }
    );
    res.json({ success: true, data });
  }));

  // Sección 11 "Soluciones con AI" — hasta 9 propuestas candidatas (la 10ª
  // la escribe el usuario a mano en el frontend, este endpoint nunca la ve).
  // Mismo patrón/gates que generar-ai-problematicas (array de salida). Body:
  // { contextoPrevio, demografia: { beneficiarios, cobertura, tipoFormulacion } }.
  app.post('/api/proyectos/:id/entrada/generar-ai-soluciones', authenticateToken, requireAccess('formulador'), entradaCampoLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { contextoPrevio, demografia } = req.body || {};
    const data = await generarPosiblesSoluciones(
      req.params.id, req.userId,
      contextoPrevio && typeof contextoPrevio === 'object' ? contextoPrevio : {},
      demografia && typeof demografia === 'object' ? demografia : {},
      { getRows, runSql, userGeminiKeys: req.userGeminiKeys }
    );
    res.json({ success: true, data });
  }));

  // "Generar con AI" del campo Nombre del Proyecto (mandato 2026-08-24) —
  // combina Diálectica (motor_dialectico) + Evaluación de Impacto Integral
  // (scoringDinamico) + lo ya escrito en Entrada. A diferencia de las rutas
  // de arriba, NO depende de la carpeta Anexos/Investigación — ver
  // EntradaIAService.js::generarNombreProyecto. Body:
  // { contextoPrevio, problematica: {problema, deficit_valor, deficit_unidad},
  //   demografia: { beneficiarios, cobertura, tipoFormulacion } }.
  app.post('/api/proyectos/:id/entrada/generar-ai-nombre', authenticateToken, requireAccess('formulador'), entradaCampoLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { contextoPrevio, problematica, demografia } = req.body || {};
    const data = await generarNombreProyecto(
      req.params.id, req.userId,
      {
        contextoPrevio: contextoPrevio && typeof contextoPrevio === 'object' ? contextoPrevio : {},
        problematica: problematica && typeof problematica === 'object' ? problematica : null,
        demografia: demografia && typeof demografia === 'object' ? demografia : {},
      },
      { getRow, getRows, userGeminiKeys: req.userGeminiKeys }
    );
    res.json({ success: true, data });
  }));

  // "Generar con AI" del campo Pitch (mandato 2026-08-24, debajo de Nombre
  // del Proyecto) — mismas fuentes/gates que generar-ai-nombre, párrafo
  // persuasivo en vez de título. Body idéntico a generar-ai-nombre.
  app.post('/api/proyectos/:id/entrada/generar-ai-pitch', authenticateToken, requireAccess('formulador'), entradaCampoLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { contextoPrevio, problematica, demografia } = req.body || {};
    const data = await generarPitchProyecto(
      req.params.id, req.userId,
      {
        contextoPrevio: contextoPrevio && typeof contextoPrevio === 'object' ? contextoPrevio : {},
        problematica: problematica && typeof problematica === 'object' ? problematica : null,
        demografia: demografia && typeof demografia === 'object' ? demografia : {},
      },
      { getRow, getRows, userGeminiKeys: req.userGeminiKeys }
    );
    res.json({ success: true, data });
  }));
}
