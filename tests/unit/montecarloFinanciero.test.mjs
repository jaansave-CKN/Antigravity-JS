/**
 * montecarloFinanciero.test.mjs — F-06: motor puro de VAN/TIR (sin BD ni red).
 * Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simularVanTir, tir, MontecarloError, TASA_SOCIAL_DESCUENTO } from '../../backend/services/montecarloFinanciero.js';

const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('beneficio fijo (min=probable=max): VAN = fórmula cerrada de anualidad y sin dispersión', () => {
  const I = 1_000_000_000, B = 200_000_000, n = 10;
  const r = simularVanTir({ inversionCop: I, beneficioMin: B, beneficioProbable: B, beneficioMax: B, horizonteAnios: n, semilla: 7 });
  const esperado = -I + B * (1 - Math.pow(1 + TASA_SOCIAL_DESCUENTO, -n)) / TASA_SOCIAL_DESCUENTO;
  cerca(r.van_escenario_probable_cop, esperado, 0.01, 'VAN determinista');
  for (const k of ['media_cop', 'p10_cop', 'p50_cop', 'p90_cop']) cerca(r.van[k], esperado, 0.01, `VAN ${k}`);
  assert.equal(r.histograma_van.length, 1, 'un solo bin cuando no hay dispersión');
  assert.equal(r.probabilidad_van_positivo, 1);
  assert.equal(r.moneda, 'COP');
  assert.equal(r.tasa_descuento, 0.12);
});

test('TIR conocida: -100 y +112 en un año → 12%; flujo sin recuperación → null', () => {
  cerca(tir(100, [112]), 0.12, 1e-7, 'TIR 1 año');
  cerca(tir(1000, [100, 100, 100, 100, 1100]), 0.10, 1e-7, 'TIR bono 10%');
  assert.equal(tir(100, [0, 0, 0]), null);
});

test('misma semilla → mismo resultado exacto; otra semilla → distinto', () => {
  const base = { inversionCop: 5e9, beneficioMin: 3e8, beneficioProbable: 7e8, beneficioMax: 1.2e9, horizonteAnios: 15 };
  const a = simularVanTir({ ...base, semilla: 12345 });
  const b = simularVanTir({ ...base, semilla: 12345 });
  const c = simularVanTir({ ...base, semilla: 999 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.van, c.van);
  assert.ok(a.van.p10_cop < a.van.p50_cop && a.van.p50_cop < a.van.p90_cop, 'percentiles ordenados');
  assert.ok(a.tir.p10 <= a.tir.p50 && a.tir.p50 <= a.tir.p90, 'TIR ordenada');
  assert.equal(a.histograma_van.reduce((s, h) => s + h.frecuencia, 0), 10000, 'el histograma suma todas las iteraciones');
});

test('validaciones → MontecarloError 422, nunca un resultado inventado', () => {
  const ok = { inversionCop: 1e9, beneficioMin: 1e8, beneficioProbable: 2e8, beneficioMax: 3e8, horizonteAnios: 10, semilla: 1 };
  const casos = [
    { beneficioMin: 3e8, beneficioProbable: 2e8 },
    { horizonteAnios: 0 }, { horizonteAnios: 51 }, { horizonteAnios: 2.5 },
    { inversionCop: 0 }, { beneficioMax: -1 }, { beneficioMax: 2e15 },
    { beneficioProbable: NaN }, { iteraciones: 10001 }, { semilla: -1 },
  ];
  for (const c of casos) {
    assert.throws(() => simularVanTir({ ...ok, ...c }), (e) => e instanceof MontecarloError && e.status === 422, JSON.stringify(c));
  }
});

test('peor caso (10.000 iteraciones × 50 años) termina en menos de 3 s', () => {
  const t0 = Date.now();
  simularVanTir({ inversionCop: 1e15, beneficioMin: 0, beneficioProbable: 5e13, beneficioMax: 1e15, horizonteAnios: 50, semilla: 3 });
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `tardó ${ms} ms`);
});
