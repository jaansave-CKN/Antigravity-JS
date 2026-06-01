import crypto from 'crypto';

export function registerConfigLogisticaRoutes(app, { authenticateToken, runSql, getRow, tryCatch }) {

  // GET /api/m5/logistica/:proyectoId
  app.get('/api/m5/logistica/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const row = await getRow(
      'SELECT * FROM config_logistica WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: row || null });
  }));

  // POST /api/m5/logistica/:proyectoId
  app.post('/api/m5/logistica/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const {
      proponente_nombre = '', proponente_nit = '',
      tipo_entidad = '', departamento = '', municipio = '',
      zona = 'Urbana', fecha_inicio = '', duracion_meses = 0,
      equipo_director = '', equipo_coordinador = '',
    } = req.body;

    const existing = await getRow(
      'SELECT id FROM config_logistica WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    if (existing) {
      await runSql(
        `UPDATE config_logistica
         SET proponente_nombre=?, proponente_nit=?, tipo_entidad=?,
             departamento=?, municipio=?, zona=?,
             fecha_inicio=?, duracion_meses=?,
             equipo_director=?, equipo_coordinador=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [proponente_nombre, proponente_nit, tipo_entidad,
         departamento, municipio, zona,
         fecha_inicio, duracion_meses,
         equipo_director, equipo_coordinador,
         req.params.proyectoId, req.userId]
      );
    } else {
      await runSql(
        `INSERT INTO config_logistica
         (id, proyecto_id, user_id, proponente_nombre, proponente_nit, tipo_entidad,
          departamento, municipio, zona, fecha_inicio, duracion_meses,
          equipo_director, equipo_coordinador)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), req.params.proyectoId, req.userId,
         proponente_nombre, proponente_nit, tipo_entidad,
         departamento, municipio, zona,
         fecha_inicio, duracion_meses,
         equipo_director, equipo_coordinador]
      );
    }

    res.json({ success: true, message: 'Configuración logística guardada' });
  }));
}
