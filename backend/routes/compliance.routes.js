import crypto from 'crypto';
// withTenant() (Fase 2 roadmap tenant, 2026-09-06): los 9 call sites de este
// archivo migran al rol rf360_rls_scoped — GRANT ya aplicado sobre
// compliance_data por 059_rls_scoped_grants_fase2.sql (otorgado para
// fichaTecnica.routes.js en la sesión anterior; proyectos ya tenía GRANT
// desde 053_rls_scoped_role.sql). withTenantRow/withTenantRun preservan el
// contrato getRow/runSql (mismo shape de retorno, misma convención "?") — el
// diff de cada call site es agregar el tenantId como primer argumento.
//
// EXCEPCIÓN DELIBERADA (PATCH /api/proyectos/:id/estado-legal): esta ruta
// permite que un ADMIN cambie el estado_legal de un proyecto AJENO
// (`req.userRole !== 'admin' && proyecto.org_id !== req.userId` es el único
// guard). El lookup inicial de `proyectos` (línea ~90) NO puede tenant-
// escoparse por req.userId: si un admin gestiona el proyecto de OTRO
// usuario, RLS (org_id = app.org_id) lo bloquearía antes incluso de poder
// determinar si tiene permiso — problema del huevo y la gallina, mismo
// principio que impide tenant-escopar el lookup de `usuarios` dentro de
// authenticateToken. Se queda en `getRow` (pool principal) a propósito. Las
// escrituras POSTERIORES en compliance_data SÍ se tenant-escopan, pero con
// `proyecto.org_id` (el dueño REAL de la fila) como tenantId — nunca
// `req.userId` — para que un admin gestionando un proyecto ajeno siga
// escribiendo bajo el tenant correcto (RLS exige que app.org_id coincida
// con compliance_data.user_id, que siempre es el dueño real del proyecto,
// no quien hace la request). Verificado con prueba dedicada (admin de
// prueba + proyecto de otro tenant).
import { withTenantRow, withTenantRun, getRow } from '../config/database.config.js';

export function registerComplianceRoutes(app, { authenticateToken, tryCatch }) {

  // SECURITY: valida que :proyectoId pertenezca al llamante ANTES de leer/escribir
  // en compliance_data — sin esto, cualquier usuario autenticado que conozca el UUID
  // de un proyecto ajeno (p. ej. vía el hash público de GET /api/m12/verificar/:hash)
  // podía asociar filas propias a ese proyecto ajeno (proyecto_id sin dueño validado).
  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // GET /api/m10/compliance/:proyectoId
  app.get('/api/m10/compliance/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const row = await withTenantRow(req.userId,
      'SELECT * FROM compliance_data WHERE proyecto_id = ? AND user_id = ?',
      [req.params.proyectoId, req.userId]
    );
    res.json({ success: true, data: row || null });
  }));

  // POST /api/m10/compliance/:proyectoId
  app.post('/api/m10/compliance/:proyectoId', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.proyectoId, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const {
      riesgos               = [],
      sostenibilidad_ambiental = '',
      sostenibilidad_social    = '',
      ods_alineados         = [],
      enfoque_genero        = false,
      enfoque_genero_texto  = '',
    } = req.body;

    const existing = await withTenantRow(req.userId,
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
      await withTenantRun(req.userId,
        `UPDATE compliance_data
         SET riesgos=?, sostenibilidad_ambiental=?, sostenibilidad_social=?,
             ods_alineados=?, enfoque_genero=?, enfoque_genero_texto=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE proyecto_id=? AND user_id=?`,
        [...vals, req.params.proyectoId, req.userId]
      );
    } else {
      await withTenantRun(req.userId,
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

    // Sin tenant-scope a propósito (ver comentario del import): un admin
    // gestionando el proyecto de OTRO usuario necesita poder leer esta fila
    // para decidir si tiene permiso, antes de que exista un tenant sobre el
    // cual escopar la query.
    const proyecto = await getRow('SELECT id, org_id FROM proyectos WHERE id = ?', [req.params.id]);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (req.userRole !== 'admin' && proyecto.org_id !== req.userId) {
      return res.status(403).json({ success: false, message: 'No tienes permiso sobre este proyecto' });
    }

    // A partir de aquí, el tenant real es el DUEÑO del proyecto
    // (proyecto.org_id), no necesariamente req.userId — un admin escribe bajo
    // el tenant del dueño real, nunca bajo su propio id (RLS exige que
    // app.org_id coincida con compliance_data.user_id, que siempre es el
    // dueño real).
    const tenantId = proyecto.org_id;

    // FIX (auditoría SRE Red Team 2026-08-10, Capa 2): el UPDATE filtraba
    // solo por proyecto_id, apoyándose únicamente en el chequeo de arriba
    // (proyecto.org_id !== req.userId). No explotable antes (el guard ya
    // corta con 403), pero sin defensa en profundidad a diferencia del resto
    // del archivo (líneas 40/59/71 sí repiten AND user_id = ?).
    const existing = await withTenantRow(tenantId, 'SELECT id FROM compliance_data WHERE proyecto_id = ?', [req.params.id]);
    if (existing) {
      await withTenantRun(tenantId,
        'UPDATE compliance_data SET estado_legal = ?, updated_at = CURRENT_TIMESTAMP WHERE proyecto_id = ? AND user_id = ?',
        [estado_legal, req.params.id, tenantId]
      );
    } else {
      await withTenantRun(tenantId,
        'INSERT INTO compliance_data (id, proyecto_id, user_id, estado_legal) VALUES (?, ?, ?, ?)',
        [crypto.randomUUID(), req.params.id, tenantId, estado_legal]
      );
    }

    res.json({ success: true, message: 'Estado legal actualizado', estado_legal });
  }));
}
