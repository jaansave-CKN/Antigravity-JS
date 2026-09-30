/**
 * embeddingsBatch.test.mjs — Fase 4: proceso por lotes de embeddings del
 * catálogo del Radar (ritmo, control de gasto, idempotencia, lease).
 * BD, API de embeddings y reloj se inyectan (deps): sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
mock.module(u('config/database.config.js'), { namedExports: { getRow: async () => null, getRows: async () => [], runSql: async () => ({}), dbStatus: () => ({ pgReady: true }) } });
mock.module(u('services/aiTokenLogger.js'), { namedExports: { logTokenUsage: async () => {} } });

const { ejecutarBatchEmbeddings, convocatoriaToText, configBatch } = await import('../../backend/pipeline/EmbeddingsBatch.js');

const SILENCIO = { info() {}, warn() {}, error() {} };
const conv = (i) => ({ id: `c${i}`, titulo: `Convocatoria ${i}`, donante: 'BID', sectores: '["agua","rural"]', paises_elegibles: '["Colombia"]', descripcion: 'Descripción real' });

function depsFalsas({ filas = 5, lease = true, pgReady = true, embed } = {}) {
  const d = {
    sql: [], llamadas: [], dormido: [], tokens: [],
    dbStatus: () => ({ pgReady }),
    getRow: async (sql, params) => {
      d.sql.push(sql);
      if (/INSERT INTO app_settings/.test(sql)) return lease ? { key: 'embeddings_batch_lease' } : null;
      if (/count\(\*\)::int AS n/.test(sql)) return { n: 0 };
      return null;
    },
    getRows: async (sql, params) => { d.sql.push(sql); d.limite = params[0]; return Array.from({ length: Math.min(filas, params[0]) }, (_, i) => conv(i)); },
    runSql: async (sql, params) => { d.sql.push(sql); if (/UPDATE convocatorias/.test(sql)) d.escritas = (d.escritas || 0) + 1; return {}; },
    textosAEmbeddings: embed || (async (textos) => { d.llamadas.push(textos.length); return textos.map(() => new Array(768).fill(0.1)); }),
    logTokenUsage: async (t) => { d.tokens.push(t); },
    dormir: async (ms) => { d.dormido.push(ms); },
    ahora: () => new Date('2026-09-28T20:00:00Z'),
  };
  return d;
}
const CFG = { maxPorCorrida: 200, lote: 2, pausaMs: 20_000, maxTokens: 200_000 };

test('texto determinista de la convocatoria (mismo input → mismo texto) con listas legibles', () => {
  const t = convocatoriaToText(conv(1));
  assert.equal(t, convocatoriaToText(conv(1)));
  assert.match(t, /Sectores: agua, rural/);
  assert.match(t, /Países: Colombia/);
});

test('procesa por lotes, pausa ENTRE llamadas, escribe solo filas sin vector y registra FinOps como costo del sistema', async () => {
  const d = depsFalsas({ filas: 5 });
  const r = await ejecutarBatchEmbeddings({ cfg: CFG, deps: d, log: SILENCIO });
  assert.deepEqual([r.procesadas, r.llamadas, r.detenidoPor], [5, 3, 'completado']);
  assert.deepEqual(d.llamadas, [2, 2, 1]);
  assert.deepEqual(d.dormido, [20_000, 20_000], 'sin pausa antes de la primera llamada');
  assert.equal(d.escritas, 5);
  assert.ok(d.sql.some(s => /embedding_vec IS NULL/.test(s) && /estado NOT IN \('cerrada', 'fondo_continuo'\)/.test(s)), 'idempotente: solo filas vivas, abiertas (sin fondos continuos) y sin vector');
  assert.ok(d.tokens.every(t => t.userId === 'sistema-radar-batch' && t.agentName === 'embeddings-batch'));
  assert.ok(d.sql.some(s => /UPDATE app_settings SET value/.test(s)), 'suelta el lease al terminar');
});

test('tope por corrida: nunca toma más filas que EMBEDDINGS_MAX_POR_CORRIDA, aunque se pida más', async () => {
  const d = depsFalsas({ filas: 1000 });
  await ejecutarBatchEmbeddings({ max: 5000, cfg: { ...CFG, maxPorCorrida: 7, lote: 100 }, deps: d, log: SILENCIO });
  assert.equal(d.limite, 7);
});

test('tope de tokens por corrida: se detiene antes de pasarse', async () => {
  const d = depsFalsas({ filas: 10 });
  const r = await ejecutarBatchEmbeddings({ cfg: { ...CFG, maxTokens: 50 }, deps: d, log: SILENCIO });
  assert.equal(r.detenidoPor, 'tope_tokens_corrida');
  assert.ok(r.tokensEstimados <= 50);
});

test('429 por minuto: espera el retryDelay REAL y reintenta el mismo lote; al 4º seguido se detiene sin perder datos', async () => {
  let n = 0;
  const d = depsFalsas({ filas: 2, embed: async (t) => { n++; if (n <= 1) { const e = new Error('429 RESOURCE_EXHAUSTED. Please retry in 13.8s.'); e.status = 429; throw e; } return t.map(() => new Array(768).fill(0)); } });
  const r = await ejecutarBatchEmbeddings({ cfg: CFG, deps: d, log: SILENCIO });
  assert.deepEqual([r.procesadas, r.detenidoPor], [2, 'completado']);
  assert.ok(d.dormido.includes(15_800), 'retryDelay real (13.8 s + 2 s de margen)');

  const siempre429 = depsFalsas({ filas: 2, embed: async () => { const e = new Error('429 Please retry in 5s.'); e.status = 429; throw e; } });
  const r2 = await ejecutarBatchEmbeddings({ cfg: CFG, deps: siempre429, log: SILENCIO });
  assert.deepEqual([r2.procesadas, r2.detenidoPor], [0, 'cuota_agotada']);
  assert.equal(siempre429.escritas, undefined, 'nada escrito');
});

test('429 de cuota DIARIA: se detiene de inmediato y devuelve la hora real de reintento', async () => {
  const d = depsFalsas({ filas: 2, embed: async () => { const e = new Error('429 quotaId: EmbedContentRequestsPerDayPerProjectPerModel'); e.status = 429; throw e; } });
  const r = await ejecutarBatchEmbeddings({ cfg: CFG, deps: d, log: SILENCIO });
  assert.equal(r.detenidoPor, 'cuota_diaria_agotada');
  assert.ok(new Date(r.proximoIntento) > new Date('2026-09-28T20:10:00Z'));
  assert.equal(d.dormido.length, 0, 'no espera horas dentro de la corrida');
});

test('otra corrida con el lease tomado, o BD degradada (sin ON CONFLICT) → no arranca', async () => {
  assert.equal((await ejecutarBatchEmbeddings({ cfg: CFG, deps: depsFalsas({ lease: false }), log: SILENCIO })).detenidoPor, 'otra_corrida_en_curso');
  assert.equal((await ejecutarBatchEmbeddings({ cfg: CFG, deps: depsFalsas({ pgReady: false }), log: SILENCIO })).detenidoPor, 'bd_degradada');
});

test('dry-run: cuenta candidatas y tokens sin llamar a la API ni tomar el lease', async () => {
  const d = depsFalsas({ filas: 3 });
  const r = await ejecutarBatchEmbeddings({ dryRun: true, cfg: CFG, deps: d, log: SILENCIO });
  assert.deepEqual([r.detenidoPor, r.candidatas, d.llamadas.length], ['dry_run', 3, 0]);
  assert.equal(d.sql.some(s => /app_settings/.test(s)), false);
  assert.ok(r.tokensEstimados > 0);
});

test('configuración por defecto: pausa de 20 s (cuota real ~100 textos/min verificada en vivo)', () => {
  assert.deepEqual(configBatch({}), { maxPorCorrida: 200, lote: 25, pausaMs: 20_000, maxTokens: 200_000 });
});
