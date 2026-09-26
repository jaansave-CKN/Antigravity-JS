/**
 * exportacion.routes.js — Fase 5: Exportación a MGA / BID / OXI
 * Compone los datos reales ya persistidos (ficha_tecnica, objetivos_arbol,
 * project_indicators, project_change_theory, presupuesto, config_logistica)
 * en documentos PDF descargables — ver backend/services/exportGenerator.js.
 */
import { generarMGA, generarBID, generarOXI } from '../services/exportGenerator.js';
import { withTenantRow, withTenantRows } from '../config/database.config.js';
import { validarBody, exportarGraficosSchema } from '../validators/zodSchemas.js';
import { recolectarFuentes, huellaFuentes } from '../services/formuladorMga.js';

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

  // Fase 3 (B5): última consolidación 'ok' del Formulador MGA (tabla propia,
  // migración 072: solo escribe el servidor) + si quedó desactualizada frente
  // a los datos actuales, recalculando la huella. Best-effort: un fallo aquí
  // nunca bloquea la exportación del PDF (se omite la sección).
  async function consolidacionParaPdf(proyecto, userId) {
    try {
      const fila = await withTenantRow(userId,
        "SELECT bloques, huella_fuentes, modelo, created_at FROM project_formulador_mga WHERE project_id = ? AND estado = 'ok' ORDER BY created_at DESC LIMIT 1", [proyecto.id]);
      if (!fila) return null;
      const { datos } = await recolectarFuentes(proyecto, {
        getRow: (sql, params) => withTenantRow(userId, sql, params),
        getRows: (sql, params) => withTenantRows(userId, sql, params),
      });
      return { bloques: safeJson(fila.bloques, null), modelo: fila.modelo, generado_en: fila.created_at, desactualizada: huellaFuentes(datos) !== fila.huella_fuentes };
    } catch (e) {
      console.warn('[exportacion] consolidación MGA omitida del PDF:', e.message);
      return null;
    }
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
  // Best-effort a propósito: un payload de graficos malformado nunca debe
  // bloquear la exportación del PDF (los datos reales del proyecto ya se
  // cargaron en cargarContexto) — se descarta en silencio, mismo criterio
  // que el `Array.isArray` original.
  function graficosDe(req) {
    const validacion = validarBody(exportarGraficosSchema, req.body);
    return validacion.ok ? (validacion.data.graficos || []) : [];
  }

  app.get('/api/proyectos/:id/exportar/mga', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarMGA(ctx.proyecto, ctx.arbol, ctx.indicadores, ctx.tdc, ctx.logistica, { consolidacion: await consolidacionParaPdf(ctx.proyecto, req.userId) });
    sendPdf(res, buffer, `MGA_${req.params.id}.pdf`);
  }));
  app.post('/api/proyectos/:id/exportar/mga', authenticateToken, tryCatch(async (req, res) => {
    const ctx = await cargarContexto(req.params.id, req.userId);
    if (!ctx) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const buffer = await generarMGA(ctx.proyecto, ctx.arbol, ctx.indicadores, ctx.tdc, ctx.logistica, { graficos: graficosDe(req), consolidacion: await consolidacionParaPdf(ctx.proyecto, req.userId) });
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
