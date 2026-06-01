/**
 * F5-02 — Exportación Certificada
 * GET /api/modulo9/reporte/:proyectoId → buffer PDF de descarga directa (SSR)
 */

import { generarReportePDF } from '../services/pdfGenerator.js';

/**
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function, getRow: Function }} deps
 */
export function registerReporteRoutes(app, { authenticateToken, getRow }) {

  app.get('/api/modulo9/reporte/:proyectoId', authenticateToken, async (req, res) => {
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

      const buffer   = await generarReportePDF(proyecto);
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
  });
}
