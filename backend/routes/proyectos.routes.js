/**
 * Módulo 9 — Gestión de Proyectos
 * Reemplaza los stubs de /api/proyectos con persistencia real.
 * Aislamiento multi-tenant via org_id derivado de la sesión JWT.
 */

import crypto from 'crypto';
import { runCrossCheck } from '../validators/crossCheckValidator.js';
import { sanitizeFormuladorBody } from '../middlewares/SecurityMiddleware.js';
import { calcularViabilidadIA, recolectarContextoViabilidad, calcularPuntoEquilibrio } from '../services/viabilidadAgent.js';
import { auditarViabilidadFinancieraIncompleta } from '../services/AuditorForenseService.js';
import { supabaseAdmin } from '../config/supabase.config.js';

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      console.error('[proyectos] Error:', err.message);
      res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }
  };
}

// FIX AUDITORÍA (blindaje de moneda): ficha_tecnica/presupuesto son JSON libres
// sin campo de moneda hoy — ninguna pantalla ofrece ingresar otra divisa, así
// que esto nunca dispara en uso normal. Es una barrera estructural para que,
// si algún día se agrega un selector de moneda sin querer, el backend rechace
// cualquier valor que no sea COP en vez de aceptarlo silenciosamente.
const CODIGOS_MONEDA_NO_COP = /\b(USD|EUR|GBP|CAD|MXN)\b/;
export function contieneMonedaNoCOP(obj) {
  const texto = JSON.stringify(obj ?? {});
  return CODIGOS_MONEDA_NO_COP.test(texto);
}

/**
 * @param {import('express').Application} app
 * @param {{ authenticateToken: Function, requireAccess: Function, runSql: Function, getRow: Function, getRows: Function, verifyPassword: Function }} deps
 */
export function registerProyectosRoutes(app, { authenticateToken, requireAccess, runSql, runTransaction, getRow, getRows, verifyPassword, aiLimiter }) {

  /**
   * POST /api/proyectos
   * Crea un nuevo proyecto. Devuelve el proyectoId para navegación inmediata.
   *
   * Body:
   *   nombre         string  (requerido)
   *   fichaTecnica   object  { metaFisicaTotal, descripcion, ... }  — Módulo 3b
   *   presupuesto    object  { fasesNegra:[], fasesGris:[], fasesBlanca:[] } — Módulo 4
   */
  app.post('/api/proyectos', authenticateToken, requireAccess('formulador'), sanitizeFormuladorBody, wrap(async (req, res) => {
    const { nombre, fichaTecnica = {}, presupuesto = {} } = req.body;

    if (contieneMonedaNoCOP(fichaTecnica) || contieneMonedaNoCOP(presupuesto)) {
      return res.status(422).json({ success: false, message: 'Todos los montos deben estar en Pesos Colombianos (COP) — se detectó otra moneda en la solicitud.' });
    }

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
      id,          // id real generado por la BD — contrato canónico
      proyectoId: id, // alias retrocompatible (consumido por rutas existentes)
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
   * POST /api/proyectos/:id/duplicar
   * "Guardar como" — crea un proyecto NUEVO copiando ficha_tecnica y
   * presupuesto del proyecto origen bajo un nombre nuevo. No copia anexos,
   * árbol de objetivos, indicadores ni compliance — esos artefactos quedan
   * como punto de partida en blanco para la copia (evita duplicar archivos
   * reales subidos, que pertenecen al proyecto original).
   */
  app.post('/api/proyectos/:id/duplicar', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const original = await getRow(
      'SELECT nombre, ficha_tecnica, presupuesto FROM proyectos WHERE id = ? AND org_id = ?',
      [req.params.id, req.userId]
    );
    if (!original) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }

    const nombreNuevo = String(req.body?.nombre || `${original.nombre} (copia)`).trim().slice(0, 200);
    if (!nombreNuevo) {
      return res.status(400).json({ success: false, message: 'nombre es requerido' });
    }

    const orgId = req.userId;
    const id    = crypto.randomUUID();
    await runSql(
      `INSERT INTO proyectos
         (id, user_id, org_id, nombre, ficha_tecnica, presupuesto, estado)
       VALUES (?, ?, ?, ?, ?, ?, 'Borrador')`,
      [id, req.userId, orgId, nombreNuevo, original.ficha_tecnica, original.presupuesto]
    );

    return res.status(201).json({ success: true, message: 'Proyecto duplicado', id, nombre: nombreNuevo });
  }));

  /**
   * PATCH /api/proyectos/:id
   * Actualiza nombre, ficha_tecnica o presupuesto mientras el proyecto
   * no esté en estado Finalizado.
   */
  app.patch('/api/proyectos/:id', authenticateToken, requireAccess('formulador'), sanitizeFormuladorBody, wrap(async (req, res) => {
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

    if (contieneMonedaNoCOP(fichaTecnica) || contieneMonedaNoCOP(presupuesto)) {
      return res.status(422).json({ success: false, message: 'Todos los montos deben estar en Pesos Colombianos (COP) — se detectó otra moneda en la solicitud.' });
    }

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

  /**
   * DELETE /api/proyectos/:id
   * Borrado (soft-delete vía deleted_at, mismo patrón que /api/usuarios/:id/purgar
   * y el resto del proyecto — nunca DELETE físico salvo el Habeas Data explícito
   * de cuentas). Requiere la contraseña real de la cuenta en el body — mismo
   * mecanismo que POST /api/auth/validate-action (verifyPassword + password_hash),
   * verificado aquí mismo en vez de depender de un paso previo separado, para
   * que no exista ventana entre "validar" y "borrar".
   */
  app.delete('/api/proyectos/:id', authenticateToken, wrap(async (req, res) => {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ success: false, message: 'Se requiere tu contraseña para confirmar el borrado.' });
    }

    const proyecto = await getRow(
      'SELECT id, nombre FROM proyectos WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
      [req.params.id, req.userId]
    );
    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }

    const user = await getRow('SELECT password_hash FROM usuarios WHERE id = ?', [req.userId]);
    const valid = user?.password_hash && await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta — el proyecto no fue borrado.' });
    }

    await runSql('UPDATE proyectos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ?', [req.params.id, req.userId]);

    return res.json({ success: true, message: `Proyecto "${proyecto.nombre}" eliminado.` });
  }));

  /**
   * GET /api/proyectos/:id/hash
   * Genera un SHA-256 del estado actual del proyecto y lo registra como
   * versión inmutable en project_version_hashes (requisito de inmutabilidad V8.0).
   *
   * El hash cubre: payload_es, payload_en, status, updated_at del proyecto.
   * Cada llamada genera un nuevo registro (ledger de versiones).
   *
   * Response:
   *   { hash_id, project_id, hash_value, project_status, created_at, payload_size_bytes }
   */
  app.get('/api/proyectos/:id/hash', authenticateToken, wrap(async (req, res) => {
    const projectId = req.params.id;
    const tenantId  = req.tenantId || req.userId;

    // Cargar datos canónicos del proyecto (tabla projects, migración 003)
    let project = await getRow(
      `SELECT id, tenant_id, status, payload_es, payload_en, updated_at, name
       FROM projects WHERE id = $1 AND tenant_id = $2`,
      [projectId, tenantId]
    ).catch(e => { console.warn('[versionado] fallback a legacy', { err: e.message }); return null; });

    // Fallback a tabla legacy proyectos si no existe en projects
    if (!project) {
      project = await getRow(
        `SELECT id, org_id AS tenant_id, estado AS status,
                NULL AS payload_es, NULL AS payload_en,
                updated_at, nombre AS name
         FROM proyectos WHERE id = $1 AND org_id = $2`,
        [projectId, tenantId]
      ).catch(() => null);
    }

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Proyecto no encontrado o no pertenece a tu organización',
      });
    }

    // Construir el documento canónico a hashear
    const timestamp  = new Date().toISOString();
    const canonical  = JSON.stringify({
      project_id:   project.id,
      tenant_id:    project.tenant_id,
      status:       project.status,
      payload_es:   project.payload_es ?? null,
      payload_en:   project.payload_en ?? null,
      db_updated_at: project.updated_at,
      hashed_at:    timestamp,
    });

    const payloadBytes = Buffer.byteLength(canonical, 'utf8');
    const hashValue    = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

    // Registrar en la tabla de hashes inmutables (append-only)
    const hashRecord = await getRow(
      `INSERT INTO project_version_hashes
         (project_id, tenant_id, hash_value, payload_size_bytes, project_status,
          triggered_by, created_by_user, metadata)
       VALUES ($1, $2, $3, $4, $5, 'api_request', $6, $7)
       ON CONFLICT (project_id, hash_value) DO UPDATE
         SET metadata = project_version_hashes.metadata  -- no-op, retorna la fila existente
       RETURNING id, project_id, hash_value, project_status, created_at, payload_size_bytes`,
      [
        project.id,
        project.tenant_id,
        hashValue,
        payloadBytes,
        project.status || 'unknown',
        req.userId,
        JSON.stringify({
          pipeline_version: '8.0',
          triggered_from:   'GET /api/proyectos/:id/hash',
          project_name:     project.name,
        }),
      ]
    );

    return res.json({
      success:         true,
      hash_id:         hashRecord.id,
      project_id:      hashRecord.project_id,
      hash_value:      hashRecord.hash_value,
      hash_algorithm:  'sha256',
      project_status:  hashRecord.project_status,
      created_at:      hashRecord.created_at,
      payload_size_bytes: hashRecord.payload_size_bytes,
      immutable:       true,
      verification_url: `/api/proyectos/${project.id}/hash/verify/${hashValue}`,
    });
  }));

  /**
   * GET /api/proyectos/:id/hash/verify/:hash
   * Verifica si un hash específico existe en el registro inmutable.
   * Permite a terceros verificar la integridad de un proyecto formulado.
   */
  app.get('/api/proyectos/:id/hash/verify/:hash', authenticateToken, wrap(async (req, res) => {
    const { id: projectId, hash: hashToVerify } = req.params;
    const tenantId = req.tenantId || req.userId;

    if (!/^[a-f0-9]{64}$/.test(hashToVerify)) {
      return res.status(400).json({ success: false, message: 'Hash inválido: debe ser SHA-256 hex (64 chars)' });
    }

    const record = await getRow(
      `SELECT id, project_id, hash_value, project_status, created_at, triggered_by
       FROM project_version_hashes
       WHERE project_id = $1 AND hash_value = $2 AND tenant_id = $3`,
      [projectId, hashToVerify, tenantId]
    );

    if (!record) {
      return res.status(404).json({
        success:  false,
        verified: false,
        message:  'Hash no encontrado en el registro de versiones — el proyecto puede haber sido alterado',
      });
    }

    return res.json({
      success:        true,
      verified:       true,
      hash_id:        record.id,
      project_id:     record.project_id,
      hash_value:     record.hash_value,
      project_status: record.project_status,
      registered_at:  record.created_at,
      triggered_by:   record.triggered_by,
    });
  }));

  /**
   * POST /api/proyectos/:id/continuar-formulacion
   * Flujo Delta → Versión N+1 (docs/DISENO_FLUJO_DELTA_VERSION_N+1.md).
   *
   * Recibe solo la corrección puntual que el usuario hizo tras recibir
   * banderas rojas (un campo de ficha_tecnica) — NO reprocesa el proyecto
   * completo desde cero. Anexos/árbol de objetivos ya están actualizados en
   * BD por sus propios endpoints (anexos.routes.js, etc.) antes de llegar
   * aquí, así que recolectarContextoViabilidad() ya los lee frescos.
   *
   * Fiscalizado por el Agente Arquitecto 2026-08-08: reutiliza
   * recolectarContextoViabilidad()/calcularViabilidadIA() (mismo motor que
   * POST /api/proyectos/:id/viabilidad-ia, no duplicado), envuelve la
   * escritura del delta + el registro de versión en una sola transacción
   * (para que un fallo parcial no deje una versión sin su delta persistido
   * o viceversa), y aplica el mismo guard "Finalizado" + ownership org_id
   * que el resto de este archivo. tenant_id se homologa a org_id, mismo
   * patrón ya usado en GET /api/proyectos/:id/hash de este mismo archivo
   * (`req.tenantId || req.userId`) — no auth.middleware.js, esa referencia
   * en el documento de diseño estaba mal citada y fue corregida por el
   * Arquitecto antes de este commit.
   *
   * Body: { delta: { ...campos de ficha_tecnica corregidos } }
   */
  app.post('/api/proyectos/:id/continuar-formulacion', authenticateToken, requireAccess('formulador'), aiLimiter, wrap(async (req, res) => {
    const proyectoId = req.params.id;
    const { delta } = req.body;

    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
      return res.status(400).json({ success: false, message: 'delta es requerido y debe ser un objeto' });
    }
    if (contieneMonedaNoCOP(delta)) {
      return res.status(422).json({ success: false, message: 'El delta debe expresarse únicamente en COP — se detectó un código de moneda distinto.' });
    }

    const proyecto = await getRow(
      'SELECT id, nombre, ficha_tecnica, presupuesto, problem_statement, estado FROM proyectos WHERE id = ? AND org_id = ?',
      [proyectoId, req.userId]
    );
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') {
      return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });
    }

    // Reprocesa viabilidad con el delta ya fusionado — mismo motor que
    // POST /api/proyectos/:id/viabilidad-ia, sin duplicar su lógica.
    const { ctx, fichaTecnica } = await recolectarContextoViabilidad(proyecto, req.userId, { getRow, getRows }, delta);
    const resultado = await calcularViabilidadIA(ctx);
    const fichaActualizada = { ...fichaTecnica, viabilidad_ia: resultado };
    const fichaJson = JSON.stringify(fichaActualizada);
    const ahora = new Date().toISOString();

    // Versión N+1 — mismo documento canónico y algoritmo que GET /hash, con
    // triggered_by propio para que quede trazable cuál fila vino de este
    // flujo. tenant_id homologado a org_id (single-tenant-per-org hoy).
    const tenantId = req.tenantId || req.userId;
    const canonical = JSON.stringify({
      project_id: proyectoId, tenant_id: tenantId, status: proyecto.estado,
      payload_es: fichaJson, payload_en: null, db_updated_at: ahora, hashed_at: ahora,
    });
    const hashValue = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

    // Delta + versión inmutable en una sola transacción — un fallo parcial no
    // debe dejar el proyecto actualizado sin su versión, ni viceversa.
    const [, hashRows] = await runTransaction([
      {
        sql: 'UPDATE proyectos SET ficha_tecnica = ?, updated_at = ? WHERE id = ? AND org_id = ?',
        params: [fichaJson, ahora, proyectoId, req.userId],
      },
      {
        sql: `INSERT INTO project_version_hashes
                (project_id, tenant_id, hash_value, payload_size_bytes, project_status,
                 triggered_by, created_by_user, metadata)
              VALUES ($1, $2, $3, $4, $5, 'delta_reprocesado', $6, $7)
              ON CONFLICT (project_id, hash_value) DO UPDATE
                SET metadata = project_version_hashes.metadata
              RETURNING id, project_id, hash_value, project_status, created_at, payload_size_bytes`,
        params: [
          proyectoId, tenantId, hashValue, Buffer.byteLength(canonical, 'utf8'),
          proyecto.estado || 'unknown', req.userId,
          JSON.stringify({ pipeline_version: '8.0', triggered_from: 'POST /api/proyectos/:id/continuar-formulacion', project_name: proyecto.nombre, delta_keys: Object.keys(delta) }),
        ],
      },
    ]);
    const hashRecord = hashRows.rows[0];

    res.json({
      success: true,
      data: resultado,
      version: {
        hash_id: hashRecord.id,
        hash_value: hashRecord.hash_value,
        hash_algorithm: 'sha256',
        triggered_by: 'delta_reprocesado',
        created_at: hashRecord.created_at,
        verification_url: `/api/proyectos/${proyectoId}/hash/verify/${hashValue}`,
      },
    });
  }));

  /**
   * POST /api/proyectos/:id/viabilidad-financiera
   * Punto de Equilibrio — especificación de negocio del Director, fiscalizada
   * por el Agente Arquitecto 2026-08-09 (ver backend/services/viabilidadAgent.js
   * :calcularPuntoEquilibrio para el detalle de por qué `is_break_even_reached`
   * es una comparación de punto único y no un cruce temporal real — este repo
   * no tiene ninguna tabla de ejecución/flujo de caja por periodo).
   *
   * No lleva aiLimiter: es cálculo matemático puro, no invoca Gemini.
   * Persiste en ficha_tecnica.viabilidad_financiera (JSONB ya existente) en
   * vez de columnas nuevas — mismo precedente que POST .../viabilidad-ia.
   *
   * costos_variables_totales se calcula EN VIVO como SUM(project_apu_lineas.
   * valor_total_cop) del proyecto (el presupuesto/APU real que el formulador
   * adjuntó en Anexos, elaborado en su software especializado) — nunca se
   * inventa por IA. Si el body manda un valor explícito, se respeta como
   * sobrescritura manual del formulador; si no, se usa el agregado real. Al
   * recalcularse en vivo en cada llamada, nunca queda obsoleto frente a un
   * presupuesto corregido — no depende de un snapshot cacheado en la subida.
   * costos_fijos_proyectados y ventas_totales_proyectadas siguen siendo
   * exclusivamente entrada manual del formulador: no existe ninguna tabla en
   * este esquema de la que derivarlos sin inventar cifras (verificado).
   *
   * Body: { costos_fijos_proyectados, ventas_totales_proyectadas, costos_variables_totales? }
   */
  app.post('/api/proyectos/:id/viabilidad-financiera', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyectoId = req.params.id;
    const { costos_fijos_proyectados, costos_variables_totales, ventas_totales_proyectadas } = req.body;

    if (contieneMonedaNoCOP(req.body)) {
      return res.status(422).json({ success: false, message: 'Los montos deben expresarse únicamente en COP — se detectó un código de moneda distinto.' });
    }

    const proyecto = await getRow(
      'SELECT id, ficha_tecnica, estado FROM proyectos WHERE id = ? AND org_id = ?',
      [proyectoId, req.userId]
    );
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') {
      return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });
    }

    // project_apu_lineas tiene RLS (tenant_isolation USING org_id =
    // current_setting('app.org_id')) que getRow/runSql no fija por request —
    // un SELECT por esa vía devuelve 0 filas siempre, silenciosamente
    // (verificado en vivo). supabaseAdmin (service_role) bypasea RLS, mismo
    // cliente que ya usan EstresadoFinancieroService.js/ValorExponencialService.js.
    const { data: lineasApu, error: sumError } = await supabaseAdmin
      .from('project_apu_lineas')
      .select('valor_total_cop')
      .eq('project_id', proyectoId);
    if (sumError) return res.status(500).json({ success: false, message: `No se pudo leer el presupuesto/APU real: ${sumError.message}` });
    const costosVariablesAuto = (lineasApu || []).reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);
    const sobrescrituraManual = costos_variables_totales !== undefined && costos_variables_totales !== null && costos_variables_totales !== '';
    const costosVariablesEfectivos = sobrescrituraManual ? costos_variables_totales : costosVariablesAuto;
    const costosVariablesFuente    = sobrescrituraManual ? 'manual' : 'auto_extraido_project_apu_lineas';

    const MENSAJES_ERROR = {
      BREAK_EVEN_COSTOS_FIJOS_INVALIDOS: 'costos_fijos_proyectados es requerido y debe ser un número ≥ 0.',
      BREAK_EVEN_COSTOS_VARIABLES_INVALIDOS: 'costos_variables_totales debe ser un número ≥ 0 (calculado automáticamente desde el presupuesto/APU adjunto en Anexos, o provisto manualmente).',
      BREAK_EVEN_VENTAS_INVALIDAS: 'ventas_totales_proyectadas es requerido y debe ser un número > 0.',
      BREAK_EVEN_MARGEN_INVALIDO: 'costos_variables_totales debe ser menor que ventas_totales_proyectadas — el margen de contribución resultante es cero o negativo, el punto de equilibrio no es matemáticamente alcanzable con estos valores.',
    };

    let resultado;
    try {
      resultado = calcularPuntoEquilibrio({ costos_fijos_proyectados, costos_variables_totales: costosVariablesEfectivos, ventas_totales_proyectadas });
    } catch (err) {
      return res.status(422).json({ success: false, code: err.message, message: MENSAJES_ERROR[err.message] || 'Datos financieros inválidos para el cálculo de punto de equilibrio.' });
    }
    resultado.costos_variables_totales_fuente = costosVariablesFuente;

    // Bandera Roja (no un juicio sobre el contenido del presupuesto, solo
    // presencia/ausencia): si no hay NINGÚN presupuesto/APU real ingerido en
    // Anexos, se reporta como hallazgo — el formulador decide si lo adjunta,
    // RadFor-360 no evalúa ni corrige sus documentos técnicos.
    auditarViabilidadFinancieraIncompleta(proyectoId, req.userId).catch(err => {
      console.error('[proyectos] auditarViabilidadFinancieraIncompleta falló (no bloqueante):', err.message);
    });

    const fichaTecnica = safeParseJson(proyecto.ficha_tecnica) || {};

    // Regla de negocio innegociable del Director (cita literal): "Queda
    // estrictamente prohibido que el sistema ofrezca esta opción al final de
    // la etapa de construcción" — prohibición ABSOLUTA e incondicional una
    // vez etapa_construccion_finalizada es true, sin importar el break-even.
    // Fiscalizado por el Agente Arquitecto 2026-08-09 (rechazó una primera
    // versión con polaridad invertida antes de esta).
    const etapaFinalizada = fichaTecnica.etapa_construccion_finalizada === true;
    resultado.reinversion = {
      habilitada: resultado.is_break_even_reached === true && !etapaFinalizada,
      modalidades_permitidas: ['total', 'parcial'],
    };

    // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 7): antes se leía
    // ficha_tecnica completo en JS, se mezclaba y se sobreescribía el blob
    // entero — confirmado en vivo 3/3 veces: 2 requests concurrentes ambos
    // respondían 200, pero cualquier otra clave escrita por un actor paralelo
    // (ej. anexos.routes.js invalidando este mismo campo tras ingerir un
    // presupuesto) se perdía en silencio. jsonb_set aplica el merge
    // atómicamente sobre el valor VIVO de la fila en Postgres, nunca sobre
    // una copia JS obsoleta — no reabre la decisión de no usar optimistic
    // lock global (esa sigue diferida), solo corrige la atomicidad del merge.
    // NOTA: proyectos.ficha_tecnica es TEXT en la BD real (no JSONB pese a lo
    // que declara 001_postgres_schema.sql — deriva de esquema verificada en
    // vivo), de ahí el cast ::jsonb de entrada y ::text de salida.
    await runSql(
      `UPDATE proyectos
       SET ficha_tecnica = jsonb_set(ficha_tecnica::jsonb, '{viabilidad_financiera}', ?::jsonb, true)::text,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND org_id = ?`,
      [JSON.stringify(resultado), proyectoId, req.userId]
    );

    return res.json({ success: true, data: resultado });
  }));

  /**
   * PUT /api/proyectos/:id/etapa-construccion
   * Marca manual de fin de obra física — no existe en este repo ningún
   * tracking automático de avance físico real (verificado por el Agente
   * Arquitecto), así que el Director definió que este campo lo marca el
   * usuario/formulador explícitamente, no se infiere de proyectos.estado
   * (workflow de formulación) ni de project_budgets.fase (taxonomía de
   * trabajo físico NEGRA/GRIS/BLANCA). Reversible (puede volver a false) —
   * no hay ninguna regla de negocio que exija un candado de un solo sentido.
   *
   * Body: { etapa_construccion_finalizada: boolean }
   */
  app.put('/api/proyectos/:id/etapa-construccion', authenticateToken, requireAccess('formulador'), wrap(async (req, res) => {
    const proyectoId = req.params.id;
    const { etapa_construccion_finalizada } = req.body;

    if (typeof etapa_construccion_finalizada !== 'boolean') {
      return res.status(400).json({ success: false, message: 'etapa_construccion_finalizada es requerido y debe ser boolean' });
    }

    const proyecto = await getRow(
      'SELECT id, ficha_tecnica, estado FROM proyectos WHERE id = ? AND org_id = ?',
      [proyectoId, req.userId]
    );
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') {
      return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });
    }

    const fichaTecnica = safeParseJson(proyecto.ficha_tecnica) || {};
    const fichaActualizada = { ...fichaTecnica, etapa_construccion_finalizada };

    await runSql(
      'UPDATE proyectos SET ficha_tecnica = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND org_id = ?',
      [JSON.stringify(fichaActualizada), proyectoId, req.userId]
    );

    return res.json({ success: true, data: { etapa_construccion_finalizada } });
  }));
}

function safeParseJson(val) {
  if (!val) return null;
  try { return JSON.parse(val); }
  catch { return val; }
}
