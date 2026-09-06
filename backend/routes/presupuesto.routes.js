/**
 * Modulo 4 - Endpoint de Presupuesto APU
 * POST /api/proyectos/:id/presupuesto
 * GET  /api/proyectos/:id/presupuesto
 */
import crypto from 'crypto';
import { procesarPresupuesto, getRendimientoRef, RENDIMIENTOS_CATALOGO } from '../pipeline/apuEngine.js';
import { logger } from '../utils/logger.js';
// Reutiliza el guardián de moneda ya existente (backend/routes/proyectos.routes.js)
// en vez de duplicarlo — este endpoint escribe a proyectos.presupuesto por otra
// vía (POST /api/proyectos/:id/presupuesto) que no pasaba por ese guardián.
import { contieneMonedaNoCOP } from './proyectos.routes.js';
import { captureError } from '../config/sentry.config.js';
// withTenant() (Fase 3 roadmap tenant, 2026-09-06): los call sites contra
// `proyectos`/`project_budgets` migran al rol rf360_rls_scoped — GRANT sobre
// project_budgets aplicado por 060_rls_scoped_grants_fase3.sql (proyectos ya
// lo tenía desde 053). El INSERT masivo de ítems APU (antes runTransaction()
// de db.js, pool principal BYPASSRLS) pasa a withTenantTransaction() —
// atomicidad real bajo RLS, mismo helper agregado en el cierre de Fase 2.
//
// EXCEPCIÓN DELIBERADA: catalogo_rendimientos NO se tenant-escopa. Verificado
// en vivo antes de tocar código: la tabla tiene RLS ACTIVO pero CERO
// políticas definidas — en Postgres, RLS habilitado sin ninguna política es
// deny-all para cualquier rol sin BYPASSRLS (GRANT no lo compensa: el GRANT
// controla el permiso de intentar la operación, la política controla qué
// filas se ven). Además no tiene columna org_id/user_id/tenant_id — es un
// catálogo de referencia GLOBAL (rendimientos de obra), no datos por tenant,
// mismo criterio que gemini_key_state/trial_sessions en la sección 4 del
// roadmap. Migrarla a withTenant() habría devuelto 0 filas siempre, rompiendo
// el catálogo para todo el mundo. `getRow` (sin tenant) se mantiene para
// GET /api/rendimientos y para el getRow que procesarPresupuesto()/
// getRendimientoRef() (apuEngine.js) reciben como dependencia inyectada —
// esa función SOLO consulta catalogo_rendimientos, nunca datos de proyecto.
import { withTenantRow, withTenantRows, withTenantRun, withTenantTransaction, getRow, getRows } from '../config/database.config.js';

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): no exponer
      // err.message crudo al cliente (puede venir de apuEngine.js o de un
      // fallo real de BD). Log interno intacto.
      console.error('[presupuesto]', err.message);
      captureError(err, { route: 'presupuesto', method: req.method, path: req.path, userId: req.userId });
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export function registerPresupuestoRoutes(app, { authenticateToken }) {

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
    // FIX (auditoría SRE Red Team 2026-08-10, Capa 3): sin tope superior, un
    // array de miles de ítems pequeños cabe bajo el límite de 1MB de
    // express.json() y satura tanto la transacción (miles de INSERT) como el
    // render de la tabla en el cliente.
    if (items.length > 500) {
      return res.status(413).json({ success: false, message: 'Máximo 500 ítems de presupuesto por guardado.' });
    }
    if (contieneMonedaNoCOP(items)) {
      return res.status(422).json({ success: false, message: 'El presupuesto debe expresarse únicamente en COP — se detectó un código de moneda distinto.' });
    }

    const proyecto = await withTenantRow(req.userId, 'SELECT id, estado, org_id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, req.userId]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') return res.status(409).json({ success: false, message: 'Proyecto Finalizado — presupuesto inmutable' });

    // Calcular APU con validacion de rendimientos — getRow SIN tenant a
    // propósito: solo consulta catalogo_rendimientos (ver comentario del import).
    const resultado = await procesarPresupuesto(items, getRow);

    if (resultado.alertas.length > 0) {
      console.warn('[presupuesto] Alertas de rendimiento:', JSON.stringify(resultado.alertas));
    }

    // FIX (2026-08-24, ORDEN — "no se puede perder ningún dato después de
    // guardar"): esto ANTES hacía DELETE FROM project_budgets + reinsertaba
    // SOLO el lote recién enviado — el frontend (PresupuestoPage.tsx `guardar()`)
    // manda únicamente las filas nuevas del borrador, nunca los ítems ya
    // guardados en sesiones anteriores. Con el DELETE, cada "Agregar fila +
    // SAVE" borraba TODO el presupuesto previo del proyecto y lo dejaba solo
    // con el lote nuevo. Ahora es aditivo — nunca borra filas existentes — y
    // el resumen (porFase/total) se recalcula desde TODAS las filas reales
    // en la tabla después del insert, igual que ya hace GET más abajo, para
    // no reportar un total que solo refleje el lote recién guardado.
    const queries = resultado.items.map(it => ({
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
    }));

    await withTenantTransaction(req.userId, queries);

    // Recalculo desde la tabla real (existentes + recién insertadas) — nunca
    // desde `resultado`, que solo conoce el lote de esta petición.
    const todasLasFilas = await withTenantRows(req.userId, 'SELECT fase, valor_total FROM project_budgets WHERE proyecto_id = ?', [proyectoId]);
    const porFaseTotal = { NEGRA: 0, GRIS: 0, BLANCA: 0 };
    for (const it of todasLasFilas) {
      const f = String(it.fase || '').toUpperCase();
      if (f in porFaseTotal) porFaseTotal[f] = Math.round((porFaseTotal[f] + Number(it.valor_total || 0)) * 100) / 100;
    }
    const totalGeneral = Math.round(Object.values(porFaseTotal).reduce((s, v) => s + v, 0) * 100) / 100;
    const resumenPresupuesto = JSON.stringify({ porFase: porFaseTotal, total: totalGeneral, alertas: resultado.alertas });
    await withTenantRun(req.userId,
      'UPDATE proyectos SET presupuesto = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ?',
      [resumenPresupuesto, proyectoId, req.userId]
    );

    return res.status(resultado.alertas.length > 0 ? 207 : 200).json({
      success: true,
      message: resultado.alertas.length > 0
        ? 'Presupuesto guardado con alertas de rendimiento'
        : 'Presupuesto calculado y guardado correctamente',
      porFase:  porFaseTotal,
      total:    totalGeneral,
      alertas:  resultado.alertas,
      items:    resultado.items.length,
    });
  }));

  /**
   * GET /api/proyectos/:id/presupuesto
   * Devuelve todos los items APU calculados del proyecto.
   */
  app.get('/api/proyectos/:id/presupuesto', authenticateToken, wrap(async (req, res) => {
    const proyecto = await withTenantRow(req.userId, 'SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [req.params.id, req.userId]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    let items = [];
    try {
      items = await withTenantRows(req.userId, 'SELECT * FROM project_budgets WHERE proyecto_id = ? ORDER BY fase, capitulo, item', [req.params.id]);
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
