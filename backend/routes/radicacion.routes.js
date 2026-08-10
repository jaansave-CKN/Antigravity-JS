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

    // SECURITY FIX: user_id en WHERE evita enumeration (403 vs 404 leakage)
    const proyecto = await getRow(
      'SELECT id, estado FROM proyectos WHERE id = ? AND user_id = ?',
      [proyectoId, req.userId]
    );

    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    if (proyecto.estado === 'Finalizado') {
      return res.status(409).json({ success: false, message: 'El proyecto ya está Finalizado' });
    }

    // Hard-Lock predial (F-Legal-01) — mismo candado que POST /api/m12/ficha/:proyectoId.
    // Este endpoint no lo llama ningún componente del frontend hoy, pero sigue
    // siendo una ruta HTTP real y autenticada — debe quedar igual de protegida.
    const complianceLegal = await getRow(
      'SELECT estado_legal FROM compliance_data WHERE proyecto_id = ? AND user_id = ?',
      [proyectoId, req.userId]
    );
    if ((complianceLegal?.estado_legal || 'sin_evaluar') !== 'despejado') {
      return res.status(409).json({
        success: false,
        code: 'RIESGO_JURIDICO_CONDICIONADO',
        message: 'Riesgo jurídico condicionado — el predio debe quedar despejado antes de certificar.',
      });
    }

    const { valid, code, discrepancy, detail } = runCrossCheck(fichaTecnica, presupuesto, proyectoId);

    // FIX (auditoría SRE Red Team 2026-08-10, Capa 2): las 2 escrituras de
    // este endpoint filtraban solo por id, apoyándose únicamente en el guard
    // de arriba — defensa en profundidad ausente a diferencia del resto del
    // repo (ej. fichaTecnica.routes.js:107). No explotable antes (el guard sí
    // corta con 404), pero ahora ambos UPDATE repiten AND user_id = ?.
    if (!valid) {
      await runSql(
        `UPDATE proyectos
           SET estado = 'BLOQUEADO',
               bloqueo_razon = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [
          `CROSSCHECK_FAILED: discrepancia de $${Math.abs(discrepancy).toFixed(2)}`,
          proyectoId, req.userId,
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
        WHERE id = ? AND user_id = ?`,
      [
        JSON.stringify(sello),
        JSON.stringify(fichaTecnica),
        JSON.stringify(presupuesto),
        proyectoId, req.userId,
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
    // SECURITY FIX: user_id en WHERE — misma corrección de enumeration
    const proyecto = await getRow(
      'SELECT id, estado, crosscheck_sello FROM proyectos WHERE id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
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
