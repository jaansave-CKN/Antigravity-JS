/**
 * lote10.test.mjs — Lote 10 (2026-09-25).
 * 1. Alertas: todo 5xx llega a logCriticalError (system_logs + webhook) con
 *    project_id y módulo; los 4xx no; sin inundar; nunca lanza.
 *    captureError() (13 rutas + tryCatch) ahora delega en esa alerta.
 * 2. Cola de guardado serializada del autoguardado (client/src/lib/colaGuardado.ts).
 * 3. Datos mínimos antes de gastar cuota de Gemini (MIROFISH / Viabilidad).
 * Sin red ni BD. Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../${p}`, import.meta.url).href;
const alertas = [];
mock.module(u('backend/services/logService.js'), { namedExports: {
  logCriticalError: async (origen, mensaje, payload) => { alertas.push({ origen, mensaje, payload }); },
} });

const { extraerProjectId, moduloDeRuta, alertarErrorServidor } = await import(u('backend/services/alertaErrores.js'));
const { captureError } = await import(u('backend/config/sentry.config.js'));
const { faltantesMirofish, faltantesViabilidad, respuesta422 } = await import(u('backend/services/datosMinimosIA.js'));
const { crearColaGuardado } = await import(u('client/src/lib/colaGuardado.ts'));

// ── 1. Alertas ───────────────────────────────────────────────────────────────
test('extraerProjectId y moduloDeRuta desde la ruta real', () => {
  assert.equal(extraerProjectId('/api/proyectos/abc-123/mirofish'), 'abc-123');
  assert.equal(extraerProjectId('/api/formulacion/integral/p9?x=1'), 'p9');
  assert.equal(extraerProjectId('/api/entidades/lookup'), null);
  assert.equal(moduloDeRuta('/api/proyectos/0f8b2c1e-1111-2222-3333-444455556666/viabilidad-ia'), 'viabilidad-ia');
  assert.equal(moduloDeRuta('/api/proyectos/0f8b2c1e-1111-2222-3333-444455556666/anexos/42'), 'anexos');
});

test('5xx → alerta con project_id, módulo, hora y usuario; nunca incluye query string', async () => {
  alertas.length = 0;
  const ok = await alertarErrorServidor(new Error('conexión perdida'), { method: 'POST', path: '/api/proyectos/p1/mirofish?token=secreto', route: 'mirofish', userId: 'u1' }, { ahora: 1_000_000 });
  assert.equal(ok, true);
  const [a] = alertas;
  assert.equal(a.origen, 'API:mirofish');
  assert.equal(a.payload.project_id, 'p1');
  assert.equal(a.payload.modulo, 'mirofish');
  assert.equal(a.payload.user_id, 'u1');
  assert.equal(a.payload.status, 500);
  assert.equal(a.payload.timestamp, new Date(1_000_000).toISOString());
  assert.doesNotMatch(JSON.stringify(a), /secreto/);
});

test('4xx no alerta; la misma falla repetida se avisa 1 vez por minuto', async () => {
  alertas.length = 0;
  const e404 = Object.assign(new Error('no existe'), { status: 404 });
  assert.equal(await alertarErrorServidor(e404, { method: 'GET', path: '/api/x' }), false);
  const ctx = { method: 'GET', path: '/api/proyectos/p2/presupuesto' };
  assert.equal(await alertarErrorServidor(new Error('boom'), ctx, { ahora: 5_000_000 }), true);
  assert.equal(await alertarErrorServidor(new Error('boom'), ctx, { ahora: 5_030_000 }), false, 'repetida a los 30 s');
  assert.equal(await alertarErrorServidor(new Error('boom'), ctx, { ahora: 5_061_000 }), true, 'a los 61 s vuelve a avisar');
  assert.equal(alertas.length, 2);
});

test('la alerta nunca lanza aunque el registro falle', async () => {
  const r = await alertarErrorServidor(new Error('x-unica'), { path: '/api/y' }, { registrar: async () => { throw new Error('bd caída'); } });
  assert.equal(r, false);
});

test('captureError (13 rutas + tryCatch) ahora llega a la alerta aunque no haya SENTRY_DSN', async () => {
  alertas.length = 0;
  captureError(new Error('fallo en ruta capturada'), { route: 'presupuesto', method: 'PUT', path: '/api/proyectos/p7/presupuesto', userId: 'u7' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].payload.project_id, 'p7');
  captureError(Object.assign(new Error('validación'), { status: 400 }), { path: '/api/proyectos/p7/presupuesto' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(alertas.length, 1, 'un 400 no genera alerta');
});

// ── 2. Cola de guardado serializada ──────────────────────────────────────────
function fabricaCola({ fallarEn = new Set(), puedeGuardar } = {}) {
  const estado = { valor: { n: 0 } };
  const base = { current: JSON.stringify({ n: 0 }) };
  const enviados = [];
  let enVuelo = 0, maxEnVuelo = 0, llamada = 0;
  const cola = crearColaGuardado({
    obtener: () => estado.valor,
    base,
    puedeGuardar,
    guardar: async (v) => {
      const esta = ++llamada;
      enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await new Promise(r => setTimeout(r, 15));
      enVuelo--;
      if (fallarEn.has(esta)) throw new Error('HTTP 500');
      enviados.push(v.n);
    },
  });
  return { estado, base, enviados, cola, maxEnVuelo: () => maxEnVuelo };
}

test('cola: nunca 2 escrituras en vuelo y el ÚLTIMO valor gana (sin escrituras viejas al final)', async () => {
  const f = fabricaCola();
  f.estado.valor = { n: 1 };
  const p1 = f.cola.encolar();
  f.estado.valor = { n: 2 };
  const p2 = f.cola.encolar();
  f.estado.valor = { n: 3 };
  const p3 = f.cola.encolar();
  await Promise.all([p1, p2, p3]);
  assert.equal(f.maxEnVuelo(), 1);
  assert.equal(f.enviados[f.enviados.length - 1], 3, 'lo último que llega al servidor es lo más nuevo');
  assert.equal(f.base.current, JSON.stringify({ n: 3 }));
  assert.equal(f.cola.pendiente(), false);
});

test('cola: sin cambios no hay petición; un fallo no marca guardado ni rompe la cola', async () => {
  const f = fabricaCola({ fallarEn: new Set([1]) });
  assert.equal(await f.cola.encolar(), true);
  assert.deepEqual(f.enviados, [], 'valor igual a la base → sin petición');
  f.estado.valor = { n: 5 };
  assert.equal(await f.cola.encolar(), false, 'primer envío falla');
  assert.equal(f.cola.pendiente(), true, 'la base no avanzó');
  assert.equal(await f.cola.encolar(), true, 'el siguiente turno se ejecuta igual');
  assert.deepEqual(f.enviados, [5]);
});

test('cola: puedeGuardar bloquea el AUTOguardado (formulario vacío) pero no el forzado (SAVE manual)', async () => {
  const f = fabricaCola({ puedeGuardar: (v) => v.n !== -1 });
  f.estado.valor = { n: -1 };
  await f.cola.encolar();
  assert.deepEqual(f.enviados, [], 'LIMPIAR no llega al servidor por autoguardado');
  await f.cola.encolar(true);
  assert.deepEqual(f.enviados, [-1], 'SAVE manual sí');
});

// ── 3. Datos mínimos ─────────────────────────────────────────────────────────
test('MIROFISH: exige nombre, ubicación y al menos una línea de presupuesto', () => {
  const completo = { datos: { 'proyecto.nombre': 'Acueducto' }, ubicacion: [{ campo: 'entrada.municipio', valor: 'Argelia' }], lineasPresupuesto: [{ campo: 'apu[1].descripcion', valor: 'Tubería' }] };
  assert.deepEqual(faltantesMirofish(completo), []);
  assert.deepEqual(faltantesMirofish({ datos: { 'proyecto.nombre': 'X' }, ubicacion: [{ valor: '' }, { valor: '  ' }], lineasPresupuesto: [] }).map(f => f.campo), ['ubicacion', 'presupuesto']);
  assert.deepEqual(faltantesMirofish({}).map(f => f.campo), ['proyecto.nombre', 'ubicacion', 'presupuesto']);
});

test('Viabilidad: exige nombre, problema y algún alcance (meta, población o cobertura); anexos NO', () => {
  assert.deepEqual(faltantesViabilidad({ nombre: 'X', problema: 'Sin agua', poblacionAfectada: '320', anexos: [] }), []);
  assert.deepEqual(faltantesViabilidad({ nombre: 'X', problema: 'Sin agua', coberturaGeografica: 'Vereda' }), []);
  assert.deepEqual(faltantesViabilidad({ nombre: 'X' }).map(f => f.campo), ['problema', 'alcance']);
});

test('respuesta 422: código estable y mensaje legible con cada faltante', () => {
  const r = respuesta422('el Comité MIROFISH', faltantesMirofish({ datos: { 'proyecto.nombre': 'X' }, ubicacion: [], lineasPresupuesto: [] }));
  assert.equal(r.success, false);
  assert.equal(r.code, 'DATOS_MINIMOS_INSUFICIENTES');
  assert.match(r.message, /sin gastar cuota de IA/);
  assert.match(r.message, /Municipio del proyecto/);
  assert.match(r.message, /Líneas de presupuesto/);
});
