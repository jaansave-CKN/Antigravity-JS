/**
 * copiloto.test.mjs — Lote 7: blindaje del Co-Piloto (texto libre).
 * Una respuesta cortada ya no se entrega como si estuviera completa, y toda
 * caída al Modo Respaldo registra su causa exacta. Gemini (fetch), pool de
 * llaves, BYOK, BD, logger y FinOps simulados: sin red, sin BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class GeminiPoolExhaustedError extends Error {}
class UserKeyPoolExhaustedError extends Error { constructor() { super('agotada'); this.code = 'USER_KEY_EXHAUSTED'; } }
const geminiCB = { keys: ['llave-servidor'] };
let rotacion = async (fn) => fn('llave-servidor');
const logs = [];
const tokens = [];

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
mock.module(u('services/geminiCircuitBreaker.js'), { namedExports: {
  geminiCB, GeminiPoolExhaustedError,
  isQuotaError: (e) => /429|quota|rate.?limit/i.test(e?.message || ''),
  withKeyRotation: (fn) => rotacion(fn),
} });
mock.module(u('services/byokService.js'), { namedExports: { UserKeyPoolExhaustedError, withUserKeyRotation: async () => { throw new UserKeyPoolExhaustedError(); } } });
mock.module(u('services/aiTokenLogger.js'), { namedExports: { logTokenUsage: async (t) => { tokens.push(t); } } });
mock.module(u('services/ValorExponencialService.js'), { namedExports: { SMMLV_2026_COP: 1750905 } });
mock.module(u('config/database.config.js'), { namedExports: { withTenant: async () => ({ rows: [] }) } });
mock.module(u('utils/logger.js'), { namedExports: { logger: {
  info: () => {}, debug: () => {},
  warn: (m, extra) => logs.push({ nivel: 'warn', m, ...extra }),
  error: (m, extra) => logs.push({ nivel: 'error', m, ...extra }),
} } });

const { llamarGemini, AVISO_RESPUESTA_CORTADA } = await import('../../backend/services/CopilotoService.js');

const MSGS = [{ role: 'system', content: 'Eres el co-piloto' }, { role: 'user', content: '¿Cómo va el presupuesto?' }];
let ultimoCuerpo = null;
function simularGemini({ status = 200, finish = 'stop', content = 'Respuesta del co-piloto.', usage = { prompt_tokens: 500, completion_tokens: 200, total_tokens: 1700 } } = {}) {
  globalThis.fetch = async (_url, init) => {
    ultimoCuerpo = JSON.parse(init.body);
    return { status, ok: status >= 200 && status < 300, text: async () => 'cuerpo', json: async () => ({ choices: [{ finish_reason: finish, message: { content } }], usage }) };
  };
}
const reset = () => { logs.length = 0; tokens.length = 0; geminiCB.keys = ['llave-servidor']; rotacion = async (fn) => fn('llave-servidor'); };
const ultimoLog = () => logs[logs.length - 1];

test('respuesta normal: sale con max_tokens 8192 y razonamiento acotado (antes 1024); FinOps con razonamiento', async () => {
  reset();
  simularGemini();
  const r = await llamarGemini(MSGS, 'u1', null);
  assert.deepEqual(r, { texto: 'Respuesta del co-piloto.', motivo: null });
  assert.equal(ultimoCuerpo.max_tokens, 8192);
  assert.equal(ultimoCuerpo.reasoning_effort, 'low');
  assert.equal(tokens[0].tokensOutput, 1200, 'salida real = total − entrada');
  assert.equal(logs.length, 0);
});

test('respuesta cortada (finish_reason: length): se entrega MARCADA como incompleta y se registra', async () => {
  reset();
  simularGemini({ finish: 'length', content: 'El presupuesto total es de $412.000.000 y la línea de' });
  const r = await llamarGemini(MSGS, 'u1', null);
  assert.equal(r.truncada, true);
  assert.ok(r.texto.endsWith(AVISO_RESPUESTA_CORTADA), 'el usuario ve que la respuesta está incompleta');
  assert.deepEqual([ultimoLog().nivel, ultimoLog().motivo], ['warn', 'respuesta_truncada']);
});

test('cuota agotada: antes caía al Modo Respaldo EN SILENCIO; ahora deja log con motivo', async () => {
  reset();
  rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado'); };
  const r = await llamarGemini(MSGS, 'u1', null);
  assert.deepEqual(r, { texto: null, motivo: 'cuota_agotada' });
  assert.deepEqual([ultimoLog().nivel, ultimoLog().motivo], ['warn', 'cuota_agotada']);
});

test('cada causa de respaldo queda identificada y registrada', async () => {
  const casos = [
    { prep: () => { geminiCB.keys = []; }, motivo: 'sin_llaves_servidor' },
    { prep: () => {}, byok: ['mi-llave'], motivo: 'USER_KEY_EXHAUSTED' },
    { prep: () => simularGemini({ status: 503 }), motivo: 'modelo_saturado' },
    { prep: () => simularGemini({ content: '   ' }), motivo: 'respuesta_vacia' },
    { prep: () => simularGemini({ status: 400 }), motivo: 'http_400' },
  ];
  for (const c of casos) {
    reset();
    c.prep();
    const r = await llamarGemini(MSGS, 'u1', c.byok ?? null);
    assert.equal(r.texto, null, c.motivo);
    assert.equal(r.motivo, c.motivo);
    assert.equal(ultimoLog().motivo, c.motivo, `log de ${c.motivo}`);
  }
});
