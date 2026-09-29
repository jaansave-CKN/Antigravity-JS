/**
 * purgarBasuraCatalogo.mjs — soft-delete (con respaldo) de las "convocatorias"
 * que no lo son: galerías, reservas de espacios, instructivos, páginas
 * legales/institucionales, logins, subvenciones ya otorgadas… (reparación
 * estructural 2026-09-29; mismo patrón que sanearCatalogo.mjs).
 *
 *   node backend/scripts/purgarBasuraCatalogo.mjs            → simulación (no escribe)
 *   node backend/scripts/purgarBasuraCatalogo.mjs --aplicar  → soft-delete con respaldo
 *
 * Criterio ÚNICO: motivoBasura() de backend/utils/tituloBasura.js — el mismo
 * que descarta estas filas en la ingesta, así que no vuelven a entrar.
 *
 * Garantías:
 *   - Requiere la Capa 1 (pg) y la migración 075 (tabla de respaldo).
 *   - Aborta si hay más candidatos que TOPE (algo cambió: revisar a mano) o si
 *     algún favorito o proyecto (ficha_tecnica.origen_radar) apunta a una fila
 *     candidata — nada del usuario queda colgando de una fila borrada.
 *   - Cada fila: UNA sentencia (UPDATE optimista WHERE titulo = el leído +
 *     copia al respaldo con el lote). Reversible: deleted_at = NULL.
 *   - Idempotente: una segunda simulación reporta 0 candidatos.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { motivoBasura } from '../utils/tituloBasura.js';

export const TOPE = 100; // medido 2026-09-29: 87 candidatos

/** Plan puro (sin BD): filas vivas cuyo título es basura, con su motivo. */
export function planificarPurga(filas) {
  return filas
    .map(f => ({ id: f.id, titulo: f.titulo, motivo: motivoBasura(f.titulo) }))
    .filter(f => f.motivo);
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const db = await import('../config/database.config.js');
  await db.esperarPgInicial();
  if (!db.dbStatus().pgReady) {
    console.error('[purga] Capa 1 (pg) no disponible: este script no corre por REST. Abortado.');
    process.exit(1);
  }
  const t = await db.getRow(`SELECT to_regclass('public.convocatorias_saneamiento_respaldo') AS t`, []);
  if (!t?.t) { console.error('[purga] Falta la migración 075 (tabla de respaldo). Abortado.'); process.exit(1); }

  const filas = await db.getRows('SELECT id, titulo FROM convocatorias WHERE deleted_at IS NULL', []);
  const candidatos = planificarPurga(filas);
  console.log(`[purga] ${filas.length} convocatorias vivas · ${candidatos.length} candidata(s) a soft-delete`);
  for (const c of candidatos) console.log(`  ${c.motivo.padEnd(28)} ${c.id}  ${JSON.stringify(c.titulo.slice(0, 90))}`);
  if (!candidatos.length) { console.log('[purga] Nada que hacer.'); process.exit(0); }

  if (candidatos.length > TOPE) {
    console.error(`[purga] ${candidatos.length} candidatos superan el tope de seguridad (${TOPE}). Abortado: revisar el criterio a mano.`);
    process.exit(1);
  }
  const ids = candidatos.map(c => c.id);
  const fav = await db.getRow('SELECT count(*)::int AS n FROM user_favorites WHERE grant_id = ANY(?::text[])', [ids]);
  const proy = await db.getRow(
    `SELECT count(*)::int AS n FROM proyectos WHERE ficha_tecnica->'origen_radar'->>'convocatoria_id' = ANY(?::text[])`, [ids]);
  console.log(`[purga] Referencias: ${fav?.n ?? '?'} favorito(s), ${proy?.n ?? '?'} proyecto(s) con origen en una candidata.`);
  if ((fav?.n ?? 1) > 0 || (proy?.n ?? 1) > 0) {
    console.error('[purga] Hay favoritos o proyectos que apuntan a filas candidatas. Abortado: reasignarlos antes de purgar.');
    process.exit(1);
  }

  if (!aplicar) { console.log('[purga] Simulación: nada escrito. Usa --aplicar para escribir.'); process.exit(0); }

  const lote = `purga_basura_${new Date().toISOString()}`;
  let aplicados = 0; let omitidos = 0;
  for (const c of candidatos) {
    const r = await db.runSql(
      `WITH u AS (UPDATE convocatorias SET deleted_at = now() WHERE id = ? AND deleted_at IS NULL AND titulo = ? RETURNING id)
       INSERT INTO convocatorias_saneamiento_respaldo (lote, convocatoria_id, campo, valor_anterior, valor_nuevo, motivo)
       SELECT ?, id, 'deleted_at', NULL, now()::text, ? FROM u`,
      [c.id, c.titulo, lote, `basura:${c.motivo}`]
    );
    if ((r?.rowCount ?? 0) === 1) aplicados++; else omitidos++;
  }
  console.log(`[purga] Lote ${lote}: ${aplicados} soft-delete(s) con respaldo, ${omitidos} omitido(s) (la fila cambió después de leerla).`);
  console.log('[purga] El Radar lo refleja al vencer su caché en memoria (TTL 15 min, radarCache.js).');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[purga] Error:', e?.message || e); process.exit(1); });
}
