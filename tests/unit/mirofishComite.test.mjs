/**
 * mirofishComite.test.mjs — F-09: IA adversarial MIROFISH sin red ni BD.
 * Cubre la validación anti-alucinación y los motivos de "no disponible"
 * (nunca un resultado fabricado). Gemini/BYOK/logger simulados.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class GeminiPoolExhaustedError extends Error {}
class UserKeyPoolExhaustedError extends Error { constructor() { super('agotada'); this.code = 'USER_KEY_EXHAUSTED'; } }
const geminiCB = { keys: [] };
let comportamiento = async () => { throw new Error('no configurado'); };

const svc = (f) => new URL(`../../backend/services/${f}`, import.meta.url).href;
mock.module(svc('geminiCircuitBreaker.js'), { namedExports: {
  geminiCB, GeminiPoolExhaustedError, isQuotaError: () => false,
  withKeyRotation: async (fn) => comportamiento(fn),
} });
mock.module(svc('byokService.js'), { namedExports: {
  UserKeyPoolExhaustedError, withUserKeyRotation: async () => { throw new UserKeyPoolExhaustedError(); },
} });
mock.module(svc('aiTokenLogger.js'), { namedExports: { logTokenUsage: async () => {} } });

const { evaluarComiteIA, validarHallazgosIA } = await import('../../backend/services/mirofishComite.js');

const DATOS = { 'tramo[02].estado_via': 'Destapada', 'tramo[02].distancia_km': '180', 'logistica.duracion_meses': '3' };

test('validación anti-alucinación: solo pasan hallazgos con evidencia literal de datos enviados', () => {
  const { validos, descartados } = validarHallazgosIA([
    { categoria: 'cronograma_clima', severidad: 'ALTA', titulo: 'Plazo corto para vía destapada',
      evidencia: [{ campo: 'tramo[02].estado_via', valor: 'destapada' }, { campo: 'logistica.duracion_meses', valor: '3' }] },
    { titulo: 'Campo inventado', evidencia: [{ campo: 'clima.precipitacion_mm', valor: '4000' }] },
    { titulo: 'Valor alterado', evidencia: [{ campo: 'tramo[02].distancia_km', valor: '18' }] },
    { titulo: 'Sin evidencia', evidencia: [] },
    { titulo: 'Categoría rara', categoria: 'xyz', severidad: 'EXTREMA', evidencia: [{ campo: 'tramo[02].estado_via', valor: 'Destapada' }] },
  ], DATOS);
  assert.deepEqual(validos.map(v => v.titulo), ['Plazo corto para vía destapada', 'Categoría rara']);
  assert.equal(validos[1].categoria, 'otro');
  assert.equal(validos[1].severidad, 'MEDIA');
  assert.deepEqual(descartados.map(d => d.motivo), ['evidencia_no_coincide:clima.precipitacion_mm', 'evidencia_no_coincide:tramo[02].distancia_km', 'sin_evidencia']);
  assert.equal(validos[0].evidencia[0].valor, 'Destapada', 'la evidencia guardada es el valor REAL enviado');
});

test('sin llaves del servidor ni BYOK → no_disponible/sin_llaves_servidor (sin hallazgos inventados)', async () => {
  geminiCB.keys = [];
  const r = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1', userGeminiKeys: [] });
  assert.deepEqual([r.estado, r.motivo, r.hallazgos.length], ['no_disponible', 'sin_llaves_servidor', 0]);
});

test('llave BYOK agotada → USER_KEY_EXHAUSTED; pool del servidor agotado → pool_servidor_agotado', async () => {
  const byok = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1', userGeminiKeys: ['k'] });
  assert.equal(byok.motivo, 'USER_KEY_EXHAUSTED');
  geminiCB.keys = ['srv'];
  comportamiento = async () => { throw new GeminiPoolExhaustedError('agotado'); };
  const srv = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1', userGeminiKeys: [] });
  assert.equal(srv.motivo, 'pool_servidor_agotado');
});

test('Gemini 503 saturado: 1 reintento; si se recupera → ok, si persiste → modelo_saturado', async () => {
  geminiCB.keys = ['srv'];
  const saturado = () => Object.assign(new Error('503'), { code: 'MODEL_OVERLOADED' });
  let llamadas = 0;
  comportamiento = async () => { llamadas++; if (llamadas === 1) throw saturado(); return { texto: '{"hallazgos":[]}', usage: {} }; };
  const recuperado = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1', reintentoMs: 0 });
  assert.deepEqual([recuperado.estado, llamadas], ['ok', 2]);

  llamadas = 0;
  comportamiento = async () => { llamadas++; throw saturado(); };
  const persistente = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1', reintentoMs: 0 });
  assert.deepEqual([persistente.estado, persistente.motivo, llamadas], ['no_disponible', 'modelo_saturado', 2]);
});

test('respuesta cortada por límite de tokens (finish_reason: length) → respuesta_truncada, no inválida', async () => {
  geminiCB.keys = ['srv'];
  comportamiento = async () => ({ texto: '{"hallazgos": [{"titulo": "corta', finishReason: 'length', usage: { prompt_tokens: 1059, completion_tokens: 272, total_tokens: 4127 } });
  const r = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' });
  assert.deepEqual([r.estado, r.motivo, r.hallazgos.length], ['no_disponible', 'respuesta_truncada', 0]);
});

test('respuesta de la IA no-JSON → respuesta_invalida; JSON válido → ok con hallazgos validados', async () => {
  geminiCB.keys = ['srv'];
  comportamiento = async () => ({ texto: 'lo siento, no puedo', usage: {} });
  assert.equal((await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' })).motivo, 'respuesta_invalida');
  comportamiento = async () => ({ texto: JSON.stringify({ hallazgos: [{ categoria: 'costos_transporte', severidad: 'ALTA', titulo: 'T', evidencia: [{ campo: 'tramo[02].distancia_km', valor: '180' }] }] }), usage: {} });
  const ok = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' });
  assert.equal(ok.estado, 'ok');
  assert.equal(ok.hallazgos.length, 1);
});
