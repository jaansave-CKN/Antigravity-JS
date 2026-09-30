/**
 * purgaCatalogo.js — ÚNICA vía de soft-delete de "convocatorias" basura
 * (2026-09-29, dictamen architect C8). La usan:
 *   - backend/scripts/purgarBasuraCatalogo.mjs (manual, con simulación),
 *   - el cron diario (CronScheduler.expirarConvocatorias),
 *   - POST /api/radar/expirar (solo admin).
 * Antes el cron y el endpoint tenían cada uno su propia lista (NOISE_CRON_RE,
 * NOISE_RE) y borraban SIN respaldo; algunas entradas nombraban fondos reales.
 *
 * Criterio único: motivoBasura() (backend/utils/tituloBasura.js). Nunca toca
 * filas en estado 'fondo_continuo' (curaduría del dueño).
 */
import { motivoBasura } from '../utils/tituloBasura.js';

/** Tope del modo AUTOMÁTICO (cron/endpoint): más candidatos = algo cambió, no borra y avisa. */
export const TOPE_PURGA_AUTOMATICA = 25;

/** Plan puro (sin BD): filas vivas cuyo título es basura, salvo fondos continuos. */
export function planificarPurga(filas) {
  return filas
    .filter(f => f.estado !== 'fondo_continuo')
    .map(f => ({ id: f.id, titulo: f.titulo, motivo: motivoBasura(f.titulo) }))
    .filter(f => f.motivo);
}

/** UNA sentencia: soft-delete optimista (el título sigue siendo el leído) + respaldo del lote. */
export const SQL_SOFT_DELETE_CON_RESPALDO =
  `WITH u AS (UPDATE convocatorias SET deleted_at = now()
               WHERE id = ? AND deleted_at IS NULL AND titulo = ? AND estado <> 'fondo_continuo' RETURNING id)
   INSERT INTO convocatorias_saneamiento_respaldo (lote, convocatoria_id, campo, valor_anterior, valor_nuevo, motivo)
   SELECT ?, id, 'deleted_at', NULL, now()::text, ? FROM u`;

/** Ids (de la lista dada) referenciados por favoritos o por proyectos (origen_radar). */
export async function idsReferenciados(db, ids) {
  if (!ids.length) return new Set();
  const [fav, proy] = await Promise.all([
    db.getRows('SELECT grant_id AS id FROM user_favorites WHERE grant_id = ANY(?::text[])', [ids]),
    db.getRows(
      `SELECT ficha_tecnica->'origen_radar'->>'convocatoria_id' AS id FROM proyectos
        WHERE ficha_tecnica->'origen_radar'->>'convocatoria_id' = ANY(?::text[])`, [ids]),
  ]);
  return new Set([...fav, ...proy].map(r => r.id));
}

/**
 * Purga automática con respaldo. db = { getRows, runSql, dbStatus }.
 * Nunca lanza por datos: devuelve un resumen con el motivo si no actuó.
 */
export async function purgarBasuraConRespaldo(db, { lote, tope = TOPE_PURGA_AUTOMATICA } = {}) {
  // El CTE con respaldo no existe en la Capa 2 (REST): sin pg, no se borra nada.
  if (!db.dbStatus().pgReady) return { accion: 'omitida', motivo: 'sin_capa_1', eliminados: 0 };
  const filas = await db.getRows('SELECT id, titulo, estado FROM convocatorias WHERE deleted_at IS NULL', []);
  const candidatos = planificarPurga(filas);
  if (candidatos.length > tope) {
    return { accion: 'omitida', motivo: 'supera_tope', candidatos: candidatos.length, tope, eliminados: 0 };
  }
  const referenciados = await idsReferenciados(db, candidatos.map(c => c.id));
  let eliminados = 0; let conReferencias = 0;
  for (const c of candidatos) {
    if (referenciados.has(c.id)) { conReferencias++; continue; } // un favorito/proyecto la usa: se deja
    const r = await db.runSql(SQL_SOFT_DELETE_CON_RESPALDO, [c.id, c.titulo, lote, `basura:${c.motivo}`]);
    if ((r?.rowCount ?? 0) === 1) eliminados++;
  }
  return { accion: 'aplicada', candidatos: candidatos.length, eliminados, conReferencias };
}
