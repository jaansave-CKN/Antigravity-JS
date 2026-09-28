/**
 * apuArbol.test.mjs — regresión de F-02 y F-03 (auditoría V3, 2026-09-23).
 *   F-03: el AIU combinado aplicado debe ser exactamente el pedido.
 *   F-02: sin IA disponible, generarArbolConIA lanza 503 — nunca devuelve
 *         un árbol de demostración fabricado.
 * B1 (2026-09-28): la capa única de IA (llmProveedor) se simula con
 * mock.module — su cascada tiene su propio test. Sin red ni BD.
 *
 * Ejecutar: npm run test:unit   (requiere Node >= 22.3 por mock.module)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class IaNoDisponibleError extends Error { constructor() { super('sin IA'); this.status = 503; this.code = 'IA_NO_DISPONIBLE'; } }
class IaTopeAgotadoError extends Error { constructor(retryAt) { super('Alcanzaste el tope diario de uso de IA de tu cuenta.'); this.status = 429; this.code = 'IA_TOPE_AGOTADO'; this.retryAt = retryAt; } }
class LlmLoopGuardError extends Error {}
let generar = async () => { throw new IaNoDisponibleError(); };
let ultimaPeticion = null;

const svc = (f) => new URL(`../../backend/services/${f}`, import.meta.url).href;
mock.module(svc('llmProveedor.js'), { namedExports: {
  IaNoDisponibleError, IaTopeAgotadoError,
  generarConIA: async (p) => { ultimaPeticion = p; return generar(p); },
} });
mock.module(svc('geminiCircuitBreaker.js'), { namedExports: { LlmLoopGuardError } });

const { calcularAPU } = await import('../../backend/pipeline/apuEngine.js');
const { generarArbolConIA, ArbolIANoDisponibleError, parsearNodosArbol } = await import('../../backend/agents/arbolObjetivosAgent.js');

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

test('F-02: ningún proveedor de IA responde → 503 IA_NO_DISPONIBLE, sin árbol fabricado', async () => {
  generar = async () => { throw new IaNoDisponibleError(); };
  await assert.rejects(generarArbolConIA('Objetivo real', 'u1'),
    (e) => e instanceof ArbolIANoDisponibleError && e.status === 503 && e.code === 'IA_NO_DISPONIBLE');
});

test('F-02: tope de gasto del usuario agotado → 429 IA_TOPE_AGOTADO con retryAt, sin árbol fabricado', async () => {
  const manana = new Date('2026-09-29T05:00:00Z');
  generar = async () => { throw new IaTopeAgotadoError(manana); };
  await assert.rejects(generarArbolConIA('Objetivo real', 'u1'),
    (e) => e instanceof ArbolIANoDisponibleError && e.status === 429 && e.code === 'IA_TOPE_AGOTADO' && e.retryAt === manana);
});

test('B1: pide json_object, sanea el objetivo y valida los nodos antes de aceptarlos', async () => {
  generar = async (p) => ({ valor: p.validar('{"nodos":[{"tipo":"CENTRAL","nivel":0,"texto":"t","parentIndex":null}]}'), proveedor: 'openrouter', modelo: 'anthropic/claude-sonnet-5' });
  const nodos = await generarArbolConIA('Objetivo "con" `comillas`\n\n\nx', 'u1');
  assert.equal(nodos.length, 1);
  assert.deepEqual([ultimaPeticion.userId, ultimaPeticion.agente, ultimaPeticion.responseFormat.type], ['u1', 'arbol_objetivos', 'json_object']);
  assert.doesNotMatch(ultimaPeticion.messages[1].content.split('\n').slice(1).join('\n'), /`/, 'sin delimitadores de inyección');
  assert.throws(() => parsearNodosArbol('{"nodos":[]}'), /vacío/);
  assert.throws(() => parsearNodosArbol('texto sin json'), /JSON/);
});
