/**
 * sanearCatalogo.mjs — higiene de datos del catálogo de convocatorias
 * (2026-09-29; alcance aprobado por el dueño, dictamen architect D).
 *
 *   node backend/scripts/sanearCatalogo.mjs            → simulación (no escribe)
 *   node backend/scripts/sanearCatalogo.mjs --aplicar  → escribe, con respaldo
 *
 * Qué corrige, con las MISMAS funciones que la ingesta:
 *   - entidades HTML en titulo/descripcion/donante ("d&#039Ivoire" → "d'Ivoire"),
 *     decodificadas y SIEMPRE pasadas después por sanitizeInput();
 *   - montos imposibles (montoPlausible) → 0 = "Monto no especificado".
 *     Los montos reales NO se inventan: recuperarlos exige volver a rastrear.
 *
 * Garantías:
 *   - Requiere 075 (tabla convocatorias_saneamiento_respaldo) y la Capa 1 (pg).
 *   - Cada cambio es UNA sentencia: UPDATE optimista (solo si el valor sigue
 *     siendo el leído) + copia del valor anterior al respaldo, con el lote.
 *   - Filas donde sanitizeInput borraría algo más que entidades (o donde el
 *     resultado aún tendría entidades) NO se tocan: van a revisión humana.
 *   - Idempotente: una segunda simulación debe reportar 0 cambios.
 *   - No toca embedding_vec. El Radar muestra los cambios al vencer su caché
 *     en memoria (TTL 15 min, radarCache.js): este proceso no puede vaciarla.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { decodificarEntidades } from '../utils/textoHtml.js';
import { montoPlausible } from '../utils/montos.js';

const CAMPOS_TEXTO = { titulo: 255, descripcion: 800, donante: 255 };
const CAMPOS_MONTO = ['monto_max', 'monto_min'];

/** Plan puro (sin BD): qué cambiar y qué dejar para revisión humana. */
export function planificarSaneamiento(filas, { sanitizar }) {
  const cambios = [];
  const revision = [];
  for (const f of filas) {
    for (const [campo, largo] of Object.entries(CAMPOS_TEXTO)) {
      const anterior = f[campo];
      if (typeof anterior !== 'string' || !anterior.includes('&')) continue;
      const decodificado = decodificarEntidades(anterior);
      if (decodificado === anterior) continue;
      const nuevo = sanitizar(decodificado).slice(0, largo);
      if (nuevo !== decodificado.trim()) {
        revision.push({ id: f.id, campo, anterior, propuesto: nuevo, razon: 'sanitizeInput borraría algo más que entidades' });
      } else if (decodificarEntidades(nuevo) !== nuevo) {
        revision.push({ id: f.id, campo, anterior, propuesto: nuevo, razon: 'doble codificación: no sería idempotente' });
      } else {
        cambios.push({ id: f.id, campo, anterior, nuevo, motivo: 'entidades_html' });
      }
    }
    for (const campo of CAMPOS_MONTO) {
      const anterior = Number(f[campo]);
      if (Number.isFinite(anterior) && anterior > 0 && !montoPlausible(anterior, f.moneda)) {
        cambios.push({ id: f.id, campo, anterior, nuevo: 0, motivo: `monto_no_plausible:${f.moneda || 'sin_moneda'}` });
      }
    }
  }
  return { cambios, revision };
}

function sqlCambio(campo) {
  const esMonto = CAMPOS_MONTO.includes(campo);
  if (!esMonto && !Object.hasOwn(CAMPOS_TEXTO, campo)) throw new Error(`campo no permitido: ${campo}`);
  const igual = esMonto ? `${campo} = ?::real` : `${campo} = ?`;
  return `WITH u AS (UPDATE convocatorias SET ${campo} = ? WHERE id = ? AND deleted_at IS NULL AND ${igual} RETURNING id)
          INSERT INTO convocatorias_saneamiento_respaldo (lote, convocatoria_id, campo, valor_anterior, valor_nuevo, motivo)
          SELECT ?, id, ?, ?, ?, ? FROM u`;
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const db = await import('../config/database.config.js');
  const { sanitizeInput } = await import('../middlewares/SecurityMiddleware.js');
  await db.esperarPgInicial();
  if (!db.dbStatus().pgReady) {
    console.error('[sanear] Capa 1 (pg) no disponible: este script no corre por REST. Abortado.');
    process.exit(1);
  }
  if (aplicar) {
    const t = await db.getRow(`SELECT to_regclass('public.convocatorias_saneamiento_respaldo') AS t`, []);
    if (!t?.t) { console.error('[sanear] Falta la migración 075 (tabla de respaldo). Abortado.'); process.exit(1); }
  }
  const filas = await db.getRows(
    `SELECT id, titulo, descripcion, donante, monto_min, monto_max, moneda FROM convocatorias WHERE deleted_at IS NULL`, []);
  const { cambios, revision } = planificarSaneamiento(filas, { sanitizar: sanitizeInput });

  const porMotivo = {};
  for (const c of cambios) porMotivo[`${c.campo} · ${c.motivo}`] = (porMotivo[`${c.campo} · ${c.motivo}`] || 0) + 1;
  console.log(`[sanear] ${filas.length} convocatorias vivas · ${cambios.length} cambio(s) · ${revision.length} para revisión humana`);
  console.table(porMotivo);
  console.log('[sanear] Muestra de cambios:');
  for (const c of cambios.filter(x => x.motivo === 'entidades_html').slice(0, 8)) console.log(`  ${c.campo}: ${JSON.stringify(String(c.anterior).slice(0, 70))} → ${JSON.stringify(String(c.nuevo).slice(0, 70))}`);
  for (const c of cambios.filter(x => x.motivo !== 'entidades_html').slice(0, 5)) console.log(`  ${c.campo}: ${c.anterior} → 0 (${c.motivo})`);
  for (const r of revision) console.log(`  [REVISIÓN] ${r.id} ${r.campo}: ${r.razon}\n    antes:     ${JSON.stringify(r.anterior.slice(0, 120))}\n    propuesto: ${JSON.stringify(r.propuesto.slice(0, 120))}`);

  if (!aplicar) { console.log('[sanear] Simulación: nada escrito. Usa --aplicar para escribir.'); process.exit(0); }

  const lote = `sanear_${new Date().toISOString()}`;
  let aplicados = 0; let omitidos = 0;
  for (const c of cambios) {
    const r = await db.runSql(sqlCambio(c.campo), [c.nuevo, c.id, c.anterior, lote, c.campo, String(c.anterior), String(c.nuevo), c.motivo]);
    if ((r?.rowCount ?? 0) === 1) aplicados++; else omitidos++;
  }
  console.log(`[sanear] Lote ${lote}: ${aplicados} aplicado(s), ${omitidos} omitido(s) (el valor cambió después de leerlo).`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[sanear] Error:', e?.message || e); process.exit(1); });
}
