/**
 * matrizRaci.routes.js — Matriz RACI (módulo nuevo, 2026-08-24).
 *
 * Hasta hoy client/src/pages/MatrizRaciPage.tsx era 100% maqueta sin backend
 * (confirmado: cero fetch/useEffect en el archivo). Diseño de este módulo
 * (esquema de 3 tablas, contrato de endpoints, CRUD por fila en vez de
 * DELETE-ALL+INSERT-ALL) revisado y aprobado por el subagente architect antes
 * de escribir esta ruta — ver migraciones/046_matriz_raci.sql para el
 * razonamiento completo del esquema.
 *
 * Convención moderna /api/proyectos/:id/raci/... (como anexos/logistica-tramos),
 * no el prefijo legacy /api/m5/.
 */
import crypto from 'crypto';
import { calcularResumenRaci } from '../services/raciService.js';
// withTenant() (005_INGENIERO_BACKEND, 2026-09-04): raci_tareas/raci_roles/
// raci_asignaciones tenían RLS completamente desactivado (relrowsecurity=
// false, verificado en vivo) Y el rol "anon" de Supabase tenía GRANT
// SELECT/INSERT/UPDATE/DELETE completo sobre las 3 (también verificado en
// vivo) — cualquiera con la anon key pública podía leer/escribir/borrar la
// matriz RACI de CUALQUIER proyecto de CUALQUIER tenant vía PostgREST directo,
// sin pasar por este backend. Migración 054_rls_raci_gemini_trial.sql cierra
// eso con políticas tenant_isolation (join a proyectos.org_id) + REVOKE de
// anon/authenticated. Como ese cierre exige rol rf360_rls_scoped (sin
// BYPASSRLS) para que la política se evalúe de verdad y no como papel
// mojado, todas las queries de este archivo se mueven de runSql/getRow/
// getRows (rol "postgres", BYPASSRLS=true) a withTenant(req.userId, ...)
// — mismo patrón ya usado en proyectos.routes.js/anexos.routes.js.
import { withTenant } from '../config/database.config.js';

const SIGLAS_VALIDAS = new Set(['R', 'A', 'C', 'I', 'V', 'IA']);

// FIX (PROTOCOLO 5x5, 2026-08-24): raci_tareas.nombre/descripcion y
// raci_roles.nombre son TEXT sin CHECK de longitud en el esquema (046). Sin
// esto, un usuario autenticado con un solo proyecto propio podía repetir
// POST /tareas con una descripcion de ~950KB hasta el tope del rate-limit
// general (300/15min por IP) — ~280MB/15min de agotamiento de almacenamiento
// en un módulo que ni siquiera tenía un limiter propio. Topes alineados con
// el resto de campos de texto libre del formulador (ver EntradaPage/
// LogisticaPage, mismo orden de magnitud).
const NOMBRE_MAX = 300;
const DESCRIPCION_MAX = 5000;

export function registerMatrizRaciRoutes(app, { authenticateToken, getRow, tryCatch, financialPipelineLimiter }) {
  const limiteEscritura = financialPipelineLimiter ? [financialPipelineLimiter] : [];

  // Mismo patrón de aislamiento multi-tenant que configLogistica.routes.js/
  // anexos.routes.js — proyecto_id + org_id contra la tabla padre `proyectos`
  // (raci_tareas/raci_roles/raci_asignaciones no tienen columna propia de
  // dueño, la propiedad se resuelve transitivamente).
  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // ── TAREAS (filas de la matriz) ───────────────────────────────────────────

  app.get('/api/proyectos/:id/raci/tareas', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const tareasRes = await withTenant(req.userId, client => client.query(
      'SELECT id, nombre, descripcion, orden FROM raci_tareas WHERE proyecto_id = $1 ORDER BY orden ASC, created_at ASC',
      [req.params.id]
    ));
    res.json({ success: true, data: tareasRes.rows || [] });
  }));

  app.post('/api/proyectos/:id/raci/tareas', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'nombre es requerido' });
    if (nombre.length > NOMBRE_MAX) return res.status(400).json({ success: false, message: `nombre supera ${NOMBRE_MAX} caracteres` });
    const descripcion = String(req.body?.descripcion || '');
    if (descripcion.length > DESCRIPCION_MAX) return res.status(400).json({ success: false, message: `descripcion supera ${DESCRIPCION_MAX} caracteres` });
    const orden = Number.isFinite(req.body?.orden) ? req.body.orden : 0;

    const id = crypto.randomUUID();
    await withTenant(req.userId, client => client.query(
      'INSERT INTO raci_tareas (id, proyecto_id, nombre, descripcion, orden) VALUES ($1,$2,$3,$4,$5)',
      [id, req.params.id, nombre, descripcion, orden]
    ));
    res.json({ success: true, data: { id, nombre, descripcion, orden } });
  }));

  app.patch('/api/proyectos/:id/raci/tareas/:tareaId', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const existenteRes = await withTenant(req.userId, client => client.query(
      'SELECT nombre, descripcion, orden FROM raci_tareas WHERE id = $1 AND proyecto_id = $2',
      [req.params.tareaId, req.params.id]
    ));
    const existente = existenteRes.rows?.[0];
    if (!existente) return res.status(404).json({ success: false, message: 'Tarea no encontrada' });

    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : existente.nombre;
    const descripcion = req.body?.descripcion !== undefined ? String(req.body.descripcion) : existente.descripcion;
    const orden = req.body?.orden !== undefined && Number.isFinite(req.body.orden) ? req.body.orden : existente.orden;
    if (!nombre) return res.status(400).json({ success: false, message: 'nombre no puede quedar vacío' });
    if (nombre.length > NOMBRE_MAX) return res.status(400).json({ success: false, message: `nombre supera ${NOMBRE_MAX} caracteres` });
    if (descripcion.length > DESCRIPCION_MAX) return res.status(400).json({ success: false, message: `descripcion supera ${DESCRIPCION_MAX} caracteres` });

    await withTenant(req.userId, client => client.query(
      'UPDATE raci_tareas SET nombre = $1, descripcion = $2, orden = $3 WHERE id = $4 AND proyecto_id = $5',
      [nombre, descripcion, orden, req.params.tareaId, req.params.id]
    ));
    res.json({ success: true });
  }));

  app.delete('/api/proyectos/:id/raci/tareas/:tareaId', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    // ON DELETE CASCADE en raci_asignaciones (migración 046) — borrar la
    // tarea borra sus celdas de la matriz automáticamente.
    await withTenant(req.userId, client => client.query(
      'DELETE FROM raci_tareas WHERE id = $1 AND proyecto_id = $2',
      [req.params.tareaId, req.params.id]
    ));
    res.json({ success: true });
  }));

  // ── ROLES (columnas de la matriz) ─────────────────────────────────────────

  app.get('/api/proyectos/:id/raci/roles', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const rolesRes = await withTenant(req.userId, client => client.query(
      'SELECT id, nombre, orden FROM raci_roles WHERE proyecto_id = $1 ORDER BY orden ASC, created_at ASC',
      [req.params.id]
    ));
    res.json({ success: true, data: rolesRes.rows || [] });
  }));

  app.post('/api/proyectos/:id/raci/roles', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'nombre es requerido' });
    if (nombre.length > NOMBRE_MAX) return res.status(400).json({ success: false, message: `nombre supera ${NOMBRE_MAX} caracteres` });
    const orden = Number.isFinite(req.body?.orden) ? req.body.orden : 0;

    const id = crypto.randomUUID();
    await withTenant(req.userId, client => client.query(
      'INSERT INTO raci_roles (id, proyecto_id, nombre, orden) VALUES ($1,$2,$3,$4)',
      [id, req.params.id, nombre, orden]
    ));
    res.json({ success: true, data: { id, nombre, orden } });
  }));

  app.patch('/api/proyectos/:id/raci/roles/:rolId', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const existenteRes = await withTenant(req.userId, client => client.query(
      'SELECT nombre, orden FROM raci_roles WHERE id = $1 AND proyecto_id = $2',
      [req.params.rolId, req.params.id]
    ));
    const existente = existenteRes.rows?.[0];
    if (!existente) return res.status(404).json({ success: false, message: 'Rol no encontrado' });

    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : existente.nombre;
    const orden = req.body?.orden !== undefined && Number.isFinite(req.body.orden) ? req.body.orden : existente.orden;
    if (!nombre) return res.status(400).json({ success: false, message: 'nombre no puede quedar vacío' });
    if (nombre.length > NOMBRE_MAX) return res.status(400).json({ success: false, message: `nombre supera ${NOMBRE_MAX} caracteres` });

    await withTenant(req.userId, client => client.query(
      'UPDATE raci_roles SET nombre = $1, orden = $2 WHERE id = $3 AND proyecto_id = $4',
      [nombre, orden, req.params.rolId, req.params.id]
    ));
    res.json({ success: true });
  }));

  app.delete('/api/proyectos/:id/raci/roles/:rolId', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    await withTenant(req.userId, client => client.query(
      'DELETE FROM raci_roles WHERE id = $1 AND proyecto_id = $2',
      [req.params.rolId, req.params.id]
    ));
    res.json({ success: true });
  }));

  // ── MATRIZ (agregado en un solo round-trip) ───────────────────────────────

  app.get('/api/proyectos/:id/raci/matriz', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const [tareasRes, rolesRes, asignacionesRes] = await Promise.all([
      withTenant(req.userId, client => client.query('SELECT id, nombre, descripcion, orden FROM raci_tareas WHERE proyecto_id = $1 ORDER BY orden ASC, created_at ASC', [req.params.id])),
      withTenant(req.userId, client => client.query('SELECT id, nombre, orden FROM raci_roles WHERE proyecto_id = $1 ORDER BY orden ASC, created_at ASC', [req.params.id])),
      withTenant(req.userId, client => client.query(
        `SELECT ra.tarea_id, ra.rol_id, ra.sigla FROM raci_asignaciones ra
           JOIN raci_tareas t ON t.id = ra.tarea_id WHERE t.proyecto_id = $1`,
        [req.params.id]
      )),
    ]);
    res.json({ success: true, data: { tareas: tareasRes.rows || [], roles: rolesRes.rows || [], asignaciones: asignacionesRes.rows || [] } });
  }));

  // PUT asignación de una celda — upsert por (tarea_id, rol_id). sigla=null
  // borra la celda (queda vacía). Valida explícitamente que tareaId Y rolId
  // pertenezcan AMBOS al :id de la URL antes de escribir — sin esto, un
  // request podría cruzar una tarea del proyecto A con un rol del proyecto B
  // (contaminación de datos entre proyectos del mismo usuario, hallazgo del
  // architect review, no solo entre usuarios distintos).
  app.put('/api/proyectos/:id/raci/asignaciones/:tareaId/:rolId', authenticateToken, ...limiteEscritura, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const [tareaRes, rolRes] = await Promise.all([
      withTenant(req.userId, client => client.query('SELECT id FROM raci_tareas WHERE id = $1 AND proyecto_id = $2', [req.params.tareaId, req.params.id])),
      withTenant(req.userId, client => client.query('SELECT id FROM raci_roles WHERE id = $1 AND proyecto_id = $2', [req.params.rolId, req.params.id])),
    ]);
    const tarea = tareaRes.rows?.[0];
    const rol = rolRes.rows?.[0];
    if (!tarea) return res.status(404).json({ success: false, message: 'Tarea no encontrada en este proyecto' });
    if (!rol) return res.status(404).json({ success: false, message: 'Rol no encontrado en este proyecto' });

    const sigla = req.body?.sigla ?? null;
    if (sigla === null) {
      await withTenant(req.userId, client => client.query(
        'DELETE FROM raci_asignaciones WHERE tarea_id = $1 AND rol_id = $2',
        [req.params.tareaId, req.params.rolId]
      ));
      return res.json({ success: true, sigla: null });
    }
    if (!SIGLAS_VALIDAS.has(sigla)) {
      return res.status(400).json({ success: false, message: `sigla debe ser una de: ${[...SIGLAS_VALIDAS].join(', ')}, o null` });
    }
    await withTenant(req.userId, client => client.query(
      `INSERT INTO raci_asignaciones (tarea_id, rol_id, sigla, updated_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
       ON CONFLICT (tarea_id, rol_id) DO UPDATE SET sigla = EXCLUDED.sigla, updated_at = CURRENT_TIMESTAMP`,
      [req.params.tareaId, req.params.rolId, sigla]
    ));
    res.json({ success: true, sigla });
  }));

  // ── RESUMEN (validación) ──────────────────────────────────────────────────

  app.get('/api/proyectos/:id/raci/resumen', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const resumen = await calcularResumenRaci(req.params.id, {
      getRows: async (sql, params) => (await withTenant(req.userId, client => client.query(sql, params))).rows || [],
    });
    res.json({ success: true, data: resumen });
  }));
}
