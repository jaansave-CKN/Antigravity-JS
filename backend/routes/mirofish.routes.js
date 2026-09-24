/**
 * mirofish.routes.js — F-09: comité hostil MIROFISH.
 *
 * POST /api/proyectos/:id/mirofish — convoca al comité (reglas + IA BYOK)
 * GET  /api/proyectos/:id/mirofish — última evaluación
 *
 * Diseño fiscalizado por architect (2026-09-24, APROBADO CON CAMBIOS):
 *  - Cadena de middlewares idéntica a POST /viabilidad-ia (server.js):
 *    authenticateToken, requireAccess('formulador'), aiLimiter, byokGate.
 *  - R1 busca el rubro de seguridad en AMBAS fuentes de presupuesto
 *    (project_apu_lineas del APU en Anexos + project_budgets del módulo
 *    Presupuesto) — B2: mirar solo una daba falsos CRÍTICOS.
 *  - Si la IA no está disponible el comité responde 200 con las reglas
 *    deterministas e ia.estado='no_disponible' + motivo (B4) — nunca una
 *    heurística disfrazada de IA.
 *  - Persistencia en project_mirofish_evaluaciones (migración 071), no en
 *    project_hallazgos.
 */
import { withTenantRow, withTenantRows } from '../config/database.config.js';
import { captureError } from '../config/sentry.config.js';
import { evaluarReglas } from '../services/mirofishReglas.js';
import { evaluarComiteIA } from '../services/mirofishComite.js';

const MAX_LINEAS = 40;

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[mirofish]', err.message);
      captureError(err, { route: 'mirofish', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

function parseJson(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}') || {}; } catch { return {}; }
}

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** Reúne los datos reales del proyecto como diccionario plano campo → valor. */
async function recolectar(proyecto, userId) {
  const pid = proyecto.id;
  const [logistica, tramos, apu, budgets] = await Promise.all([
    withTenantRow(userId, 'SELECT departamento, municipio, zona, fecha_inicio, duracion_meses FROM config_logistica WHERE proyecto_id = ? AND user_id = ?', [pid, userId]),
    withTenantRows(userId, 'SELECT numero, origen, destino, medio, distancia_km, duracion, estado_via, calidad, tipo_transporte, orden_publico FROM logistica_tramos WHERE proyecto_id = ? ORDER BY numero ASC', [pid]),
    withTenantRows(userId, 'SELECT descripcion, valor_total_cop FROM project_apu_lineas WHERE project_id = ?', [pid]),
    withTenantRows(userId, 'SELECT capitulo, item, valor_total FROM project_budgets WHERE proyecto_id = ?', [pid]),
  ]);
  const entrada = parseJson(proyecto.ficha_tecnica).entrada_completa || {};

  const datos = {};
  const poner = (k, v) => { const t = texto(v); if (t) datos[k] = t; };
  poner('proyecto.nombre', proyecto.nombre);
  poner('entrada.municipio', entrada.municipio);
  poner('entrada.vereda', entrada.vereda);
  if (logistica) {
    for (const k of ['departamento', 'municipio', 'zona', 'fecha_inicio', 'duracion_meses']) poner(`logistica.${k}`, logistica[k]);
  }
  for (const t of tramos) {
    const n = texto(t.numero) || '?';
    for (const k of ['origen', 'destino', 'medio', 'distancia_km', 'duracion', 'estado_via', 'calidad', 'tipo_transporte', 'orden_publico']) poner(`tramo[${n}].${k}`, t[k]);
  }
  const totalApu = apu.reduce((s, l) => s + Number(l.valor_total_cop || 0), 0);
  const totalManual = budgets.reduce((s, l) => s + Number(l.valor_total || 0), 0);
  if (apu.length) poner('presupuesto.total_apu_cop', Math.round(totalApu));
  if (budgets.length) poner('presupuesto.total_modulo_presupuesto_cop', Math.round(totalManual));
  apu.slice(0, MAX_LINEAS).forEach((l, i) => { poner(`apu[${i + 1}].descripcion`, l.descripcion); poner(`apu[${i + 1}].valor_total_cop`, Math.round(Number(l.valor_total_cop || 0))); });
  budgets.slice(0, MAX_LINEAS).forEach((l, i) => { poner(`presupuesto[${i + 1}].item`, [l.capitulo, l.item].filter(Boolean).join(' — ')); poner(`presupuesto[${i + 1}].valor_total_cop`, Math.round(Number(l.valor_total || 0))); });

  // Todas las líneas (no solo las 40 enviadas a la IA) para la regla R1.
  const lineasPresupuesto = [
    ...apu.map((l, i) => ({ campo: `apu[${i + 1}].descripcion`, valor: texto(l.descripcion) })),
    ...budgets.map((l, i) => ({ campo: `presupuesto[${i + 1}].item`, valor: [texto(l.capitulo), texto(l.item)].filter(Boolean).join(' — ') })),
  ].filter(l => l.valor);
  const ubicacion = [
    { campo: 'entrada.municipio', valor: texto(entrada.municipio) },
    { campo: 'logistica.municipio', valor: texto(logistica?.municipio) },
    { campo: 'logistica.departamento', valor: texto(logistica?.departamento) },
  ];
  return { datos, lineasPresupuesto, ubicacion, tramos: tramos.map(t => ({ numero: texto(t.numero), orden_publico: texto(t.orden_publico) })) };
}

export function registerMirofishRoutes(app, { authenticateToken, requireAccess, aiLimiter, byokGate }) {
  async function cargarProyecto(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, nombre, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/mirofish', authenticateToken, requireAccess('formulador'), aiLimiter, byokGate, wrap(async (req, res) => {
    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { datos, lineasPresupuesto, ubicacion, tramos } = await recolectar(proyecto, req.userId);
    const reglas = evaluarReglas({ ubicacion, lineasPresupuesto, tramos });
    if (reglas.municipio_match.municipio) {
      datos['pdet.municipio'] = `${reglas.municipio_match.municipio.municipio} (${reglas.municipio_match.municipio.departamento}) — municipio PDET, subregión ${reglas.municipio_match.municipio.subregion}`;
    }
    const ia = await evaluarComiteIA({ datos, hallazgosReglas: reglas.hallazgos, userId: req.userId, userGeminiKeys: req.userGeminiKeys });

    const fila = await withTenantRow(req.userId,
      `INSERT INTO project_mirofish_evaluaciones (project_id, org_id, municipio_match, reglas, ia, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [req.params.id, req.userId, JSON.stringify(reglas.municipio_match),
        JSON.stringify({ hallazgos: reglas.hallazgos, lineas_seguridad: reglas.lineas_seguridad }), JSON.stringify(ia), req.userId]
    );
    res.status(201).json({ success: true, data: fila });
  }));

  app.get('/api/proyectos/:id/mirofish', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const ultima = await withTenantRow(req.userId,
      'SELECT * FROM project_mirofish_evaluaciones WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [req.params.id]);
    res.json({ success: true, data: ultima || null });
  }));
}
