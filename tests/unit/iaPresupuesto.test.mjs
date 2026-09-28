/**
 * iaPresupuesto.test.mjs — B1 (2026-09-28): tope de gasto de IA por usuario,
 * persistido en Postgres (no en RAM: Render reinicia la instancia).
 * withTenant se simula con un cliente pg falso que registra cada SQL: sin BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;

const bd = {};
const reiniciar = () => Object.assign(bd, {
  sqls: [], rest: false, fallar: null,
  gasto: { dia: 0, mes: 0 }, topeUsuario: null,
  inicioDia: new Date('2026-09-28T05:00:00Z'), inicioMes: new Date('2026-09-01T05:00:00Z'),
});
function clienteFalso() {
  const c = {
    query: async (sql, params = []) => {
      bd.sqls.push({ sql, params });
      if (bd.fallar) throw new Error(bd.fallar);
      if (/date_trunc\('day'/.test(sql)) return { rows: [{ inicio_dia: bd.inicioDia, inicio_mes: bd.inicioMes }] };
      if (/FROM ai_consumo_usuario/.test(sql) && /SUM/.test(sql)) return { rows: [bd.gasto] };
      if (/FROM ai_tope_usuario/.test(sql)) return { rows: bd.topeUsuario ? [bd.topeUsuario] : [] };
      if (/^\s*INSERT INTO ai_consumo_usuario/.test(sql)) return { rows: [{ id: 'reserva-1' }] };
      return { rows: [] };
    },
  };
  if (bd.rest) c._tenantId = 'u1'; // el fakeClient REST de database.config.js lleva _tenantId
  return c;
}
mock.module(u('config/database.config.js'), { namedExports: {
  withTenant: async (tenantId, cb) => cb(clienteFalso()),
} });

const {
  configPresupuesto, estimarReservaUsd, costoRealUsd, reservar, liquidar, liberar, estadoPresupuesto,
  IaTopeAgotadoError, PresupuestoNoVerificableError,
} = await import('../../backend/services/iaPresupuesto.js');

const CFG = configPresupuesto({ LLM_TOPE_USD_DIA: '1', LLM_TOPE_USD_MES: '10' });

test('configuración: sin topes no hay presupuesto (falla cerrado); precios por defecto verificados de claude-sonnet-5', () => {
  const sin = configPresupuesto({});
  assert.equal(sin.ok, false);
  assert.deepEqual(sin.faltante, ['LLM_TOPE_USD_DIA', 'LLM_TOPE_USD_MES']);
  assert.deepEqual([CFG.ok, CFG.topeDia, CFG.topeMes, CFG.precioIn, CFG.precioOut], [true, 1, 10, 2, 10]);
  assert.equal(configPresupuesto({ LLM_TOPE_USD_DIA: '0', LLM_TOPE_USD_MES: '5' }).ok, false, 'un tope 0 o inválido no cuenta como configurado');
});

test('reserva = peor caso (entrada estimada + TODO max_tokens de salida); costo real prefiere usage.cost', () => {
  const msgs = [{ role: 'user', content: 'x'.repeat(300) }];
  assert.equal(estimarReservaUsd(msgs, 8192, CFG), (100 * 2 + 8192 * 10) / 1_000_000);
  assert.equal(costoRealUsd({ prompt_tokens: 1000, completion_tokens: 500 }, 0.0042, CFG), 0.0042);
  assert.equal(costoRealUsd({ prompt_tokens: 1000, completion_tokens: 500 }, null, CFG), (1000 * 2 + 500 * 10) / 1_000_000);
});

test('reservar: lock de TRANSACCIÓN (compatible con el pooler :6543), sin SET de sesión, org_id explícito', async () => {
  reiniciar();
  const id = await reservar({ userId: 'u1', agente: 'viabilidad', modelo: 'anthropic/claude-sonnet-5', reservaUsd: 0.08 }, CFG);
  assert.equal(id, 'reserva-1');
  const todo = bd.sqls.map(s => s.sql).join('\n');
  assert.match(todo, /pg_advisory_xact_lock\(hashtext\('ia_tope:' \|\| \$1\)\)/);
  assert.doesNotMatch(todo, /pg_advisory_lock\(/, 'nunca lock de sesión');
  assert.doesNotMatch(todo, /^\s*SET\s/im, 'nunca SET de sesión');
  assert.ok(bd.sqls.filter(s => /ai_consumo_usuario|ai_tope_usuario/.test(s.sql)).every(s => /org_id = \$1|VALUES \(\$1/.test(s.sql) && s.params[0] === 'u1'));
  const insert = bd.sqls.find(s => /INSERT INTO ai_consumo_usuario/.test(s.sql));
  assert.deepEqual(insert.params, ['u1', 'viabilidad', 'anthropic/claude-sonnet-5', 0.08]);
});

test('tope diario: gasto + reserva por encima → IaTopeAgotadoError 429 con renovación a medianoche de Bogotá, sin INSERT', async () => {
  reiniciar();
  bd.gasto = { dia: 0.95, mes: 3 };
  await assert.rejects(reservar({ userId: 'u1', agente: 'x', modelo: 'm', reservaUsd: 0.08 }, CFG), (e) => {
    assert.ok(e instanceof IaTopeAgotadoError);
    assert.deepEqual([e.status, e.code, e.periodo], [429, 'IA_TOPE_AGOTADO', 'dia']);
    assert.equal(e.retryAt.toISOString(), '2026-09-29T05:00:00.000Z');
    return true;
  });
  assert.equal(bd.sqls.some(s => /INSERT/.test(s.sql)), false);
});

test('tope mensual: se renueva el primer día del mes siguiente (hora Colombia)', async () => {
  reiniciar();
  bd.gasto = { dia: 0, mes: 9.95 };
  await assert.rejects(reservar({ userId: 'u1', agente: 'x', modelo: 'm', reservaUsd: 0.08 }, CFG),
    (e) => e.periodo === 'mes' && e.retryAt.toISOString() === '2026-10-01T05:00:00.000Z');
});

test('tope propio del usuario (ai_tope_usuario) reemplaza el del entorno', async () => {
  reiniciar();
  bd.gasto = { dia: 0.95, mes: 3 };
  bd.topeUsuario = { tope_usd_dia: '5', tope_usd_mes: null };
  assert.equal(await reservar({ userId: 'u1', agente: 'x', modelo: 'm', reservaUsd: 0.08 }, CFG), 'reserva-1');
});

test('falla CERRADO: sin tope, en modo REST degradado o con error de BD → PresupuestoNoVerificableError', async () => {
  reiniciar();
  await assert.rejects(reservar({ userId: 'u1', agente: 'x', modelo: 'm', reservaUsd: 0.08 }, configPresupuesto({})), PresupuestoNoVerificableError);
  bd.rest = true;
  await assert.rejects(reservar({ userId: 'u1', agente: 'x', modelo: 'm', reservaUsd: 0.08 }, CFG), PresupuestoNoVerificableError);
  reiniciar();
  bd.fallar = 'relation "ai_consumo_usuario" does not exist';
  await assert.rejects(reservar({ userId: 'u1', agente: 'x', modelo: 'm', reservaUsd: 0.08 }, CFG), PresupuestoNoVerificableError);
});

test('liquidar/liberar solo tocan reservas abiertas del propio usuario y nunca lanzan', async () => {
  reiniciar();
  await liquidar('u1', 'reserva-1', { costoUsd: 0.003, tokensIn: 10, tokensOut: 5, modelo: 'm' }, { error: () => {} });
  await liberar('u1', 'reserva-2', { error: () => {} });
  for (const s of bd.sqls) {
    assert.match(s.sql, /WHERE id = \$1 AND org_id = \$2 AND estado = 'reservado'/);
    assert.equal(s.params[1], 'u1');
  }
  bd.fallar = 'conexión perdida';
  const errores = [];
  await liquidar('u1', 'r', { costoUsd: 1 }, { error: (m) => errores.push(m) });
  assert.equal(errores.length, 1, 'el fallo queda en el log; la reserva sigue contando');
});

test('estadoPresupuesto (para /api/ia/estado-cuota): agotado solo si ya no cabe ni una llamada mínima', async () => {
  reiniciar();
  assert.deepEqual(await estadoPresupuesto('u1', CFG), { agotado: false, retryAt: null });
  bd.gasto = { dia: 0.995, mes: 1 };
  const e = await estadoPresupuesto('u1', CFG);
  assert.equal(e.agotado, true);
  assert.equal(await estadoPresupuesto('u1', configPresupuesto({})), null, 'sin tope: no verificable');
});
