/**
 * slowDown.test.mjs — Lote 5/6: la exención de CI (E2E_DESACTIVAR_SLOWDOWN)
 * queda herméticamente sellada y el rate limiter sigue operando en producción.
 * Sin BD (store de rate-limit simulado).
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

class StoreFalso { async increment() { return { totalHits: 1, resetTime: new Date() }; } async decrement() {} async resetKey() {} }
mock.module(new URL('../../backend/middlewares/PostgresRateLimitStore.js', import.meta.url).href, { namedExports: { PostgresRateLimitStore: StoreFalso } });
const { slowDown, esExencionSlowDownDeCI } = await import('../../backend/middlewares/SecurityMiddleware.js');

let ipSeq = 0;
// Envía 101 peticiones desde una IP nueva y reporta si la última fue retrasada.
function ultimaRetrasada() {
  const ip = `10.9.0.${++ipSeq}`;
  let retrasada = false;
  for (let i = 0; i < 101; i++) {
    let inmediata = false;
    const res = { setHeader: (k) => { if (k === 'X-RateLimit-Delay-Ms') retrasada = true; } };
    slowDown({ ip, path: '/api/x', originalUrl: '/api/x', method: 'GET', headers: {} }, res, () => { inmediata = true; });
    if (i < 100) assert.equal(inmediata, true);
  }
  return retrasada;
}
function conEntorno(vars, fn) {
  const previo = { ...process.env };
  for (const k of ['NODE_ENV', 'CI', 'E2E_DESACTIVAR_SLOWDOWN']) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const k of ['NODE_ENV', 'CI', 'E2E_DESACTIVAR_SLOWDOWN']) { if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k]; } }
}

test('matriz de exención: solo bandera + entorno de prueba, y nunca producción', () => {
  const casos = [
    [{}, false],
    [{ NODE_ENV: 'test' }, false],                                                    // entorno de prueba sin bandera
    [{ E2E_DESACTIVAR_SLOWDOWN: '1' }, false],                                       // bandera sin entorno declarado
    [{ E2E_DESACTIVAR_SLOWDOWN: '1', NODE_ENV: 'development' }, false],              // dev local con bandera
    [{ E2E_DESACTIVAR_SLOWDOWN: '0', NODE_ENV: 'test' }, false],                     // bandera distinta de '1'
    [{ E2E_DESACTIVAR_SLOWDOWN: '1', NODE_ENV: 'test' }, true],                      // .env de CI
    [{ E2E_DESACTIVAR_SLOWDOWN: '1', CI: 'true' }, true],                             // runner de GitHub
    [{ E2E_DESACTIVAR_SLOWDOWN: '1', NODE_ENV: 'production' }, false],               // bandera por error en prod
    [{ E2E_DESACTIVAR_SLOWDOWN: '1', NODE_ENV: 'production', CI: 'true' }, false],   // prod gana aunque CI=true
  ];
  for (const [env, esperado] of casos) assert.equal(esExencionSlowDownDeCI(env), esperado, JSON.stringify(env));
});

test('producción con bandera Y CI=true: la petición 101 SIGUE retrasándose', () => {
  conEntorno({ E2E_DESACTIVAR_SLOWDOWN: '1', CI: 'true', NODE_ENV: 'production' }, () => assert.equal(ultimaRetrasada(), true));
});

test('sin bandera (producción real hoy): la petición 101 se retrasa', () => {
  conEntorno({ NODE_ENV: 'production' }, () => assert.equal(ultimaRetrasada(), true));
});

test('CI (bandera + NODE_ENV=test): sin retraso', () => {
  conEntorno({ E2E_DESACTIVAR_SLOWDOWN: '1', NODE_ENV: 'test' }, () => assert.equal(ultimaRetrasada(), false));
});

test('ningún otro limitador lee la bandera ni variables de entorno de CI', () => {
  const sec = fs.readFileSync(new URL('../../backend/middlewares/SecurityMiddleware.js', import.meta.url), 'utf8');
  const srv = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  assert.equal((sec.match(/E2E_DESACTIVAR_SLOWDOWN/g) || []).length, 1, 'la bandera solo aparece en esExencionSlowDownDeCI');
  assert.equal((srv.match(/E2E_DESACTIVAR_SLOWDOWN/g) || []).length, 0);
  // Los rateLimit({...}) no tienen skip por entorno (solo el health check).
  for (const bloque of sec.split('rateLimit({').slice(1).map(b => b.split('});')[0])) {
    assert.doesNotMatch(bloque, /process\.env|NODE_ENV|\bCI\b/, 'un limitador de SecurityMiddleware lee el entorno');
  }
});
