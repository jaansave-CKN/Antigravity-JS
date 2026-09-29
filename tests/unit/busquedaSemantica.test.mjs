/**
 * busquedaSemantica.test.mjs — pantalla de producción de búsqueda semántica
 * (2026-09-29, dictamen architect C1-C6): orquestación del coordinador A
 * (buscarPorTexto / estadoBusquedaSemantica), esquema acotado y el 429 del
 * aiLimiter con hora real de reintento. BD y embeddings simulados.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
const est = { pgReady: true, cobertura: { total: 550, con: 550 }, embedFalla: false, embeds: 0, sql: [] };
mock.module(u('config/database.config.js'), { namedExports: {
  dbStatus: () => ({ pgReady: est.pgReady }),
  getRow: async () => est.cobertura,
  getRows: async (sql, params) => { est.sql.push({ sql, params }); return [{ id: 'c1', titulo: 'Fondo del Agua', moneda: 'USD', similitud: 0.81 }]; },
} });
mock.module(u('services/embeddingsService.js'), { namedExports: {
  textToEmbedding: async () => { est.embeds++; if (est.embedFalla) throw new Error('EMBEDDINGS_ERROR: 503 del proveedor con llave=secreta'); return [0.1, 0.2]; },
  deserializeEmbedding: (x) => x,
  cosineSimilarity: () => 0.5,
} });

const A = await import('../../backend/agents/radar/index.js');
const { busquedaSemanticaSchema, validarBody } = await import('../../backend/validators/zodSchemas.js');

function reiniciar(cambios = {}) {
  Object.assign(est, { pgReady: true, cobertura: { total: 550, con: 550 }, embedFalla: false, embeds: 0, sql: [] }, cambios);
  process.env.DATABASE_URL = 'postgres://prueba';
}

test('búsqueda OK: usa el vector, devuelve resultados con moneda y la cobertura del catálogo abierto', async () => {
  reiniciar();
  const r = await A.buscarPorTexto({ texto: 'acueducto veredal', limit: 25, threshold: 0.3 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.cobertura, { total: 550, con: 550 });
  assert.equal(r.resultados[0].moneda, 'USD');
  assert.match(est.sql[0].sql, /moneda/);
  assert.deepEqual(est.sql[0].params.slice(1), [0.3, 25]);
});

test('catálogo sin vectores → 503 CATALOGO_SIN_EMBEDDINGS ANTES de gastar un embedding', async () => {
  reiniciar({ cobertura: { total: 550, con: 0 } });
  const r = await A.buscarPorTexto({ texto: 'agua' });
  assert.deepEqual([r.ok, r.status, r.code], [false, 503, 'CATALOGO_SIN_EMBEDDINGS']);
  assert.equal(est.embeds, 0);
});

test('BD en modo REST degradado → 503 BUSQUEDA_NO_VERIFICABLE (nunca un falso "catálogo sin indexar")', async () => {
  reiniciar({ pgReady: false });
  assert.deepEqual((await A.estadoBusquedaSemantica()), { ok: false, status: 503, code: 'BUSQUEDA_NO_VERIFICABLE' });
  const r = await A.buscarPorTexto({ texto: 'agua' });
  assert.equal(r.code, 'BUSQUEDA_NO_VERIFICABLE');
  assert.equal(est.embeds, 0);
});

test('embeddings caídos → 503 IA_NO_DISPONIBLE; el detalle interno NO es parte de la respuesta pública', async () => {
  reiniciar({ embedFalla: true });
  const r = await A.buscarPorTexto({ texto: 'agua' });
  assert.deepEqual([r.ok, r.status, r.code], [false, 503, 'IA_NO_DISPONIBLE']);
  assert.equal(r.resultados, undefined, 'sin vector no hay resultados inventados');
  assert.match(r.detalleInterno, /EMBEDDINGS_ERROR/);
});

test('esquema: se ACOTA (no 400): limit 1-50 (defecto 25), afinidad 0,25-0,90 (defecto 0,25); texto obligatorio', () => {
  const v = (b) => validarBody(busquedaSemanticaSchema, b);
  assert.deepEqual(v({ texto: 'agua', limit: 500, threshold: 0.99 }).data, { texto: 'agua', limit: 50, threshold: 0.9 });
  assert.deepEqual(v({ texto: 'agua', limit: 20, threshold: 0.1 }).data, { texto: 'agua', limit: 20, threshold: 0.25 });
  assert.deepEqual(v({ texto: 'agua' }).data, { texto: 'agua', limit: 25, threshold: 0.25 });
  assert.equal(v({ texto: '  ' }).ok, false);
});

test('ruta: 503 con X-RF-No-Retry literal y sin reintentos del cliente; estado sin aiLimiter', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const bloque = src.slice(src.indexOf("app.get('/api/radar/busqueda-semantica/estado'"), src.indexOf('// GET /api/radar/buscar?q='));
  assert.match(bloque, /app\.get\('\/api\/radar\/busqueda-semantica\/estado', authenticateToken, requireAccess\('radar'\), tryCatch/, 'estado sin aiLimiter: no gasta cuota');
  assert.match(bloque, /buscarPorTexto\(/);
  assert.equal((bloque.match(/res\.set\('X-RF-No-Retry', '1'\)/g) || []).length, 2);
  assert.doesNotMatch(bloque, /\.json\(\{[^)]*detalleInterno/, 'el detalle interno no sale en el JSON (solo al log)');
  assert.match(bloque, /logger\.warn\([^)]*detalleInterno/, 'el detalle interno sí va al log');
});

test('aiLimiter: el 429 trae la hora REAL de reintento (retryAt) además del código', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../backend/middlewares/SecurityMiddleware.js', import.meta.url), 'utf8');
  const bloque = src.slice(src.indexOf('export const aiLimiter'), src.indexOf('export const aiLimiter') + 900);
  assert.match(bloque, /code: 'AI_RATE_LIMITED'/);
  assert.match(bloque, /retryAt: reset instanceof Date \? reset\.toISOString\(\) : null/);
});
