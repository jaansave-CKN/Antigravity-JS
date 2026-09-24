/**
 * F5-01 — Módulo 9: Radicación de Proyecto
 * Endpoint de cierre que bloquea el paso a 'Finalizado'
 * hasta que el sello de auditoría Cross-Check sea aprobado.
 */

import crypto from 'crypto';
import { runCrossCheck } from '../validators/crossCheckValidator.js';
import { captureError } from '../config/sentry.config.js';
import { withTenantRow, withTenantRun } from '../config/database.config.js';
import { validarBody, radicacionSchema } from '../validators/zodSchemas.js';

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): no exponer
      // err.message crudo al cliente. Log interno intacto.
      console.error('[radicacion] Error:', err.message);
      captureError(err, { route: 'radicacion', method: req.method, path: req.path, userId: req.userId });
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

/**
 * Registra las rutas de radicación en la aplicación Express.
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function }} deps
 */
export function registerRadicacionRoutes(app, { authenticateToken }) {

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
    const validacionRadicar = validarBody(radicacionSchema, req.body);
    if (!validacionRadicar.ok) {
      return res.status(400).json({
        success: false,
        message: 'fichaTecnica y presupuesto son requeridos',
      });
    }
    const { fichaTecnica, presupuesto } = validacionRadicar.data;

    // SECURITY FIX: user_id en WHERE evita enumeration (403 vs 404 leakage)
    const proyecto = await withTenantRow(req.userId,
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
    const complianceLegal = await withTenantRow(req.userId,
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
      await withTenantRun(req.userId,
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

    await withTenantRun(req.userId,
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

}
