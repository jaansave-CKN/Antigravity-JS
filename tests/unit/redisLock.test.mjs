/**
 * redisLock.test.mjs — lock distribuido para los trabajos programados.
 *
 * Cubre el contrato completo, incluida la degradación: este lock protege el
 * catálogo de 1.109 convocatorias de un rastreo duplicado, pero NUNCA debe
 * impedir que el catálogo se actualice. Por eso un fallo de Redis o su
 * ausencia resultan en "corre igual" (comportamiento de hoy con una sola
 * instancia), no en "no corras".
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module(new URL('../../backend/utils/logger.js', import.meta.url).href, {
  namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } },
});

const { adquirirLock, liberarLock, conLockDeTrabajo, lockDisponible } =
  await import('../../backend/utils/redisLock.js');

const ENV = { UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok' };
const conRedis = () => Object.assign(process.env, ENV);
const sinRedis = () => { delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; };

let llamadas = [];
const red = (responder) => {
  llamadas = [];
  global.fetch = async (url, opts) => {
    llamadas.push({ url, cuerpo: JSON.parse(opts.body) });
    return responder();
  };
};
const ok = (result) => ({ ok: true, status: 200, json: async () => ({ result }) });

test('sin Redis configurado: devuelve null y lo informa como no disponible', async () => {
  sinRedis();
  assert.equal(lockDisponible(), false);
  assert.equal(await adquirirLock('x', 60), null);
});

test('con Redis: usa SET NX EX (atómico) y devuelve true cuando lo gana', async () => {
  conRedis();
  red(() => ok('OK'));
  assert.equal(lockDisponible(), true);
  assert.equal(await adquirirLock('rastreo1', 5400), true);
  assert.equal(llamadas.length, 1);
  const [cmd, clave, , nx, ex, ttl] = llamadas[0].cuerpo;
  assert.equal(cmd, 'SET');
  assert.equal(clave, 'radfor360:lock:rastreo1');
  assert.deepEqual([nx, ex, ttl], ['NX', 'EX', '5400'],
    'NX hace la operación atómica y EX garantiza que un lock huérfano expire solo');
});

test('otra instancia lo tiene: Redis devuelve null → false (debo saltar)', async () => {
  conRedis();
  red(() => ok(null));
  assert.equal(await adquirirLock('rastreo1', 5400), false);
});

test('Redis caído: devuelve null, NUNCA false — el catálogo debe poder actualizarse', async () => {
  conRedis();
  red(() => { throw new Error('ECONNREFUSED'); });
  assert.equal(await adquirirLock('rastreo1', 5400), null,
    'un hipo de Redis no puede dejar el catálogo sin rastrear');

  red(() => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal(await adquirirLock('rastreo1', 5400), null);
});

test('conLockDeTrabajo: ejecuta y libera cuando gana el lock', async () => {
  conRedis();
  let respuestas = ['OK', 1];
  red(() => ok(respuestas.shift()));
  let corrio = false;
  const r = await conLockDeTrabajo('embeddings', 1800, async () => { corrio = true; return { procesadas: 3 }; });
  assert.equal(corrio, true);
  assert.deepEqual(r, { procesadas: 3 });
  assert.deepEqual(llamadas.map(l => l.cuerpo[0]), ['SET', 'DEL'], 'toma el lock y lo libera al terminar');
});

test('conLockDeTrabajo: NO ejecuta el trabajo si otra instancia lo tiene', async () => {
  conRedis();
  red(() => ok(null));
  let corrio = false;
  const r = await conLockDeTrabajo('rastreo2', 5400, async () => { corrio = true; });
  assert.equal(corrio, false, 'el trabajo duplicado no debe ejecutarse');
  assert.deepEqual(r, { omitido: true });
  assert.deepEqual(llamadas.map(l => l.cuerpo[0]), ['SET'], 'no intenta liberar un lock que no tomó');
});

test('conLockDeTrabajo: sin Redis ejecuta igual (comportamiento de hoy, nunca peor)', async () => {
  sinRedis();
  let corrio = false;
  await conLockDeTrabajo('rastreo1', 5400, async () => { corrio = true; });
  assert.equal(corrio, true);
});

test('conLockDeTrabajo: libera el lock aunque el trabajo lance', async () => {
  conRedis();
  let respuestas = ['OK', 1];
  red(() => ok(respuestas.shift()));
  await assert.rejects(
    conLockDeTrabajo('rastreo1', 5400, async () => { throw new Error('falló el rastreo'); }),
    /falló el rastreo/,
  );
  assert.deepEqual(llamadas.map(l => l.cuerpo[0]), ['SET', 'DEL'],
    'un trabajo que falla no puede dejar el lock tomado hasta el TTL');
});

test('liberarLock sin Redis no lanza', async () => {
  sinRedis();
  await liberarLock('x');
});
