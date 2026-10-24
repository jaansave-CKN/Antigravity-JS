/**
 * suscripcionAdmin.test.mjs — activación de plan por admin y pagos en stand-by.
 *
 * POR QUÉ EXISTE
 * --------------
 * `backend/routes/subscriptions.routes.js` usaba `withTenantRun` en tres líneas
 * sin importarlo: un ReferenceError que `tryCatch` convertía en 500. Con las
 * pasarelas de pago congeladas a propósito para el lanzamiento, la activación
 * por admin es el ÚNICO camino para otorgar un plan o una cortesía — estaba
 * roto justo donde no había alternativa.
 *
 * Nada lo detectó: `node --check` solo mira sintaxis, `tsc` no cubre el backend
 * en JS, y ninguna prueba ejercitaba esta ruta. Un import faltante solo se
 * manifiesta EJECUTANDO el handler, así que esta prueba lo ejecuta de verdad
 * contra dobles de la BD, en vez de inspeccionar el texto del archivo.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;

// Dobles de la capa de BD: registran lo que la ruta intenta escribir.
const bd = { filas: new Map(), escrituras: [] };
mock.module(u('config/database.config.js'), {
  namedExports: {
    withTenantRow: async (tenant, sql, params) => {
      bd.escrituras.push({ tipo: 'row', tenant, sql, params });
      return bd.filas.get(tenant) ?? null;
    },
    withTenantRun: async (tenant, sql, params) => {
      bd.escrituras.push({ tipo: 'run', tenant, sql, params });
      return { rowCount: 1 };
    },
  },
});
mock.module(u('agents/gp/gerenteProyecto.js'), { namedExports: { formularConvocatoria: async () => ({}) } });

// Pasarela NO configurada: el estado real de producción (sin llaves de pago).
mock.module(u('payments/index.js'), {
  namedExports: {
    paymentProvider: {
      isConfigured: false,
      name: 'stripe',
      getOrCreateCustomer: async () => 'cus_x',
      createCheckoutSession: async () => ({ url: 'https://no', sessionId: 's' }),
    },
    activePaymentProviderName: 'stripe',
  },
});

const { registerSubscriptionRoutes } = await import(u('routes/subscriptions.routes.js'));

/** App mínima que captura el handler registrado en POST /api/subscription/activate. */
function montar() {
  let handler = null;
  const app = {
    get() {}, put() {}, patch() {}, delete() {},
    post(ruta, ...capas) { if (ruta === '/api/subscription/activate') handler = capas[capas.length - 1]; },
  };
  registerSubscriptionRoutes(app, {
    authenticateToken: (_q, _s, n) => n(),
    tryCatch: (fn) => fn,          // sin red de seguridad: un throw sale a la vista
    getRow: async () => null,
    runSql: async () => ({}),
  });
  assert.ok(handler, 'no se registró POST /api/subscription/activate');
  return handler;
}

const respuesta = () => {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

test('REGRESIÓN: el admin activa un plan sin ReferenceError (withTenantRun debe estar importado)', async () => {
  bd.filas.clear(); bd.escrituras = [];
  const handler = montar();
  const res = respuesta();

  // Sin fila previa → rama INSERT (línea que usaba withTenantRun sin importar).
  await handler({ userRole: 'admin', userId: 'admin-1', body: { plan: 'suite', target_user_id: 'usuario-7' } }, res);

  assert.equal(res.code, 200, `se esperaba 200, llegó ${res.code}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.equal(res.body.plan, 'suite');
  assert.deepEqual([res.body.access_radar, res.body.access_formulador], [true, true]);

  const run = bd.escrituras.find(e => e.tipo === 'run');
  assert.ok(run, 'debió escribir la suscripción');
  assert.match(run.sql, /INSERT INTO user_subscriptions/);
  assert.equal(run.tenant, 'usuario-7',
    'el tenant debe ser el DUEÑO del plan, no el admin: con RLS, escopar por el admin perdería la escritura en silencio');
});

test('REGRESIÓN: el admin actualiza un plan existente (rama UPDATE, mismo import)', async () => {
  bd.filas.clear(); bd.escrituras = [];
  bd.filas.set('usuario-7', { id: 'sub-1' });
  const handler = montar();
  const res = respuesta();

  await handler({ userRole: 'admin', userId: 'admin-1', body: { plan: 'radar', target_user_id: 'usuario-7' } }, res);

  assert.equal(res.code, 200, `se esperaba 200, llegó ${res.code}: ${JSON.stringify(res.body)}`);
  const run = bd.escrituras.find(e => e.tipo === 'run');
  assert.match(run.sql, /UPDATE user_subscriptions/);
  assert.deepEqual([res.body.access_radar, res.body.access_formulador], [true, false]);
});

test('pagos en stand-by: el usuario normal recibe 503 con code estable, no un 500', async () => {
  bd.filas.clear(); bd.escrituras = [];
  const handler = montar();
  const res = respuesta();

  await handler({ userRole: 'user', userId: 'usuario-7', body: { plan: 'suite' } }, res);

  assert.equal(res.code, 503, 'stand-by es 503 (servicio no disponible), nunca 500');
  assert.equal(res.body.code, 'PAGOS_EN_STANDBY',
    'la UI necesita distinguir "aún no habilitado" de "la pasarela se cayó"');
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /[a-záéíóú]/i, 'el mensaje va en español y es accionable');
  assert.equal(bd.escrituras.filter(e => e.tipo === 'run').length, 0,
    'un checkout imposible no debe dejar escrituras a medias');
});

test('plan inválido se rechaza con 400 antes de tocar la BD', async () => {
  bd.filas.clear(); bd.escrituras = [];
  const handler = montar();
  const res = respuesta();
  await handler({ userRole: 'admin', userId: 'admin-1', body: { plan: 'inexistente' } }, res);
  assert.equal(res.code, 400);
  assert.equal(bd.escrituras.length, 0);
});
