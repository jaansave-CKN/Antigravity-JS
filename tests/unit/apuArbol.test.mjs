/**
 * apuArbol.test.mjs — regresión de F-02 y F-03 (auditoría V3, 2026-09-23).
 *   F-03: el AIU combinado aplicado debe ser exactamente el pedido.
 *   F-02: sin IA del servidor, generarArbolConIA lanza 503 — nunca devuelve
 *         un árbol de demostración fabricado.
 * Gemini, BYOK y el logger de tokens se simulan con mock.module: ningún caso
 * llama a la red ni a la BD.
 *
 * Ejecutar: npm run test:unit   (requiere Node >= 22.3 por mock.module)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class GeminiPoolExhaustedError extends Error {}
class UserKeyPoolExhaustedError extends Error {}
const geminiCB = { keys: [] };

const svc = (f) => new URL(`../../backend/services/${f}`, import.meta.url).href;
mock.module(svc('geminiCircuitBreaker.js'), {
  namedExports: {
    geminiCB,
    GeminiPoolExhaustedError,
    isQuotaError: () => false,
    withKeyRotation: async () => { throw new GeminiPoolExhaustedError('pool agotado'); },
  },
});
mock.module(svc('byokService.js'), {
  namedExports: { UserKeyPoolExhaustedError, withUserKeyRotation: async () => { throw new Error('no debe llamarse'); } },
});
mock.module(svc('aiTokenLogger.js'), { namedExports: { logTokenUsage: async () => {} } });

const { calcularAPU } = await import('../../backend/pipeline/apuEngine.js');
const { generarArbolConIA, ArbolIANoDisponibleError } = await import('../../backend/agents/arbolObjetivosAgent.js');

const item = (aiu) => ({
  cantidad: 1, rendimiento_real: 1, rendimiento_std: 'descapote', costo_jornal_dia: 0,
  materiales: [{ cantidad: 1, precio_unitario: 1_000_000 }], aiu,
});

test('F-03: el AIU aplicado es exactamente el pedido (antes 0.30→0.29 y 0.33→0.34)', async () => {
  for (const aiu of [0, 0.25, 0.28, 0.3, 0.32, 0.33, 0.35, 0.4, 0.275]) {
    const r = await calcularAPU(item(aiu));
    assert.equal(r.valor_total, Math.round(1_000_000 * (1 + aiu) * 100) / 100, `aiu ${aiu}`);
    assert.equal(Math.round((r.aiu_administracion + r.aiu_imprevistos + r.aiu_utilidad) * 10000) / 10000, aiu, `suma de componentes aiu ${aiu}`);
  }
});

test('F-03: el AIU por defecto (0.28) conserva la partición 20/3/5', async () => {
  const r = await calcularAPU(item(0.28));
  assert.deepEqual([r.aiu_administracion, r.aiu_imprevistos, r.aiu_utilidad], [0.2, 0.03, 0.05]);
});

test('F-02: sin llaves del servidor → 503 IA_CUOTA_AGOTADA, sin árbol fabricado', async () => {
  geminiCB.keys = [];
  await assert.rejects(generarArbolConIA('Objetivo real', [], 'u1'),
    (e) => e instanceof ArbolIANoDisponibleError && e.status === 503 && e.code === 'IA_CUOTA_AGOTADA');
});

test('F-02: pool del servidor agotado → 503 IA_CUOTA_AGOTADA, sin árbol fabricado', async () => {
  geminiCB.keys = ['llave-falsa'];
  await assert.rejects(generarArbolConIA('Objetivo real', [], 'u1'),
    (e) => e instanceof ArbolIANoDisponibleError && e.status === 503);
});
