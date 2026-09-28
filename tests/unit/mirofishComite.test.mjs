/**
 * mirofishComite.test.mjs — F-09: IA adversarial MIROFISH sin red ni BD.
 * Cubre la validación anti-alucinación y los motivos de "no disponible"
 * (nunca un resultado fabricado). B1 (2026-09-28): la llamada pasa por la
 * capa única (llmProveedor, simulada aquí; su cascada tiene su propio test).
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class IaNoDisponibleError extends Error { constructor(intentos) { super('sin IA'); this.code = 'IA_NO_DISPONIBLE'; this.intentos = intentos; } }
class IaTopeAgotadoError extends Error { constructor(retryAt) { super('Alcanzaste el tope diario de uso de IA de tu cuenta.'); this.code = 'IA_TOPE_AGOTADO'; this.retryAt = retryAt; } }
class LlmLoopGuardError extends Error { constructor() { super('bucle'); this.code = 'LLM_LOOP_GUARD'; } }
let generar = async () => { throw new Error('no configurado'); };
let ultimaPeticion = null;

const svc = (f) => new URL(`../../backend/services/${f}`, import.meta.url).href;
mock.module(svc('llmProveedor.js'), { namedExports: {
  IaNoDisponibleError, IaTopeAgotadoError,
  generarConIA: async (p) => { ultimaPeticion = p; return generar(p); },
} });
mock.module(svc('geminiCircuitBreaker.js'), { namedExports: { LlmLoopGuardError } });

const { evaluarComiteIA, validarHallazgosIA, parsearRespuestaComite } = await import('../../backend/services/mirofishComite.js');

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

test('respuesta sin arreglo "hallazgos" es rechazada (la capa prueba el siguiente proveedor)', () => {
  assert.throws(() => parsearRespuestaComite('lo siento, no puedo'));
  assert.throws(() => parsearRespuestaComite('{"hallazgos": [{"titulo": "corta'));
  assert.deepEqual(parsearRespuestaComite('{"hallazgos": []}'), { hallazgos: [] });
});

test('JSON válido → ok con hallazgos validados y el modelo que realmente respondió (B7)', async () => {
  const texto = JSON.stringify({ hallazgos: [{ categoria: 'costos_transporte', severidad: 'ALTA', titulo: 'T', evidencia: [{ campo: 'tramo[02].distancia_km', valor: '180' }] }] });
  generar = async (p) => ({ valor: p.validar(texto), modelo: 'anthropic/claude-sonnet-5', proveedor: 'openrouter' });
  const ok = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' });
  assert.deepEqual([ok.estado, ok.hallazgos.length, ok.modelo, ok.proveedor], ['ok', 1, 'anthropic/claude-sonnet-5', 'openrouter']);
  assert.deepEqual([ultimaPeticion.userId, ultimaPeticion.agente, ultimaPeticion.responseFormat.type], ['u1', 'mirofish_comite', 'json_object']);
});

test('sin IA disponible → no_disponible con los intentos, sin hallazgos inventados (las reglas siguen en la ruta)', async () => {
  const intentos = [{ proveedor: 'openrouter', motivo: 'sin_llave' }, { proveedor: 'gemini_servidor', motivo: 'cuota_agotada' }];
  generar = async () => { throw new IaNoDisponibleError(intentos); };
  const r = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' });
  assert.deepEqual([r.estado, r.motivo, r.hallazgos.length], ['no_disponible', 'ia_no_disponible', 0]);
  assert.deepEqual(r.intentos, intentos);
});

test('tope agotado y guardián anti-bucle → no_disponible con su motivo y mensaje', async () => {
  const manana = new Date('2026-09-29T05:00:00Z');
  generar = async () => { throw new IaTopeAgotadoError(manana); };
  const tope = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' });
  assert.deepEqual([tope.estado, tope.motivo, tope.retryAt], ['no_disponible', 'IA_TOPE_AGOTADO', manana]);
  generar = async () => { throw new LlmLoopGuardError(); };
  const bucle = await evaluarComiteIA({ datos: DATOS, hallazgosReglas: [], userId: 'u1' });
  assert.equal(bucle.motivo, 'LLM_LOOP_GUARD');
});
