/**
 * biblioteca.routes.js — CRUD de la Biblioteca Gubernamental contra
 * project_biblioteca (migración 039). Clon aislado de anexos.routes.js:
 * mismo patrón de subida/descarga/ownership, bucket de Storage propio
 * ('biblioteca', no compartido con 'anexos'), y SIN el pipeline financiero
 * (ExtractorService/AuditorForenseService/conector de viabilidad) — este
 * módulo es un repositorio de documentos de referencia institucional, no
 * dispara extracción de presupuestos. Revisado con el agente architect
 * antes de clonar (2026-08-16): alcance recortado a CRUD simple.
 *
 * GET    /api/proyectos/:id/biblioteca                    — lista los documentos del proyecto
 * POST   /api/proyectos/:id/biblioteca                    — sube un archivo real (multipart/form-data, campo "file")
 * PATCH  /api/proyectos/:id/biblioteca/:docId              — edita campos narrativos + categoria + carpeta_id
 * GET    /api/proyectos/:id/biblioteca/:docId/download     — URL firmada temporal para descargar el archivo
 * DELETE /api/proyectos/:id/biblioteca/:docId              — elimina el documento (fila en BD + objeto en Supabase Storage)
 *
 * Carpetas dinámicas (migración 040 — reemplazan las 2 carpetas fijas):
 * GET    /api/proyectos/:id/biblioteca/carpetas                        — lista carpetas del proyecto
 * POST   /api/proyectos/:id/biblioteca/carpetas                        — crea carpeta { nombre }
 * PUT    /api/proyectos/:id/biblioteca/carpetas/:carpetaId             — renombra { nombre }
 * DELETE /api/proyectos/:id/biblioteca/carpetas/:carpetaId             — elimina carpeta; sus documentos quedan
 *                                                                        "sin carpeta" (ON DELETE SET NULL)
 * DELETE /api/proyectos/:id/biblioteca/carpetas/:carpetaId?eliminarDocumentos=true
 *                                                                       — además borra los documentos de la carpeta
 *                                                                        (fila + archivo en Storage) — acción opt-in,
 *                                                                        nunca el comportamiento implícito
 */
import crypto from 'crypto';
import { supabaseStorage } from '../config/supabase.config.js';
import { sanitizeTechnicalText, sanitizeUrl } from '../middlewares/SecurityMiddleware.js';
import { captureError } from '../config/sentry.config.js';
// withTenant() (Fase 2 roadmap tenant, 2026-09-06): los 20 call sites de este
// archivo (getRow/getRows/runSql contra `proyectos`/`project_biblioteca`/
// `project_biblioteca_carpetas`) migran al rol rf360_rls_scoped — GRANT
// aplicado por 059_rls_scoped_grants_fase2.sql (verificado en vivo: GRANT +
// prueba de aislamiento cross-tenant, 2026-09-06). withTenantRow/
// withTenantRows/withTenantRun (database.config.js) preservan el contrato
// getRow/getRows/runSql (mismo shape de retorno, misma convención "?") — el
// diff de cada call site es solo agregar el tenantId (siempre `req.userId`
// en este archivo, org_id = user_id, mismo criterio que anexos.routes.js)
// como primer argumento.
import { withTenantRow, withTenantRows, withTenantRun } from '../config/database.config.js';

const BIBLIOTECA_BUCKET = 'biblioteca';

// ── Whitelist de tipos permitidos (mismo criterio que Anexos) ───────────────
// Límites subidos 2026-08-17 (15MB→50MB documentos, 8MB→15MB imágenes) —
// mismo criterio que anexos.routes.js: PDF escaneados institucionales
// rutinariamente superan 15MB.
const ALLOWED_BIBLIOTECA_TYPES = {
  pdf:  { mimes: ['application/pdf'],                                                                        maxBytes: 50 * 1024 * 1024 },
  doc:  { mimes: ['application/msword'],                                                                      maxBytes: 50 * 1024 * 1024 },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'], maxBytes: 50 * 1024 * 1024 },
  xls:  { mimes: ['application/vnd.ms-excel'],                                                                 maxBytes: 50 * 1024 * 1024 },
  xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],       maxBytes: 50 * 1024 * 1024 },
  jpg:  { mimes: ['image/jpeg'], maxBytes: 15 * 1024 * 1024 },
  jpeg: { mimes: ['image/jpeg'], maxBytes: 15 * 1024 * 1024 },
  png:  { mimes: ['image/png'],  maxBytes: 15 * 1024 * 1024 },
};
const BIBLIOTECA_MAX_BYTES = 50 * 1024 * 1024;

// Sin 'presupuesto_apu' — la Biblioteca no dispara el pipeline financiero.
const CATEGORIAS_VALIDAS = new Set(['legal', 'financiero', 'tecnico', 'institucional', 'otro']);

function safeExt(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

// FIX (auditoría 2026-08-17, "no me deja anexar archivos" — tercera causa
// distinta de las ya corregidas): la lista blanca anterior (\w = SOLO ASCII)
// rechazaba cualquier nombre real con tildes/ñ/paréntesis/símbolos como "N°"
// — es decir, prácticamente todo nombre de archivo institucional en español
// ("Plan de Desarrollo Bolívar (2024-2027).pdf"). El nombre real NUNCA se
// usa para construir la ruta de Storage (esa usa el UUID de la fila, ver
// storagePath más abajo) — solo se guarda para mostrarlo y para el
// Content-Disposition de la descarga. Se cambia a lista NEGRA: solo se
// bloquean caracteres de control (incluye CRLF — inyección de cabecera),
// comillas y separadores de ruta (/ \) — cualquier letra, tilde, ñ, símbolo
// o puntuación normal queda permitida.
const NOMBRE_ARCHIVO_PELIGROSO = /[\x00-\x1F"<>\\/]/;
function validateBibliotecaFile(file) {
  const nombre = file.originalname || '';
  const safeName = nombre.length >= 1 && nombre.length <= 200 && !NOMBRE_ARCHIVO_PELIGROSO.test(nombre);
  if (!safeName) return 'Nombre de archivo no permitido';

  const ext = safeExt(file.originalname);
  const rule = ALLOWED_BIBLIOTECA_TYPES[ext];
  if (!rule) return `Extensión ".${ext}" no permitida. Solo: ${Object.keys(ALLOWED_BIBLIOTECA_TYPES).join(', ')}`;
  if (file.size > rule.maxBytes) return `Archivo demasiado grande (máx ${rule.maxBytes / 1024 / 1024} MB para .${ext})`;

  return null;
}

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      console.error('[biblioteca]', err.message);
      captureError(err, { route: 'biblioteca', method: req.method, path: req.path, userId: req.userId });
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerBibliotecaRoutes(app, { authenticateToken }) {
  if (!supabaseStorage) {
    console.error('[biblioteca] SUPABASE_URL/SUPABASE_SERVICE_KEY no configurados — subida a la Biblioteca desactivada');
  } else {
    // Bucket propio, aislado del de Anexos — idempotente. Si ya existía con
    // un fileSizeLimit viejo, createBucket lo ignora (no lo actualiza) —
    // updateBucket sí aplica el límite nuevo (fix 2026-08-17).
    const { error } = await supabaseStorage.storage.createBucket(BIBLIOTECA_BUCKET, {
      public: false,
      fileSizeLimit: BIBLIOTECA_MAX_BYTES,
    });
    if (error && !/already exists/i.test(error.message || '')) {
      console.warn('[biblioteca] No se pudo confirmar el bucket de Storage:', error.message);
    } else if (error) {
      const { error: updateError } = await supabaseStorage.storage.updateBucket(BIBLIOTECA_BUCKET, {
        public: false,
        fileSizeLimit: BIBLIOTECA_MAX_BYTES,
      });
      if (updateError) console.warn('[biblioteca] No se pudo actualizar el límite del bucket:', updateError.message);
    }
  }

  const multer = (await import('multer')).default;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: BIBLIOTECA_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = safeExt(file.originalname);
      if (!ALLOWED_BIBLIOTECA_TYPES[ext]) {
        const err = new Error(`Extensión ".${ext}" no permitida`);
        err.status = 422;
        return cb(err);
      }
      cb(null, true);
    },
  });

  async function checkOwnership(proyectoId, userId) {
    return withTenantRow(userId, 'SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  /**
   * GET /api/proyectos/:id/biblioteca
   */
  app.get('/api/proyectos/:id/biblioteca', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const documentos = await withTenantRows(req.userId,
      // FIX (reportado por el usuario 2026-08-17): mismo fix que anexos.routes.js
      // — ORDER BY created_at DESC invertía el orden de ingreso en cada recarga.
      'SELECT id, project_id, carpeta_id, nombre_archivo, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, created_at FROM project_biblioteca WHERE project_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: documentos });
  }));

  /**
   * GET /api/proyectos/:id/biblioteca/carpetas
   */
  app.get('/api/proyectos/:id/biblioteca/carpetas', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const carpetas = await withTenantRows(req.userId,
      'SELECT id, project_id, nombre, orden, created_at FROM project_biblioteca_carpetas WHERE project_id = ? ORDER BY orden ASC, created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: carpetas });
  }));

  /**
   * POST /api/proyectos/:id/biblioteca/carpetas — crea una carpeta { nombre }
   */
  app.post('/api/proyectos/:id/biblioteca/carpetas', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombre = sanitizeTechnicalText(String(req.body?.nombre || ''), 100).trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la carpeta es obligatorio' });

    const [{ maxOrden } = { maxOrden: -1 }] = await withTenantRows(req.userId,
      'SELECT COALESCE(MAX(orden), -1) AS "maxOrden" FROM project_biblioteca_carpetas WHERE project_id = ?',
      [req.params.id]
    );

    const id = crypto.randomUUID();
    await withTenantRun(req.userId,
      'INSERT INTO project_biblioteca_carpetas (id, project_id, tenant_id, nombre, orden, created_at) VALUES (?,?,?,?,?,?)',
      [id, req.params.id, req.userId, nombre, Number(maxOrden) + 1, new Date().toISOString()]
    );
    res.status(201).json({ success: true, data: { id, project_id: req.params.id, nombre, orden: Number(maxOrden) + 1 } });
  }));

  /**
   * PUT /api/proyectos/:id/biblioteca/carpetas/:carpetaId — renombra { nombre }
   */
  app.put('/api/proyectos/:id/biblioteca/carpetas/:carpetaId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombre = sanitizeTechnicalText(String(req.body?.nombre || ''), 100).trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la carpeta es obligatorio' });

    const carpeta = await withTenantRow(req.userId,
      'SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?',
      [req.params.carpetaId, req.params.id]
    );
    if (!carpeta) return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });

    await withTenantRun(req.userId, 'UPDATE project_biblioteca_carpetas SET nombre = ? WHERE id = ?', [nombre, req.params.carpetaId]);
    res.json({ success: true, message: 'Carpeta renombrada' });
  }));

  /**
   * DELETE /api/proyectos/:id/biblioteca/carpetas/:carpetaId
   * Por defecto, los documentos de la carpeta quedan "sin carpeta" (FK
   * ON DELETE SET NULL) — nunca se borran implícitamente. Solo con
   * ?eliminarDocumentos=true se borran también los documentos (fila +
   * archivo en Storage), acción explícita y opt-in desde el frontend.
   */
  app.delete('/api/proyectos/:id/biblioteca/carpetas/:carpetaId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const carpeta = await withTenantRow(req.userId,
      'SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?',
      [req.params.carpetaId, req.params.id]
    );
    if (!carpeta) return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });

    const eliminarDocumentos = String(req.query?.eliminarDocumentos || '') === 'true';
    if (eliminarDocumentos) {
      const docs = await withTenantRows(req.userId,
        'SELECT id, ruta_storage FROM project_biblioteca WHERE carpeta_id = ? AND project_id = ?',
        [req.params.carpetaId, req.params.id]
      );
      await withTenantRun(req.userId, 'DELETE FROM project_biblioteca WHERE carpeta_id = ? AND project_id = ?', [req.params.carpetaId, req.params.id]);
      if (supabaseStorage) {
        const rutas = docs.map(d => d.ruta_storage).filter(Boolean);
        if (rutas.length) supabaseStorage.storage.from(BIBLIOTECA_BUCKET).remove(rutas).catch(() => {});
      }
    }

    await withTenantRun(req.userId, 'DELETE FROM project_biblioteca_carpetas WHERE id = ?', [req.params.carpetaId]);
    res.json({ success: true, message: eliminarDocumentos ? 'Carpeta y sus documentos eliminados' : 'Carpeta eliminada — sus documentos quedaron sin carpeta' });
  }));

  /**
   * POST /api/proyectos/:id/biblioteca
   * multipart/form-data: file=<archivo opcional>, categoria, descripcion, texto, link
   * El archivo es opcional — una fila puramente narrativa también es válida,
   * siempre que no esté completamente vacía.
   */
  app.post('/api/proyectos/:id/biblioteca', authenticateToken, upload.single('file'), wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const descripcion = sanitizeTechnicalText(String(req.body?.descripcion || ''), 500);
    const texto       = sanitizeTechnicalText(String(req.body?.texto || ''), 500);
    const link        = sanitizeUrl(String(req.body?.link || ''), 500);

    if (!req.file && !descripcion.trim() && !texto.trim() && !link.trim()) {
      return res.status(400).json({ success: false, message: 'Adjunta un archivo o completa descripción/texto/link' });
    }

    if (req.file) {
      // FIX (auditoría 2026-08-17): multer/busboy decodifican el campo
      // "filename" del multipart como latin1 por defecto, aunque el
      // navegador lo mande en UTF-8 (estándar real) — "Bolívar" llegaba
      // como "BolÃ­var". Reinterpretar los bytes como UTF-8 corrige
      // cualquier nombre con tildes/ñ/etc. antes de validarlo o guardarlo.
      req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const error = validateBibliotecaFile(req.file);
      if (error) return res.status(422).json({ success: false, message: error });
      if (!supabaseStorage) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible — Supabase no configurado' });
    }

    const categoriaRaw = String(req.body?.categoria || 'otro').toLowerCase();
    const categoria = CATEGORIAS_VALIDAS.has(categoriaRaw) ? categoriaRaw : 'otro';

    // carpeta_id es opcional (documento "sin carpeta" es válido) — se valida
    // que exista y pertenezca al mismo proyecto antes de aceptarla.
    let carpetaId = req.body?.carpeta_id ? String(req.body.carpeta_id) : null;
    if (carpetaId) {
      const carpeta = await withTenantRow(req.userId, 'SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?', [carpetaId, req.params.id]);
      if (!carpeta) carpetaId = null;
    }

    const id = crypto.randomUUID();
    let nombreArchivo = '', rutaStorage = '', tipoMime = '', tamanoBytes = 0;

    if (req.file) {
      const ext = safeExt(req.file.originalname);
      const storedName = `${id}.${ext}`;
      const storagePath = `${req.params.id}/${storedName}`;

      const { error: uploadError } = await supabaseStorage.storage
        .from(BIBLIOTECA_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (uploadError) {
        return res.status(502).json({ success: false, message: `No se pudo subir el archivo a Storage: ${uploadError.message}` });
      }

      rutaStorage   = storagePath;
      nombreArchivo = req.file.originalname.slice(0, 200);
      tipoMime      = req.file.mimetype;
      tamanoBytes   = req.file.size;
    }

    try {
      await withTenantRun(req.userId,
        `INSERT INTO project_biblioteca
         (id, project_id, tenant_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, carpeta_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, req.params.id, req.userId, nombreArchivo, rutaStorage, tipoMime, tamanoBytes, categoria, descripcion, texto, link, carpetaId, new Date().toISOString()]
      );
    } catch (dbError) {
      if (rutaStorage) {
        await supabaseStorage.storage.from(BIBLIOTECA_BUCKET).remove([rutaStorage])
          .catch(cleanupErr => console.error('[biblioteca] Rollback de Storage también falló:', cleanupErr.message));
      }
      console.error('[biblioteca] INSERT falló tras subir a Storage — rollback aplicado:', dbError.message);
      return res.status(500).json({ success: false, message: 'No se pudo registrar el documento. El archivo no quedó guardado.' });
    }

    res.status(201).json({
      success: true,
      data: {
        id, project_id: req.params.id, nombre_archivo: nombreArchivo,
        tipo_mime: tipoMime, tamano_bytes: tamanoBytes, categoria, descripcion, texto, link,
        carpeta_id: carpetaId,
        created_at: new Date().toISOString(),
      },
    });
  }));

  /**
   * PATCH /api/proyectos/:id/biblioteca/:docId — edita los campos narrativos
   * (descripcion/texto/link) y, opcionalmente, categoria y/o carpeta_id
   * (mover el documento a otra carpeta, o a null = sin carpeta).
   */
  // FIX (auditoría 2026-08-17, "borro el texto ODS, guardo, F5 y vuelve a
  // aparecer"): el BLINDAJE ANTIPÉRDIDA original (mismo commit del
  // 2026-08-17) trataba CUALQUIER valor vacío como "dato perdido
  // accidentalmente" y lo descartaba silenciosamente — eso protegía contra
  // una condición de carrera real de esa fecha, pero como efecto secundario
  // hacía IMPOSIBLE borrar descripcion/texto/link de forma intencional (solo
  // se podía borrando la fila completa). Esa condición de carrera ya está
  // resuelta en el frontend por otra vía (cola de guardado `encolar()` +
  // `eliminadosRef`, ver project_fix_duplicacion_anexos_biblioteca_2026_08_17)
  // — el payload que llega aquí SIEMPRE refleja el estado real y completo de
  // la fila en el cliente, nunca un fragmento parcial o desactualizado.
  // El fix correcto es distinguir "el campo llegó vacío a propósito" (el
  // usuario lo borró) de "el campo ni siquiera vino en el body" (un llamador
  // parcial que no debería tocarlo) — por PRESENCIA, no por vacío/no-vacío.
  // carpeta_id/categoria ya usaban este mismo criterio de presencia.
  app.patch('/api/proyectos/:id/biblioteca/:docId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const existente = await withTenantRow(req.userId,
      'SELECT descripcion, texto, link FROM project_biblioteca WHERE id = ? AND project_id = ?',
      [req.params.docId, req.params.id]
    );
    if (!existente) return res.status(404).json({ success: false, message: 'Documento no encontrado' });

    const descripcion = req.body?.descripcion !== undefined ? sanitizeTechnicalText(String(req.body.descripcion), 500) : existente.descripcion;
    const texto        = req.body?.texto !== undefined ? sanitizeTechnicalText(String(req.body.texto), 500) : existente.texto;
    const link          = req.body?.link !== undefined ? sanitizeUrl(String(req.body.link), 500) : existente.link;

    let carpetaClause = '';
    const params = [descripcion, texto, link];
    if (req.body?.carpeta_id !== undefined) {
      let carpetaId = req.body.carpeta_id ? String(req.body.carpeta_id) : null;
      if (carpetaId) {
        const carpeta = await withTenantRow(req.userId, 'SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?', [carpetaId, req.params.id]);
        if (!carpeta) carpetaId = null;
      }
      carpetaClause = ', carpeta_id = ?';
      params.push(carpetaId);
    }

    if (req.body?.categoria !== undefined) {
      const categoriaRaw = String(req.body.categoria || 'otro').toLowerCase();
      const categoria = CATEGORIAS_VALIDAS.has(categoriaRaw) ? categoriaRaw : 'otro';
      params.push(categoria);
      await withTenantRun(req.userId,
        `UPDATE project_biblioteca SET descripcion = ?, texto = ?, link = ?${carpetaClause}, categoria = ? WHERE id = ? AND project_id = ?`,
        [...params, req.params.docId, req.params.id]
      );
    } else {
      await withTenantRun(req.userId,
        `UPDATE project_biblioteca SET descripcion = ?, texto = ?, link = ?${carpetaClause} WHERE id = ? AND project_id = ?`,
        [...params, req.params.docId, req.params.id]
      );
    }
    res.json({ success: true, message: 'Documento actualizado' });
  }));

  /**
   * GET /api/proyectos/:id/biblioteca/:docId/download
   * URL firmada de corta duración (5 min) — bucket privado.
   */
  app.get('/api/proyectos/:id/biblioteca/:docId/download', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const doc = await withTenantRow(req.userId,
      'SELECT ruta_storage, nombre_archivo FROM project_biblioteca WHERE id = ? AND project_id = ?',
      [req.params.docId, req.params.id]
    );
    if (!doc || !doc.ruta_storage) return res.status(404).json({ success: false, message: 'Documento no encontrado o sin archivo adjunto' });
    if (!supabaseStorage) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible' });

    const { data, error } = await supabaseStorage.storage
      .from(BIBLIOTECA_BUCKET)
      .createSignedUrl(doc.ruta_storage, 300, { download: doc.nombre_archivo });
    if (error) return res.status(502).json({ success: false, message: `No se pudo generar el enlace de descarga: ${error.message}` });

    res.json({ success: true, data: { url: data.signedUrl, expiresIn: 300 } });
  }));

  /**
   * DELETE /api/proyectos/:id/biblioteca/:docId
   */
  app.delete('/api/proyectos/:id/biblioteca/:docId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const doc = await withTenantRow(req.userId,
      'SELECT id, ruta_storage FROM project_biblioteca WHERE id = ? AND project_id = ?',
      [req.params.docId, req.params.id]
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Documento no encontrado' });

    await withTenantRun(req.userId, 'DELETE FROM project_biblioteca WHERE id = ?', [req.params.docId]);

    if (doc.ruta_storage && supabaseStorage) {
      supabaseStorage.storage.from(BIBLIOTECA_BUCKET).remove([doc.ruta_storage]).catch(() => {});
    }

    res.json({ success: true, message: 'Documento eliminado' });
  }));
}
