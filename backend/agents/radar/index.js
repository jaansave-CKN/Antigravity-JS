/**
 * Coordinador A — Radar (Nivel 2, Fase 4, dictamen architect 2026-09-28).
 *
 * Fachada: expone SOLO las capacidades del Radar que un flujo A↔B necesita,
 * para que el Gerente de Proyecto (backend/agents/gp/) nunca toque una
 * función hoja. Las rutas existentes del Radar siguen llamando a sus
 * funciones directamente (una indirección sin comportamiento solo añadiría
 * riesgo) — este archivo no se mete en su camino.
 *
 * convocatorias es el CATÁLOGO GLOBAL (sin org_id): se lee con el pool
 * principal, igual que las búsquedas del Radar en server.js.
 */
import { getRow, getRows } from '../../config/database.config.js';
import { deserializeEmbedding, cosineSimilarity } from '../../services/embeddingsService.js';
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
       FROM convocatorias WHERE deleted_at IS NULL AND estado != 'cerrada'`,
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
      `SELECT id, titulo, donante, descripcion, monto_min, monto_max, fecha_limite, estado, url_convocatoria,
              round((1 - (embedding_vec <=> $1::vector))::numeric, 4) AS similitud
         FROM convocatorias
        WHERE embedding_vec IS NOT NULL AND deleted_at IS NULL AND estado != 'cerrada'
          AND (1 - (embedding_vec <=> $1::vector)) >= $2
        ORDER BY embedding_vec <=> $1::vector
        LIMIT $3`,
      [JSON.stringify(vec), thr, lim]
    );
    return { resultados, motor: 'pgvector·HNSW' };
  }
  const convs = await getRows("SELECT id, titulo, donante, descripcion, monto_min, monto_max, fecha_limite, estado, url_convocatoria, embedding FROM convocatorias WHERE deleted_at IS NULL AND embedding IS NOT NULL AND estado != 'cerrada'", []);
  const resultados = convs
    .map(c => ({ ...c, embedding: undefined, similitud: Math.round(cosineSimilarity(vec, deserializeEmbedding(c.embedding)) * 10000) / 10000 }))
    .filter(c => c.similitud >= thr)
    .sort((a, b) => b.similitud - a.similitud)
    .slice(0, lim);
  return { resultados, motor: 'js-coseno' };
}
