/**
 * M12 — Ficha Técnica Maestra con Integridad Hash
 * Genera un sello SHA-256 inmutable de cada versión final del proyecto.
 */

import crypto from 'crypto';

export function registerFichaTecnicaRoutes(app, { authenticateToken, runSql, getRow, getRows, tryCatch }) {

  // GET /api/m12/ficha/:proyectoId — historial de versiones selladas
  app.get('/api/m12/ficha/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const versiones = await getRows(
      `SELECT id, version_num, hash_sha256, contenido_resumido, firmado_en
       FROM versiones_proyecto
       WHERE proyecto_id = ? AND user_id = ?
       ORDER BY version_num DESC`,
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: versiones });
  }));

  // POST /api/m12/ficha/:proyectoId — generar sello SHA-256 de la versión actual
  app.post('/api/m12/ficha/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const proyectoId = req.params.proyectoId;

    const proyecto = await getRow(
      'SELECT * FROM proyectos WHERE id = ? AND user_id = ?',
      [proyectoId, req.userId]
    );
    if (!proyecto) {
      return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    }
    if (proyecto.estado === 'BLOQUEADO') {
      return res.status(409).json({
        success: false,
        code: 'PROYECTO_BLOQUEADO',
        message: 'El proyecto está bloqueado. Resuelve los errores antes de sellar.',
      });
    }

    // Hard-Lock predial (F-Legal-01): el único punto real de bloqueo estricto.
    // 'sin_evaluar' también bloquea — certificar exige un despeje EXPLÍCITO,
    // no simplemente que nadie haya corrido la auditoría predial todavía.
    const complianceLegal = await getRow(
      'SELECT estado_legal FROM compliance_data WHERE proyecto_id = ? AND user_id = ?',
      [proyectoId, req.userId]
    );
    if ((complianceLegal?.estado_legal || 'sin_evaluar') !== 'despejado') {
      return res.status(409).json({
        success: false,
        code: 'RIESGO_JURIDICO_CONDICIONADO',
        message: 'Riesgo jurídico condicionado — el predio debe quedar despejado antes de certificar.',
      });
    }

    // Recopilar todos los módulos del proyecto
    const [motorDialectico, compliance, marcoNormativo, logistica] = await Promise.all([
      getRow('SELECT tono, lista_oro, lista_negra, enfasis FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?', [proyectoId, req.userId]),
      getRow('SELECT ods_alineados, sostenibilidad_ambiental, sostenibilidad_social, enfoque_genero FROM compliance_data WHERE proyecto_id = ? AND user_id = ?', [proyectoId, req.userId]),
      getRow('SELECT normas_aplicables, citas_bibliograficas FROM marco_normativo WHERE proyecto_id = ? AND user_id = ?', [proyectoId, req.userId]),
      getRow('SELECT proponente_nombre, tipo_entidad, departamento, municipio FROM config_logistica WHERE proyecto_id = ? AND user_id = ?', [proyectoId, req.userId]),
    ]);

    const firmado_en = new Date().toISOString();

    // Objeto canónico a hashear (orden determinístico)
    const payload = {
      schema_version: '8.0',
      proyecto_id:    proyectoId,
      nombre:         proyecto.nombre,
      estado:         proyecto.estado,
      ficha_tecnica:  proyecto.ficha_tecnica  || '{}',
      presupuesto:    proyecto.presupuesto     || '{}',
      motor_dialectico: JSON.stringify(motorDialectico  || {}),
      compliance:       JSON.stringify(compliance       || {}),
      marco_normativo:  JSON.stringify(marcoNormativo   || {}),
      logistica:        JSON.stringify(logistica        || {}),
      firmado_en,
      firmado_por: req.userId,
    };

    const contenidoStr  = JSON.stringify(payload);
    const hash_sha256   = crypto.createHash('sha256').update(contenidoStr).digest('hex');

    // Calcular número de versión
    const ultima = await getRow(
      'SELECT MAX(version_num) as max_v FROM versiones_proyecto WHERE proyecto_id = ?',
      [proyectoId]
    );
    const version_num = (Number(ultima?.max_v) || 0) + 1;

    const contenido_resumido = `V${version_num} · ${proyecto.nombre} · ${proyecto.estado} · ${firmado_en}`;
    const versionId = crypto.randomUUID();

    await runSql(
      `INSERT INTO versiones_proyecto
       (id, proyecto_id, user_id, version_num, hash_sha256, contenido_resumido, firmado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [versionId, proyectoId, req.userId, version_num, hash_sha256, contenido_resumido, firmado_en]
    );

    // Marcar proyecto como Finalizado y guardar sello
    const sello = { hash: hash_sha256, version: version_num, firmado_en, schema: '8.0' };
    await runSql(
      `UPDATE proyectos
       SET estado = 'Finalizado', crosscheck_sello = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND estado NOT IN ('BLOQUEADO')`,
      [JSON.stringify(sello), proyectoId, req.userId]
    );

    res.json({
      success: true,
      data: {
        id:                versionId,
        version_num,
        hash_sha256,
        contenido_resumido,
        firmado_en,
        sello,
      },
    });
  }));

  // GET /api/m12/verificar/:hash — verifica si un hash existe en la base de datos
  app.get('/api/m12/verificar/:hash', tryCatch(async (req, res) => {
    const registro = await getRow(
      'SELECT id, proyecto_id, version_num, contenido_resumido, firmado_en FROM versiones_proyecto WHERE hash_sha256 = ?',
      [req.params.hash]
    );
    if (!registro) {
      return res.json({ success: true, valido: false, message: 'Hash no encontrado en el registro' });
    }
    res.json({ success: true, valido: true, data: registro });
  }));
}
