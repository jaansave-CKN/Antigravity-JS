/**
 * formulacionIntegral.routes.js — cadena "un clic" de formulación integral
 * (2026-09-22, mandato del usuario, diseño revisado por el agente
 * `architect` antes de escribirse — dos rondas: la primera rechazó un
 * "GP_Formulador" genérico por no tener ningún problema real que resolver;
 * la segunda aprobó ESTE alcance concreto una vez que el usuario dio el
 * flujo exacto con manejo de fallo parcial).
 *
 * De los 6 módulos que el usuario nombró originalmente para la cadena, solo
 * 3 tienen un agente de IA real detrás — verificado por grep antes de
 * construir esto (Motor Dialéctico, Ficha Técnica y Logística son CRUD o
 * agregación de solo lectura, cero llamadas a Gemini):
 *
 *   1. entrada      → EntradaIAService.js (generarEntradaDesdeInvestigacion)
 *   2. arbol        → arbolObjetivosAgent.js (generarArbolConIA)
 *   3. viabilidad   → viabilidadAgent.js (calcularViabilidadIA)
 *
 * Decisiones de producto tomadas explícitamente por el usuario (no asumidas
 * en silencio — ver conversación de diseño):
 *   - Paso 1 se autoguarda SIN revisión manual — pero solo rellena campos
 *     VACÍOS de ficha_tecnica.entrada_completa.contexto, nunca sobreescribe
 *     lo que el usuario ya haya escrito a mano (mismo criterio de "cero
 *     pérdida de datos" que ya usa el botón manual "Generar con AI" de
 *     Entrada — ver EntradaIAService.js).
 *   - objetivoCentral (paso 2) se pide como campo obligatorio en el body al
 *     lanzar la cadena — no existe hoy ninguna fuente automática confiable
 *     para derivarlo (es texto libre metodológico, no un campo ya guardado
 *     en otro módulo).
 *   - Se persiste desde el primer intento (objetivo_central_usado) para no
 *     tener que reenviarlo al reanudar tras un fallo.
 *   - Rate limit dedicado (formulacionIntegralLimiter, 6/hora) — esta
 *     cadena gasta hasta 3x la cuota real de Gemini que el resto de
 *     endpoints de IA por cada ejecución completa.
 *
 * Persistencia de progreso: SIN tabla/columna nueva — reusa el JSONB
 * ficha_tecnica ya existente (mismo precedente que viabilidad_ia/
 * viabilidad_financiera en proyectos.routes.js/server.js), bajo la clave
 * `formulacion_integral`. El POST es síncrono (los 3 agentes ya combinados
 * tardan segundos, no minutos — withKeyRotation() en
 * geminiCircuitBreaker.js es fail-fast, sin sleep bloqueante) pero persiste
 * el progreso INMEDIATAMENTE después de cada paso exitoso — si la conexión
 * se corta a mitad de camino, el trabajo ya hecho no se pierde. El mismo
 * POST sirve para iniciar Y para reanudar: lee qué pasos ya están
 * `completado` y arranca desde el primero que no lo esté. Sin rollback ante
 * fallo parcial (mandato explícito del usuario): un paso ya completado
 * nunca se borra ni se re-ejecuta solo.
 *
 * GET /estado es de solo lectura (nunca toca Gemini) para que el frontend
 * pueda hacer polling de "voy en el paso X de 3" sin gastar cuota ni
 * disparar el rate limiter dedicado.
 *
 * Deliberadamente fuera de alcance (ver auditoría de arquitectura previa):
 * NO es un orquestador genérico ni un despachador reutilizable para futuros
 * agentes — es un endpoint de negocio con una secuencia fija y conocida de
 * 3 pasos. No crea cola/worker/Redis (no hay precedente de esa
 * infraestructura en el repo y no se justifica para 3 llamadas
 * secuenciales de menos de un minuto). No modifica el comportamiento de los
 * 3 endpoints individuales existentes (/api/proyectos/:id/entrada/generar-ai,
 * /api/modulo3b/arbol/generar, /api/proyectos/:id/viabilidad-ia) — siguen
 * funcionando igual para uso manual campo por campo.
 */
import crypto from 'crypto';
import { generarArbolConIA } from '../agents/arbolObjetivosAgent.js';
import { generarEntradaDesdeInvestigacion } from '../services/EntradaIAService.js';
import { calcularViabilidadIA, recolectarContextoViabilidad } from '../services/viabilidadAgent.js';
import { requireByokOrExento } from '../middlewares/byokGate.js';
import { captureError } from '../config/sentry.config.js';
import { withTenantRow, withTenantRun, withTenantRows, withTenantTransaction } from '../config/database.config.js';
import { validarBody, formulacionIntegralSchema } from '../validators/zodSchemas.js';

const PASOS = ['entrada', 'arbol', 'viabilidad'];
const LABEL_PASO = {
  entrada: 'Contexto/Entrada',
  arbol: 'Árbol de Objetivos',
  viabilidad: 'Viabilidad',
};

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      console.error('[formulacionIntegral]', err.message);
      captureError(err, { route: 'formulacionIntegral', method: req.method, path: req.path, userId: req.userId });
      res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

function safeParseJson(val, fallback = {}) {
  if (val == null) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function estadoInicial() {
  const ahora = new Date().toISOString();
  return {
    paso_actual: PASOS[0],
    pasos: Object.fromEntries(PASOS.map(p => [p, { estado: 'pendiente', completado_at: null, error: null }])),
    objetivo_central_usado: null,
    iniciado_at: ahora,
    actualizado_at: ahora,
  };
}

function primerPasoPendiente(progreso) {
  return PASOS.find(p => progreso.pasos[p]?.estado !== 'completado') || null;
}

export function registerFormulacionIntegralRoutes(app, { authenticateToken, requireAccess, formulacionIntegralLimiter }) {
  const byokGate = requireByokOrExento();

  async function cargarProyecto(proyectoId, userId) {
    return withTenantRow(userId,
      'SELECT id, nombre, ficha_tecnica, presupuesto, problem_statement FROM proyectos WHERE id = ? AND org_id = ?',
      [proyectoId, userId]
    );
  }

  async function persistirProgreso(userId, proyectoId, fichaTecnica, progreso) {
    progreso.actualizado_at = new Date().toISOString();
    const fichaActualizada = { ...fichaTecnica, formulacion_integral: progreso };
    await withTenantRun(userId,
      'UPDATE proyectos SET ficha_tecnica = ?, updated_at = ? WHERE id = ? AND org_id = ?',
      [JSON.stringify(fichaActualizada), progreso.actualizado_at, proyectoId, userId]
    );
    return fichaActualizada;
  }

  // GET /api/formulacion/integral/:proyectoId/estado — polling liviano, sin Gemini.
  app.get('/api/formulacion/integral/:proyectoId/estado', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyecto = await cargarProyecto(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const fichaTecnica = safeParseJson(proyecto.ficha_tecnica);
    const progreso = fichaTecnica.formulacion_integral || estadoInicial();
    res.json({ success: true, data: progreso });
  }));

  // POST /api/formulacion/integral/:proyectoId — inicia o reanuda la cadena.
  app.post('/api/formulacion/integral/:proyectoId', authenticateToken, requireAccess('formulador'), formulacionIntegralLimiter, byokGate, wrap(async (req, res) => {
    const proyectoId = req.params.proyectoId;
    const validacion = validarBody(formulacionIntegralSchema, req.body);
    if (!validacion.ok) return res.status(400).json({ success: false, message: validacion.message });

    const proyecto = await cargarProyecto(proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    let fichaTecnica = safeParseJson(proyecto.ficha_tecnica);
    let progreso = fichaTecnica.formulacion_integral || estadoInicial();

    // Ya completa — idempotente, jamás vuelve a llamar a ningún agente.
    if (!primerPasoPendiente(progreso)) {
      return res.json({ success: true, completo: true, message: 'Formulación integral ya completa.', data: progreso });
    }

    const objetivoCentral = validacion.data.objetivoCentral || progreso.objetivo_central_usado || null;

    // Corte temprano ANTES de gastar ninguna llamada real a Gemini: si el
    // árbol sigue pendiente en esta ejecución y no hay objetivoCentral (ni
    // nuevo ni ya persistido de un intento anterior), no tiene sentido
    // siquiera empezar el paso 1 para luego trabarse en el paso 2.
    if (progreso.pasos.arbol.estado !== 'completado' && !objetivoCentral) {
      return res.status(400).json({
        success: false,
        code: 'OBJETIVO_CENTRAL_REQUERIDO',
        message: 'objetivoCentral es requerido para completar el Árbol de Objetivos — envíalo en el body para lanzar o reanudar la cadena.',
        data: progreso,
      });
    }
    if (objetivoCentral) progreso.objetivo_central_usado = objetivoCentral;

    while (true) {
      const paso = primerPasoPendiente(progreso);
      if (!paso) break; // todos los pasos completados dentro de este mismo request

      progreso.paso_actual = paso;

      try {
        if (paso === 'entrada') {
          const scopedDeps = {
            getRow:  (sql, params) => withTenantRow(req.userId, sql, params),
            getRows: (sql, params) => withTenantRows(req.userId, sql, params),
            runSql:  (sql, params) => withTenantRun(req.userId, sql, params),
          };
          const generado = await generarEntradaDesdeInvestigacion(proyectoId, req.userId, { ...scopedDeps, userGeminiKeys: req.userGeminiKeys });

          // Fusión sin pisar datos ya escritos — mismo criterio que el botón
          // manual "Generar con AI" de Entrada (nunca sobreescribe lo real).
          const entradaActual = fichaTecnica.entrada_completa || {};
          const contextoActual = entradaActual.contexto || {};
          const contextoFusionado = { ...contextoActual };
          for (const [campo, valor] of Object.entries(generado || {})) {
            if (!contextoFusionado[campo] || !String(contextoFusionado[campo]).trim()) {
              contextoFusionado[campo] = valor;
            }
          }
          fichaTecnica = { ...fichaTecnica, entrada_completa: { ...entradaActual, contexto: contextoFusionado } };

        } else if (paso === 'arbol') {
          const nodos = await generarArbolConIA(objetivoCentral, req.userGeminiKeys, req.userId);
          const ids = nodos.map(() => crypto.randomUUID());
          const queries = [
            { sql: 'DELETE FROM objetivos_arbol WHERE proyecto_id = ?', params: [proyectoId] },
            ...nodos.map((n, i) => ({
              sql: `INSERT INTO objetivos_arbol (id, proyecto_id, tipo, nivel, texto, parent_id, generado_por_ia, confirmado)
                    VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
              params: [
                ids[i], proyectoId, n.tipo, n.nivel, n.texto,
                (n.parentIndex !== null && n.parentIndex !== undefined) ? ids[n.parentIndex] : null,
              ],
            })),
          ];
          // Transacción real (DELETE+INSERT atómico) — a diferencia del
          // endpoint manual /api/modulo3b/arbol/generar (server.js), que
          // hace el mismo DELETE+loop de INSERT sin transacción. No se toca
          // ese endpoint existente (fuera de alcance de este pedido); el
          // nuevo sí usa el helper ya disponible para no repetir ese riesgo
          // en código escrito hoy.
          await withTenantTransaction(req.userId, queries);

        } else if (paso === 'viabilidad') {
          const scopedDeps = {
            getRow:  (sql, params) => withTenantRow(req.userId, sql, params),
            getRows: (sql, params) => withTenantRows(req.userId, sql, params),
          };
          const proyectoParaViabilidad = { ...proyecto, ficha_tecnica: fichaTecnica };
          const { ctx, fichaTecnica: fichaBase } = await recolectarContextoViabilidad(proyectoParaViabilidad, req.userId, scopedDeps);
          const resultado = await calcularViabilidadIA(ctx, req.userGeminiKeys);
          fichaTecnica = { ...fichaBase, viabilidad_ia: resultado };
        }

        progreso.pasos[paso] = { estado: 'completado', completado_at: new Date().toISOString(), error: null };
        fichaTecnica = await persistirProgreso(req.userId, proyectoId, fichaTecnica, progreso);

      } catch (err) {
        const mensajeError = err.message || 'Error desconocido';
        progreso.pasos[paso] = { estado: 'fallido', completado_at: null, error: mensajeError };
        await persistirProgreso(req.userId, proyectoId, fichaTecnica, progreso);

        const status = err.status || 502;
        return res.status(status).json({
          success: false,
          code: err.code || 'FORMULACION_INTEGRAL_PASO_FALLIDO',
          message: `Formulación pausada. Fallo en ${LABEL_PASO[paso]}: ${mensajeError}. Vuelve a llamar a este mismo endpoint para reanudar desde aquí.`,
          data: progreso,
        });
      }
    }

    res.json({ success: true, completo: true, message: 'Formulación integral completa.', data: progreso });
  }));
}
