/**
 * anexos.routes.js — CRUD real de Anexos contra project_anexos (migración 013)
 * Reemplaza el almacenamiento en localStorage de AnexosView.tsx (radar360_anexos_data).
 *
 * GET    /api/proyectos/:id/anexos                    — lista los anexos reales del proyecto
 * POST   /api/proyectos/:id/anexos                    — sube un archivo real (multipart/form-data, campo "file")
 * GET    /api/proyectos/:id/anexos/buscar?q=...       — búsqueda semántica (pgvector) sobre el contenido
 * GET    /api/proyectos/:id/anexos/:anexoId/download  — URL firmada temporal para descargar el archivo
 * DELETE /api/proyectos/:id/anexos/:anexoId           — elimina el anexo (fila en BD + objeto en Supabase Storage)
 *
 * FIX AUDITORÍA (Pilar 2 — pérdida de datos en contenedores efímeros):
 * Railway reconstruye el contenedor en cada deploy — cualquier archivo escrito
 * en el disco local (fs.writeFileSync) se pierde permanentemente. Se elimina
 * por completo la dependencia de disco: los archivos ahora viven en Supabase
 * Storage (bucket privado "anexos"), subidos/leídos/borrados vía el cliente
 * admin (service_role key, bypasea RLS — igual que el resto de la app).
 *
 * BÚSQUEDA SEMÁNTICA (migración 041, 2026-08-17): mandato original del
 * usuario pedía un pipeline nuevo con pdf-parse/cheerio/worker_threads y un
 * JSONB "compatible con el Motor Dialéctico (RAG del proyecto)" — objetado
 * por el agente architect tras leer el código real: motor_dialectico es
 * configuración de tono narrativo (TEXT plano), no un RAG; el RAG real de
 * este repo es embeddingsService.js + columnas vector(768) (mismo patrón que
 * proyectos.embedding/convocatorias.embedding). pdf-parse/cheerio habrían
 * duplicado markitdownService.js/EntityScraper.js, ya en producción.
 * Alcance corregido y confirmado por el usuario: solo Anexos (no Biblioteca,
 * que se diseñó el mismo día para NO tener pipeline de extracción — ver
 * migración 040), conectado al RAG real, sin worker_threads/SSE (no
 * justificados — extracción+embedding corre fire-and-forget tras responder,
 * mismo patrón ya usado para el pipeline de presupuesto_apu más abajo).
 * El embedding se genera solo en el POST (subida) — editar descripcion/texto
 * después no lo regenera (evita releer el archivo en cada blur; limitación
 * documentada, no un descuido).
 */
import crypto from 'crypto';
import pLimit from 'p-limit';
import { supabaseStorage } from '../config/supabase.config.js';
// withTenant() (005_INGENIERO_BACKEND, 2026-09-04): reemplazó el único uso de
// supabaseAdmin que tenía este archivo (lectura de project_apu_lineas para el
// conector de viabilidad financiera). supabaseStorage sigue siendo el cliente
// correcto para Supabase Storage (líneas de arriba), sin cambios.
// AMPLIACIÓN (Prioridad Roja, Fase 1 de docs/ROADMAP_MIGRACION_TENANT_2026.md,
// 2026-09-05): el resto de los call sites de este archivo (getRow/getRows/
// runSql contra `project_anexos`, `project_anexos_carpetas`, `proyectos`)
// migran aquí también, al rol rf360_rls_scoped — GRANT ya aplicado en
// producción por 055_rls_scoped_grants_fase1.sql (verificado en vivo:
// GRANT + prueba de aislamiento cross-tenant, 2026-09-05). withTenantRow/
// withTenantRows/withTenantRun (database.config.js) preservan el contrato
// getRow/getRows/runSql (mismo shape de retorno, misma convención "?") — el
// diff de cada call site es solo agregar el tenantId (siempre `req.userId`
// en este archivo, org_id = user_id) como primer argumento.
import { withTenant, withTenantRow, withTenantRows, withTenantRun } from '../config/database.config.js';
import { sanitizeTechnicalText, sanitizeUrl } from '../middlewares/SecurityMiddleware.js';
import { parseAndSanitizeExcel } from '../services/ExtractorService.js';
import { ejecutarAuditoriaCompleta } from '../services/AuditorForenseService.js';
import { convertBufferToMarkdown } from '../services/markitdownService.js';
import { textToEmbedding, serializeEmbedding } from '../services/embeddingsService.js';
import { captureError } from '../config/sentry.config.js';

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
// Límites subidos 2026-08-17 (15MB→50MB documentos, 8MB→15MB imágenes):
// los PDF escaneados de resoluciones/decretos gubernamentales rutinariamente
// superan 15MB — el límite anterior rechazaba archivos reales y legítimos.
const ALLOWED_ANEXO_TYPES = {
  pdf:  { mimes: ['application/pdf'],                                                                        maxBytes: 50 * 1024 * 1024 },
  doc:  { mimes: ['application/msword'],                                                                      maxBytes: 50 * 1024 * 1024 },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'], maxBytes: 50 * 1024 * 1024 },
  xls:  { mimes: ['application/vnd.ms-excel'],                                                                 maxBytes: 50 * 1024 * 1024 },
  xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],       maxBytes: 50 * 1024 * 1024 },
  jpg:  { mimes: ['image/jpeg'], maxBytes: 15 * 1024 * 1024 },
  jpeg: { mimes: ['image/jpeg'], maxBytes: 15 * 1024 * 1024 },
  png:  { mimes: ['image/png'],  maxBytes: 15 * 1024 * 1024 },
};
const ANEXO_MAX_BYTES = 50 * 1024 * 1024; // techo global de multer (el mayor de los límites por tipo)

const CATEGORIAS_VALIDAS = new Set(['legal', 'financiero', 'tecnico', 'institucional', 'presupuesto_apu', 'otro']);

// Extensiones de ALLOWED_ANEXO_TYPES que MarkItDown puede convertir a texto —
// jpg/png quedan fuera (no son documentos de texto, no aportan al embedding).
const EXTENSIONES_CON_TEXTO = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx']);

// Columna vector(768) nativa (migración 041) solo existe/se puebla vía pg
// directo — igual que matchScore.js (stage2GetEmbedding): en Capa 2 (REST) el
// cast "::vector" se omite en silencio (restUpdate solo acepta placeholders
// bare), así que ahí solo se escribe la columna TEXT de respaldo.
const USE_PG = !!process.env.DATABASE_URL;

// Genera el embedding semántico de un anexo y lo persiste — fire-and-forget
// (se llama sin await desde el POST, después de responder al cliente; nunca
// debe bloquear ni hacer fallar la subida si Gemini/MarkItDown fallan).
async function generarEmbeddingAsync(tenantId, { anexoId, projectId, texto }) {
  try {
    if (!texto || !texto.trim()) return;
    const vector = await textToEmbedding(texto);
    const embStr = serializeEmbedding(vector);
    if (USE_PG) {
      await withTenantRun(tenantId, 'UPDATE project_anexos SET embedding = ?, embedding_vec = ?::vector WHERE id = ? AND project_id = ?', [embStr, embStr, anexoId, projectId]);
    } else {
      await withTenantRun(tenantId, 'UPDATE project_anexos SET embedding = ? WHERE id = ? AND project_id = ?', [embStr, anexoId, projectId]);
    }
  } catch (e) {
    console.warn('[anexos] No se pudo generar el embedding semántico (no bloqueante):', e.message);
  }
}

function safeExt(filename) {
  return (filename || '').split('.').pop().toLowerCase();
}

// Carpeta "Investigación" protegida (mandato 2026-08-17): es la fuente real
// que lee EntradaIAService.js para "Generar con AI" — renombrarla o
// borrarla rompería esa función en silencio, así que el bloqueo no puede
// depender solo de ocultar los botones en el frontend (una llamada directa
// a la API los saltaría). Mismo criterio de normalización (sin tildes) que
// EntradaIAService.js y AnexosCalcoView.tsx.
function normalizar(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function esCarpetaProtegida(nombre) {
  return normalizar(nombre).includes('investigacion');
}

// FIX (auditoría 2026-08-17, "no me deja anexar archivos" — tercera causa
// distinta de las ya corregidas): la lista blanca anterior (\w = SOLO ASCII)
// rechazaba cualquier nombre real con tildes/ñ/paréntesis/símbolos como "N°"
// — es decir, prácticamente todo nombre de archivo institucional en español
// ("Plan de Desarrollo Bolívar (2024-2027).pdf"). El nombre real NUNCA se
// usa para construir la ruta de Storage (esa usa el UUID de la fila) — solo
// se guarda para mostrarlo y para el Content-Disposition de la descarga. Se
// cambia a lista NEGRA: solo se bloquean caracteres de control (incluye
// CRLF — inyección de cabecera), comillas y separadores de ruta (/ \) —
// cualquier letra, tilde, ñ, símbolo o puntuación normal queda permitida.
const NOMBRE_ARCHIVO_PELIGROSO = /[\x00-\x1F"<>\\/]/;
function validateAnexoFile(file) {
  const nombre = file.originalname || '';
  const safeName = nombre.length >= 1 && nombre.length <= 200 && !NOMBRE_ARCHIVO_PELIGROSO.test(nombre);
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
      captureError(err, { route: 'anexos', method: req.method, path: req.path, userId: req.userId });
      res.status(500).json({ success: false, message: 'Error interno del servidor. Si el problema persiste, contacta al administrador.' });
    }
  };
}

// `getRow`/`getRows`/`runSql` ya no se destructuran (todos los call sites de
// este archivo migraron a withTenantRow/withTenantRows/withTenantRun, pool
// RLS-escopado) — si server.js los sigue pasando en el objeto de deps, se
// ignoran sin error.
export async function registerAnexosRoutes(app, { authenticateToken, financialPipelineLimiter }) {
  if (!supabaseStorage) {
    console.error('[anexos] SUPABASE_URL/SUPABASE_SERVICE_KEY no configurados — subida de anexos desactivada');
  } else {
    // Idempotente: si el bucket ya existe, createBucket devuelve un error que
    // se ignora — pero eso significa que su fileSizeLimit original NUNCA se
    // actualiza. updateBucket sí aplica el límite nuevo a un bucket existente
    // (fix 2026-08-17: el bucket llevaba meses con el tope viejo de 15MB pese
    // a que el código ya pedía uno mayor).
    const { error } = await supabaseStorage.storage.createBucket(ANEXOS_BUCKET, {
      public: false,
      fileSizeLimit: ANEXO_MAX_BYTES,
    });
    if (error && !/already exists/i.test(error.message || '')) {
      console.warn('[anexos] No se pudo confirmar el bucket de Storage:', error.message);
    } else if (error) {
      const { error: updateError } = await supabaseStorage.storage.updateBucket(ANEXOS_BUCKET, {
        public: false,
        fileSizeLimit: ANEXO_MAX_BYTES,
      });
      if (updateError) console.warn('[anexos] No se pudo actualizar el límite del bucket:', updateError.message);
    }
  }

  const multer = (await import('multer')).default;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: ANEXO_MAX_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = safeExt(file.originalname);
      if (!ALLOWED_ANEXO_TYPES[ext]) {
        const err = new Error(`Extensión ".${ext}" no permitida`);
        err.status = 422;
        return cb(err);
      }
      cb(null, true);
    },
  });

  async function checkOwnership(proyectoId, userId) {
    // Incluye ficha_tecnica (no solo id): el conector de viabilidad financiera
    // (más abajo, tras ingestar un presupuesto_apu) necesita fusionar sobre el
    // estado actual sin una segunda consulta — el resto de endpoints de este
    // archivo ignora este campo, así que ampliarlo aquí es seguro.
    return withTenantRow(userId, 'SELECT id, ficha_tecnica FROM proyectos WHERE id = ? AND org_id = ?', [proyectoId, userId]);
  }

  /**
   * GET /api/proyectos/:id/anexos
   */
  app.get('/api/proyectos/:id/anexos', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const anexos = await withTenantRows(req.userId,
      // FIX (reportado por el usuario 2026-08-17): ORDER BY created_at DESC
      // (más nuevo primero) invertía el orden de ingreso cada vez que la
      // lista se recargaba — el usuario numera sus filas mentalmente en el
      // orden en que las escribe, no al revés. ASC = orden de ingreso real.
      'SELECT id, project_id, carpeta_id, nombre_archivo, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, created_at FROM project_anexos WHERE project_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: anexos });
  }));

  /**
   * GET /api/proyectos/:id/anexos/carpetas
   */
  app.get('/api/proyectos/:id/anexos/carpetas', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const carpetas = await withTenantRows(req.userId,
      'SELECT id, project_id, nombre, orden, created_at FROM project_anexos_carpetas WHERE project_id = ? ORDER BY orden ASC, created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: carpetas });
  }));

  /**
   * POST /api/proyectos/:id/anexos/carpetas — crea una carpeta { nombre }
   */
  app.post('/api/proyectos/:id/anexos/carpetas', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombre = sanitizeTechnicalText(String(req.body?.nombre || ''), 100).trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la carpeta es obligatorio' });

    const [{ maxOrden } = { maxOrden: -1 }] = await withTenantRows(req.userId,
      'SELECT COALESCE(MAX(orden), -1) AS "maxOrden" FROM project_anexos_carpetas WHERE project_id = ?',
      [req.params.id]
    );

    const id = crypto.randomUUID();
    await withTenantRun(req.userId,
      'INSERT INTO project_anexos_carpetas (id, project_id, tenant_id, nombre, orden, created_at) VALUES (?,?,?,?,?,?)',
      [id, req.params.id, req.userId, nombre, Number(maxOrden) + 1, new Date().toISOString()]
    );
    res.status(201).json({ success: true, data: { id, project_id: req.params.id, nombre, orden: Number(maxOrden) + 1 } });
  }));

  /**
   * PUT /api/proyectos/:id/anexos/carpetas/:carpetaId — renombra { nombre }
   */
  app.put('/api/proyectos/:id/anexos/carpetas/:carpetaId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const nombre = sanitizeTechnicalText(String(req.body?.nombre || ''), 100).trim();
    if (!nombre) return res.status(400).json({ success: false, message: 'El nombre de la carpeta es obligatorio' });

    const carpeta = await withTenantRow(req.userId,
      'SELECT id, nombre FROM project_anexos_carpetas WHERE id = ? AND project_id = ?',
      [req.params.carpetaId, req.params.id]
    );
    if (!carpeta) return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
    if (esCarpetaProtegida(carpeta.nombre)) {
      return res.status(403).json({ success: false, message: 'Esta carpeta está protegida y vinculada al botón "Generar con AI" de Entrada — no se puede renombrar.' });
    }

    await withTenantRun(req.userId, 'UPDATE project_anexos_carpetas SET nombre = ? WHERE id = ?', [nombre, req.params.carpetaId]);
    res.json({ success: true, message: 'Carpeta renombrada' });
  }));

  /**
   * DELETE /api/proyectos/:id/anexos/carpetas/:carpetaId
   * Por defecto, los anexos de la carpeta quedan "sin carpeta" (FK ON DELETE
   * SET NULL) — nunca se borran implícitamente. Solo con
   * ?eliminarDocumentos=true se borran también los anexos (fila + archivo en
   * Storage), acción explícita y opt-in desde el frontend — mismo criterio
   * que biblioteca.routes.js.
   */
  app.delete('/api/proyectos/:id/anexos/carpetas/:carpetaId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const carpeta = await withTenantRow(req.userId,
      'SELECT id, nombre FROM project_anexos_carpetas WHERE id = ? AND project_id = ?',
      [req.params.carpetaId, req.params.id]
    );
    if (!carpeta) return res.status(404).json({ success: false, message: 'Carpeta no encontrada' });
    if (esCarpetaProtegida(carpeta.nombre)) {
      return res.status(403).json({ success: false, message: 'Esta carpeta está protegida y vinculada al botón "Generar con AI" de Entrada — no se puede eliminar.' });
    }

    const eliminarDocumentos = String(req.query?.eliminarDocumentos || '') === 'true';
    if (eliminarDocumentos) {
      const docs = await withTenantRows(req.userId,
        'SELECT id, ruta_storage FROM project_anexos WHERE carpeta_id = ? AND project_id = ?',
        [req.params.carpetaId, req.params.id]
      );
      await withTenantRun(req.userId, 'DELETE FROM project_anexos WHERE carpeta_id = ? AND project_id = ?', [req.params.carpetaId, req.params.id]);
      if (supabaseStorage) {
        const rutas = docs.map(d => d.ruta_storage).filter(Boolean);
        if (rutas.length) supabaseStorage.storage.from(ANEXOS_BUCKET).remove(rutas).catch(() => {});
      }
    }

    await withTenantRun(req.userId, 'DELETE FROM project_anexos_carpetas WHERE id = ?', [req.params.carpetaId]);
    res.json({ success: true, message: eliminarDocumentos ? 'Carpeta y sus anexos eliminados' : 'Carpeta eliminada — sus anexos quedaron sin carpeta' });
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
    // FIX (auditoría 2026-08-23, "Campo A da ND pese a tener investigación
    // real pegada"): texto truncaba en silencio a 500 caracteres — un
    // usuario que pega una conversación de investigación completa (el caso
    // de uso real y esperado de este campo, ver EntradaIAService.js) perdía
    // todo menos el primer párrafo, sin ningún aviso de guardado parcial.
    // Confirmado en vivo contra BD real: 4/4 anexos de "Investigación" de un
    // proyecto quedaron en exactamente 500 caracteres, todos cortados en
    // medio de una oración. Elevado a MAX_CHARS_POR_ANEXO (20000, mismo tope
    // que ya usa EntradaIAService.js al leer este campo para la IA) — antes
    // el límite de escritura (500) era 40x más chico que el de lectura
    // (20000), contradicción que confirma que 500 fue un descuido, no una
    // regla de negocio. descripcion/link (campos cortos por diseño) quedan
    // igual en 500.
    const descripcion = sanitizeTechnicalText(String(req.body?.descripcion || ''), 500);
    const texto       = sanitizeTechnicalText(String(req.body?.texto || ''), 20000);
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
      const error = validateAnexoFile(req.file);
      if (error) return res.status(422).json({ success: false, message: error });
      if (!supabaseStorage) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible — Supabase no configurado' });
    }

    const categoriaRaw = String(req.body?.categoria || 'otro').toLowerCase();
    const categoria = CATEGORIAS_VALIDAS.has(categoriaRaw) ? categoriaRaw : 'otro';

    // carpeta_id es opcional (anexo "sin carpeta" es válido) — se valida que
    // exista y pertenezca al mismo proyecto antes de aceptarla. Mismo
    // criterio que biblioteca.routes.js (migración 042).
    let carpetaId = req.body?.carpeta_id ? String(req.body.carpeta_id) : null;
    if (carpetaId) {
      const carpeta = await withTenantRow(req.userId, 'SELECT id FROM project_anexos_carpetas WHERE id = ? AND project_id = ?', [carpetaId, req.params.id]);
      if (!carpeta) carpetaId = null;
    }

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

      const { error: uploadError } = await supabaseStorage.storage
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
      await withTenantRun(req.userId,
        `INSERT INTO project_anexos
         (id, project_id, tenant_id, nombre_archivo, ruta_storage, tipo_mime, tamano_bytes, categoria, descripcion, texto, link, carpeta_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, req.params.id, req.userId, nombreArchivo, rutaStorage, tipoMime, tamanoBytes, categoria, descripcion, texto, link, carpetaId, new Date().toISOString()]
      );
    } catch (dbError) {
      if (rutaStorage) {
        await supabaseStorage.storage.from(ANEXOS_BUCKET).remove([rutaStorage])
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
        const anterioresRows = await withTenantRows(req.userId,
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
          // silenciosamente (verificado en vivo). FIX (005_INGENIERO_BACKEND,
          // 2026-09-04): antes usaba supabaseAdmin (service_role, bypasea RLS
          // por completo) — ahora usa withTenantRows() (wrapper sobre
          // withTenant()) con el rol rf360_rls_scoped (sin BYPASSRLS,
          // migración 053_rls_scoped_role.sql), RLS real.
          const lineasApu = await withTenantRows(req.userId,
            'SELECT valor_total_cop FROM project_apu_lineas WHERE project_id = ?',
            [req.params.id]
          );
          const costosVariablesTotales = lineasApu.reduce((sum, l) => sum + Number(l.valor_total_cop || 0), 0);

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
          // ficha_tecnica es JSONB nativo desde 037_ficha_tecnica_a_jsonb.sql
          // (2026-08-10) — sin casts tácticos ::jsonb/::text, ya innecesarios.
          await withTenantRun(req.userId,
            `UPDATE proyectos
             SET ficha_tecnica = jsonb_set(ficha_tecnica, '{viabilidad_financiera}', ?::jsonb, true),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND org_id = ?`,
            [JSON.stringify(viabilidadActualizada), req.params.id, req.userId]
          );
        } catch (viabErr) {
          console.error('[anexos] Conector de viabilidad financiera falló (no bloqueante):', viabErr.message);
        }
      } catch (extErr) {
        await withTenantRun(req.userId, 'DELETE FROM project_anexos WHERE id = ?', [id]);
        if (rutaStorage) supabaseStorage.storage.from(ANEXOS_BUCKET).remove([rutaStorage]).catch(() => {});
        return res.status(extErr.status || 500).json({ success: false, message: extErr.message });
      }
    }

    // Búsqueda semántica (migración 041) — fire-and-forget, corre DESPUÉS de
    // responder (sin await aquí) y nunca puede hacer fallar la subida. Combina
    // el texto extraído del archivo (si el formato lo permite) con los campos
    // narrativos — ver comentario de cabecera del archivo.
    (async () => {
      let textoArchivo = '';
      if (req.file && EXTENSIONES_CON_TEXTO.has(safeExt(req.file.originalname))) {
        try {
          textoArchivo = await convertBufferToMarkdown(req.file.buffer, safeExt(req.file.originalname));
        } catch (e) {
          console.warn('[anexos] No se pudo extraer texto del archivo para el embedding (no bloqueante):', e.message);
        }
      }
      const textoCompleto = [descripcion, texto, textoArchivo].filter(Boolean).join('\n\n').slice(0, 8000);
      await generarEmbeddingAsync(req.userId, { anexoId: id, projectId: req.params.id, texto: textoCompleto });
    })().catch(() => {});

    res.status(201).json({
      success: true,
      data: {
        id, project_id: req.params.id, nombre_archivo: nombreArchivo,
        tipo_mime: tipoMime, tamano_bytes: tamanoBytes, categoria, descripcion, texto, link,
        carpeta_id: carpetaId,
        created_at: new Date().toISOString(),
      },
      // No se envían las líneas crudas al cliente — solo el resumen.
      extraccion: extraccion ? { totalLineas: extraccion.totalLineas, sheetUsada: extraccion.sheetUsada } : null,
      auditoria,
    });
  }));

  /**
   * GET /api/proyectos/:id/anexos/buscar?q=texto
   * Búsqueda semántica (pgvector, coseno) sobre descripcion+texto+contenido
   * extraído del archivo. Requiere Capa 1 (pg directo) — en Capa 2 (REST) la
   * columna embedding_vec puede no estar poblada (ver USE_PG arriba).
   */
  app.get('/api/proyectos/:id/anexos/buscar', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const q = String(req.query?.q || '').trim();
    if (!q) return res.status(400).json({ success: false, message: 'Parámetro "q" requerido' });
    if (!USE_PG) return res.status(503).json({ success: false, message: 'Búsqueda semántica no disponible sin conexión directa a la base de datos' });

    let vector;
    try {
      vector = await textToEmbedding(q);
    } catch (e) {
      return res.status(502).json({ success: false, message: `No se pudo generar el embedding de la búsqueda: ${e.message}` });
    }
    const vecStr = serializeEmbedding(vector);

    const resultados = await withTenantRows(req.userId,
      `SELECT id, nombre_archivo, categoria, descripcion, texto, link, created_at,
              (1 - (embedding_vec <=> ?::vector)) AS similitud
       FROM project_anexos
       WHERE project_id = ? AND embedding_vec IS NOT NULL
       ORDER BY embedding_vec <=> ?::vector
       LIMIT 20`,
      [vecStr, req.params.id, vecStr]
    );
    res.json({ success: true, data: resultados });
  }));

  /**
   * PATCH /api/proyectos/:id/anexos/:anexoId — edita los campos narrativos
   * (descripcion/texto/link) y, opcionalmente, la categoria (usada por el
   * toggle "Documento Técnico" del frontend para reclasificar un anexo ya
   * subido). Solo cambia la etiqueta — no vuelve a disparar ExtractorService/
   * AuditorForenseService aunque la nueva categoria sea 'presupuesto_apu';
   * ese pipeline solo corre una vez, en el POST original de subida.
   *
   * FIX (auditoría 2026-08-17, "borro el texto ODS, guardo, F5 y vuelve a
   * aparecer"): el BLINDAJE ANTIPÉRDIDA original trataba CUALQUIER valor
   * vacío como "dato perdido accidentalmente" y lo descartaba en silencio —
   * protegía contra una condición de carrera real de esa fecha, pero de paso
   * hacía imposible borrar un campo a propósito. Esa carrera ya está resuelta
   * en el frontend por otra vía (cola de guardado `encolar()` +
   * `eliminadosRef`) — el payload que llega aquí siempre refleja el estado
   * real y completo de la fila en el cliente, nunca un fragmento parcial.
   * El fix correcto distingue "el campo llegó vacío a propósito" (el usuario
   * lo borró) de "el campo ni siquiera vino en el body" — por PRESENCIA
   * (`!== undefined`), mismo criterio que ya usaba `categoria` más abajo.
   */
  app.patch('/api/proyectos/:id/anexos/:anexoId', authenticateToken, wrap(async (req, res) => {
    const proyecto = await checkOwnership(req.params.id, req.userId);
    if (!proyecto) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

    const existente = await withTenantRow(req.userId,
      'SELECT descripcion, texto, link FROM project_anexos WHERE id = ? AND project_id = ?',
      [req.params.anexoId, req.params.id]
    );
    if (!existente) return res.status(404).json({ success: false, message: 'Anexo no encontrado' });

    // FIX (auditoría 2026-08-23): mismo límite que en el POST de arriba —
    // 20000, no 500 (ver comentario completo en el POST).
    const descripcion = req.body?.descripcion !== undefined ? sanitizeTechnicalText(String(req.body.descripcion), 500) : existente.descripcion;
    const texto        = req.body?.texto !== undefined ? sanitizeTechnicalText(String(req.body.texto), 20000) : existente.texto;
    const link          = req.body?.link !== undefined ? sanitizeUrl(String(req.body.link), 500) : existente.link;

    // carpeta_id — mover el anexo a otra carpeta (o a null = sin carpeta).
    // Mismo criterio de presencia que categoria más abajo: null es un valor
    // válido e intencional aquí, no un dato accidentalmente perdido.
    let carpetaClause = '';
    const params = [descripcion, texto, link];
    if (req.body?.carpeta_id !== undefined) {
      let carpetaId = req.body.carpeta_id ? String(req.body.carpeta_id) : null;
      if (carpetaId) {
        const carpeta = await withTenantRow(req.userId, 'SELECT id FROM project_anexos_carpetas WHERE id = ? AND project_id = ?', [carpetaId, req.params.id]);
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
        `UPDATE project_anexos SET descripcion = ?, texto = ?, link = ?${carpetaClause}, categoria = ? WHERE id = ? AND project_id = ?`,
        [...params, req.params.anexoId, req.params.id]
      );
    } else {
      await withTenantRun(req.userId,
        `UPDATE project_anexos SET descripcion = ?, texto = ?, link = ?${carpetaClause} WHERE id = ? AND project_id = ?`,
        [...params, req.params.anexoId, req.params.id]
      );
    }
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

    const anexo = await withTenantRow(req.userId,
      'SELECT ruta_storage, nombre_archivo FROM project_anexos WHERE id = ? AND project_id = ?',
      [req.params.anexoId, req.params.id]
    );
    if (!anexo || !anexo.ruta_storage) return res.status(404).json({ success: false, message: 'Anexo no encontrado o sin archivo adjunto' });
    if (!supabaseStorage) return res.status(503).json({ success: false, message: 'Almacenamiento de archivos no disponible' });

    const { data, error } = await supabaseStorage.storage
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

    const anexo = await withTenantRow(req.userId,
      'SELECT id, ruta_storage FROM project_anexos WHERE id = ? AND project_id = ?',
      [req.params.anexoId, req.params.id]
    );
    if (!anexo) return res.status(404).json({ success: false, message: 'Anexo no encontrado' });

    await withTenantRun(req.userId, 'DELETE FROM project_anexos WHERE id = ?', [req.params.anexoId]);

    // Best-effort: un fallo al borrar el objeto en Storage no bloquea la respuesta.
    if (anexo.ruta_storage && supabaseStorage) {
      supabaseStorage.storage.from(ANEXOS_BUCKET).remove([anexo.ruta_storage]).catch(() => {});
    }

    res.json({ success: true, message: 'Anexo eliminado' });
  }));
}
