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
import { supabaseAdmin } from '../config/supabase.config.js';
import { sanitizeTechnicalText, sanitizeUrl } from '../middlewares/SecurityMiddleware.js';

const BIBLIOTECA_BUCKET = 'biblioteca';

// ── Whitelist de tipos permitidos (mismo criterio que Anexos) ───────────────
const ALLOWED_BIBLIOTECA_TYPES = {
  pdf:  { mimes: ['application/pdf'],                                                                        maxBytes: 15 * 1024 * 1024 },
  doc:  { mimes: ['application/msword'],                                                                      maxBytes: 15 * 1024 * 1024 },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'], maxBytes: 15 * 1024 * 1024 },
  xls:  { mimes: ['application/vnd.ms-excel'],                                                                 maxBytes: 15 * 1024 * 1024 },
  xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],       maxBytes: 15 * 1024 * 1024 },
  jpg:  { mimes: ['image/jpeg'], maxBytes: 8 * 1024 * 1024 },
  jpeg: { mimes: ['image/jpeg'], maxBytes: 8 * 1024 * 1024 },
  png:  { mimes: ['image/png'],  maxBytes: 8 * 1024 * 1024 },
};

// Sin 'presupuesto_apu' — la Biblioteca no dispara el pipeline financiero.
const CATEGORIAS_VALIDAS = new Set(['legal', 'financiero', 'tecnico', 'institucional', 'otro']);

function safeExt(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

function validateBibliotecaFile(file) {
  const safeName = /^[\w\-. ]{1,200}$/.test(file.originalname);
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
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerBibliotecaRoutes(app, { authenticateToken, runSql, getRow, getRows }) {
  if (!supabaseAdmin) {
    console.error('[biblioteca] SUPABASE_URL/SUPABASE_SERVICE_KEY no configurados — subida a la Biblioteca desactivada');
  } else {
    // Bucket propio, aislado del de Anexos — idempotente.
    const { error } = await supabaseAdmin.storage.createBucket(BIBLIOTECA_BUCKET, {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
    });
    if (error && !/already exists/i.test(error.message || '')) {
      console.warn('[biblioteca] No se pudo confirmar el bucket de Storage:', error.message);
    }
  }

  const multer = (await import('multer')).default;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = safeExt(file.originalname);
      if (!ALLOWED_BIBLIOTECA_TYPES[ext]) return cb(new Error(`Extensión ".${ext}" no permitida`));
      cb(null, true);
    },
  });

  async function checkOwnership(proyectoId, userId) {
    return getRow('SELECT id FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  /**
   * GET /api/proyectos/:id/biblioteca
   */
  app.get('/api/proyectos/:id/biblioteca', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const documentos = await getRows(
      'SELECT id, project_id, carpeta_id, nombre_archivo, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, created_at FROM project_biblioteca WHERE project_id = ? ORDER BY created_at DESC',
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

    const carpetas = await getRows(
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

    const [{ maxOrden } = { maxOrden: -1 }] = await getRows(
      'SELECT COALESCE(MAX(orden), -1) AS "maxOrden" FROM project_biblioteca_carpetas WHERE project_id = ?',
      [req.params.id]
    );

    const id = crypto.randomUUID();
    await runSql(
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

    const carpeta = await getRow(
      'SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?',
      [req.params.carpetaId, req.params.id]
    );
    if (!carpeta) return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });

    await runSql('UPDATE project_biblioteca_carpetas SET nombre = ? WHERE id = ?', [nombre, req.params.carpetaId]);
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

    const carpeta = await getRow(
      'SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?',
      [req.params.carpetaId, req.params.id]
    );
    if (!carpeta) return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });

    const eliminarDocumentos = String(req.query?.eliminarDocumentos || '') === 'true';
    if (eliminarDocumentos) {
      const docs = await getRows(
        'SELECT id, ruta_storage FROM project_biblioteca WHERE carpeta_id = ? AND project_id = ?',
        [req.params.carpetaId, req.params.id]
      );
      await runSql('DELETE FROM project_biblioteca WHERE carpeta_id = ? AND project_id = ?', [req.params.carpetaId, req.params.id]);
      if (supabaseAdmin) {
        const rutas = docs.map(d => d.ruta_storage).filter(Boolean);
        if (rutas.length) supabaseAdmin.storage.from(BIBLIOTECA_BUCKET).remove(rutas).catch(() => {});
      }
    }

    await runSql('DELETE FROM project_biblioteca_carpetas WHERE id = ?', [req.params.carpetaId]);
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
      const error = validateBibliotecaFile(req.file);
      if (error) return res.status(422).json({ success: false, message: error });
      if (!supabaseAdmin) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible — Supabase no configurado' });
    }

    const categoriaRaw = String(req.body?.categoria || 'otro').toLowerCase();
    const categoria = CATEGORIAS_VALIDAS.has(categoriaRaw) ? categoriaRaw : 'otro';

    // carpeta_id es opcional (documento "sin carpeta" es válido) — se valida
    // que exista y pertenezca al mismo proyecto antes de aceptarla.
    let carpetaId = req.body?.carpeta_id ? String(req.body.carpeta_id) : null;
    if (carpetaId) {
      const carpeta = await getRow('SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?', [carpetaId, req.params.id]);
      if (!carpeta) carpetaId = null;
    }

    const id = crypto.randomUUID();
    let nombreArchivo = '', rutaStorage = '', tipoMime = '', tamanoBytes = 0;

    if (req.file) {
      const ext = safeExt(req.file.originalname);
      const storedName = `${id}.${ext}`;
      const storagePath = `${req.params.id}/${storedName}`;

      const { error: uploadError } = await supabaseAdmin.storage
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
      await runSql(
        `INSERT INTO project_biblioteca
         (id, project_id, tenant_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, carpeta_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, req.params.id, req.userId, nombreArchivo, rutaStorage, tipoMime, tamanoBytes, categoria, descripcion, texto, link, carpetaId, new Date().toISOString()]
      );
    } catch (dbError) {
      if (rutaStorage) {
        await supabaseAdmin.storage.from(BIBLIOTECA_BUCKET).remove([rutaStorage])
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
  // BLINDAJE ANTIPÉRDIDA (2026-08-17): si el payload trae descripcion/texto/
  // link vacíos pero el valor ya guardado en BD no lo está, se conserva el
  // valor existente en vez de sobrescribirlo con vacío. No aplica a
  // carpeta_id/categoria — null es un valor válido e intencional para esos
  // dos (mover a "sin carpeta" / reclasificar), no un dato accidentalmente
  // perdido. Consecuencia consciente: ya no se puede vaciar descripcion/
  // texto/link por edición normal — solo eliminando la fila completa.
  app.patch('/api/proyectos/:id/biblioteca/:docId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const existente = await getRow(
      'SELECT descripcion, texto, link FROM project_biblioteca WHERE id = ? AND project_id = ?',
      [req.params.docId, req.params.id]
    );
    if (!existente) return res.status(404).json({ success: false, message: 'Documento no encontrado' });

    const descripcionIn = sanitizeTechnicalText(String(req.body?.descripcion ?? ''), 500);
    const textoIn        = sanitizeTechnicalText(String(req.body?.texto ?? ''), 500);
    const linkIn          = sanitizeUrl(String(req.body?.link ?? ''), 500);
    const descripcion = descripcionIn.trim() ? descripcionIn : existente.descripcion;
    const texto        = textoIn.trim() ? textoIn : existente.texto;
    const link          = linkIn.trim() ? linkIn : existente.link;

    let carpetaClause = '';
    const params = [descripcion, texto, link];
    if (req.body?.carpeta_id !== undefined) {
      let carpetaId = req.body.carpeta_id ? String(req.body.carpeta_id) : null;
      if (carpetaId) {
        const carpeta = await getRow('SELECT id FROM project_biblioteca_carpetas WHERE id = ? AND project_id = ?', [carpetaId, req.params.id]);
        if (!carpeta) carpetaId = null;
      }
      carpetaClause = ', carpeta_id = ?';
      params.push(carpetaId);
    }

    if (req.body?.categoria !== undefined) {
      const categoriaRaw = String(req.body.categoria || 'otro').toLowerCase();
      const categoria = CATEGORIAS_VALIDAS.has(categoriaRaw) ? categoriaRaw : 'otro';
      params.push(categoria);
      await runSql(
        `UPDATE project_biblioteca SET descripcion = ?, texto = ?, link = ?${carpetaClause}, categoria = ? WHERE id = ? AND project_id = ?`,
        [...params, req.params.docId, req.params.id]
      );
    } else {
      await runSql(
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

    const doc = await getRow(
      'SELECT ruta_storage, nombre_archivo FROM project_biblioteca WHERE id = ? AND project_id = ?',
      [req.params.docId, req.params.id]
    );
    if (!doc || !doc.ruta_storage) return res.status(404).json({ success: false, message: 'Documento no encontrado o sin archivo adjunto' });
    if (!supabaseAdmin) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible' });

    const { data, error } = await supabaseAdmin.storage
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

    const doc = await getRow(
      'SELECT id, ruta_storage FROM project_biblioteca WHERE id = ? AND project_id = ?',
      [req.params.docId, req.params.id]
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Documento no encontrado' });

    await runSql('DELETE FROM project_biblioteca WHERE id = ?', [req.params.docId]);

    if (doc.ruta_storage && supabaseAdmin) {
      supabaseAdmin.storage.from(BIBLIOTECA_BUCKET).remove([doc.ruta_storage]).catch(() => {});
    }

    res.json({ success: true, message: 'Documento eliminado' });
  }));
}
