/**
 * F5-01 — Módulo 9: Radicación de Proyecto
 * Endpoint de cierre que bloquea el paso a 'Finalizado'
 * hasta que el sello de auditoría Cross-Check sea aprobado.
 */

import crypto from 'crypto';
import { runCrossCheck } from '../validators/crossCheckValidator.js';

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      console.error('[radicacion] Error:', err.message);
      res.status(500).json({ success: false, message: err.message || 'Error interno' });
    }
  };
}

/**
 * Registra las rutas de radicación en la aplicación Express.
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function, runSql: Function, getRow: Function }} deps
 */
export function registerRadicacionRoutes(app, { authenticateToken, runSql, getRow }) {

  /**
   * POST /api/modulo9/radicar/:proyectoId
   *
   * Body:
   *   fichaTecnica  { metaFisicaTotal: number, ... }   — datos Módulo 3b
   *   presupuesto   { fasesNegra: [], fasesGris: [], fasesBlanca: [] }  — Módulo 4
   *
   * Flujo:
   *   1. Verifica que el proyecto exista y no esté ya Finalizado/BLOQUEADO.
   *   2. Ejecuta Cross-Check matemático.
   *   3a. Falla → estado BLOQUEADO + bloqueo_razon + 422 CROSSCHECK_FAILED.
   *   3b. OK    → estado Finalizado + crosscheck_sello + 200.
   */
  app.post('/api/modulo9/radicar/:proyectoId', authenticateToken, wrap(async (req, res) => {
    const { proyectoId } = req.params;
    const { fichaTecnica, presupuesto } = req.body;

    if (!fichaTecnica || !presupuesto) {
      return res.status(400).json({
        success: false,
        message: 'fichaTecnica y presupuesto son requeridos',
      });
    }

    const proyecto = await getRow(
      'SELECT id, estado, user_id FROM proyectos WHERE id = ?',
      [proyectoId]
    );

    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    if (proyecto.user_id !== req.userId) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }
    if (proyecto.estado === 'Finalizado') {
      return res.status(409).json({ success: false, message: 'El proyecto ya está Finalizado' });
    }

    const { valid, code, discrepancy, detail } = runCrossCheck(fichaTecnica, presupuesto, proyectoId);

    if (!valid) {
      await runSql(
        `UPDATE proyectos
           SET estado = 'BLOQUEADO',
               bloqueo_razon = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          `CROSSCHECK_FAILED: discrepancia de $${Math.abs(discrepancy).toFixed(2)}`,
          proyectoId,
        ]
      );

      return res.status(422).json({
        success: false,
        code: 'CROSSCHECK_FAILED',
        message: `Discrepancia presupuestal de $${Math.abs(discrepancy).toFixed(2)}. El proyecto no puede pasar a Finalizado.`,
        discrepancy,
        detail,
      });
    }

    const sello = {
      auditId: crypto.randomUUID(),
      pasado_en: detail.timestamp,
      validado_por: 'crosscheck-pipeline-v1',
      discrepancy: 0,
      resumen: detail,
    };

    await runSql(
      `UPDATE proyectos
          SET estado = 'Finalizado',
              bloqueo_razon = NULL,
              crosscheck_sello = ?,
              ficha_tecnica = ?,
              presupuesto = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [
        JSON.stringify(sello),
        JSON.stringify(fichaTecnica),
        JSON.stringify(presupuesto),
        proyectoId,
      ]
    );

    return res.json({
      success: true,
      message: 'Proyecto radicado exitosamente. Sello de auditoría Cross-Check emitido.',
      estado: 'Finalizado',
      sello,
    });
  }));

  /**
   * GET /api/modulo9/radicar/:proyectoId/sello
   * Consulta el sello de auditoría de un proyecto ya finalizado.
   */
  app.get('/api/modulo9/radicar/:proyectoId/sello', authenticateToken, wrap(async (req, res) => {
    const proyecto = await getRow(
      'SELECT id, estado, crosscheck_sello, user_id FROM proyectos WHERE id = ?',
      [req.params.proyectoId]
    );

    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    if (proyecto.user_id !== req.userId) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }
    if (proyecto.estado !== 'Finalizado' || !proyecto.crosscheck_sello) {
      return res.status(404).json({ success: false, message: 'Sello Cross-Check no disponible' });
    }

    return res.json({
      success: true,
      sello: JSON.parse(proyecto.crosscheck_sello),
    });
  }));
}
