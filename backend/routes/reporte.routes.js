/**
 * F5-02 — Exportación Certificada
 * GET  /api/modulo9/reporte/:proyectoId → buffer PDF de descarga directa (SSR), sin gráficos
 * POST /api/modulo9/reporte/:proyectoId → igual, + body { graficos: [{svg, titulo}] }
 *      (Motor de Diagramación ISO 9000, 2026-08-17) — GET no soporta body en HTTP de forma
 *      confiable, así que los gráficos (SVG ya renderizado en el navegador, puede pesar
 *      varios KB) se envían por POST. El GET se conserva intacto para no romper enlaces de
 *      descarga directa existentes — mismo PDF, simplemente sin el anexo de gráficos.
 */

import { generarReportePDF } from '../services/pdfGenerator.js';

/**
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function, getRow: Function }} deps
 */
export function registerReporteRoutes(app, { authenticateToken, getRow }) {

  async function manejarReporte(req, res, graficos) {
    try {
      const proyecto = await getRow(
        `SELECT id, nombre, estado, bloqueo_razon,
                ficha_tecnica, presupuesto, crosscheck_sello,
                created_at, updated_at
           FROM proyectos
          WHERE id = ? AND org_id = ?`,
        [req.params.proyectoId, req.userId]
      );

      if (!proyecto) {
        return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
      }

      const buffer   = await generarReportePDF(proyecto, graficos);
      const filename = `RadarFondos_${req.params.proyectoId.slice(0, 8)}_reporte.pdf`;

      res.set({
        'Content-Type':           'application/pdf',
        'Content-Disposition':    `attachment; filename="${filename}"`,
        'Content-Length':         buffer.length,
        'Cache-Control':          'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'X-Generated-By':         'RadarFondos360-SSR',
      });

      return res.send(buffer);
    } catch (err) {
      console.error('[reporte] Error generando PDF:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error al generar el reporte PDF',
      });
    }
  }

  app.get('/api/modulo9/reporte/:proyectoId', authenticateToken, (req, res) => manejarReporte(req, res, []));
  app.post('/api/modulo9/reporte/:proyectoId', authenticateToken, (req, res) => manejarReporte(req, res, Array.isArray(req.body?.graficos) ? req.body.graficos : []));
}
