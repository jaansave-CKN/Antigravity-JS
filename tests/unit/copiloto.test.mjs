/**
 * copiloto.test.mjs — Co-Piloto sobre la capa única de IA.
 * Lote 7: una respuesta cortada se entrega MARCADA, nunca como completa.
 * B1 (2026-09-28, regla de oro): se eliminó el "Modo Respaldo" (texto fijo
 * guardado en el historial como turno del modelo) — sin IA, LANZA y no se
 * guarda nada. La cascada se prueba en llmProveedor.test.mjs.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class IaNoDisponibleError extends Error { constructor() { super('sin IA'); this.status = 503; this.code = 'IA_NO_DISPONIBLE'; } }
let generar = async () => ({ texto: 'Respuesta del co-piloto.', modelo: 'anthropic/claude-sonnet-5', proveedor: 'openrouter', truncada: false });
let ultimaPeticion = null;
const inserts = [];
const logs = [];

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
mock.module(u('services/llmProveedor.js'), { namedExports: {
  generarConIA: async (p) => { ultimaPeticion = p; return generar(p); },
} });
mock.module(u('services/ValorExponencialService.js'), { namedExports: { SMMLV_2026_COP: 1750905 } });
mock.module(u('config/database.config.js'), { namedExports: {
  withTenant: async (orgId, cb) => cb({ query: async (sql, params) => { if (/INSERT INTO project_chat_history/.test(sql)) inserts.push(params); return { rows: [] }; } }),
} });
mock.module(u('utils/logger.js'), { namedExports: { logger: {
  info: () => {}, debug: () => {}, error: () => {},
  warn: (m, extra) => logs.push({ m, ...extra }),
} } });

const { llamarIA, chatConCopiloto, AVISO_RESPUESTA_CORTADA } = await import('../../backend/services/CopilotoService.js');

const MSGS = [{ role: 'system', content: 'Eres el co-piloto' }, { role: 'user', content: '¿Cómo va el presupuesto?' }];

test('respuesta normal: pasa por la capa única con agente copiloto y permitirTruncado', async () => {
  const r = await llamarIA(MSGS, 'u1');
  assert.deepEqual(r, { texto: 'Respuesta del co-piloto.', modelo: 'anthropic/claude-sonnet-5', truncada: false });
  assert.deepEqual([ultimaPeticion.userId, ultimaPeticion.agente, ultimaPeticion.permitirTruncado], ['u1', 'copiloto', true]);
});

test('respuesta cortada: se entrega MARCADA como incompleta y se registra', async () => {
  generar = async () => ({ texto: 'El presupuesto total es de $412.000.000 y la línea de', modelo: 'gemini-3.6-flash', proveedor: 'gemini_servidor', truncada: true });
  const r = await llamarIA(MSGS, 'u1');
  assert.equal(r.truncada, true);
  assert.ok(r.texto.endsWith(AVISO_RESPUESTA_CORTADA), 'el usuario ve que la respuesta está incompleta');
  assert.equal(logs.at(-1).modelo, 'gemini-3.6-flash');
});

test('chat: guarda los dos turnos y `fuente` es el modelo que respondió (B7), con roles traducidos', async () => {
  inserts.length = 0;
  generar = async () => ({ texto: 'Todo en orden.', modelo: 'anthropic/claude-sonnet-5', proveedor: 'openrouter', truncada: false });
  const r = await chatConCopiloto('p1', 'u1', { mensaje: 'Hola', moduloActivo: 'Anexos' });
  assert.deepEqual(r, { respuesta: 'Todo en orden.', fuente: 'anthropic/claude-sonnet-5' });
  assert.equal(inserts.length, 1);
  assert.deepEqual([inserts[0][2], inserts[0][4]], ['Hola', 'Todo en orden.']);
});

test('REGLA DE ORO: sin IA disponible LANZA y NO guarda nada en el historial (antes guardaba un texto fijo)', async () => {
  inserts.length = 0;
  generar = async () => { throw new IaNoDisponibleError(); };
  await assert.rejects(chatConCopiloto('p1', 'u1', { mensaje: 'Hola' }), (e) => e.status === 503 && e.code === 'IA_NO_DISPONIBLE');
  assert.equal(inserts.length, 0);
});
