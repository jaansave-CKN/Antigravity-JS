/**
 * Modulo 7 — Pipeline de Match Score Vectorial
 * Formula: S_match = w1 * cos(theta) + w2 * P_norm - w3 * C_risk
 *   w1 = 0.60  (similitud semantica por embeddings)
 *   w2 = 0.30  (probabilidad normalizada de la convocatoria)
 *   w3 = 0.10  (factor de riesgo compuesto)
 * Embeddings: Google Gemini text-embedding-004 (768 dims)
 * Fallback coseno: calculo JS cuando pgvector no esta disponible (SQLite)
 */
import crypto from 'crypto';
import {
  textToEmbedding,
  fichaTecnicaToText,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
} from '../services/embeddingsService.js';
import { logCriticalError } from '../services/logService.js';
import { logger } from '../utils/logger.js';

// Pesos según spec v2.0 Sección D-3: w1=0.50 coseno, w2=0.30 P_norm, w3=0.20 C_risk
const W = Object.freeze({ cosine: 0.50, prob: 0.30, risk: 0.20 });
const USE_PG = !!process.env.DATABASE_URL;

function r4(n) { return Math.round(n * 10000) / 10000; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ── Riesgo compuesto ──────────────────────────────────────────────────────────
function computeRisk(convocatoria, metaFisicaTotal) {
  let risk = 0;

  // Proximidad deadline
  if (convocatoria.fecha_limite) {
    const daysLeft = (new Date(convocatoria.fecha_limite) - Date.now()) / 86400000;
    if (daysLeft < 7)        risk += 0.40;
    else if (daysLeft < 30)  risk += 0.20;
    else if (daysLeft < 90)  risk += 0.10;
  }

  // Desajuste de rango presupuestal
  const monto = Number(metaFisicaTotal || 0);
  const montoMax = Number(convocatoria.monto_max || 0);
  const montoMin = Number(convocatoria.monto_min || 0);
  if (monto > 0 && montoMax > 0) {
    if (monto > montoMax * 1.5 || monto < montoMin * 0.3) risk += 0.40;
    else if (monto > montoMax || monto < montoMin)         risk += 0.20;
    else if (monto > montoMax * 0.9)                       risk += 0.05;
  }

  return clamp(risk, 0, 1);
}

// ── Bulk match via pgvector (PostgreSQL): una sola query, top N por coseno ────
async function pgBulkMatch(proyectoEmbedding, getRows) {
  const vec = serializeEmbedding(proyectoEmbedding); // "[0.1,-0.45,...]" — pgvector text format
  try {
    // Columna nativa vector(768) con índice HNSW — ruta rápida
    return await getRows(
      `SELECT id, titulo, descripcion, monto_min, monto_max, score_probabilidad, fecha_limite, donante,
              (1 - (embedding_vec <=> $1::vector)) AS cosine_sim
       FROM convocatorias
       WHERE embedding_vec IS NOT NULL AND estado != 'cerrada' AND deleted_at IS NULL
       ORDER BY embedding_vec <=> $1::vector
       LIMIT 200`,
      [vec]
    );
  } catch {
    // Fallback: cast TEXT → vector si backfill aún no completó
    return await getRows(
      `SELECT id, titulo, descripcion, monto_min, monto_max, score_probabilidad, fecha_limite, donante,
              (1 - (embedding::vector <=> $1::vector)) AS cosine_sim
       FROM convocatorias
       WHERE embedding IS NOT NULL AND estado != 'cerrada' AND deleted_at IS NULL
       ORDER BY embedding::vector <=> $1::vector
       LIMIT 200`,
      [vec]
    );
  }
}

// ── Stage 1: Validar proyecto ─────────────────────────────────────────────────
async function stage1Validate(proyectoId, getRow) {
  const proyecto = await getRow('SELECT estado FROM proyectos WHERE id = ?', [proyectoId]);
  if (!proyecto) throw new Error('PROYECTO_NOT_FOUND');
  if (proyecto.estado === 'BLOQUEADO') throw new Error('PIPELINE_BLOCKED: proyecto bloqueado');
  return true;
}

// ── Stage 2: Obtener/generar embedding del proyecto ───────────────────────────
async function stage2GetEmbedding(proyectoId, getRow, runSql) {
  const row = await getRow(
    'SELECT ficha_tecnica, presupuesto, embedding FROM proyectos WHERE id = ?',
    [proyectoId]
  );

  let fichaTecnica = {};
  try {
    fichaTecnica = typeof row.ficha_tecnica === 'string' ? JSON.parse(row.ficha_tecnica) : (row.ficha_tecnica || {});
  } catch (e) {
    logger.warn('[MatchScore] ficha_tecnica con JSON corrupto — usando objeto vacío', { proyectoId, err: e.message });
  }

  // Reusar embedding existente si ya fue calculado
  if (row.embedding) {
    const vec = deserializeEmbedding(row.embedding);
    if (vec && vec.length > 0) {
      return { embedding: vec, fichaTecnica };
    }
  }

  // Generar embedding via Gemini
  const text = fichaTecnicaToText(fichaTecnica);
  const embedding = await textToEmbedding(text);

  // Persistir embedding — en PG también puebla la columna vector(768)
  try {
    const embStr = serializeEmbedding(embedding); // "[0.1,-0.45,...]" compatible con pgvector
    if (USE_PG) {
      await runSql('UPDATE proyectos SET embedding = ?, embedding_vec = ?::vector WHERE id = ?', [embStr, embStr, proyectoId]);
    } else {
      await runSql('UPDATE proyectos SET embedding = ? WHERE id = ?', [embStr, proyectoId]);
    }
  } catch (e) {
    logCriticalError('MatchScore', 'No se pudo persistir embedding — se recalculará en cada match', { proyectoId, err: e.message });
  }

  return { embedding, fichaTecnica };
}


// ── Batch embedding: procesa convocatorias sin embedding en chunks ─────────────
const EMBED_BATCH_SIZE  = 5;   // llamadas Gemini concurrentes por lote
const EMBED_BATCH_DELAY = 300; // ms entre lotes (respeta cuota por minuto)

async function prefetchEmbeddings(convocatorias, runSql) {
  const sinEmbedding = convocatorias.filter(c => !c.embedding);
  if (sinEmbedding.length === 0) return;

  for (let i = 0; i < sinEmbedding.length; i += EMBED_BATCH_SIZE) {
    const chunk = sinEmbedding.slice(i, i + EMBED_BATCH_SIZE);
    await Promise.allSettled(
      chunk.map(async (conv) => {
        try {
          const text = [conv.titulo, conv.descripcion, conv.sectores, conv.donante]
            .filter(Boolean).join('. ');
          const embedding = await textToEmbedding(text);
          const embStr   = serializeEmbedding(embedding); // "[0.1,-0.45,...]"
          conv.embedding = embStr; // mutate in-place para reutilizar en JS coseno
          if (USE_PG) {
            await runSql('UPDATE convocatorias SET embedding = ?, embedding_vec = ?::vector WHERE id = ?',
              [embStr, embStr, conv.id]);
          } else {
            await runSql('UPDATE convocatorias SET embedding = ? WHERE id = ?', [embStr, conv.id]);
          }
        } catch (err) {
          console.error(`[MatchScore] Prefetch embedding falló para conv ${conv.id}:`, err.message);
        }
      })
    );
    if (i + EMBED_BATCH_SIZE < sinEmbedding.length) {
      await new Promise(r => setTimeout(r, EMBED_BATCH_DELAY));
    }
  }
}

// ── Pipeline principal ────────────────────────────────────────────────────────
export async function runMatchPipeline(proyectoId, getRow, getRows, runSql) {
  await stage1Validate(proyectoId, getRow);

  const { embedding: proyEmb, fichaTecnica } = await stage2GetEmbedding(proyectoId, getRow, runSql);
  const metaFisicaTotal = fichaTecnica.metaFisicaTotal || 0;

  // Stage 3: obtener candidatas con similitud coseno
  let candidatas = [];
  if (USE_PG) {
    // Una sola query SQL ordenada por pgvector — O(log n) con índice HNSW
    candidatas = await pgBulkMatch(proyEmb, getRows);
  } else {
    // SQLite: cargar todas, prefetch embeddings faltantes, calcular coseno en JS
    const convocatorias = await getRows(
      "SELECT id, titulo, descripcion, sectores, paises_elegibles, monto_min, monto_max, score_probabilidad, fecha_limite, donante, embedding FROM convocatorias WHERE estado != 'cerrada' AND deleted_at IS NULL",
      []
    );
    await prefetchEmbeddings(convocatorias, runSql);
    candidatas = convocatorias.map(conv => ({
      ...conv,
      cosine_sim: (() => {
        const convEmb = deserializeEmbedding(conv.embedding);
        return convEmb ? clamp(cosineSimilarity(proyEmb, convEmb), 0, 1) : 0;
      })(),
    }));
  }

  const results = candidatas.map(conv => {
    const cosine = clamp(Number(conv.cosine_sim || 0), 0, 1);
    const P_norm = clamp(Number(conv.score_probabilidad || 50) / 100, 0, 1);
    const C_risk = computeRisk(conv, metaFisicaTotal);

    const score = r4(
      W.cosine * cosine +
      W.prob   * P_norm -
      W.risk   * C_risk
    );

    return {
      convocatoriaId: conv.id,
      titulo:         conv.titulo,
      score:          clamp(score, 0, 1),
      breakdown: {
        cosine_sim: r4(cosine),
        P_norm:     r4(P_norm),
        C_risk:     r4(C_risk),
        weights:    W,
      },
    };
  });

  const top20 = results.sort((a, b) => b.score - a.score).slice(0, 20);

  // Persistir resultados — FIX 3.5: log estructurado en catch (no silencioso)
  for (const res of top20) {
    const id = crypto.randomUUID();
    try {
      await runSql(
        `INSERT INTO match_scores (id, proyecto_id, convocatoria_id, score, breakdown, pipeline_version)
         VALUES (?, ?, ?, ?, ?, 'v2-vector')
         ON CONFLICT(proyecto_id, convocatoria_id)
         DO UPDATE SET score = excluded.score, breakdown = excluded.breakdown, calculado_en = CURRENT_TIMESTAMP`,
        [id, proyectoId, res.convocatoriaId, res.score, JSON.stringify(res.breakdown)]
      );
    } catch (err) {
      logCriticalError('MatchScore', 'Fallo al persistir score en match_scores', {
        proyecto_id:     proyectoId,
        convocatoria_id: res.convocatoriaId,
        score:           res.score,
        error:           err.message,
      });
    }
  }

  return top20;
}
