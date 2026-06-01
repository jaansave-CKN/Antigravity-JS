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

// ── Coseno via pgvector (PostgreSQL) ──────────────────────────────────────────
async function pgCosineSim(proyectoEmbedding, convocatoriaId, runRaw) {
  try {
    const vec = '[' + proyectoEmbedding.join(',') + ']';
    const row = await runRaw(
      'SELECT 1 - (embedding <=> $1::vector) AS sim FROM convocatorias WHERE id = $2',
      [vec, convocatoriaId]
    );
    return row ? clamp(Number(row.sim), 0, 1) : 0;
  } catch { return 0; }
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
  try { fichaTecnica = typeof row.ficha_tecnica === 'string' ? JSON.parse(row.ficha_tecnica) : (row.ficha_tecnica || {}); } catch {}

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

  // Persistir embedding
  try {
    await runSql('UPDATE proyectos SET embedding = ? WHERE id = ?', [serializeEmbedding(embedding), proyectoId]);
  } catch {}

  return { embedding, fichaTecnica };
}

// ── Stage 3: Obtener/generar embedding de convocatoria ────────────────────────
async function getConvocatoriaEmbedding(conv, runSql) {
  if (conv.embedding) {
    const vec = deserializeEmbedding(conv.embedding);
    if (vec && vec.length > 0) return vec;
  }

  const text = [conv.titulo, conv.descripcion, conv.sectores, conv.donante].filter(Boolean).join('. ');
  const embedding = await textToEmbedding(text);

  try {
    await runSql('UPDATE convocatorias SET embedding = ? WHERE id = ?', [serializeEmbedding(embedding), conv.id]);
  } catch {}

  return embedding;
}

// ── Pipeline principal ────────────────────────────────────────────────────────
export async function runMatchPipeline(proyectoId, getRow, getRows, runSql) {
  await stage1Validate(proyectoId, getRow);

  const { embedding: proyEmb, fichaTecnica } = await stage2GetEmbedding(proyectoId, getRow, runSql);
  const metaFisicaTotal = fichaTecnica.metaFisicaTotal || 0;

  const convocatorias = await getRows(
    "SELECT id, titulo, descripcion, sectores, paises_elegibles, monto_min, monto_max, score_probabilidad, fecha_limite, donante, embedding FROM convocatorias WHERE estado != 'cerrada' AND deleted_at IS NULL",
    []
  );

  const results = [];

  for (const conv of convocatorias) {
    let cosine = 0;

    if (USE_PG) {
      // pgvector: operador <=> (cosine distance = 1 - similarity)
      cosine = await pgCosineSim(proyEmb, conv.id, getRow);
    } else {
      // SQLite fallback: coseno en JS
      const convEmb = await getConvocatoriaEmbedding(conv, runSql);
      cosine = clamp(cosineSimilarity(proyEmb, convEmb), 0, 1);
    }

    const P_norm = clamp(Number(conv.score_probabilidad || 50) / 100, 0, 1);
    const C_risk = computeRisk(conv, metaFisicaTotal);

    const score = r4(
      W.cosine * cosine +
      W.prob   * P_norm -
      W.risk   * C_risk
    );

    results.push({
      convocatoriaId: conv.id,
      titulo:         conv.titulo,
      score:          clamp(score, 0, 1),
      breakdown: {
        cosine_sim: r4(cosine),
        P_norm:     r4(P_norm),
        C_risk:     r4(C_risk),
        weights:    W,
      },
    });
  }

  const top20 = results.sort((a, b) => b.score - a.score).slice(0, 20);

  // Persistir resultados
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
    } catch {}
  }

  return top20;
}
