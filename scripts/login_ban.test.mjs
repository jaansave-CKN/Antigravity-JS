// login_ban.test.mjs — cobertura del ban temporal de IP por fuerza bruta de
// login (session-manager.js::checkLoginBan/recordLoginFailure/loginBanGuard).
// Corre contra el fallback en memoria de cache.js (sin UPSTASH_* en el
// entorno de test), igual que el resto de la suite — no requiere Redis real.
// Corre con: node --test scripts/login_ban.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLoginBan, recordLoginFailure, loginBanGuard } from '../src/shared/infrastructure/session-manager.js';
import { clearMemCache } from '../src/shared/infrastructure/cache.js';

function ip() {
  // Una IP distinta por test — evita que el estado de un test contamine el
  // siguiente sin depender de limpiar el Map completo entre tests.
  return `10.0.0.${Math.floor(Math.random() * 65000) + 1}`;
}

test('checkLoginBan: IP sin fallos previos está permitida', async () => {
  const r = await checkLoginBan(ip());
  assert.equal(r.allowed, true);
});

test('recordLoginFailure: fallos por debajo del umbral no banean', async () => {
  const testIp = ip();
  for (let i = 0; i < 4; i++) {
    const r = await recordLoginFailure(testIp);
    assert.equal(r.banned, false);
  }
  const check = await checkLoginBan(testIp);
  assert.equal(check.allowed, true);
});

test('recordLoginFailure: el 5o fallo banea la IP y checkLoginBan lo refleja', async () => {
  const testIp = ip();
  let last;
  for (let i = 0; i < 5; i++) last = await recordLoginFailure(testIp);
  assert.equal(last.banned, true);
  assert.ok(last.retryAfterMs > 0);

  const check = await checkLoginBan(testIp);
  assert.equal(check.allowed, false);
  assert.ok(check.retryAfterMs > 0);
});

test('loginBanGuard: deja pasar (next) cuando la IP no está baneada', async () => {
  const req = { ip: ip() };
  let calledNext = false;
  const res = { status() { return this; }, json() {} };
  await loginBanGuard(req, res, () => { calledNext = true; });
  assert.equal(calledNext, true);
});

test('loginBanGuard: responde 429 con retryAfterMs cuando la IP está baneada', async () => {
  const testIp = ip();
  for (let i = 0; i < 5; i++) await recordLoginFailure(testIp);

  const req = { ip: testIp };
  let statusCode, body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; },
  };
  let calledNext = false;
  await loginBanGuard(req, res, () => { calledNext = true; });

  assert.equal(calledNext, false);
  assert.equal(statusCode, 429);
  assert.ok(typeof body.retryAfterMs === 'number' && body.retryAfterMs > 0);
});

test.after(() => clearMemCache());
