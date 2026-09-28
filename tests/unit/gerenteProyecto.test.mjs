/**
 * gerenteProyecto.test.mjs — Fase 4: Gerente de Proyecto mínimo (flujos A↔B).
 * Coordinadores y embeddings simulados con mock.module: sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
const est = {};
const reiniciar = () => Object.assign(est, {
  acceso: true, conv: { id: 'c1', externo_id: 'EXT-1', titulo: 'Fondo del Agua', descripcion: 'desc real del catálogo' },
  creados: [], catalogo: { total: 550, con: 550 }, vectorProyecto: [0.1, 0.2], embeddings: 0, busquedas: [],
});
mock.module(u('agents/radar/index.js'), { namedExports: {
  obtenerConvocatoria: async (id) => (id === 'c1' || id === 'EXT-1' ? est.conv : null),
  estadoEmbeddings: async () => est.catalogo,
  buscarConvocatoriasPorVector: async (vec, o) => { est.busquedas.push({ vec, o }); return { resultados: [{ id: 'c1', similitud: 0.84 }], motor: 'pgvector·HNSW' }; },
} });
mock.module(u('agents/formulador/index.js'), { namedExports: {
  tieneAccesoFormulador: async (userId, rol) => rol === 'admin' || est.acceso,
  crearProyectoBorradorDesdeConvocatoria: async (userId, conv) => { est.creados.push({ userId, conv }); return { proyecto_id: 'p-nuevo', nombre: `Formulación: ${conv.titulo}` }; },
  obtenerVectorProyecto: async (userId, proyectoId) => (proyectoId === 'ajeno' ? 'NO_ENCONTRADO' : proyectoId === 'vacio' ? 'SIN_TEXTO' : est.vectorProyecto),
} });
mock.module(u('services/embeddingsService.js'), { namedExports: {
  textToEmbedding: async () => { est.embeddings++; return [0.9, 0.9]; },
} });

const { formularConvocatoria, convocatoriasParaProyecto } = await import('../../backend/agents/gp/gerenteProyecto.js');

test('formularConvocatoria: sin plan → 403 NO_ACCESS_FORMULADOR (y no crea nada); el admin pasa', async () => {
  reiniciar();
  est.acceso = false;
  const r = await formularConvocatoria({ userId: 'u1', userRole: 'user', convocatoriaId: 'c1' });
  assert.deepEqual([r.ok, r.status, r.code, r.redirect_to], [false, 403, 'NO_ACCESS_FORMULADOR', '/planes']);
  assert.equal(est.creados.length, 0);
  assert.equal((await formularConvocatoria({ userId: 'adm', userRole: 'admin', convocatoriaId: 'c1' })).ok, true);
});

test('formularConvocatoria: convocatoria inexistente → 404, nunca crea con datos del cliente', async () => {
  reiniciar();
  const r = await formularConvocatoria({ userId: 'u1', userRole: 'user', convocatoriaId: 'inventada' });
  assert.deepEqual([r.ok, r.status, r.code], [false, 404, 'CONVOCATORIA_NO_ENCONTRADA']);
  assert.equal(est.creados.length, 0);
});

test('formularConvocatoria: crea con los datos del CATÁLOGO, a nombre del usuario, y redirige a la ruta real /checklist', async () => {
  reiniciar();
  const r = await formularConvocatoria({ userId: 'u1', userRole: 'user', convocatoriaId: 'EXT-1' });
  assert.deepEqual(r, { ok: true, proyecto_id: 'p-nuevo', nombre: 'Formulación: Fondo del Agua', convocatoria_id: 'c1', redirect_to: '/checklist' });
  assert.equal(est.creados[0].userId, 'u1');
  assert.equal(est.creados[0].conv.descripcion, 'desc real del catálogo');
});

test('convocatoriasParaProyecto: catálogo sin vectores → 503 explícito ANTES de gastar un embedding', async () => {
  reiniciar();
  est.catalogo = { total: 550, con: 0 };
  const r = await convocatoriasParaProyecto({ userId: 'u1', texto: 'agua' });
  assert.deepEqual([r.ok, r.status, r.code], [false, 503, 'CATALOGO_SIN_EMBEDDINGS']);
  assert.equal(est.embeddings, 0);
});

test('convocatoriasParaProyecto: usa el vector REAL del proyecto (recalculado por el coordinador B)', async () => {
  reiniciar();
  const r = await convocatoriasParaProyecto({ userId: 'u1', proyectoId: 'p1', limit: 10, threshold: 0.5 });
  assert.equal(r.ok, true);
  assert.deepEqual(est.busquedas[0], { vec: [0.1, 0.2], o: { limit: 10, threshold: 0.5 } });
  assert.equal(est.embeddings, 0, 'no vectoriza texto si el proyecto ya dio vector');
  assert.deepEqual(r.cobertura, { total: 550, con: 550 });
});

test('convocatoriasParaProyecto: proyecto ajeno → 404; sin texto suficiente y sin texto libre → 400; con texto libre busca por texto', async () => {
  reiniciar();
  assert.equal((await convocatoriasParaProyecto({ userId: 'u1', proyectoId: 'ajeno' })).code, 'PROYECTO_NO_ENCONTRADO');
  assert.equal((await convocatoriasParaProyecto({ userId: 'u1', proyectoId: 'vacio' })).code, 'SIN_VECTOR_NI_TEXTO');
  const r = await convocatoriasParaProyecto({ userId: 'u1', proyectoId: 'vacio', texto: 'acueducto rural' });
  assert.equal(r.ok, true);
  assert.equal(est.embeddings, 1);
});
