import crypto from 'crypto';
import { generarNormasAplicables } from '../agents/normativoAgent.js';

export function registerMarcoNormativoRoutes(app, { authenticateToken, runSql, getRow, tryCatch }) {

  // GET /api/m8/normas/:proyectoId
  app.get('/api/m8/normas/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const row = await getRow(
      'SELECT * FROM marco_normativo WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: row || null });
  }));

  // POST /api/m8/normas/generar
  // Genera normas aplicables a partir del sector y municipio del proyecto.
  app.post('/api/m8/normas/generar', authenticateToken, tryCatch(async (req, res) => {
    const { proyecto_id, sector, municipio } = req.body;
    if (!proyecto_id || !sector) {
      return res.status(400).json({ success: false, message: 'proyecto_id y sector son requeridos' });
    }

    const resultado = generarNormasAplicables(sector, municipio);

    const existing = await getRow(
      'SELECT id FROM marco_normativo WHERE proyecto_id = ? AND user_id = ?',
      [proyecto_id, req.userId]
    );

    if (existing) {
      await runSql(
        `UPDATE marco_normativo
         SET normas_aplicables=?, citas_bibliograficas=?, sector=?, municipio=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [JSON.stringify(resultado.normas_aplicables), JSON.stringify(resultado.citas_bibliograficas),
         sector, municipio || '', proyecto_id, req.userId]
      );
    } else {
      await runSql(
        `INSERT INTO marco_normativo
         (id, proyecto_id, user_id, sector, municipio, normas_aplicables, citas_bibliograficas)
         VALUES (?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), proyecto_id, req.userId, sector, municipio || '',
         JSON.stringify(resultado.normas_aplicables), JSON.stringify(resultado.citas_bibliograficas)]
      );
    }

    res.json({ success: true, data: resultado });
  }));

  // POST /api/m8/normas/:proyectoId — guardar normas editadas manualmente
  app.post('/api/m8/normas/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const { normas_aplicables = [], citas_bibliograficas = [], notas_adicionales = '' } = req.body;

    const existing = await getRow(
      'SELECT id FROM marco_normativo WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    if (existing) {
      await runSql(
        `UPDATE marco_normativo
         SET normas_aplicables=?, citas_bibliograficas=?, notas_adicionales=?, updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [JSON.stringify(normas_aplicables), JSON.stringify(citas_bibliograficas), notas_adicionales,
         req.params.proyectoId, req.userId]
      );
    } else {
      await runSql(
        `INSERT INTO marco_normativo
         (id, proyecto_id, user_id, normas_aplicables, citas_bibliograficas, notas_adicionales)
         VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), req.params.proyectoId, req.userId,
         JSON.stringify(normas_aplicables), JSON.stringify(citas_bibliograficas), notas_adicionales]
      );
    }

    res.json({ success: true, message: 'Marco normativo guardado' });
  }));
}
