/**
 * Coordinador A — Radar (Nivel 2, Fase 4, dictamen architect 2026-09-28).
 *
 * Fachada: expone las capacidades del Radar que un flujo A↔B necesita, para
 * que el Gerente de Proyecto (backend/agents/gp/) nunca toque una función
 * hoja. Desde 2026-09-29 también la usa la ruta de búsqueda semántica de
 * producción (POST /api/radar/buscar-masivo, GET
 * /api/radar/busqueda-semantica/estado vía buscarPorTexto /
 * estadoBusquedaSemantica): un solo SQL de búsqueda para el GP y la pantalla.
 *
 * convocatorias es el CATÁLOGO GLOBAL (sin org_id): se lee con el pool
 * principal, igual que las búsquedas del Radar en server.js.
 */
import { getRow, getRows, dbStatus } from '../../config/database.config.js';
import { deserializeEmbedding, cosineSimilarity, textToEmbedding } from '../../services/embeddingsService.js';
import { FUNCIONES as TODAS } from '../modulos.map.js';

export const MODULO = 'A_RADAR';
export const FUNCIONES = TODAS.filter(f => f.modulo === MODULO);

const COLUMNAS = 'id, externo_id, titulo, donante, descripcion, monto_min, monto_max, moneda, fecha_limite, url_convocatoria, estado';

/**
 * Convocatoria viva del catálogo por id o externo_id (el Radar del cliente
 * envía externo_id || id). null si no existe o está en la papelera.
 */
export async function obtenerConvocatoria(idOExterno) {
  const clave = String(idOExterno ?? '').trim();
  if (!clave) return null;
  return getRow(
    `SELECT ${COLUMNAS} FROM convocatorias WHERE (id = ? OR externo_id = ?) AND deleted_at IS NULL LIMIT 1`,
    [clave, clave]
  );
}

/** Conteo de convocatorias abiertas con/sin vector — distingue "catálogo sin embeddings" de "sin coincidencias". */
export async function estadoEmbeddings() {
  const fila = await getRow(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE embedding_vec IS NOT NULL)::int AS con
       FROM convocatorias WHERE deleted_at IS NULL AND estado NOT IN ('cerrada', 'fondo_continuo')`,
    []
  );
  return { total: Number(fila?.total) || 0, con: Number(fila?.con) || 0 };
}

/**
 * Convocatorias abiertas más cercanas a un vector (pgvector·HNSW; sin
 * DATABASE_URL, coseno en JS). Mismo SQL que tenía barridoMasivoHandler.
 */
export async function buscarConvocatoriasPorVector(vec, { limit = 50, threshold = 0.25 } = {}) {
  const lim = Math.min(Number(limit) || 50, 500);
  const thr = Number(threshold) || 0.25;
  if (process.env.DATABASE_URL) {
    const resultados = await getRows(
      `SELECT id, titulo, donante, descripcion, monto_min, monto_max, moneda, fecha_limite, estado, url_convocatoria,
              round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
        WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL AND estado NOT IN ('cerrada', 'fondo_continuo')
          AND (1 - (embedding_vec <=> $1::vector)) >= $2
        ORDER BY embedding_vec <=> $1::vector
        LIMIT $3`,
      [JSON.stringify(vec), thr, lim]
    );
    return { resultados, motor: 'pgvector·HNSW' };
  }
  const convs = await getRows("SELECT id, titulo, donante, descripcion, monto_min, monto_max, moneda, fecha_limite, estado, url_convocatoria, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL AND estado NOT IN ('cerrada', 'fondo_continuo')", []);
  const resultados = [];
  for (const c of convs) {
    const similitud = Math.round(cosineSimilarity(vec, deserializeEmbedding(c.embedding)) * 10000) / 10000;
    if (similitud >= thr) resultados.push({ ...c, embedding: undefined, similitud });
  }
  resultados.sort((a, b) => b.similitud - a.similitud).splice(lim);
  return { resultados, motor: 'js-coseno' };
}

/**
 * Estado de la búsqueda semántica (pantalla de producción, 2026-09-29).
 * Con la BD en modo REST degradado el conteo daría 0/0 falso (restCount) y la
 * pantalla afirmaría "catálogo sin indexar" sin serlo → 503
 * BUSQUEDA_NO_VERIFICABLE (dictamen architect C1).
 * @returns {Promise<{ok:true, cobertura:{con:number,total:number}} | {ok:false, status:number, code:string}>}
 */
export async function estadoBusquedaSemantica() {
  if (process.env.DATABASE_URL && !dbStatus().pgReady) return { ok: false, status: 503, code: 'BUSQUEDA_NO_VERIFICABLE' };
  return { ok: true, cobertura: await estadoEmbeddings() };
}

/**
 * Búsqueda semántica por texto libre sobre el catálogo ABIERTO. Orquestación
 * pura (la ruta solo mapea el resultado y pone X-RF-No-Retry):
 *   BD no verificable → 503 BUSQUEDA_NO_VERIFICABLE
 *   0 convocatorias con vector → 503 CATALOGO_SIN_EMBEDDINGS (antes de gastar
 *     un embedding)
 *   el servicio de embeddings falla → 503 IA_NO_DISPONIBLE (sin detalle
 *     interno hacia el cliente; el motivo va en detalleInterno para el log)
 * Nunca inventa resultados: sin vector no hay búsqueda.
 */
export async function buscarPorTexto({ texto, limit, threshold }) {
  const estado = await estadoBusquedaSemantica();
  if (!estado.ok) return estado;
  if (estado.cobertura.con === 0) return { ok: false, status: 503, code: 'CATALOGO_SIN_EMBEDDINGS', cobertura: estado.cobertura };
  let vec;
  try {
    vec = await textToEmbedding(String(texto).trim());
  } catch (err) {
    return { ok: false, status: 503, code: 'IA_NO_DISPONIBLE', detalleInterno: String(err?.message || err).slice(0, 200) };
  }
  const { resultados, motor } = await buscarConvocatoriasPorVector(vec, { limit, threshold });
  return { ok: true, resultados, motor, cobertura: estado.cobertura };
}
