import crypto from 'crypto';
import { generarNormasAplicables } from '../agents/normativoAgent.js';
// withTenant() (Fase 2 roadmap tenant, 2026-09-06): los 8 call sites de este
// archivo (getRow/runSql contra `proyectos`/`marco_normativo`) migran al rol
// rf360_rls_scoped — GRANT aplicado por 059_rls_scoped_grants_fase2.sql
// (verificado en vivo: GRANT + prueba de aislamiento cross-tenant, 2026-09-06).
// withTenantRow/withTenantRun (database.config.js) preservan el contrato
// getRow/runSql (mismo shape de retorno, misma convención "?") — el diff de
// cada call site es solo agregar el tenantId (siempre `req.userId` en este
// archivo, org_id = user_id) como primer argumento.
import { withTenantRow, withTenantRun } from '../config/database.config.js';

export function registerMarcoNormativoRoutes(app, { authenticateToken, tryCatch }) {

  // SECURITY: valida propiedad de proyecto_id antes de tocar marco_normativo —
  // mismo fix de BOLA aplicado en compliance/configLogistica/motorDialectico.
  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // GET /api/m8/normas/:proyectoId
  app.get('/api/m8/normas/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const row = await withTenantRow(req.userId,
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
    const proyecto = await checkOwnership(proyecto_id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const resultado = generarNormasAplicables(sector, municipio);

    const existing = await withTenantRow(req.userId,
      'SELECT id FROM marco_normativo WHERE proyecto_id = ? AND user_id = ?',
      [proyecto_id, req.userId]
    );

    if (existing) {
      await withTenantRun(req.userId,
        `UPDATE marco_normativo
         SET normas_aplicables=?, citas_bibliograficas=?, sector=?, municipio=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [JSON.stringify(resultado.normas_aplicables), JSON.stringify(resultado.citas_bibliograficas),
         sector, municipio || '', proyecto_id, req.userId]
      );
    } else {
      await withTenantRun(req.userId,
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
    const proyecto = await checkOwnership(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const { normas_aplicables = [], citas_bibliograficas = [], notas_adicionales = '' } = req.body;

    const existing = await withTenantRow(req.userId,
      'SELECT id FROM marco_normativo WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );

    if (existing) {
      await withTenantRun(req.userId,
        `UPDATE marco_normativo
         SET normas_aplicables=?, citas_bibliograficas=?, notas_adicionales=?, updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [JSON.stringify(normas_aplicables), JSON.stringify(citas_bibliograficas), notas_adicionales,
         req.params.proyectoId, req.userId]
      );
    } else {
      await withTenantRun(req.userId,
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
