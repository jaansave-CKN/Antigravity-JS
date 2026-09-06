/**
 * exportacion.routes.js — Fase 5: Exportación a MGA / BID / OXI
 * Compone los datos reales ya persistidos (ficha_tecnica, objetivos_arbol,
 * project_indicators, project_change_theory, presupuesto, config_logistica)
 * en documentos PDF descargables — ver backend/services/exportGenerator.js.
 */
import { generarMGA, generarBID, generarOXI } from '../services/exportGenerator.js';
import { withTenantRow, withTenantRows } from '../config/database.config.js';

function safeJson(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export function registerExportacionRoutes(app, { authenticateToken, tryCatch }) {
  async function cargarContexto(proyectoId, userId) {
    const proyecto = await withTenantRow(userId, 'SELECT * FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
    if (!proyecto) return null;
    const [arbol, indicadores, tdcRow, logistica] = await Promise.all([
      withTenantRows(userId, 'SELECT tipo, nivel, texto, parent_id, supuestos FROM objetivos_arbol WHERE proyecto_id = ? ORDER BY nivel ASC', [proyectoId]),
      withTenantRows(userId, 'SELECT nombre, tipo, linea_base, meta_total, unidad_medida, fuente_verificacion FROM project_indicators WHERE project_id = ?', [proyectoId]),
      withTenantRow(userId, 'SELECT insumos, actividades, productos, resultados_corto_plazo, impacto_largo_plazo FROM project_change_theory WHERE proyecto_id = ?', [proyectoId]),
      withTenantRow(userId, 'SELECT proponente_nombre, tipo_entidad, departamento, municipio, duracion_meses FROM config_logistica WHERE proyecto_id = ? AND user_id = ?', [proyectoId, userId]),
    ]);
    const tdc = tdcRow ? { ...tdcRow, resultados_corto_plazo: safeJson(tdcRow.resultados_corto_plazo, []) } : null;
    return { proyecto, arbol, indicadores, tdc, logistica };
  }

  function sendPdf(res, buffer, filename) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  // Motor de Diagramación ISO 9000 (2026-08-17): graficos = [{svg, titulo}]
  // ya renderizados en el navegador — solo llega por POST (GET no soporta
  // body HTTP de forma confiable, y un SVG puede pesar varios KB). El GET
  // se conserva intacto para no romper enlaces de descarga existentes.
  function graficosDe(req) {
    return Array.isArray(req.body?.graficos) ? req.body.graficos : [];
  }

  app.get('/api/proyectos/:id/exportar/mga', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarMGA(ctx.proyecto, ctx.arbol, ctx.indicadores, ctx.tdc, ctx.logistica);
    sendPdf(res, buffer, `MGA_${req.params.id}.pdf`);
  }));
  app.post('/api/proyectos/:id/exportar/mga', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarMGA(ctx.proyecto, ctx.arbol, ctx.indicadores, ctx.tdc, ctx.logistica, graficosDe(req));
    sendPdf(res, buffer, `MGA_${req.params.id}.pdf`);
  }));

  app.get('/api/proyectos/:id/exportar/bid', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarBID(ctx.proyecto, ctx.arbol, ctx.indicadores);
    sendPdf(res, buffer, `BID_${req.params.id}.pdf`);
  }));
  app.post('/api/proyectos/:id/exportar/bid', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarBID(ctx.proyecto, ctx.arbol, ctx.indicadores, graficosDe(req));
    sendPdf(res, buffer, `BID_${req.params.id}.pdf`);
  }));

  app.get('/api/proyectos/:id/exportar/oxi', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarOXI(ctx.proyecto, ctx.arbol, ctx.indicadores, ctx.tdc, ctx.logistica);
    sendPdf(res, buffer, `OXI_${req.params.id}.pdf`);
  }));
  app.post('/api/proyectos/:id/exportar/oxi', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarOXI(ctx.proyecto, ctx.arbol, ctx.indicadores, ctx.tdc, ctx.logistica, graficosDe(req));
    sendPdf(res, buffer, `OXI_${req.params.id}.pdf`);
  }));
}
