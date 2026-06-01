/**
 * Módulo 9 — Gestión de Proyectos
 * Reemplaza los stubs de /api/proyectos con persistencia real.
 * Aislamiento multi-tenant via org_id derivado de la sesión JWT.
 */

import crypto from 'crypto';
import { runCrossCheck } from '../validators/crossCheckValidator.js';

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      console.error('[proyectos] Error:', err.message);
      res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }
  };
}

/**
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function, runSql: Function, getRow: Function, getRows: Function }} deps
 */
export function registerProyectosRoutes(app, { authenticateToken, runSql, getRow, getRows }) {

  /**
   * POST /api/proyectos
   * Crea un nuevo proyecto. Devuelve el proyectoId para navegación inmediata.
   *
   * Body:
   *   nombre         string  (requerido)
   *   fichaTecnica   object  { metaFisicaTotal, descripcion, ... }  — Módulo 3b
   *   presupuesto    object  { fasesNegra:[], fasesGris:[], fasesBlanca:[] } — Módulo 4
   */
  app.post('/api/proyectos', authenticateToken, wrap(async (req, res) => {
    const { nombre, fichaTecnica = {}, presupuesto = {} } = req.body;

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ success: false, message: 'nombre es requerido' });
    }

    // Cross-check en tiempo real si se proveen datos financieros completos
    const hasFaseItems = [
      ...(presupuesto.fasesNegra  || []),
      ...(presupuesto.fasesGris   || []),
      ...(presupuesto.fasesBlanca || []),
    ].length > 0;

    if (fichaTecnica.metaFisicaTotal && hasFaseItems) {
      const check = runCrossCheck(fichaTecnica, presupuesto, 'PRE-INSERT');
      if (!check.valid) {
        return res.status(422).json({
          status:  'ERROR',
          message: 'Discrepancia detectada en Ficha Técnica',
          details: [check.detail],
        });
      }
    }

    // org_id = user_id (fase 1: un usuario = una organización; escalable a multi-org)
    const orgId = req.userId;
    const id    = crypto.randomUUID();

    await runSql(
      `INSERT INTO proyectos
         (id, user_id, org_id, nombre, ficha_tecnica, presupuesto, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'Borrador')`,
      [
        id,
        req.userId,
        orgId,
        nombre.trim(),
        JSON.stringify(fichaTecnica),
        JSON.stringify(presupuesto),
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Proyecto creado',
      proyectoId: id,
      estado: 'Borrador',
    });
  }));

  /**
   * GET /api/proyectos
   * Lista los proyectos del tenant autenticado (filtro RLS por org_id).
   */
  app.get('/api/proyectos', authenticateToken, wrap(async (req, res) => {
    const rows = await getRows(
      `SELECT id, nombre, estado, bloqueo_razon, created_at, updated_at
         FROM proyectos
        WHERE org_id = ?
        ORDER BY created_at DESC`,
      [req.userId]
    );
    return res.json({ success: true, data: rows });
  }));

  /**
   * GET /api/proyectos/:id
   * Devuelve el detalle completo (incluye ficha_tecnica y presupuesto).
   * RLS: org_id debe coincidir con el usuario autenticado.
   */
  app.get('/api/proyectos/:id', authenticateToken, wrap(async (req, res) => {
    const proyecto = await getRow(
      `SELECT id, nombre, estado, bloqueo_razon,
              ficha_tecnica, presupuesto, crosscheck_sello,
              created_at, updated_at
         FROM proyectos
        WHERE id = ? AND org_id = ?`,
      [req.params.id, req.userId]
    );

    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }

    return res.json({
      success: true,
      data: {
        ...proyecto,
        ficha_tecnica:    safeParseJson(proyecto.ficha_tecnica),
        presupuesto:      safeParseJson(proyecto.presupuesto),
        crosscheck_sello: safeParseJson(proyecto.crosscheck_sello),
      },
    });
  }));

  /**
   * PATCH /api/proyectos/:id
   * Actualiza nombre, ficha_tecnica o presupuesto mientras el proyecto
   * no esté en estado Finalizado.
   */
  app.patch('/api/proyectos/:id', authenticateToken, wrap(async (req, res) => {
    const proyecto = await getRow(
      'SELECT id, estado FROM proyectos WHERE id = ? AND org_id = ?',
      [req.params.id, req.userId]
    );

    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    if (proyecto.estado === 'Finalizado') {
      return res.status(409).json({
        success: false,
        message: 'Un proyecto Finalizado no puede modificarse',
      });
    }

    const { nombre, fichaTecnica, presupuesto } = req.body;
    const updates = [];
    const params  = [];

    if (nombre !== undefined) {
      updates.push('nombre = ?');
      params.push(String(nombre).trim());
    }
    if (fichaTecnica !== undefined) {
      updates.push('ficha_tecnica = ?');
      params.push(JSON.stringify(fichaTecnica));
    }
    if (presupuesto !== undefined) {
      updates.push('presupuesto = ?');
      params.push(JSON.stringify(presupuesto));
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Nada que actualizar' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id, req.userId);

    await runSql(
      `UPDATE proyectos SET ${updates.join(', ')} WHERE id = ? AND org_id = ?`,
      params
    );

    return res.json({ success: true, message: 'Proyecto actualizado' });
  }));
}

function safeParseJson(val) {
  if (!val) return null;
  try { return JSON.parse(val); }
  catch { return val; }
}
