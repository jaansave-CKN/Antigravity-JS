/**
 * viabilidadAgent.test.mjs — dictamen de viabilidad sobre la capa única de IA.
 * B1 (2026-09-28, regla de oro): se eliminó el respaldo heurístico — si
 * ningún proveedor entrega un dictamen válido, calcularViabilidadIA LANZA y
 * el caller no guarda nada. La cascada, el cuerpo de la petición y FinOps se
 * prueban en llmProveedor.test.mjs; aquí se simula generarConIA.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class IaNoDisponibleError extends Error { constructor() { super('sin IA'); this.status = 503; this.code = 'IA_NO_DISPONIBLE'; } }
let generar = async () => { throw new Error('no configurado'); };
let ultimaPeticion = null;

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
mock.module(u('services/llmProveedor.js'), { namedExports: {
  IaNoDisponibleError,
  generarConIA: async (p) => { ultimaPeticion = p; return generar(p); },
} });
mock.module(u('utils/logger.js'), { namedExports: { logger: { info() {}, debug() {}, warn() {}, error() {} } } });

const { calcularViabilidadIA, parsearDictamen } = await import('../../backend/services/viabilidadAgent.js');

const CTX = { userId: 'u1', problema: 'Déficit de acueducto en la vereda El Mango con 320 familias sin agua potable', metaEsperada: 'Cobertura del 100% en 2027', poblacionAfectada: 320, presupuesto: { total: 412000000 }, anexos: [{ categoria: 'financiero', nombre_archivo: 'presupuesto.xlsx' }], supuestosArbol: [], resultadosCambio: [] };
const DICTAMEN = { estado_auditoria: 'APROBADO_TECNICAMENTE', score_viabilidad: 81.6, analisis_escala_poblacion: { proporcion_logica: true, veredicto_escala: 'Proporcional' }, cruce_anexos: { respaldo_financiero_detectado: true, marco_normativo_validado: false, brechas_detectadas: ['Sin anexo legal'] }, teoria_del_cambio_generada: { supuestos: ['s1'], resultados_esperados: ['r1'] } };

test('pide salida estructurada (json_schema) con el esquema del dictamen y el userId del dueño', async () => {
  generar = async (p) => ({ valor: p.validar(JSON.stringify(DICTAMEN)), modelo: 'anthropic/claude-sonnet-5', proveedor: 'openrouter' });
  await calcularViabilidadIA(CTX);
  assert.equal(ultimaPeticion.userId, 'u1');
  assert.equal(ultimaPeticion.agente, 'viabilidad');
  assert.equal(ultimaPeticion.responseFormat.type, 'json_schema');
  assert.deepEqual(ultimaPeticion.responseFormat.json_schema.schema.properties.estado_auditoria.enum, ['APROBADO_TECNICAMENTE', 'OBSERVACION_CRITICA', 'RECHAZADO_INCOHERENCIA']);
  assert.equal(typeof ultimaPeticion.validar, 'function', 'una salida inválida hace probar el siguiente proveedor');
});

test('dictamen válido: se normaliza y `fuente` es el modelo que REALMENTE respondió (B7)', async () => {
  generar = async (p) => ({ valor: p.validar(JSON.stringify(DICTAMEN)), modelo: 'anthropic/claude-sonnet-5', proveedor: 'openrouter' });
  const r = await calcularViabilidadIA(CTX);
  assert.equal(r.score_viabilidad, 82);
  assert.equal(r.estado_auditoria, 'APROBADO_TECNICAMENTE');
  assert.deepEqual(r.cruce_anexos.brechas_detectadas, ['Sin anexo legal']);
  assert.deepEqual([r.fuente, r.proveedor], ['anthropic/claude-sonnet-5', 'openrouter']);
  assert.equal('motivo_respaldo' in r, false);
});

test('REGLA DE ORO: sin IA disponible LANZA — ya no existe el veredicto heurístico', async () => {
  generar = async () => { throw new IaNoDisponibleError(); };
  await assert.rejects(calcularViabilidadIA(CTX), (e) => e.status === 503 && e.code === 'IA_NO_DISPONIBLE');
});

test('validación del esquema: rechaza JSON roto, estados fuera del enum y score no numérico', () => {
  assert.throws(() => parsearDictamen('lo siento, no puedo'), /sin JSON/);
  assert.throws(() => parsearDictamen('{"estado_auditoria": APROBADO}'));
  assert.throws(() => parsearDictamen('{"estado_auditoria": "INVENTADO", "score_viabilidad": 50}'), /esquema inválido/);
  assert.throws(() => parsearDictamen('{"estado_auditoria": "OBSERVACION_CRITICA", "score_viabilidad": "alto"}'), /esquema inválido/);
  assert.equal(parsearDictamen('```json\n' + JSON.stringify(DICTAMEN) + '\n```').score_viabilidad, 81.6);
});
