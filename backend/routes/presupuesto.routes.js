/**
 * Modulo 4 - Endpoint de Presupuesto APU
 * POST /api/proyectos/:id/presupuesto
 * GET  /api/proyectos/:id/presupuesto
 */
import crypto from 'crypto';
import { procesarPresupuesto, getRendimientoRef, RENDIMIENTOS_CATALOGO } from '../pipeline/apuEngine.js';
import { runTransaction } from '../db.js';
import { logger } from '../utils/logger.js';
// Reutiliza el guardián de moneda ya existente (backend/routes/proyectos.routes.js)
// en vez de duplicarlo — este endpoint escribe a proyectos.presupuesto por otra
// vía (POST /api/proyectos/:id/presupuesto) que no pasaba por ese guardián.
import { contieneMonedaNoCOP } from './proyectos.routes.js';

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      console.error('[presupuesto]', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  };
}

export function registerPresupuestoRoutes(app, { authenticateToken, runSql, getRow, getRows }) {

  /**
   * GET /api/rendimientos
   * Catalogo de rendimientos disponible para el formulador.
   */
  app.get('/api/rendimientos', authenticateToken, wrap(async (req, res) => {
    let rows = [];
    try {
      rows = await getRows('SELECT clave, descripcion, fase, unidad, valor FROM catalogo_rendimientos WHERE activo = TRUE ORDER BY fase, clave');
    } catch {
      rows = Object.entries(RENDIMIENTOS_CATALOGO).map(([clave, v]) => ({ clave, ...v }));
    }
    return res.json({ success: true, data: rows });
  }));

  /**
   * POST /api/proyectos/:id/presupuesto
   * Recibe items APU, calcula costos, valida rendimientos y persiste.
   *
   * Body: { items: [{ fase, capitulo, item, unidad, cantidad, rendimiento_std,
   *                   rendimiento_real, costo_jornal_dia, materiales, equipos, aiu }] }
   */
  app.post('/api/proyectos/:id/presupuesto', authenticateToken, wrap(async (req, res) => {
    const proyectoId = req.params.id;
    const { items }  = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items[] es requerido y no puede estar vacio' });
    }
    if (contieneMonedaNoCOP(items)) {
      return res.status(422).json({ success: false, message: 'El presupuesto debe expresarse únicamente en COP — se detectó un código de moneda distinto.' });
    }

    const proyecto = await getRow('SELECT id, estado, org_id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, req.userId]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') return res.status(409).json({ success: false, message: 'Proyecto Finalizado — presupuesto inmutable' });

    // Calcular APU con validacion de rendimientos
    const resultado = await procesarPresupuesto(items, getRow);

    if (resultado.alertas.length > 0) {
      console.warn('[presupuesto] Alertas de rendimiento:', JSON.stringify(resultado.alertas));
    }

    // FIX 4.3: DELETE + N INSERTs + UPDATE envueltos en una transacción atómica
    const resumenPresupuesto = JSON.stringify({
      porFase: resultado.porFase, total: resultado.total, alertas: resultado.alertas,
    });

    const queries = [
      { sql: 'DELETE FROM project_budgets WHERE proyecto_id = ?', params: [proyectoId] },
      ...resultado.items.map(it => ({
        sql: `INSERT INTO project_budgets
               (id, proyecto_id, org_id, fase, capitulo, item, unidad, cantidad,
                rendimiento_std, rendimiento_real, rendimiento_ref,
                costo_jornal_dia, materiales, equipos,
                costo_mano_obra, costo_materiales, costo_equipos,
                costo_directo, aiu, valor_total,
                tipo_contrato, aiu_administracion, aiu_imprevistos, aiu_utilidad, valor_iva)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          crypto.randomUUID(), proyectoId, req.userId,
          it.fase, it.capitulo || '', it.item || '', it.unidad || 'm2', it.cantidad,
          it.rendimiento_std || '', it.rendimiento_real, it.rendimiento_ref,
          it.costo_jornal_dia, JSON.stringify(it.materiales || []), JSON.stringify(it.equipos || []),
          it.costo_mano_obra, it.costo_materiales, it.costo_equipos,
          it.costo_directo, it.aiu ?? 0.28, it.valor_total,
          it.tipo_contrato ?? 'construccion', it.aiu_administracion ?? 0.20,
          it.aiu_imprevistos ?? 0.03, it.aiu_utilidad ?? 0.05, it.valor_iva ?? 0,
        ],
      })),
      {
        sql: 'UPDATE proyectos SET presupuesto = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ?',
        params: [resumenPresupuesto, proyectoId, req.userId],
      },
    ];

    await runTransaction(queries);

    return res.status(resultado.alertas.length > 0 ? 207 : 200).json({
      success: true,
      message: resultado.alertas.length > 0
        ? 'Presupuesto guardado con alertas de rendimiento'
        : 'Presupuesto calculado y guardado correctamente',
      porFase:  resultado.porFase,
      total:    resultado.total,
      alertas:  resultado.alertas,
      items:    resultado.items.length,
    });
  }));

  /**
   * GET /api/proyectos/:id/presupuesto
   * Devuelve todos los items APU calculados del proyecto.
   */
  app.get('/api/proyectos/:id/presupuesto', authenticateToken, wrap(async (req, res) => {
    const proyecto = await getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [req.params.id, req.userId]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    let items = [];
    try {
      items = await getRows('SELECT * FROM project_budgets WHERE proyecto_id = ? ORDER BY fase, capitulo, item', [req.params.id]);
    } catch (e) {
      logger.error('[Presupuesto] Fallo consultando project_budgets — devolviendo presupuesto vacío', { proyectoId: req.params.id, err: e.message });
    }

    const porFase = { NEGRA: 0, GRIS: 0, BLANCA: 0 };
    for (const it of items) {
      const f = String(it.fase || '').toUpperCase();
      if (f in porFase) porFase[f] = Math.round((porFase[f] + Number(it.valor_total || 0)) * 100) / 100;
    }

    return res.json({
      success: true,
      data: items,
      porFase,
      total: Object.values(porFase).reduce((s, v) => s + v, 0),
    });
  }));
}
