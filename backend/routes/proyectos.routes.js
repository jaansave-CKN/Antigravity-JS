/**
 * Módulo 9 — Gestión de Proyectos
 * Reemplaza los stubs de /api/proyectos con persistencia real.
 * Aislamiento multi-tenant via org_id derivado de la sesión JWT.
 */

import crypto from 'crypto';
import { runCrossCheck } from '../validators/crossCheckValidator.js';
import { sanitizeFormuladorBody } from '../middlewares/SecurityMiddleware.js';

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
export function registerProyectosRoutes(app, { authenticateToken, requireAccess, runSql, getRow, getRows, verifyPassword }) {

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
}

function safeParseJson(val) {
  if (!val) return null;
  try { return JSON.parse(val); }
  catch { return val; }
}
