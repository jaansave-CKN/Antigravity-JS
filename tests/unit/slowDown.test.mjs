/**
 * slowDown.test.mjs — Lote 5: la exención de CI (E2E_DESACTIVAR_SLOWDOWN)
 * NUNCA puede aplicar en producción. Sin BD (store de rate-limit simulado).
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class StoreFalso { async increment() { return { totalHits: 1, resetTime: new Date() }; } async decrement() {} async resetKey() {} }
mock.module(new URL('../../backend/middlewares/PostgresRateLimitStore.js', import.meta.url).href, { namedExports: { PostgresRateLimitStore: StoreFalso } });
const { slowDown } = await import('../../backend/middlewares/SecurityMiddleware.js');

// Envía 101 peticiones desde una IP y reporta si la última fue retrasada.
function ultimaRetrasada(ip) {
  let retrasada = false;
  for (let i = 0; i < 101; i++) {
    let inmediata = false;
    const res = { setHeader: (k) => { if (k === 'X-RateLimit-Delay-Ms') retrasada = true; } };
    slowDown({ ip, path: '/api/x', originalUrl: '/api/x', method: 'GET', headers: {} }, res, () => { inmediata = true; });
    if (i < 100) assert.equal(inmediata, true);
  }
  return retrasada;
}

test('sin bandera: la petición 101 de la misma IP se retrasa', () => {
  delete process.env.E2E_DESACTIVAR_SLOWDOWN;
  process.env.NODE_ENV = 'test';
  assert.equal(ultimaRetrasada('10.0.0.1'), true);
});

test('bandera de CI con NODE_ENV=test: sin retraso', () => {
  process.env.E2E_DESACTIVAR_SLOWDOWN = '1';
  process.env.NODE_ENV = 'test';
  assert.equal(ultimaRetrasada('10.0.0.2'), false);
});

test('bandera puesta por error en PRODUCCIÓN: el retraso sigue aplicando', () => {
  process.env.E2E_DESACTIVAR_SLOWDOWN = '1';
  process.env.NODE_ENV = 'production';
  assert.equal(ultimaRetrasada('10.0.0.3'), true);
});
