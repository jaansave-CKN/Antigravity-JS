#!/usr/bin/env node
/**
 * embeddings-batch.mjs — corre UNA corrida acotada del proceso por lotes de
 * embeddings del catálogo del Radar (backend/pipeline/EmbeddingsBatch.js).
 *
 * Uso:  node --env-file=.env scripts/embeddings-batch.mjs [--max N] [--dry-run]
 *   --dry-run  solo cuenta candidatas y tokens estimados (no llama a la API)
 *   --max N    tope de convocatorias de esta corrida (nunca más que
 *              EMBEDDINGS_MAX_POR_CORRIDA)
 * Nunca imprime secretos. Comparte el lease de app_settings con el servidor:
 * si hay otra corrida activa (cron o POST admin), esta no arranca.
 */
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const dryRun = process.argv.includes('--dry-run');
const max = Number(arg('--max')) || undefined;

const { esperarPgInicial } = await import('../backend/config/database.config.js');
await esperarPgInicial();
const { ejecutarBatchEmbeddings, estadoBatch } = await import('../backend/pipeline/EmbeddingsBatch.js');

console.log('Antes: ', JSON.stringify(await estadoBatch()));
const r = await ejecutarBatchEmbeddings({ max, dryRun, log: { info() {}, warn: console.warn, error: console.error } });
console.log('Resumen:', JSON.stringify(r));
console.log('Después:', JSON.stringify(await estadoBatch()));
process.exit(r.detenidoPor === 'bd_degradada' || r.detenidoPor === 'otra_corrida_en_curso' ? 1 : 0);
