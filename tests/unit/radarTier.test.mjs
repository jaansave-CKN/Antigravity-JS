/**
 * radarTier.test.mjs — prueba aislada de backend/middlewares/radarTier.js
 * (BIZ-001, auditoría 2026-09-23). La BD se simula con mock.module: ningún
 * caso escribe ni lee la base real. Cubre el plan Radar no admin, que hoy no
 * se puede probar en vivo (ningún usuario real tiene access_radar=1).
 *
 * Ejecutar: npm run test:unit   (requiere Node >= 22.3 por mock.module)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const SUSCRIPCIONES = {
  'u-radar': { access_radar: 1 },
  'u-suite': { access_radar: 1 },
  'u-formulador': { access_radar: 0 },
};
const consultas = [];

mock.module(new URL('../../backend/config/database.config.js', import.meta.url).href, {
  namedExports: {
    withTenantRow: async (tenantId, sql, params) => {
      consultas.push({ tenantId, sql, params });
      if (tenantId === 'u-error') throw new Error('BD caída (simulada)');
      return SUSCRIPCIONES[tenantId] ?? null;
    },
  },
});
mock.module(new URL('../../backend/utils/logger.js', import.meta.url).href, {
  namedExports: { logger: { warn() {}, info() {}, error() {} } },
});

const { resolverNivelRadar, nivelRadar } = await import('../../backend/middlewares/radarTier.js');

function nivelVia(req) {
  return new Promise(resolve => resolverNivelRadar(req, {}, () => resolve(req.radarTier)));
}

const CASOS = [
  ['anónimo (sin sesión)', undefined, undefined, 'muestra'],
  ['admin', 'u-admin', 'admin', 'full'],
  ['plan Radar, no admin', 'u-radar', 'Usuario', 'full'],
  ['plan Suite, no admin', 'u-suite', 'Usuario', 'full'],
  ['plan Formulador (sin radar)', 'u-formulador', 'Usuario', 'muestra'],
  ['free sin fila de suscripción', 'u-free', 'Usuario', 'muestra'],
  ['trial por rol', 'trial-ab12cd34', 'trial', 'muestra'],
  ['trial por prefijo de id', 'trial-zz99', 'Usuario', 'muestra'],
  ['error de BD (cierra en muestra)', 'u-error', 'Usuario', 'muestra'],
];

for (const [nombre, userId, userRole, esperado] of CASOS) {
  test(`middleware: ${nombre} -> ${esperado}`, async () => {
    assert.equal(await nivelVia({ userId, userRole }), esperado);
  });
}

test('la consulta es la misma de requireAccess y va escopada al propio usuario', async () => {
  consultas.length = 0;
  assert.equal(await nivelRadar('u-radar', 'Usuario'), 'full');
  assert.equal(consultas.length, 1);
  assert.equal(consultas[0].tenantId, 'u-radar');
  assert.deepEqual(consultas[0].params, ['u-radar']);
  assert.match(consultas[0].sql, /SELECT access_radar FROM user_subscriptions WHERE user_id = \?/);
});

test('admin, anónimo y trial no consultan la BD', async () => {
  consultas.length = 0;
  await nivelRadar(undefined, undefined);
  await nivelRadar('u-admin', 'admin');
  await nivelRadar('trial-ab12cd34', 'trial');
  assert.equal(consultas.length, 0);
});
