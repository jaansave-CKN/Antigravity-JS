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
}
