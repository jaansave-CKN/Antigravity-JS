/**
 * purgarBasuraCatalogo.mjs — soft-delete (con respaldo) de las "convocatorias"
 * que no lo son, y curaduría de fondos continuos (2026-09-29).
 *
 *   node backend/scripts/purgarBasuraCatalogo.mjs                        → simulación por patrones
 *   node backend/scripts/purgarBasuraCatalogo.mjs --aplicar              → purga por patrones
 *   node backend/scripts/purgarBasuraCatalogo.mjs --curaduria            → simulación de la curaduría
 *   node backend/scripts/purgarBasuraCatalogo.mjs --curaduria --aplicar  → aplica la curaduría
 *
 * Por patrones: criterio motivoBasura() (backend/utils/tituloBasura.js), el
 * mismo que filtra la ingesta y la purga diaria (backend/services/purgaCatalogo.js).
 * Curaduría: backend/data/curaduria_catalogo_2026-09-29.json (decisión del
 * dueño, revisada título por título): purgar páginas institucionales y marcar
 * programas reales como estado 'fondo_continuo'.
 *
 * Garantías:
 *   - Requiere la Capa 1 (pg) y la tabla de respaldo (075; la curaduría, 077).
 *   - Tope: por patrones TOPE; curaduría = tamaño EXACTO del JSON.
 *   - Aborta si algún favorito o proyecto apunta a una fila a purgar.
 *   - Cada fila: UNA sentencia optimista (título/estado leídos) + respaldo del lote.
 *   - Nunca purga filas 'fondo_continuo'. Idempotente.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planificarPurga, SQL_SOFT_DELETE_CON_RESPALDO, idsReferenciados } from '../services/purgaCatalogo.js';

export { planificarPurga };
export const TOPE = 100; // purga manual por patrones (medido 2026-09-29: 87 en la primera pasada)
export const ARCHIVO_CURADURIA = new URL('../data/curaduria_catalogo_2026-09-29.json', import.meta.url);

const SQL_MARCAR_FONDO =
  `WITH u AS (UPDATE convocatorias SET estado = 'fondo_continuo'
               WHERE id = ? AND deleted_at IS NULL AND titulo = ? AND estado = ? RETURNING id)
   INSERT INTO convocatorias_saneamiento_respaldo (lote, convocatoria_id, campo, valor_anterior, valor_nuevo, motivo)
   SELECT ?, id, 'estado', ?, 'fondo_continuo', ? FROM u`;

/** Valida la curaduría (pura): listas disjuntas, sin ids repetidos, con título. */
export function validarCuraduria(cur) {
  const ids = [...cur.fondos_continuos, ...cur.purgar].map(x => x.id);
  if (new Set(ids).size !== ids.length) throw new Error('curaduría: hay ids repetidos o una fila está en ambas listas');
  if ([...cur.fondos_continuos, ...cur.purgar].some(x => !x.id || !x.titulo)) throw new Error('curaduría: fila sin id o título');
  return { fondos: cur.fondos_continuos.length, purgar: cur.purgar.length };
}

async function exigirBase(db, { curaduria }) {
  await db.esperarPgInicial();
  if (!db.dbStatus().pgReady) { console.error('[purga] Capa 1 (pg) no disponible: este script no corre por REST. Abortado.'); process.exit(1); }
  const t = await db.getRow(`SELECT to_regclass('public.convocatorias_saneamiento_respaldo') AS t`, []);
  if (!t?.t) { console.error('[purga] Falta la migración 075 (tabla de respaldo). Abortado.'); process.exit(1); }
  if (curaduria) {
    const chk = await db.getRow(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'conv_saneamiento_respaldo_campo_valido'`, []);
    if (!chk?.d?.includes('estado')) { console.error('[purga] Falta la migración 077 (respaldo del campo estado). Abortado.'); process.exit(1); }
  }
}

async function abortarSiReferenciados(db, ids) {
  const refs = await idsReferenciados(db, ids);
  console.log(`[purga] Referencias: ${refs.size} fila(s) a purgar con favoritos o proyectos.`);
  if (refs.size) { console.error(`[purga] Abortado: reasignar antes ${[...refs].join(', ')}`); process.exit(1); }
}

async function porPatrones(db, aplicar) {
  const filas = await db.getRows('SELECT id, titulo, estado FROM convocatorias WHERE deleted_at IS NULL', []);
  const candidatos = planificarPurga(filas);
  console.log(`[purga] ${filas.length} convocatorias vivas · ${candidatos.length} candidata(s) a soft-delete`);
  for (const c of candidatos) console.log(`  ${c.motivo.padEnd(28)} ${c.id}  ${JSON.stringify(c.titulo.slice(0, 90))}`);
  if (!candidatos.length) { console.log('[purga] Nada que hacer.'); return; }
  if (candidatos.length > TOPE) { console.error(`[purga] ${candidatos.length} candidatos superan el tope (${TOPE}). Abortado.`); process.exit(1); }
  await abortarSiReferenciados(db, candidatos.map(c => c.id));
  if (!aplicar) { console.log('[purga] Simulación: nada escrito. Usa --aplicar para escribir.'); return; }
  const lote = `purga_basura_${new Date().toISOString()}`;
  let ok = 0; let omit = 0;
  for (const c of candidatos) {
    const r = await db.runSql(SQL_SOFT_DELETE_CON_RESPALDO, [c.id, c.titulo, lote, `basura:${c.motivo}`]);
    if ((r?.rowCount ?? 0) === 1) ok++; else omit++;
  }
  console.log(`[purga] Lote ${lote}: ${ok} soft-delete(s) con respaldo, ${omit} omitido(s).`);
}

async function porCuraduria(db, aplicar) {
  const cur = JSON.parse(fs.readFileSync(ARCHIVO_CURADURIA, 'utf8'));
  const n = validarCuraduria(cur);
  const ids = [...cur.fondos_continuos, ...cur.purgar].map(x => x.id);
  const vivas = new Map((await db.getRows(
    'SELECT id, titulo, estado FROM convocatorias WHERE deleted_at IS NULL AND id = ANY(?::text[])', [ids])).map(r => [r.id, r]));
  const fondos = cur.fondos_continuos.filter(f => vivas.has(f.id) && vivas.get(f.id).estado !== 'fondo_continuo');
  const purgar = cur.purgar.filter(p => vivas.has(p.id));
  console.log(`[curaduría] JSON: ${n.fondos} fondos, ${n.purgar} a purgar · pendientes: ${fondos.length} por marcar, ${purgar.length} por purgar`);
  for (const f of fondos) console.log(`  FONDO  ${f.id}  ${JSON.stringify(f.titulo.slice(0, 80))}`);
  for (const p of purgar) console.log(`  PURGA  ${p.id}  ${JSON.stringify(p.titulo.slice(0, 80))}`);
  if (fondos.length > n.fondos || purgar.length > n.purgar) { console.error('[curaduría] Tope excedido (imposible salvo bug). Abortado.'); process.exit(1); }
  if (!fondos.length && !purgar.length) { console.log('[curaduría] Nada que hacer (ya aplicada).'); return; }
  await abortarSiReferenciados(db, purgar.map(p => p.id));
  if (!aplicar) { console.log('[curaduría] Simulación: nada escrito. Usa --aplicar para escribir.'); return; }
  const lote = `curaduria_${new Date().toISOString()}`;
  let marcados = 0; let purgados = 0; let omit = 0;
  for (const f of fondos) {
    const actual = vivas.get(f.id);
    const r = await db.runSql(SQL_MARCAR_FONDO, [f.id, actual.titulo, actual.estado, lote, actual.estado, `curaduria:fondo_continuo:${f.motivo}`]);
    if ((r?.rowCount ?? 0) === 1) marcados++; else omit++;
  }
  for (const p of purgar) {
    const r = await db.runSql(SQL_SOFT_DELETE_CON_RESPALDO, [p.id, vivas.get(p.id).titulo, lote, 'curaduria:pagina_sin_fondo']);
    if ((r?.rowCount ?? 0) === 1) purgados++; else omit++;
  }
  console.log(`[curaduría] Lote ${lote}: ${marcados} marcado(s) fondo_continuo, ${purgados} soft-delete(s), ${omit} omitido(s). Todo con respaldo.`);
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const curaduria = process.argv.includes('--curaduria');
  const db = await import('../config/database.config.js');
  await exigirBase(db, { curaduria });
  if (curaduria) await porCuraduria(db, aplicar); else await porPatrones(db, aplicar);
  console.log('[purga] El Radar lo refleja al vencer su caché en memoria (TTL 15 min, radarCache.js).');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[purga] Error:', e?.message || e); process.exit(1); });
}
