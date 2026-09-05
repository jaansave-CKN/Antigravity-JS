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
import { calcularResumenRaci } from '../services/raciService.js';
// MIGRACIÓN (Prioridad Roja, Archivo 3, 2026-09-05): reemplaza getRow/getRows
// planos (pool principal, BYPASSRLS) por withTenantRow/withTenantRows (pool
// rf360_rls_scoped) — GRANT ya cubierto por 054/055 para las 5 tablas que
// toca este archivo (proyectos, motor_dialectico, logistica_tramos,
// project_anexos, raci_*). calcularResumenRaci() sigue el mismo patrón ya
// usado en matrizRaci.routes.js:251-253 (getRows con placeholders $N vía
// withTenant() directo, no withTenantRows, porque raciService.js ya espera
// esa convención — ver comentario en raciService.js:14-22).
import { withTenant, withTenantRow, withTenantRows } from '../config/database.config.js';

/**
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function }} deps
 */
export function registerReporteRoutes(app, { authenticateToken }) {

  async function manejarReporte(req, res, graficos) {
    try {
      const proyecto = await withTenantRow(req.userId,
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

      // MANDATO (2026-08-23, "que se vea como un proyecto formulado"): el
      // reporte solo cubría Datos Generales + Presupuesto + Sello — Contexto
      // del Problema, Motor Dialéctico, Logística y Anexos (todo lo que
      // muestra FichaTecnicaPage) faltaban por completo del PDF. Se agregan
      // aquí las 3 consultas que faltan (mismas tablas/columnas que ya usan
      // los endpoints reales de cada módulo — motorDialectico.routes.js,
      // configLogistica.routes.js, anexos.routes.js — cero tablas nuevas).
      // MANDATO (2026-08-24, "que también al generar PDF, aparezca" — Matriz
      // RACI): raciResumen se calcula con la MISMA función que usa
      // GET /api/proyectos/:id/raci/resumen (matrizRaci.routes.js) — condición
      // de diseño explícita del architect review: nunca reimplementar el
      // conteo de validación (tareas sin A/R, roles sin asignación) por
      // segunda vez aquí, para no repetir el patrón de fuentes divergentes
      // ya encontrado 3 veces en este proyecto el mismo día.
      const [dialectico, tramos, anexos, raciResumen] = await Promise.all([
        withTenantRow(req.userId, 'SELECT tono, interlocutor, enfoque, humanizacion FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?', [req.params.proyectoId, req.userId]),
        withTenantRows(req.userId, 'SELECT origen, destino, duracion, medio FROM logistica_tramos WHERE proyecto_id = ? ORDER BY numero ASC', [req.params.proyectoId]),
        withTenantRows(req.userId, 'SELECT descripcion, nombre_archivo, link FROM project_anexos WHERE project_id = ? ORDER BY created_at ASC', [req.params.proyectoId]),
        calcularResumenRaci(req.params.proyectoId, {
          getRows: async (sql, params) => (await withTenant(req.userId, client => client.query(sql, params))).rows || [],
        }),
      ]);

      const buffer   = await generarReportePDF(proyecto, graficos, { dialectico, tramos, anexos, raciResumen });
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
