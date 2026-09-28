/**
 * EmbeddingsBatch.js — vectoriza por LOTES las convocatorias abiertas del
 * catálogo del Radar (Fase 4, dictamen architect 2026-09-28).
 *
 * Causa raíz verificada: ningún código escribía convocatorias.embedding_vec
 * (0 de 1866; 550 abiertas sin vector el 2026-09-28) — la búsqueda semántica
 * y el barrido por proyecto siempre devolvían vacío.
 *
 * Control de gasto y de ritmo (estricto, todo configurable por env):
 *   EMBEDDINGS_MAX_POR_CORRIDA    tope de convocatorias por corrida (200)
 *   EMBEDDINGS_LOTE               textos por llamada a la API (25)
 *   EMBEDDINGS_PAUSA_MS           pausa entre llamadas (20000 ms: con lotes de 25
 *                                 ≈ 75 textos/min — verificado en vivo 2026-09-28
 *                                 que la cuota por minuto de la llave es ~100
 *                                 textos: con 3 s llegaban 429 cada 2-4 llamadas)
 *   EMBEDDINGS_MAX_TOKENS_CORRIDA tope de tokens estimados por corrida (200000)
 *   429 de cuota DIARIA → la corrida se detiene y devuelve la hora de reintento.
 *   429 por minuto → espera el retryDelay real (máx. 3 veces) y si no, se detiene.
 *
 * Idempotente: solo toma filas con embedding_vec IS NULL (vivas y no
 * cerradas — las búsquedas nunca devuelven cerradas, vectorizarlas sería
 * gasto sin uso). Concurrencia: bandera en proceso + lease atómico en
 * app_settings (INSERT … ON CONFLICT … WHERE vencido) — nunca advisory lock
 * de sesión (el pooler :6543 está en modo transacción). Exige conexión
 * directa a Postgres: el modo REST degradado no soporta ON CONFLICT.
 *
 * Disparadores: CLI (scripts/embeddings-batch.mjs), POST admin
 * /api/radar/embeddings/batch, y cron 03:45 COT SOLO si
 * EMBEDDINGS_BATCH_ENABLED=true (apagado por defecto).
 * Costo del SISTEMA: no descuenta del tope de IA por usuario (iaPresupuesto).
 */
import { getRow, getRows, runSql, dbStatus } from '../config/database.config.js';
import { textosAEmbeddings, serializeEmbedding, EMBEDDING_MODEL } from '../services/embeddingsService.js';
import { retryDelayDe429 } from '../services/geminiCircuitBreaker.js';
import { logTokenUsage } from '../services/aiTokenLogger.js';

const CLAVE_LEASE = 'embeddings_batch_lease';
const LEASE_MS = 30 * 60_000;
const ESPERA_LARGA_MS = 10 * 60_000;
const MAX_ESPERAS_RPM = 3;

const numEnv = (v, defecto) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : defecto; };

export function configBatch(env = process.env) {
  return {
    maxPorCorrida: numEnv(env.EMBEDDINGS_MAX_POR_CORRIDA, 200),
    lote: Math.min(numEnv(env.EMBEDDINGS_LOTE, 25), 100),
    pausaMs: numEnv(env.EMBEDDINGS_PAUSA_MS, 20_000),
    maxTokens: numEnv(env.EMBEDDINGS_MAX_TOKENS_CORRIDA, 200_000),
  };
}

/** Texto determinista de una convocatoria (mismo texto → mismo vector). Exportada para test. */
export function convocatoriaToText(c) {
  const lista = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.join(', ') : String(v || ''); } catch { return String(v || ''); } };
  return [
    c.titulo && `Convocatoria: ${c.titulo}`,
    c.donante && `Donante: ${c.donante}`,
    lista(c.sectores) && `Sectores: ${lista(c.sectores)}`,
    lista(c.paises_elegibles) && `Países: ${lista(c.paises_elegibles)}`,
    c.descripcion && `Descripción: ${String(c.descripcion).slice(0, 6000)}`,
  ].filter(Boolean).join('. ');
}

const estimarTokens = (textos) => Math.ceil(textos.reduce((s, t) => s + t.length, 0) / 4);
const dormirReal = (ms) => new Promise(r => setTimeout(r, ms));

let _enCurso = false;

const DEPS_REALES = {
  getRow, getRows, runSql, dbStatus, textosAEmbeddings, logTokenUsage,
  dormir: dormirReal, ahora: () => new Date(),
};

async function tomarLease(deps) {
  const ahora = deps.ahora();
  const fila = await deps.getRow(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE app_settings.value < ? RETURNING key`,
    [CLAVE_LEASE, new Date(ahora.getTime() + LEASE_MS).toISOString(), ahora.toISOString()]
  );
  return !!fila;
}

async function soltarLease(deps) {
  await deps.runSql('UPDATE app_settings SET value = ? WHERE key = ?', ['1970-01-01T00:00:00.000Z', CLAVE_LEASE]).catch(() => {});
}

/** Conteos para /api/radar/embeddings/estado. */
export async function estadoBatch(deps = DEPS_REALES) {
  const f = await deps.getRow(
    `SELECT count(*)::int AS abiertas, count(*) FILTER (WHERE embedding_vec IS NOT NULL)::int AS con_vector
       FROM convocatorias WHERE deleted_at IS NULL AND estado != 'cerrada'`, []);
  return { abiertas: Number(f?.abiertas) || 0, con_vector: Number(f?.con_vector) || 0, en_curso: _enCurso, modelo: EMBEDDING_MODEL };
}

/**
 * Ejecuta UNA corrida acotada.
 * @param {{ max?: number, dryRun?: boolean, cfg?: object, deps?: object, log?: object }} opts
 * @returns {Promise<object>} resumen: procesadas, fallidas, llamadas, tokensEstimados, detenidoPor, proximoIntento, restantes
 */
export async function ejecutarBatchEmbeddings({ max, dryRun = false, cfg = configBatch(), deps = DEPS_REALES, log = console } = {}) {
  const resumen = { procesadas: 0, fallidas: [], llamadas: 0, tokensEstimados: 0, detenidoPor: null, proximoIntento: null, dryRun };
  if (_enCurso) return { ...resumen, detenidoPor: 'ya_en_curso_en_este_proceso' };
  if (!deps.dbStatus().pgReady) return { ...resumen, detenidoPor: 'bd_degradada' };
  _enCurso = true;
  let conLease = false;
  try {
    if (!dryRun) {
      conLease = await tomarLease(deps);
      if (!conLease) return { ...resumen, detenidoPor: 'otra_corrida_en_curso' };
    }
    const limite = Math.min(Number(max) || cfg.maxPorCorrida, cfg.maxPorCorrida);
    const filas = await deps.getRows(
      `SELECT id, titulo, donante, sectores, paises_elegibles, descripcion
         FROM convocatorias
        WHERE deleted_at IS NULL AND estado != 'cerrada' AND embedding_vec IS NULL
        ORDER BY created_at DESC
        LIMIT ?`, [limite]);
    const candidatas = [];
    for (const f of filas) {
      const texto = convocatoriaToText(f);
      if (texto.trim()) candidatas.push({ id: f.id, texto });
    }
    resumen.candidatas = candidatas.length;
    if (dryRun) {
      resumen.tokensEstimados = estimarTokens(candidatas.map(c => c.texto));
      resumen.detenidoPor = 'dry_run';
      return resumen;
    }

    let esperasRpm = 0;
    for (let i = 0; i < candidatas.length;) {
      const lote = candidatas.slice(i, i + cfg.lote);
      const tokensLote = estimarTokens(lote.map(c => c.texto));
      if (resumen.tokensEstimados + tokensLote > cfg.maxTokens) { resumen.detenidoPor = 'tope_tokens_corrida'; break; }
      if (resumen.llamadas > 0) await deps.dormir(cfg.pausaMs);
      let vectores;
      try {
        resumen.llamadas++;
        vectores = await deps.textosAEmbeddings(lote.map(c => c.texto));
      } catch (err) {
        const msg = String(err?.message || err);
        if (err?.status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
          const espera = retryDelayDe429(msg, deps.ahora());
          if (espera && espera <= ESPERA_LARGA_MS && esperasRpm < MAX_ESPERAS_RPM) {
            esperasRpm++;
            log.warn?.(`[EmbeddingsBatch] 429 por minuto — espera ${espera} ms (${esperasRpm}/${MAX_ESPERAS_RPM})`);
            await deps.dormir(espera);
            continue; // reintenta el MISMO lote
          }
          resumen.detenidoPor = espera && espera > ESPERA_LARGA_MS ? 'cuota_diaria_agotada' : 'cuota_agotada';
          resumen.proximoIntento = espera ? new Date(deps.ahora().getTime() + espera).toISOString() : null;
          break;
        }
        // Error no de cuota: el lote se registra como fallido y se sigue (sin reintentar en bucle).
        log.error?.('[EmbeddingsBatch] Lote fallido', { ids: lote.map(c => c.id), err: msg.slice(0, 300) });
        resumen.fallidas.push(...lote.map(c => c.id));
        i += lote.length;
        continue;
      }
      for (let k = 0; k < lote.length; k++) {
        const vec = serializeEmbedding(vectores[k]);
        await deps.runSql('UPDATE convocatorias SET embedding = ?, embedding_vec = ?::vector WHERE id = ? AND deleted_at IS NULL', [vec, vec, lote[k].id]);
      }
      resumen.procesadas += lote.length;
      resumen.tokensEstimados += tokensLote;
      deps.logTokenUsage({ userId: 'sistema-radar-batch', agentName: 'embeddings-batch', tokensInput: tokensLote, tokensOutput: 0 }).catch?.(() => {});
      i += lote.length;
    }
    const fila = await deps.getRow(`SELECT count(*)::int AS n FROM convocatorias WHERE deleted_at IS NULL AND estado != 'cerrada' AND embedding_vec IS NULL`, []);
    resumen.restantes = Number(fila?.n) || 0;
    if (!resumen.detenidoPor) resumen.detenidoPor = resumen.restantes ? 'tope_por_corrida' : 'completado';
    log.info?.('[EmbeddingsBatch] Corrida terminada', resumen);
    return resumen;
  } finally {
    if (conLease) await soltarLease(deps);
    _enCurso = false;
  }
}
