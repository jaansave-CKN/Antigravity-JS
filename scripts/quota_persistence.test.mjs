// quota_persistence.test.mjs — regresión del BUG FinOps real (PROTOCOLO
// OMEGA-TITÁN, 2026-08-15): checkQuota() vivía en un Map en memoria puro,
// que se vaciaba en cada cold-start del proceso. El plan de Render es
// `free` (render.yaml) y hace spin-down por inactividad — confirmado real,
// no hipotético — así que la cuota de 50/día no se cumplía en la práctica:
// cada cold-start le regalaba a cualquier usuario una cuota nueva.
// Corregido: checkQuota migró a cache.js/Redis, con resetAt explícito en el
// valor cacheado (no delegado al TTL físico, para no convertir la ventana
// fija en una ventana deslizante).
//
// Sin credenciales UPSTASH_* reales en CI, este archivo corre contra el
// fallback en memoria (mismo comportamiento que scripts/login_ban.test.mjs)
// y cubre el contrato lógico de checkQuota() en sí — el round-trip real
// contra Upstash ya se verificó manualmente en vivo (clearMemCache() +
// consulta subsiguiente SIGUIÓ bloqueando, prueba de que el estado real
// vive en Redis, no en memoria).
//
// Corre con: node --test scripts/quota_persistence.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkQuota } from '../src/shared/infrastructure/session-manager.js';
import { clearMemCache } from '../src/shared/infrastructure/cache.js';

test('checkQuota: permite hasta el máximo y bloquea el siguiente intento', async () => {
  const uid = 'test-uid-' + Date.now();
  for (let i = 0; i < 3; i++) {
    const r = await checkQuota(uid, 3);
    assert.equal(r.allowed, true, `intento ${i + 1}/3 debe permitirse`);
  }
  const cuarto = await checkQuota(uid, 3);
  assert.equal(cuarto.allowed, false, 'el 4to intento sobre el máximo de 3 debe bloquear');
  assert.equal(cuarto.remaining, 0);
});

test('checkQuota: resetAt es fijo desde el primer uso, no se desliza en cada llamada (ventana fija, no deslizante — regresión del bug real)', async () => {
  const uid = 'test-uid-resetAt-' + Date.now();
  const primero = await checkQuota(uid, 5);
  const segundo = await checkQuota(uid, 5);
  assert.equal(primero.resetAt, segundo.resetAt, 'resetAt debe ser el mismo en llamadas sucesivas dentro de la misma ventana');
});

test('checkQuota: uids distintos tienen contadores independientes', async () => {
  const uidA = 'test-uid-a-' + Date.now();
  const uidB = 'test-uid-b-' + Date.now();
  await checkQuota(uidA, 1);
  const segundoA = await checkQuota(uidA, 1);
  const primeroB = await checkQuota(uidB, 1);
  assert.equal(segundoA.allowed, false, 'uidA ya agotó su cuota de 1');
  assert.equal(primeroB.allowed, true, 'uidB no debe verse afectado por el consumo de uidA');
});

test.after(() => clearMemCache());
