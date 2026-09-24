import crypto from 'crypto';
// withTenant() (Fase 3 roadmap tenant, 2026-09-06): los 7 call sites de este
// archivo (proyectos/config_logistica/logistica_tramos) migran al rol
// rf360_rls_scoped. config_logistica y logistica_tramos ya tenían GRANT
// (059_rls_scoped_grants_fase2.sql y 055_rls_scoped_grants_fase1.sql
// respectivamente); proyectos desde 053. El DELETE+INSERTs atómico de
// logistica-tramos (antes runTransaction() de db.js, pool principal
// BYPASSRLS) pasa a withTenantTransaction() — mismo helper del cierre de
// Fase 2. logistica_tramos no tiene columna de tenant propia: su política
// tenant_isolation valida via EXISTS contra proyectos.org_id — funciona
// igual con withTenant(req.userId, ...) porque set_config('app.org_id', ...)
// es lo único que esa política necesita, sin importar en qué columna vive.
import { withTenantRow, withTenantRows, withTenantTransaction, dbStatus } from '../config/database.config.js';
import { validarBody, logisticaTramosSchema, configLogisticaPatchSchema } from '../validators/zodSchemas.js';
import { esFechaValida } from '../services/vigenciaDocumental.js';

// Lote 5 T1 (2026-09-24): columnas escribibles de config_logistica — mapa
// FIJO: el SQL se arma solo con estas claves, nunca con las del body.
const COLUMNAS_CFG = ['proponente_nombre', 'proponente_nit', 'tipo_entidad', 'departamento', 'municipio',
  'zona', 'fecha_inicio', 'duracion_meses', 'equipo_director', 'equipo_coordinador'];

export function registerConfigLogisticaRoutes(app, { authenticateToken, requireAccess, tryCatch }) {

  // SECURITY: valida propiedad de :proyectoId antes de tocar config_logistica —
  // ver mismo fix aplicado en compliance.routes.js/marcoNormativo.routes.js/
  // motorDialectico.routes.js (auditoría 2026-08-08, hallazgo BOLA en tablas hijas
  // del Formulador que solo filtraban por user_id, no por dueño real del proyecto).
  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id, estado FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  // ── config_logistica (Lote 5 T1, 2026-09-24) ─────────────────────────────
  // La ruta de escritura original (POST /api/m5/logistica/:proyectoId) se
  // purgó en 18bc775 y además sobreescribía TODOS los campos con defaults
  // ('' / 'Urbana' / 0) cuando no venían. Este endpoint es AISLADO (mismo
  // patrón que PATCH .../anexos/:id/vigencia): no toca logistica-tramos, ni
  // Entrada, ni otras filas. Fiscalizado por architect (T1-B1..B3):
  //  - semántica de PRESENCIA: solo se escriben los campos que vinieron;
  //  - upsert ATÓMICO (INSERT ... ON CONFLICT (proyecto_id, user_id), UNIQUE
  //    verificado en vivo) — en el INSERT, toda columna ausente va NULL
  //    explícito: los defaults del esquema ('Urbana', 0) llegarían a MIROFISH
  //    como datos declarados por el usuario;
  //  - id generado aquí (TEXT PK sin default); user_id siempre de la sesión.
  app.get('/api/proyectos/:id/config-logistica', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    const fila = await withTenantRow(req.userId, 'SELECT * FROM config_logistica WHERE proyecto_id = ? AND user_id = ?', [req.params.id, req.userId]);
    res.json({ success: true, data: fila || null });
  }));

  app.patch('/api/proyectos/:id/config-logistica', authenticateToken, requireAccess('formulador'), tryCatch(async (req, res) => {
    // Capa 2 (REST) ignora ON CONFLICT y no conoce el tenant de esta tabla
    // (user_id, no org_id): sin pool pg no hay escritura segura → 503 explícito.
    if (!dbStatus().pgReady) {
      return res.status(503).json({ success: false, message: 'No se puede guardar en este momento (base de datos en modo degradado) — intenta de nuevo en unos segundos.' });
    }
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });
    if (proyecto.estado === 'Finalizado') return res.status(409).json({ success: false, message: 'Un proyecto Finalizado no puede modificarse' });

    const validacion = validarBody(configLogisticaPatchSchema, req.body);
    if (!validacion.ok) return res.status(400).json({ success: false, message: validacion.message });
    const datos = validacion.data;
    const presentes = COLUMNAS_CFG.filter(c => datos[c] !== undefined);
    if (!presentes.length) return res.status(400).json({ success: false, message: 'Envía al menos un campo de la configuración logística.' });
    if (datos.fecha_inicio && !esFechaValida(datos.fecha_inicio)) {
      return res.status(400).json({ success: false, message: 'fecha_inicio no es una fecha válida (AAAA-MM-DD).' });
    }

    const valores = COLUMNAS_CFG.map(c => (datos[c] === undefined ? null : datos[c]));
    const fila = await withTenantRow(req.userId,
      `INSERT INTO config_logistica (id, proyecto_id, user_id, ${COLUMNAS_CFG.join(', ')})
       VALUES (?, ?, ?, ${COLUMNAS_CFG.map(() => '?').join(', ')})
       ON CONFLICT (proyecto_id, user_id) DO UPDATE SET
         ${presentes.map(c => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [crypto.randomUUID(), req.params.id, req.userId, ...valores]
    );
    res.json({ success: true, data: fila });
  }));



  // ── Tramos de logística (Fase 1.2) — dominio distinto de config_logistica:
  // tramos de transporte origen→destino, no datos del proponente/entidad. ──

  // GET /api/proyectos/:id/logistica-tramos
  app.get('/api/proyectos/:id/logistica-tramos', authenticateToken, tryCatch(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const tramos = await withTenantRows(req.userId,
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

    const validacionTramos = validarBody(logisticaTramosSchema, req.body);
    if (!validacionTramos.ok) return res.status(400).json({ success: false, message: validacionTramos.message });
    const { tramos } = validacionTramos.data;

    // FIX (auditoría SRE 2026-08-08, Capa 5): DELETE + N INSERTs envueltos en
    // una única transacción atómica (mismo patrón ya usado en presupuesto.routes.js)
    // — si un INSERT falla a mitad del loop, el DELETE se revierte solo, en vez
    // de dejar el listado de tramos truncado en la BD sin aviso al usuario.
    const queries = [
      { sql: 'DELETE FROM logistica_tramos WHERE proyecto_id = ?', params: [req.params.id] },
      ...tramos.map(t => ({
        sql: `INSERT INTO logistica_tramos
              (id, proyecto_id, numero, origen, destino, duracion, distancia_km, medio,
               estado_via, calidad, tipo_transporte, orden_publico, seleccionado)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          crypto.randomUUID(), req.params.id,
          t.numero || 0, t.origen || '', t.destino || '', t.duracion || '',
          t.distancia_km || 0, t.medio || '', t.estado_via || '', t.calidad || '',
          t.tipo_transporte || '', t.orden_publico || '', t.seleccionado ? 1 : 0,
        ],
      })),
    ];
    await withTenantTransaction(req.userId, queries);
    res.json({ success: true, message: `${tramos.length} tramo(s) guardado(s)` });
  }));
}
