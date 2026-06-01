import crypto from 'crypto';

export function registerMotorDialecticoRoutes(app, { authenticateToken, runSql, getRow, tryCatch }) {

  // GET /api/m4/config/:proyectoId
  app.get('/api/m4/config/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const row = await getRow(
      'SELECT * FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: row || null });
  }));

  // POST /api/m4/config/:proyectoId
  app.post('/api/m4/config/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const { tono, lista_oro = [], lista_negra = [], enfasis = '' } = req.body;

    const TONOS_VALIDOS = ['formal', 'tecnico', 'comunitario', 'academico', 'normativo'];
    if (tono && !TONOS_VALIDOS.includes(tono)) {
      return res.status(400).json({ success: false, message: `Tono inválido. Opciones: ${TONOS_VALIDOS.join(', ')}` });
    }

    const existing = await getRow(
      'SELECT id FROM motor_dialectico WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    if (existing) {
      await runSql(
        `UPDATE motor_dialectico
         SET tono = ?, lista_oro = ?, lista_negra = ?, enfasis = ?, updated_at = CURRENT_TIMESTAMP
         WHERE proyecto_id = ? AND user_id = ?`,
        [tono || 'formal', JSON.stringify(lista_oro), JSON.stringify(lista_negra), enfasis,
         req.params.proyectoId, req.userId]
      );
    } else {
      await runSql(
        `INSERT INTO motor_dialectico (id, proyecto_id, user_id, tono, lista_oro, lista_negra, enfasis)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), req.params.proyectoId, req.userId,
         tono || 'formal', JSON.stringify(lista_oro), JSON.stringify(lista_negra), enfasis]
      );
    }

    res.json({ success: true, message: 'Configuración dialéctica guardada' });
  }));
}
