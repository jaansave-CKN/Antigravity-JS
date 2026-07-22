import crypto from 'crypto';

export function registerConfigLogisticaRoutes(app, { authenticateToken, runSql, getRow, getRows, tryCatch }) {

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

  // ── Tramos de logística (Fase 1.2) — dominio distinto de config_logistica:
  // tramos de transporte origen→destino, no datos del proponente/entidad. ──

  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // GET /api/proyectos/:id/logistica-tramos
  app.get('/api/proyectos/:id/logistica-tramos', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const tramos = await getRows(
      `SELECT id, numero, origen, destino, duracion, distancia_km, medio, estado_via,
              calidad, tipo_transporte, orden_publico, seleccionado
       FROM logistica_tramos WHERE proyecto_id = ? ORDER BY numero ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: tramos });
  }));

  // POST /api/proyectos/:id/logistica-tramos — reemplaza el array completo (idempotente)
  app.post('/api/proyectos/:id/logistica-tramos', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { tramos } = req.body;
    if (!Array.isArray(tramos)) return res.status(400).json({ success: false, message: 'tramos debe ser array' });

    await runSql('DELETE FROM logistica_tramos WHERE proyecto_id = ?', [req.params.id]);
    for (const t of tramos) {
      await runSql(
        `INSERT INTO logistica_tramos
         (id, proyecto_id, numero, origen, destino, duracion, distancia_km, medio,
          estado_via, calidad, tipo_transporte, orden_publico, seleccionado)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          crypto.randomUUID(), req.params.id,
          t.numero || 0, t.origen || '', t.destino || '', t.duracion || '',
          t.distancia_km || 0, t.medio || '', t.estado_via || '', t.calidad || '',
          t.tipo_transporte || '', t.orden_publico || '', t.seleccionado ? 1 : 0,
        ]
      );
    }
    res.json({ success: true, message: `${tramos.length} tramo(s) guardado(s)` });
  }));
}
