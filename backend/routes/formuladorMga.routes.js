/**
 * formuladorMga.routes.js — Fase 3: Formulador MGA (consolidador).
 *
 * POST /api/proyectos/:id/formulador-mga — consolida y guarda una fila nueva
 * GET  /api/proyectos/:id/formulador-mga — última consolidación 'ok', último
 *      intento y si está desactualizada respecto a los datos actuales
 *
 * Diseño: docs/diseno/formulador-mga.md (architect 2026-09-26, B1-B7).
 *   - B6: TODO empieza verificando que el proyecto es del usuario
 *     (WHERE id = ? AND org_id = ?, vía withTenant*) → 404 si no. Solo después
 *     se leen las tablas hijas por project_id. INSERT con org_id = req.userId.
 *   - B1: persistencia en project_formulador_mga (migración 072, append-only),
 *     nunca en ficha_tecnica: allí se perdería o se podría falsificar desde el
 *     navegador (PUT /api/proyectos/:id acepta ficha_tecnica del cliente).
 *   - Sin byokGate: el modelo es deepseek-v4.1-flash en NVIDIA NIM con la
 *     llave del servidor; las llaves BYOK del usuario son de Gemini.
 *     aiLimiter (20/h por usuario) sigue acotando el gasto.
 */
import { withTenantRow, withTenantRows } from '../config/database.config.js';
import { captureError } from '../config/sentry.config.js';
import { recolectarFuentes, consolidarMGA, huellaFuentes } from '../services/formuladorMga.js';
import { faltantesFormulador, respuesta422 } from '../services/datosMinimosIA.js';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[formuladorMga]', err.message);
      captureError(err, { route: 'formuladorMga', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

const parse = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
const normalizarFila = (f) => f && ({ ...f, bloques: parse(f.bloques), descartados: parse(f.descartados) || [] });

/** Proyecto del usuario (B6) + dependencias de lectura escopadas a su tenant. */
async function contexto(proyectoId, userId) {
  const proyecto = await withTenantRow(userId, 'SELECT id, nombre, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  const deps = {
    getRow: (sql, params) => withTenantRow(userId, sql, params),
    getRows: (sql, params) => withTenantRows(userId, sql, params),
  };
  return { proyecto, deps };
}

export function registerFormuladorMgaRoutes(app, { authenticateToken, requireAccess, aiLimiter }) {
  app.post('/api/proyectos/:id/formulador-mga', authenticateToken, requireAccess('formulador'), aiLimiter, wrap(async (req, res) => {
    const { proyecto, deps } = await contexto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { datos, meta } = await recolectarFuentes(proyecto, deps);
    const faltantes = faltantesFormulador(meta);
    if (faltantes.length) return res.status(422).json(respuesta422('el Formulador MGA', faltantes));

    const r = await consolidarMGA(datos, { userId: req.userId });
    const fila = await withTenantRow(req.userId,
      `INSERT INTO project_formulador_mga (project_id, org_id, estado, motivo, bloques, descartados, huella_fuentes, modelo, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [req.params.id, req.userId, r.estado, r.motivo ?? null, r.bloques ? JSON.stringify(r.bloques) : null,
        JSON.stringify(r.descartados || []), huellaFuentes(datos), r.modelo ?? null, req.userId]
    );
    res.status(201).json({ success: true, data: { ...normalizarFila(fila), desactualizada: false, viabilidad_heuristica: meta.viabilidadHeuristica } });
  }));

  app.get('/api/proyectos/:id/formulador-mga', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const { proyecto, deps } = await contexto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const [ultimaOk, ultimoIntento] = await Promise.all([
      withTenantRow(req.userId, "SELECT * FROM project_formulador_mga WHERE project_id = ? AND estado = 'ok' ORDER BY created_at DESC LIMIT 1", [req.params.id]),
      withTenantRow(req.userId, 'SELECT * FROM project_formulador_mga WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [req.params.id]),
    ]);
    let desactualizada = false;
    if (ultimaOk) {
      const { datos } = await recolectarFuentes(proyecto, deps);
      desactualizada = huellaFuentes(datos) !== ultimaOk.huella_fuentes;
    }
    res.json({ success: true, data: { ultima_ok: normalizarFila(ultimaOk), ultimo_intento: normalizarFila(ultimoIntento), desactualizada } });
  }));
}
