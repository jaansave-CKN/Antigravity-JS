/**
 * bunkerApis.test.mjs — Búnker de Conexiones (2026-09-28): interruptores de IA
 * (iaFlags.js) y diagnóstico sin costo de proveedores (apisEstado.js).
 * BD inyectada y proveedores simulados: sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
const sim = { or: { activo: true }, saldo: async () => ({ saldoUsd: 5 }), saldoLlamadas: 0 };
mock.module(u('services/llmProveedor.js'), { namedExports: { estadoOpenRouter: (env, ahora, flags) => sim.or } });
mock.module(u('services/openRouterCliente.js'), { namedExports: {
  consultarSaldoOpenRouter: async () => { sim.saldoLlamadas++; return sim.saldo(); },
} });
mock.module(u('utils/logger.js'), { namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } } });

const F = await import('../../backend/services/iaFlags.js');
const { estadoApis, _reiniciarApisEstado } = await import('../../backend/services/apisEstado.js');

function bdFalsa(valores = {}) {
  const bd = { valores: { ...valores }, lecturas: 0, falla: false, fallaEscritura: false,
    getRow: async (sql, [clave]) => { bd.lecturas++; if (bd.falla) throw new Error('BD caída'); return clave in bd.valores ? { value: bd.valores[clave] } : null; },
    runSql: async (sql, params) => {
      if (bd.fallaEscritura) throw new Error('escritura falló');
      if (/^UPDATE/.test(sql)) { const clave = params[2]; if (!(clave in bd.valores)) return { rowCount: 0 }; bd.valores[clave] = params[0]; return { rowCount: 1 }; }
      bd.valores[params[0]] = params[1]; return { rowCount: 1 };
    } };
  return bd;
}

test('sin configurar (tests/scripts): todo habilitado y cero E/S', async () => {
  F._reiniciarFlagsIA();
  assert.deepEqual(await F.leerFlagsIA(), { openrouter: true, nvidia: true });
  await assert.rejects(F.fijarFlagIA('openrouter', false), /sin configurar/);
});

test("solo el texto exacto 'false' deshabilita; ausente u otro valor = habilitado", async () => {
  F._reiniciarFlagsIA();
  F.configurarFlagsIA(bdFalsa({ ia_flag_openrouter: 'false', ia_flag_nvidia: 'FALSE' }));
  assert.deepEqual(await F.leerFlagsIA(), { openrouter: false, nvidia: true });
});

test('caché de 15 s y una sola lectura en vuelo ante llamadas concurrentes', async () => {
  F._reiniciarFlagsIA();
  const bd = bdFalsa();
  F.configurarFlagsIA(bd);
  await Promise.all([F.leerFlagsIA(), F.leerFlagsIA(), F.leerFlagsIA()]);
  assert.equal(bd.lecturas, 2, 'una pasada (2 claves) aunque hubo 3 llamadas');
  await F.leerFlagsIA();
  assert.equal(bd.lecturas, 2, 'dentro del TTL no vuelve a leer');
  await F.leerFlagsIA(Date.now() + 16_000);
  assert.equal(bd.lecturas, 4, 'vencido el TTL, relee');
});

test('BD caída al leer: conserva el ÚLTIMO valor conocido (no vuelve al defecto)', async () => {
  F._reiniciarFlagsIA();
  const bd = bdFalsa({ ia_flag_openrouter: 'false' });
  F.configurarFlagsIA(bd);
  assert.equal((await F.leerFlagsIA()).openrouter, false);
  bd.falla = true;
  assert.equal((await F.leerFlagsIA(Date.now() + 16_000)).openrouter, false);
  assert.equal(F.flagsIACacheados().openrouter, false);
});

test('fijarFlagIA: UPDATE→INSERT, relee y actualiza la caché; si no persiste, LANZA y no cambia la caché', async () => {
  F._reiniciarFlagsIA();
  const bd = bdFalsa();
  F.configurarFlagsIA(bd);
  assert.equal(await F.fijarFlagIA('nvidia', false), false);
  assert.equal(bd.valores.ia_flag_nvidia, 'false');
  assert.equal(F.flagsIACacheados().nvidia, false);
  bd.fallaEscritura = true;
  await assert.rejects(F.fijarFlagIA('nvidia', true));
  assert.equal(F.flagsIACacheados().nvidia, false, 'la caché no cambia si la escritura falló');
  await assert.rejects(F.fijarFlagIA('tavily', true), /sin interruptor/);
});

test('apisEstado: saldo negativo → sin_saldo (con el número redondeado); sin llave → faltante; Tavily no integrado', async () => {
  F._reiniciarFlagsIA(); _reiniciarApisEstado();
  sim.saldo = async () => ({ saldoUsd: -0.16 });
  const r = await estadoApis({ env: { OPENROUTER_API_KEY: 'sk-or-x', NVIDIA_API_KEY: '' } });
  assert.deepEqual(r.openrouter, { configurada: true, habilitada: true, flagDisponible: true, saldoUsd: -0.16, estado: 'sin_saldo' });
  assert.deepEqual(r.nvidia, { configurada: false, habilitada: true, flagDisponible: true, estado: 'faltante' });
  assert.deepEqual(r.tavily, { integrado: false, estado: 'no_integrado' });
  const sinLlave = await estadoApis({ env: {} });
  assert.equal(sinLlave.openrouter.estado, 'faltante');
});

test('apisEstado: nunca expone la llave; 401 → llave_rechazada; red caída → saldo_no_verificable; caché de 60 s', async () => {
  F._reiniciarFlagsIA(); _reiniciarApisEstado();
  sim.saldo = async () => { const e = new Error('x'); e.motivo = 'llave_rechazada'; throw e; };
  const r = await estadoApis({ env: { OPENROUTER_API_KEY: 'sk-or-SECRETO', NVIDIA_API_KEY: 'nvapi-SECRETO' } });
  assert.equal(r.openrouter.estado, 'llave_rechazada');
  assert.doesNotMatch(JSON.stringify(r), /SECRETO|sk-or|nvapi/);
  _reiniciarApisEstado();
  sim.saldo = async () => { throw new Error('ECONNRESET'); };
  sim.saldoLlamadas = 0;
  assert.equal((await estadoApis({ env: { OPENROUTER_API_KEY: 'k' } })).openrouter.estado, 'saldo_no_verificable');
  await estadoApis({ env: { OPENROUTER_API_KEY: 'k' } });
  assert.equal(sim.saldoLlamadas, 1, 'el error también se cachea: una llamada por minuto como máximo');
});

test('apisEstado: con saldo, el resto lo decide estadoOpenRouter (sin tope → sin_tope) y el interruptor apagado viaja en habilitada', async () => {
  F._reiniciarFlagsIA(); _reiniciarApisEstado();
  sim.saldo = async () => ({ saldoUsd: 12.5 });
  sim.or = { activo: false, motivo: 'sin_tope_configurado' };
  F.configurarFlagsIA(bdFalsa({ ia_flag_openrouter: 'false' }));
  const r = await estadoApis({ env: { OPENROUTER_API_KEY: 'k' } });
  assert.deepEqual([r.openrouter.estado, r.openrouter.habilitada, r.openrouter.saldoUsd], ['sin_tope', false, 12.5]);
  sim.or = { activo: true };
  F._reiniciarFlagsIA();
});
