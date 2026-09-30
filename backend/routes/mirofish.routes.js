/**
 * mirofish.routes.js — F-09: comité hostil MIROFISH.
 *
 * POST /api/proyectos/:id/mirofish — convoca al comité (reglas + IA BYOK)
 * GET  /api/proyectos/:id/mirofish — última evaluación
 *
 * Diseño fiscalizado por architect (2026-09-24, APROBADO CON CAMBIOS):
 *  - Cadena de middlewares idéntica a POST /viabilidad-ia (server.js):
 *    authenticateToken, requireAccess('formulador'), aiLimiter (sin byokGate desde B1, 2026-09-28).
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
import { faltantesMirofish, respuesta422 } from '../services/datosMinimosIA.js';
import { resolverDirectivas } from '../services/directivasFormulacion.js';
import { evaluarVectores } from '../services/auditoriaVectores.js';
import { hoyBogota } from '../services/vigenciaDocumental.js';
import { logger } from '../utils/logger.js';
import { SQL_ANEXOS_META, huellaMetadatos, seccionCumple, cargarArbol, arbolObjetivosRegistrado } from '../services/expedienteFinanciador.js';

const ORDEN_SEVERIDAD = { CRITICA: 0, ALTA: 1, MEDIA: 2, INFO: 3 };

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
  const [logistica, tramos, apu, budgets, anexos, teoriaCambioRegistrada, arbol] = await Promise.all([
    withTenantRow(userId, 'SELECT departamento, municipio, zona, fecha_inicio, duracion_meses FROM config_logistica WHERE proyecto_id = ? AND user_id = ?', [pid, userId]),
    withTenantRows(userId, 'SELECT numero, origen, destino, medio, distancia_km, duracion, estado_via, calidad, tipo_transporte, orden_publico FROM logistica_tramos WHERE proyecto_id = ? ORDER BY numero ASC', [pid]),
    withTenantRows(userId, 'SELECT descripcion, valor_total_cop FROM project_apu_lineas WHERE project_id = ?', [pid]),
    withTenantRows(userId, 'SELECT capitulo, item, valor_total FROM project_budgets WHERE proyecto_id = ?', [pid]),
    withTenantRows(userId, SQL_ANEXOS_META, [pid]),
    teoriaCambioDelProyecto(pid, userId),
    cargarArbol((sql, params) => withTenantRows(userId, sql, params), pid),
  ]);
  const entrada = parseJson(proyecto.ficha_tecnica).entrada_completa || {};
  const directivas = resolverDirectivas(entrada);
  const expediente = await seccionesExpedienteConContenido(pid, userId, huellaMetadatos(entrada, anexos, arbol));

  const datos = {};
  const poner = (k, v) => { const t = texto(v); if (t) datos[k] = t; };
  poner('proyecto.nombre', proyecto.nombre);
  poner('entrada.municipio', entrada.municipio);
  poner('entrada.vereda', entrada.vereda);
  // Ejes del financiador (Fase B 2026-09-30): la IA adversarial puede citarlos.
  poner('entrada.tipo_proyecto', directivas.vectores.tipoProyecto);
  poner('entrada.fuente_financiacion', directivas.vectores.fuente);
  poner('entrada.nivel_proyecto', directivas.vectores.nivel);
  poner('entrada.metodologias', directivas.vectores.metodologias.join('; '));
  poner('entrada.formato_financiador', directivas.vectores.formato);
  poner('entrada.problema_seleccionado', entrada.contextoMeta?.problemaSeleccionado);
  poner('entrada.problema_urgente', entrada.contexto?.problema_urgente);
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
  // Reglas V (auditor determinista por ejes del financiador).
  const problemas = [
    { campo: 'entrada.problema_seleccionado', valor: texto(entrada.contextoMeta?.problemaSeleccionado) },
    { campo: 'entrada.problema_urgente', valor: texto(entrada.contexto?.problema_urgente) },
  ].filter(p => p.valor);
  const textosMoneda = [
    ...Object.entries(entrada.contexto || {}).map(([k, v]) => ({ campo: `entrada.contexto.${k}`, valor: texto(v) })),
    { campo: 'entrada.pitch', valor: texto(entrada.pitch) },
    ...lineasPresupuesto,
  ].filter(t => t.valor);
  const hallazgosVectores = evaluarVectores({ directivas, problemas, textosMoneda, anexos, teoriaCambioRegistrada, expediente, arbolObjetivos: arbolObjetivosRegistrado(arbol.nodos), hoy: hoyBogota() });

  return { datos, lineasPresupuesto, ubicacion, hallazgosVectores, tramos: tramos.map(t => ({ numero: texto(t.numero), orden_publico: texto(t.orden_publico) })) };
}

/**
 * Secciones del Expediente del Financiador cuya ÚLTIMA generación cuenta
 * como soporte: contenido verificable en sus grupos mínimos (seccionCumple)
 * y fuentes sin cambios desde que se generó (misma huella). try/catch: sin
 * la migración 078 el comité sigue funcionando (solo no cuenta el expediente).
 * @returns {Promise<Record<string, boolean>>}
 */
async function seccionesExpedienteConContenido(pid, userId, huellaActual) {
  try {
    const filas = await withTenantRows(userId, 'SELECT seccion, estado, contenido, huella FROM project_expediente_financiador WHERE project_id = ? ORDER BY created_at DESC LIMIT 100', [pid]);
    const ultimas = {};
    for (const f of filas) {
      if (f.seccion in ultimas) continue;
      ultimas[f.seccion] = f.huella === huellaActual && seccionCumple(f.seccion, { estado: f.estado, contenido: parseJson(f.contenido) });
    }
    return ultimas;
  } catch (err) {
    logger.warn('[mirofish] Expediente del Financiador no verificable — las reglas V solo miran anexos', { proyectoId: pid, err: err.message });
    return {};
  }
}

/**
 * true si el proyecto tiene ruta causal registrada; null si no se pudo
 * verificar. try/catch propio: la tabla nació con dos esquemas distintos
 * (server.js project_id vs migración 016 proyecto_id — la BD viva tiene
 * proyecto_id, verificado 2026-09-30) y un error aquí no puede tumbar el
 * comité con un 500 (dictamen architect, cond. 2).
 */
async function teoriaCambioDelProyecto(pid, userId) {
  try {
    const fila = await withTenantRow(userId, 'SELECT resultados_corto_plazo, impacto_largo_plazo FROM project_change_theory WHERE proyecto_id = ?', [pid]);
    if (!fila) return false;
    let resultados = [];
    try { resultados = JSON.parse(fila.resultados_corto_plazo || '[]'); } catch { /* texto no JSON: sin resultados */ }
    return Array.isArray(resultados) && resultados.length > 0 && !!texto(fila.impacto_largo_plazo);
  } catch (err) {
    logger.warn('[mirofish] project_change_theory no verificable — la regla V3 lo trata como no registrado', { proyectoId: pid, err: err.message });
    return null;
  }
}

export function registerMirofishRoutes(app, { authenticateToken, requireAccess, aiLimiter }) {
  async function cargarProyecto(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, nombre, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/mirofish', authenticateToken, requireAccess('formulador'), aiLimiter, wrap(async (req, res) => {
    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { datos, lineasPresupuesto, ubicacion, tramos, hallazgosVectores } = await recolectar(proyecto, req.userId);
    // LOTE 10: sin ubicación o sin presupuesto el comité no tiene qué evaluar
    // → 422 con la lista exacta, ANTES de llamar a Gemini.
    const faltantes = faltantesMirofish({ datos, lineasPresupuesto, ubicacion });
    if (faltantes.length) return res.status(422).json(respuesta422('el Comité MIROFISH', faltantes));
    const reglas = evaluarReglas({ ubicacion, lineasPresupuesto, tramos });
    if (reglas.municipio_match.municipio) {
      datos['pdet.municipio'] = `${reglas.municipio_match.municipio.municipio} (${reglas.municipio_match.municipio.departamento}) — municipio PDET, subregión ${reglas.municipio_match.municipio.subregion}`;
    }
    // Reglas R (PDET) + V (ejes del financiador): la IA recibe ambas para no repetirlas.
    // Ordenados por severidad (orden estable): el Formulador MGA toma los primeros 12 y
    // un CRÍTICO/ALTO de las reglas V no puede quedar fuera por ir al final (architect, cond. 5).
    const hallazgosReglas = [...reglas.hallazgos, ...hallazgosVectores]
      .map((h, i) => ({ h, i }))
      .sort((a, b) => (ORDEN_SEVERIDAD[a.h.severidad] ?? 9) - (ORDEN_SEVERIDAD[b.h.severidad] ?? 9) || a.i - b.i)
      .map(({ h }) => h);
    const ia = await evaluarComiteIA({ datos, hallazgosReglas, userId: req.userId });

    const fila = await withTenantRow(req.userId,
      `INSERT INTO project_mirofish_evaluaciones (project_id, org_id, municipio_match, reglas, ia, created_by)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [req.params.id, req.userId, JSON.stringify(reglas.municipio_match),
        JSON.stringify({ hallazgos: hallazgosReglas, lineas_seguridad: reglas.lineas_seguridad }), JSON.stringify(ia), req.userId]
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
