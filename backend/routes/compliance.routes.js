import crypto from 'crypto';

export function registerComplianceRoutes(app, { authenticateToken, runSql, getRow, tryCatch }) {

  // GET /api/m10/compliance/:proyectoId
  app.get('/api/m10/compliance/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const row = await getRow(
      'SELECT * FROM compliance_data WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: row || null });
  }));

  // POST /api/m10/compliance/:proyectoId
  app.post('/api/m10/compliance/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const {
      riesgos               = [],
      sostenibilidad_ambiental = '',
      sostenibilidad_social    = '',
      ods_alineados         = [],
      enfoque_genero        = false,
      enfoque_genero_texto  = '',
    } = req.body;

    const existing = await getRow(
      'SELECT id FROM compliance_data WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    const vals = [
      JSON.stringify(riesgos),
      sostenibilidad_ambiental,
      sostenibilidad_social,
      JSON.stringify(ods_alineados),
      enfoque_genero ? 1 : 0,
      enfoque_genero_texto,
    ];

    if (existing) {
      await runSql(
        `UPDATE compliance_data
         SET riesgos=?, sostenibilidad_ambiental=?, sostenibilidad_social=?,
             ods_alineados=?, enfoque_genero=?, enfoque_genero_texto=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [...vals, req.params.proyectoId, req.userId]
      );
    } else {
      await runSql(
        `INSERT INTO compliance_data
         (id, proyecto_id, user_id, riesgos, sostenibilidad_ambiental, sostenibilidad_social,
          ods_alineados, enfoque_genero, enfoque_genero_texto)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), req.params.proyectoId, req.userId, ...vals]
      );
    }

    res.json({ success: true, message: 'Datos de compliance guardados' });
  }));

  // PATCH /api/proyectos/:id/estado-legal — Soft-Lock predial (F-Legal-01).
  // Solo admin o el dueño del proyecto puede cambiar el estado. 'condicionado'
  // no bloquea nada aquí — es solo el flag que lee el badge del frontend y el
  // Hard-Lock de certificación (POST /api/m12/ficha/:proyectoId).
  const ESTADOS_LEGALES_VALIDOS = new Set(['sin_evaluar', 'condicionado', 'despejado']);
  app.patch('/api/proyectos/:id/estado-legal', authenticateToken, tryCatch(async (req, res) => {
    const { estado_legal } = req.body || {};
    if (!ESTADOS_LEGALES_VALIDOS.has(estado_legal)) {
      return res.status(400).json({
        success: false,
        message: `estado_legal debe ser uno de: ${[...ESTADOS_LEGALES_VALIDOS].join(', ')}`,
      });
    }

    const proyecto = await getRow('SELECT id, org_id FROM proyectos WHERE id = ?', [req.params.id]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (req.userRole !== 'admin' && proyecto.org_id !== req.userId) {
      return res.status(403).json({ success: false, message: 'No tienes permiso sobre este proyecto' });
    }

    const existing = await getRow('SELECT id FROM compliance_data WHERE proyecto_id = ?', [req.params.id]);
    if (existing) {
      await runSql(
        'UPDATE compliance_data SET estado_legal = ?, updated_at = CURRENT_TIMESTAMP WHERE proyecto_id = ?',
        [estado_legal, req.params.id]
      );
    } else {
      await runSql(
        'INSERT INTO compliance_data (id, proyecto_id, user_id, estado_legal) VALUES (?, ?, ?, ?)',
        [crypto.randomUUID(), req.params.id, proyecto.org_id, estado_legal]
      );
    }

    res.json({ success: true, message: 'Estado legal actualizado', estado_legal });
  }));
}
