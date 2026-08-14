// cache_redis.test.mjs — regresión del BUG REAL de producción encontrado por
// PROTOCOLO TITÁN ∞ (2026-08-13): redisSet() hacía JSON.stringify() dos veces
// mientras redisGet() solo hacía JSON.parse() una — toda lectura devolvía el
// string serializado en vez del objeto original. Rompió en silencio durante
// 8 días (desde el commit que creó cache.js) porque scripts/login_ban.test.mjs
// (y el resto de la suite) corre contra el fallback en memoria, que no tiene
// este bug — el path de Redis nunca se ejercitaba en CI.
//
// Este test NO requiere UPSTASH_* real (no está en los secretos de CI) — en
// vez de eso, mockea global.fetch para capturar exactamente el `body` que
// redisSet() envía a Upstash, y lo alimenta de vuelta como si fuera la
// respuesta real de un GET (`{result: <ese body>}`) a través de redisGet().
// Si alguien reintroduce el doble-stringify (o cualquier asimetría de
// serialización entre SET y GET), este test falla en el mismo commit, no 8
// días después en producción.
//
// Corre con: node --test scripts/cache_redis.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// UPSTASH_URL/TOKEN deben existir ANTES de importar cache.js — el módulo los
// lee una sola vez al cargar (const a nivel de módulo).
process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token-para-test';

const { cacheGet, cacheSet, clearMemCache } = await import('../src/shared/infrastructure/cache.js');

function mockUpstashFetch() {
  let capturedSetBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes('/set/')) {
      capturedSetBody = options.body;
      return { json: async () => ({ result: 'OK' }) };
    }
    if (u.includes('/get/')) {
      // Simula la respuesta real de Upstash: el valor guardado vuelve tal
      // cual bajo la clave "result" — exactamente lo que capturó el SET.
      return { json: async () => ({ result: capturedSetBody }) };
    }
    return { json: async () => ({}) };
  };
  return {
    getCaptured: () => capturedSetBody,
    restore: () => { global.fetch = originalFetch; },
  };
}

test('cache Redis: round-trip SET->GET devuelve el objeto original, no un string (regresión bug crítico 2026-08-13)', async () => {
  const mock = mockUpstashFetch();
  try {
    const original = { count: 1, foo: 'bar', anidado: { x: [1, 2, 3] } };
    await cacheSet('titan:regresion:objeto', original, 60);
    const result = await cacheGet('titan:regresion:objeto');

    assert.equal(typeof result, 'object', 'cacheGet debe devolver un objeto, no un string serializado');
    assert.deepEqual(result, original, 'el objeto debe sobrevivir el round-trip sin mutar');
  } finally {
    mock.restore();
    clearMemCache();
  }
});

test('cache Redis: el body enviado a Upstash es JSON.stringify() UNA sola vez (no doble-serializado)', async () => {
  const mock = mockUpstashFetch();
  try {
    const original = { a: 1 };
    await cacheSet('titan:regresion:body', original, 60);
    const capturado = mock.getCaptured();

    // Un solo stringify: JSON.parse(capturado) debe dar directamente el
    // objeto. Con el bug (doble stringify), JSON.parse(capturado) da un
    // STRING (`'{"a":1}'`), no un objeto — hay que parsear dos veces para
    // recuperar el valor real.
    const parsedOnce = JSON.parse(capturado);
    assert.equal(typeof parsedOnce, 'object', 'un solo JSON.parse() debe bastar para recuperar el objeto — si esto falla, el body está doble-serializado otra vez');
    assert.deepEqual(parsedOnce, original);
  } finally {
    mock.restore();
    clearMemCache();
  }
});

test.after(() => clearMemCache());
