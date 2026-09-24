/**
 * viabilidadAgent.test.mjs — Lote 6 T1: blindaje forense del dictamen de
 * viabilidad. Toda caída al MODO RESPALDO debe (1) no colapsar, (2) devolver
 * el cálculo heurístico etiquetado y (3) REGISTRAR su causa exacta en el log.
 * Gemini (fetch), pool de llaves, BYOK, logger y FinOps simulados: sin red, sin BD.
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
mock.module(u('utils/logger.js'), { namedExports: { logger: {
  info: () => {}, debug: () => {},
  warn: (m, extra) => logs.push({ nivel: 'warn', m, ...extra }),
  error: (m, extra) => logs.push({ nivel: 'error', m, ...extra }),
} } });

const { calcularViabilidadIA } = await import('../../backend/services/viabilidadAgent.js');

const CTX = { userId: 'u1', problema: 'Déficit de acueducto en la vereda El Mango con 320 familias sin agua potable', metaEsperada: 'Cobertura del 100% en 2027', poblacionAfectada: 320, presupuesto: { total: 412000000 }, anexos: [{ categoria: 'financiero' }], supuestosArbol: [], resultadosCambio: [] };

let ultimoCuerpo = null;
function simularGemini({ status = 200, finish = 'stop', content = '', usage = { prompt_tokens: 900, completion_tokens: 300, total_tokens: 3900 } } = {}) {
  globalThis.fetch = async (_url, init) => {
    ultimoCuerpo = JSON.parse(init.body);
    return { status, ok: status >= 200 && status < 300, text: async () => 'cuerpo de error', json: async () => ({ choices: [{ finish_reason: finish, message: { content } }], usage }) };
  };
}
const ultimoLog = () => logs[logs.length - 1];
const reset = () => { logs.length = 0; tokens.length = 0; geminiCB.keys = ['llave-servidor']; rotacion = async (fn) => fn('llave-servidor'); };

test('JSON cortado (finish_reason: length) → MODO RESPALDO sin colapsar y log con motivo respuesta_truncada', async () => {
  reset();
  simularGemini({ finish: 'length', content: '{"estado_auditoria": "APROBADO_TECNI' });
  const r = await calcularViabilidadIA(CTX);
  assert.equal(r.fuente, 'heuristica');
  assert.equal(r.motivo_respaldo, 'respuesta_truncada');
  assert.equal(typeof r.score_viabilidad, 'number');
  assert.equal(ultimoLog().nivel, 'error');
  assert.equal(ultimoLog().motivo, 'respuesta_truncada');
  assert.equal(ultimoLog().usage.total_tokens, 3900, 'el log conserva el consumo real para diagnóstico');
});

test('la petición sale con max_tokens 8192 y razonamiento acotado (antes 2048)', async () => {
  reset();
  simularGemini({ content: JSON.stringify({ estado_auditoria: 'APROBADO_TECNICAMENTE', score_viabilidad: 81 }) });
  const r = await calcularViabilidadIA(CTX);
  assert.equal(ultimoCuerpo.max_tokens, 8192);
  assert.equal(ultimoCuerpo.reasoning_effort, 'low');
  assert.equal(ultimoCuerpo.response_format.type, 'json_schema', 'el esquema se exige en la API, no solo en el prompt');
  assert.deepEqual(ultimoCuerpo.response_format.json_schema.schema.properties.estado_auditoria.enum, ['APROBADO_TECNICAMENTE', 'OBSERVACION_CRITICA', 'RECHAZADO_INCOHERENCIA']);
  assert.equal(r.fuente, 'gemini-3.6-flash');
  assert.equal(r.motivo_respaldo, undefined);
  assert.equal(logs.length, 0, 'un dictamen real no deja log de respaldo');
  assert.equal(tokens[0].tokensOutput, 3000, 'FinOps: salida real = total − entrada (incluye razonamiento)');
});

test('cuota agotada: antes caía al respaldo EN SILENCIO; ahora deja log warn con motivo', async () => {
  reset();
  rotacion = async () => { throw new GeminiPoolExhaustedError('pool agotado'); };
  const r = await calcularViabilidadIA(CTX);
  assert.equal(r.motivo_respaldo, 'cuota_agotada');
  assert.deepEqual([ultimoLog().nivel, ultimoLog().motivo], ['warn', 'cuota_agotada']);
});

test('cada causa queda identificada: sin llaves, BYOK agotada, 503, JSON inválido, esquema, HTTP', async () => {
  const casos = [
    { prep: () => { geminiCB.keys = []; }, motivo: 'sin_llaves_servidor' },
    { prep: () => {}, byok: ['mi-llave'], motivo: 'USER_KEY_EXHAUSTED' },
    { prep: () => simularGemini({ status: 503 }), motivo: 'modelo_saturado' },
    { prep: () => simularGemini({ content: '{"estado_auditoria": APROBADO_SIN_COMILLAS}' }), motivo: 'json_invalido' },
    { prep: () => simularGemini({ content: '{"estado_auditoria": "INVENTADO", "score_viabilidad": 50}' }), motivo: 'esquema_invalido' },
    { prep: () => simularGemini({ content: 'lo siento, no puedo' }), motivo: 'respuesta_sin_json' },
    { prep: () => simularGemini({ status: 500 }), motivo: 'http_500' },
  ];
  for (const c of casos) {
    reset();
    c.prep();
    const r = await calcularViabilidadIA(CTX, c.byok ?? null);
    assert.equal(r.fuente, 'heuristica', c.motivo);
    assert.equal(r.motivo_respaldo, c.motivo);
    assert.equal(ultimoLog().motivo, c.motivo, `log de ${c.motivo}`);
  }
});
