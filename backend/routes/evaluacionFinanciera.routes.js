/**
 * evaluacionFinanciera.routes.js — F-06: Montecarlo de VAN/TIR (COP).
 *
 * POST /api/proyectos/:id/montecarlo  { beneficioMin, beneficioProbable, beneficioMax, horizonteAnios, semilla? }
 * GET  /api/proyectos/:id/montecarlo  — última corrida + si quedó obsoleta
 *
 * Diseño fiscalizado por architect (2026-09-24, APROBADO CON CAMBIOS B1-B4):
 *  - requireAccess('formulador') en ambas rutas (B1).
 *  - Cada corrida es una fila de project_montecarlo_runs (migración 070), no
 *    una clave dentro de proyectos.ficha_tecnica (B2/B3: otros flujos
 *    reescriben ficha_tecnica completa y la borrarían).
 *  - 409 si el proyecto está Finalizado (B4).
 *  - Inversión = SUM(project_apu_lineas.valor_total_cop): la MISMA fuente del
 *    punto de equilibrio (proyectos.routes.js) y del SROI
 *    (ValorExponencialService.js). project_budgets NO se suma (doble conteo).
 *  - GET marca `obsoleta` si la inversión actual ya no coincide con la de la
 *    corrida (p. ej. se subió un APU nuevo en Anexos) — sin tocar Anexos.
 */
import crypto from 'crypto';
import { simularVanTir, ITERACIONES, TASA_SOCIAL_DESCUENTO } from '../services/montecarloFinanciero.js';
import { captureError } from '../config/sentry.config.js';
import { withTenantRow, withTenantRows, withTenantRun } from '../config/database.config.js';
import { validarBody, montecarloSchema } from '../validators/zodSchemas.js';
import { contieneMonedaNoCOP } from './proyectos.routes.js';

const INVERSION_FUENTE = 'auto_extraido_project_apu_lineas';

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      // Mismo criterio que estresFinanciero.routes.js: err.status presente =
      // mensaje controlado (MontecarloError 422); ausente = no exponer err.message.
      console.error('[evaluacionFinanciera]', err.message);
      captureError(err, { route: 'evaluacionFinanciera', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

async function inversionActual(proyectoId, userId) {
  const lineas = await withTenantRows(userId, 'SELECT valor_total_cop FROM project_apu_lineas WHERE project_id = ?', [proyectoId]);
  return Math.round(lineas.reduce((s, l) => s + Number(l.valor_total_cop || 0), 0) * 100) / 100;
}

// pg devuelve NUMERIC como string — el contrato de la API entrega números.
function normalizarCorrida(row) {
  if (!row) return null;
  const n = { ...row };
  for (const k of ['inversion_cop', 'beneficio_min_cop', 'beneficio_probable_cop', 'beneficio_max_cop', 'tasa_descuento', 'semilla']) {
    if (n[k] != null) n[k] = Number(n[k]);
  }
  return n;
}

export function registerEvaluacionFinancieraRoutes(app, { authenticateToken, requireAccess, financialPipelineLimiter }) {
  async function cargarProyecto(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, estado FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  app.post('/api/proyectos/:id/montecarlo', authenticateToken, requireAccess('formulador'), financialPipelineLimiter, wrap(async (req, res) => {
    if (contieneMonedaNoCOP(req.body)) {
      return res.status(422).json({ success: false, message: 'Los montos deben expresarse únicamente en COP — se detectó un código de moneda distinto.' });
    }
    const validacion = validarBody(montecarloSchema, req.body);
    if (!validacion.ok) return res.status(400).json({ success: false, message: validacion.message });

    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });

    const inversionCop = await inversionActual(req.params.id, req.userId);
    if (inversionCop <= 0) {
      return res.status(422).json({ success: false, message: 'El proyecto no tiene líneas de presupuesto ingeridas — sube primero un presupuesto/APU en Anexos antes de simular el VAN/TIR.' });
    }

    const { beneficioMin, beneficioProbable, beneficioMax, horizonteAnios } = validacion.data;
    const semilla = validacion.data.semilla ?? crypto.randomInt(0, 0xFFFFFFFF);
    const resultado = simularVanTir({
      inversionCop, beneficioMin, beneficioProbable, beneficioMax, horizonteAnios,
      tasa: TASA_SOCIAL_DESCUENTO, iteraciones: ITERACIONES, semilla,
    });

    const fila = await withTenantRow(req.userId,
      `INSERT INTO project_montecarlo_runs
         (project_id, org_id, inversion_cop, inversion_fuente, beneficio_min_cop, beneficio_probable_cop, beneficio_max_cop,
          horizonte_anios, tasa_descuento, iteraciones, semilla, resultado, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [req.params.id, req.userId, inversionCop, INVERSION_FUENTE, beneficioMin, beneficioProbable, beneficioMax,
        horizonteAnios, TASA_SOCIAL_DESCUENTO, ITERACIONES, semilla, JSON.stringify(resultado), req.userId]
    );
    res.status(201).json({ success: true, data: { ...normalizarCorrida(fila), obsoleta: false, inversion_actual_cop: inversionCop } });
  }));

  app.get('/api/proyectos/:id/montecarlo', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyecto = await cargarProyecto(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const [ultima, inversion] = await Promise.all([
      withTenantRow(req.userId, 'SELECT * FROM project_montecarlo_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [req.params.id]),
      inversionActual(req.params.id, req.userId),
    ]);
    const corrida = normalizarCorrida(ultima);
    res.json({
      success: true,
      data: corrida ? { ...corrida, obsoleta: Math.abs(corrida.inversion_cop - inversion) > 0.005, inversion_actual_cop: inversion } : null,
      inversion_actual_cop: inversion,
    });
  }));
}
