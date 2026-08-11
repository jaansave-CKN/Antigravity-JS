/**
 * anexos.routes.js — CRUD real de Anexos contra project_anexos (migración 013)
 * Reemplaza el almacenamiento en localStorage de AnexosView.tsx (radar360_anexos_data).
 *
 * GET    /api/proyectos/:id/anexos                    — lista los anexos reales del proyecto
 * POST   /api/proyectos/:id/anexos                    — sube un archivo real (multipart/form-data, campo "file")
 * GET    /api/proyectos/:id/anexos/:anexoId/download  — URL firmada temporal para descargar el archivo
 * DELETE /api/proyectos/:id/anexos/:anexoId           — elimina el anexo (fila en BD + objeto en Supabase Storage)
 *
 * FIX AUDITORÍA (Pilar 2 — pérdida de datos en contenedores efímeros):
 * Railway reconstruye el contenedor en cada deploy — cualquier archivo escrito
 * en el disco local (fs.writeFileSync) se pierde permanentemente. Se elimina
 * por completo la dependencia de disco: los archivos ahora viven en Supabase
 * Storage (bucket privado "anexos"), subidos/leídos/borrados vía el cliente
 * admin (service_role key, bypasea RLS — igual que el resto de la app).
 */
import crypto from 'crypto';
import pLimit from 'p-limit';
import { supabaseAdmin } from '../config/supabase.config.js';
import { sanitizeTechnicalText, sanitizeUrl } from '../middlewares/SecurityMiddleware.js';
import { parseAndSanitizeExcel } from '../services/ExtractorService.js';
import { ejecutarAuditoriaCompleta } from '../services/AuditorForenseService.js';

function safeParseJson(val) {
  if (!val) return null;
  // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10 — migración ficha_tecnica a
  // JSONB nativo): antes funcionaba "por accidente" — JSON.parse(objeto)
  // lanzaba y el catch devolvía val (el objeto original) sin querer. Guard
  // explícito, mismo resultado pero sin depender de ese efecto colateral.
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); }
  catch { return val; }
}

// Amortigua subidas simultáneas de presupuestos pesados: máximo 3 extracciones
// corriendo a la vez por instancia de Node — el resto se encola en memoria en
// vez de saturar el pool de conexiones REST de Supabase (Capa 2). Sin Redis/
// BullMQ: un semáforo en memoria basta para el volumen actual; solo se
// justificaría una cola real si el tráfico concurrente crece más allá de lo
// que un único proceso puede absorber.
const extraccionLimiter = pLimit(3);

const ANEXOS_BUCKET = 'anexos';

// ── Whitelist de tipos permitidos (documentos de soporte del proyecto) ───────
const ALLOWED_ANEXO_TYPES = {
  pdf:  { mimes: ['application/pdf'],                                                                        maxBytes: 15 * 1024 * 1024 },
  doc:  { mimes: ['application/msword'],                                                                      maxBytes: 15 * 1024 * 1024 },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'], maxBytes: 15 * 1024 * 1024 },
  xls:  { mimes: ['application/vnd.ms-excel'],                                                                 maxBytes: 15 * 1024 * 1024 },
  xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],       maxBytes: 15 * 1024 * 1024 },
  jpg:  { mimes: ['image/jpeg'], maxBytes: 8 * 1024 * 1024 },
  jpeg: { mimes: ['image/jpeg'], maxBytes: 8 * 1024 * 1024 },
  png:  { mimes: ['image/png'],  maxBytes: 8 * 1024 * 1024 },
};

const CATEGORIAS_VALIDAS = new Set(['legal', 'financiero', 'tecnico', 'institucional', 'presupuesto_apu', 'otro']);

function safeExt(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

function validateAnexoFile(file) {
  const safeName = /^[\w\-. ]{1,200}$/.test(file.originalname);
  if (!safeName) return 'Nombre de archivo no permitido';

  const ext = safeExt(file.originalname);
  const rule = ALLOWED_ANEXO_TYPES[ext];
  if (!rule) return `Extensión ".${ext}" no permitida. Solo: ${Object.keys(ALLOWED_ANEXO_TYPES).join(', ')}`;
  if (file.size > rule.maxBytes) return `Archivo demasiado grande (máx ${rule.maxBytes / 1024 / 1024} MB para .${ext})`;

  return null;
}

function wrap(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (err) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 4): antes se
      // devolvía err.message crudo al cliente — confirmado en vivo que un
      // error de tipo Postgres llega íntegro (nombres de constraint, tipos
      // de columna). El log interno sigue completo, solo cambia lo que ve
      // el cliente.
      console.error('[anexos]', err.message);
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

export async function registerAnexosRoutes(app, { authenticateToken, runSql, getRow, getRows, financialPipelineLimiter }) {
  if (!supabaseAdmin) {
    console.error('[anexos] SUPABASE_URL/SUPABASE_SERVICE_KEY no configurados — subida de anexos desactivada');
  } else {
    // Idempotente: si el bucket ya existe, Supabase devuelve un error que se ignora.
    const { error } = await supabaseAdmin.storage.createBucket(ANEXOS_BUCKET, {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
    });
    if (error && !/already exists/i.test(error.message || '')) {
      console.warn('[anexos] No se pudo confirmar el bucket de Storage:', error.message);
    }
  }

  const multer = (await import('multer')).default;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = safeExt(file.originalname);
      if (!ALLOWED_ANEXO_TYPES[ext]) return cb(new Error(`Extensión ".${ext}" no permitida`));
      cb(null, true);
    },
  });

  async function checkOwnership(proyectoId, userId) {
    // Incluye ficha_tecnica (no solo id): el conector de viabilidad financiera
    // (más abajo, tras ingestar un presupuesto_apu) necesita fusionar sobre el
    // estado actual sin una segunda consulta — el resto de endpoints de este
    // archivo ignora este campo, así que ampliarlo aquí es seguro.
    return getRow('SELECT id, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  /**
   * GET /api/proyectos/:id/anexos
   */
  app.get('/api/proyectos/:id/anexos', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const anexos = await getRows(
      'SELECT id, project_id, nombre_archivo, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, created_at FROM project_anexos WHERE project_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ success: true, data: anexos });
  }));

  /**
   * POST /api/proyectos/:id/anexos
   * multipart/form-data: file=<archivo opcional>, categoria, descripcion, texto, link
   * El archivo es opcional — una fila puramente narrativa (descripcion/texto/link
   * sin adjunto real) también es válida, siempre que no esté completamente vacía.
   */
  app.post('/api/proyectos/:id/anexos', authenticateToken, upload.single('file'), wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 2): antes solo se
    // truncaba (.slice), sin sanitizar — un payload <script>/onerror= vivía
    // íntegro en BD. Hoy inerte (React escapa todo, sin
    // dangerouslySetInnerHTML en el proyecto — verificado) pero viola el
    // estándar Zero-Trust. link usa sanitizeUrl (no sanitizeTechnicalText):
    // su regex on\w+= no ancla a inicio de palabra y corrompería query
    // strings legítimos como "?ocupacion_id=1".
    const descripcion = sanitizeTechnicalText(String(req.body?.descripcion || ''), 500);
    const texto       = sanitizeTechnicalText(String(req.body?.texto || ''), 500);
    const link        = sanitizeUrl(String(req.body?.link || ''), 500);

    if (!req.file && !descripcion.trim() && !texto.trim() && !link.trim()) {
      return res.status(400).json({ success: false, message: 'Adjunta un archivo o completa descripción/texto/link' });
    }

    if (req.file) {
      const error = validateAnexoFile(req.file);
      if (error) return res.status(422).json({ success: false, message: error });
      if (!supabaseAdmin) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible — Supabase no configurado' });
    }

    const categoriaRaw = String(req.body?.categoria || 'otro').toLowerCase();
    const categoria = CATEGORIAS_VALIDAS.has(categoriaRaw) ? categoriaRaw : 'otro';

    // Rate limit por org_id SOLO para la ruta pesada (extracción de Excel) —
    // aplicarlo a todo /anexos golpearía el autoguardado onBlur de filas
    // puramente narrativas (descripción/texto/link), que se dispara muy
    // seguido y no tiene nada que ver con el pipeline financiero.
    if (req.file && categoria === 'presupuesto_apu' && /\.(xlsx|xls)$/i.test(req.file.originalname) && financialPipelineLimiter) {
      await new Promise(resolve => financialPipelineLimiter(req, res, () => resolve()));
      if (res.headersSent) return; // el limiter ya respondió 429
    }

    const id = crypto.randomUUID();
    let nombreArchivo = '', rutaStorage = '', tipoMime = '', tamanoBytes = 0;

    if (req.file) {
      const ext = safeExt(req.file.originalname);
      const storedName = `${id}.${ext}`;
      const storagePath = `${req.params.id}/${storedName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(ANEXOS_BUCKET)
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (uploadError) {
        return res.status(502).json({ success: false, message: `No se pudo subir el archivo a Storage: ${uploadError.message}` });
      }

      rutaStorage   = storagePath;
      nombreArchivo = req.file.originalname.slice(0, 200);
      tipoMime      = req.file.mimetype;
      tamanoBytes   = req.file.size;
    }

    // FIX (auditoría SRE 2026-08-08, Capa 5): el archivo ya se subió a Supabase
    // Storage arriba — si este INSERT falla (ej. columna faltante en la BD real,
    // ver auditoría Capa 2), antes quedaba huérfano en Storage, pagando hosting
    // sin ninguna fila que lo referencie. Se revierte el upload si el INSERT falla.
    try {
      await runSql(
        `INSERT INTO project_anexos
         (id, project_id, tenant_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, req.params.id, req.userId, nombreArchivo, rutaStorage, tipoMime, tamanoBytes, categoria, descripcion, texto, link, new Date().toISOString()]
      );
    } catch (dbError) {
      if (rutaStorage) {
        await supabaseAdmin.storage.from(ANEXOS_BUCKET).remove([rutaStorage])
          .catch(cleanupErr => console.error('[anexos] Rollback de Storage también falló:', cleanupErr.message));
      }
      console.error('[anexos] INSERT falló tras subir a Storage — rollback aplicado:', dbError.message);
      return res.status(500).json({ success: false, message: 'No se pudo registrar el anexo. El archivo no quedó guardado.' });
    }

    // "Pieza Cero": si el anexo se marcó explícitamente como presupuesto/APU y
    // es un Excel, se extrae a project_apu_lineas. Si falla (moneda extranjera,
    // archivo sin tabla reconocible), se revierte todo — no queda un anexo
    // "presupuesto" huérfano sin datos extraídos.
    let extraccion = null;
    let auditoria = null;
    if (req.file && categoria === 'presupuesto_apu' && /\.(xlsx|xls)$/i.test(req.file.originalname)) {
      try {
        // Idempotencia real: busca anexos previos del mismo proyecto con el
        // mismo nombre de archivo (p. ej. el usuario corrigió un typo y volvió
        // a subir "presupuesto.xlsx") para que ExtractorService limpie también
        // esas líneas antiguas, no solo las del anexo_id recién creado.
        const anterioresRows = await getRows(
          'SELECT id FROM project_anexos WHERE project_id = ? AND categoria = ? AND nombre_archivo = ? AND id != ?',
          [req.params.id, 'presupuesto_apu', nombreArchivo, id]
        );
        const anexoIdsAnteriores = anterioresRows.map(r => r.id);

        // Encolado: si ya hay 3 extracciones corriendo en este proceso, esta
        // petición espera su turno en memoria en vez de competir por conexiones.
        extraccion = await extraccionLimiter(() => parseAndSanitizeExcel(req.file.buffer, {
          projectId: req.params.id, orgId: req.userId, anexoId: id, anexoIdsAnteriores,
        }));
        // Sprint 2 — Motor VERIFICAR: cruza las líneas recién ingeridas.
        // No bloquea la respuesta si falla — la ingesta ya quedó guardada.
        try {
          auditoria = await ejecutarAuditoriaCompleta(req.params.id, id, req.userId, extraccion.lineas);
        } catch (audErr) {
          console.error('[anexos] AuditorForenseService falló (no bloqueante):', audErr.message);
        }

        // Conector Anexos → Punto de Equilibrio (fiscalizado por el Agente
        // Arquitecto 2026-08-09): costos_variables_totales se deriva SIEMPRE de
        // SUM(project_apu_lineas.valor_total_cop) — el presupuesto real recién
        // ingerido — nunca de un regex-scan del documento (costos_fijos y
        // ventas_totales siguen siendo exclusivamente entrada manual del
        // formulador, no hay fuente estructurada real de la que derivarlos).
        //
        // Invalidación explícita: si ya existía un punto de equilibrio calculado
        // (break_even_point_cop, reinversion.habilitada, etc.) en ficha_tecnica,
        // se limpia aquí — dejarlo junto a un costos_variables_totales nuevo
        // sería un gate de reinversión de dinero de inversionistas basado en un
        // presupuesto que ya no es el vigente. Requiere un nuevo POST explícito
        // a /viabilidad-financiera para recalcular. No bloqueante: un fallo aquí
        // no debe tumbar una ingesta de presupuesto ya guardada exitosamente.
        try {
          // project_apu_lineas tiene RLS (tenant_isolation ON project_apu_lineas
          // USING org_id = current_setting('app.org_id')) que getRow/runSql no
          // fija por request — un SELECT vía esa vía devuelve 0 filas siempre,
          // silenciosamente (verificado en vivo). supabaseAdmin (service_role)
          // bypasea RLS, mismo cliente que ya usan EstresadoFinancieroService.js
          // y ValorExponencialService.js para leer esta misma tabla.
          const { data: lineasApu, error: sumError } = await supabaseAdmin
            .from('project_apu_lineas')
            .select('valor_total_cop')
            .eq('project_id', req.params.id);
          if (sumError) throw new Error(sumError.message);
          const costosVariablesTotales = (lineasApu || []).reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);

          const fichaTecnicaActual   = safeParseJson(proyecto.ficha_tecnica) || {};
          const viabilidadPrevia     = fichaTecnicaActual.viabilidad_financiera || {};
          const viabilidadActualizada = {
            costos_fijos_proyectados:   viabilidadPrevia.costos_fijos_proyectados   ?? null,
            ventas_totales_proyectadas: viabilidadPrevia.ventas_totales_proyectadas ?? null,
            costos_variables_totales:   costosVariablesTotales,
            costos_variables_totales_fuente: 'auto_extraido_project_apu_lineas',
            // Cálculo obsoleto tras el nuevo presupuesto — se limpia hasta el
            // próximo POST /api/proyectos/:id/viabilidad-financiera explícito.
            break_even_point_cop:  null,
            is_break_even_reached: null,
            metodo_calculo:        null,
            reinversion:           null,
            recalculo_pendiente:   true,
          };

          // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, Capa 7): jsonb_set en
          // vez de sobreescribir el blob completo — este es el otro agente
          // (junto a proyectos.routes.js /viabilidad-financiera) que puede
          // escribir esta misma clave en paralelo; mismo fix, mismo motivo.
          // NOTA: ficha_tecnica es TEXT en la BD real (no JSONB), de ahí el
          // cast ::jsonb de entrada y ::text de salida — ver mismo fix en
          // proyectos.routes.js.
          await runSql(
            `UPDATE proyectos
             SET ficha_tecnica = jsonb_set(ficha_tecnica::jsonb, '{viabilidad_financiera}', ?::jsonb, true)::text,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND org_id = ?`,
            [JSON.stringify(viabilidadActualizada), req.params.id, req.userId]
          );
        } catch (viabErr) {
          console.error('[anexos] Conector de viabilidad financiera falló (no bloqueante):', viabErr.message);
        }
      } catch (extErr) {
        await runSql('DELETE FROM project_anexos WHERE id = ?', [id]);
        if (rutaStorage) supabaseAdmin.storage.from(ANEXOS_BUCKET).remove([rutaStorage]).catch(() => {});
        return res.status(extErr.status || 500).json({ success: false, message: extErr.message });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        id, project_id: req.params.id, nombre_archivo: nombreArchivo,
        tipo_mime: tipoMime, tamano_bytes: tamanoBytes, categoria, descripcion, texto, link,
        created_at: new Date().toISOString(),
      },
      // No se envían las líneas crudas al cliente — solo el resumen.
      extraccion: extraccion ? { totalLineas: extraccion.totalLineas, sheetUsada: extraccion.sheetUsada } : null,
      auditoria,
    });
  }));

  /**
   * PATCH /api/proyectos/:id/anexos/:anexoId — edita solo los campos narrativos
   * (descripcion/texto/link), sin tocar el archivo ya adjunto.
   */
  app.patch('/api/proyectos/:id/anexos/:anexoId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const descripcion = sanitizeTechnicalText(String(req.body?.descripcion ?? ''), 500);
    const texto        = sanitizeTechnicalText(String(req.body?.texto ?? ''), 500);
    const link         = sanitizeUrl(String(req.body?.link ?? ''), 500);

    await runSql(
      'UPDATE project_anexos SET descripcion = ?, texto = ?, link = ? WHERE id = ? AND project_id = ?',
      [descripcion, texto, link, req.params.anexoId, req.params.id]
    );
    res.json({ success: true, message: 'Anexo actualizado' });
  }));

  /**
   * GET /api/proyectos/:id/anexos/:anexoId/download
   * Devuelve una URL firmada de corta duración (5 min) — el bucket es privado,
   * así que no hay forma de acceder al archivo sin pasar por este endpoint
   * autenticado y con ownership verificado.
   */
  app.get('/api/proyectos/:id/anexos/:anexoId/download', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const anexo = await getRow(
      'SELECT ruta_storage, nombre_archivo FROM project_anexos WHERE id = ? AND project_id = ?',
      [req.params.anexoId, req.params.id]
    );
    if (!anexo || !anexo.ruta_storage) return res.status(404).json({ success: false, message: 'Anexo no encontrado o sin archivo adjunto' });
    if (!supabaseAdmin) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible' });

    const { data, error } = await supabaseAdmin.storage
      .from(ANEXOS_BUCKET)
      .createSignedUrl(anexo.ruta_storage, 300, { download: anexo.nombre_archivo });
    if (error) return res.status(502).json({ success: false, message: `No se pudo generar el enlace de descarga: ${error.message}` });

    res.json({ success: true, data: { url: data.signedUrl, expiresIn: 300 } });
  }));

  /**
   * DELETE /api/proyectos/:id/anexos/:anexoId
   */
  app.delete('/api/proyectos/:id/anexos/:anexoId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const anexo = await getRow(
      'SELECT id, ruta_storage FROM project_anexos WHERE id = ? AND project_id = ?',
      [req.params.anexoId, req.params.id]
    );
    if (!anexo) return res.status(404).json({ success: false, message: 'Anexo no encontrado' });

    await runSql('DELETE FROM project_anexos WHERE id = ?', [req.params.anexoId]);

    // Best-effort: un fallo al borrar el objeto en Storage no bloquea la respuesta.
    if (anexo.ruta_storage && supabaseAdmin) {
      supabaseAdmin.storage.from(ANEXOS_BUCKET).remove([anexo.ruta_storage]).catch(() => {});
    }

    res.json({ success: true, message: 'Anexo eliminado' });
  }));
}
