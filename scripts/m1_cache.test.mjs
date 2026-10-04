// m1_cache.test.mjs — hallazgo 2 de docs/RADFOR360_RELACION_AGENTES_SKILLS_2026-09-28.pdf:
// /api/radar/search normalizaba la clave de caché y /api/radar/stream usaba la
// query cruda y nunca escribía — la misma búsqueda pagaba Claude+Tavily dos
// veces. Estas pruebas fijan el contrato único de m1Cache.js y lo ejercitan
// de punta a punta (Express real + SSE real) sin red ni costo: Anthropic y
// Tavily se simulan en la capa fetch.
//
// Corre con: node --test scripts/m1_cache.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

// Entorno antes de cualquier import: cache.js lee UPSTASH_* al cargar (aquí
// se fuerza el fallback en memoria) y el SDK de Anthropic captura
// globalThis.fetch al construir el cliente (perezoso, en la primera llamada).
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.LANGFUSE_SECRET_KEY;
delete process.env.LANGFUSE_PUBLIC_KEY;
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-no-real-0000000000';
process.env.TAVILY_API_KEY = 'tvly-test-no-real-0000000000';

// --- Doble de red: Anthropic y Tavily simulados, localhost real ------------------
const realFetch = globalThis.fetch;
const red = { anthropic: 0, tavily: 0, respuestaModelo: null, demoraMs: 0 };

const OPORTUNIDADES = [
  { titulo: 'Vivienda rural SGR', entidad: 'MinVivienda', monto: '$1.000.000.000', sector: 'Vivienda', cobertura: 'Nacional', fechaCierre: '2026-12-01', requisitos: 'MGA', normativa: 'Ley 1537/2012', url: 'https://minvivienda.gov.co/x', viabilidadMGA: 'Alta', prioridad: 90, alertas: '' },
  { titulo: 'Acueducto veredal', entidad: 'Gobernación', monto: 'Por confirmar', sector: 'Agua potable', cobertura: 'Bolívar', fechaCierre: 'Por confirmar', requisitos: 'MGA', normativa: 'RAS 2000', url: 'https://bolivar.gov.co/y', viabilidadMGA: 'Media', prioridad: 60, alertas: '' },
];

function mensajeAnthropic(texto) {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-test',
    content: [{ type: 'text', text: texto }],
    stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  if (url.startsWith('https://api.anthropic.com')) {
    red.anthropic++;
    if (red.demoraMs) await new Promise(r => setTimeout(r, red.demoraMs));
    const texto = red.respuestaModelo ?? JSON.stringify({ oportunidades: OPORTUNIDADES });
    return new Response(JSON.stringify(mensajeAnthropic(texto)), {
      status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  }
  if (url.startsWith('https://api.tavily.com')) {
    red.tavily++;
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};

const express = (await import('express')).default;
const { clearMemCache } = await import('../src/shared/infrastructure/cache.js');
const M = await import('../src/modules/radar/m1Cache.js');
const { m1Router, runM1Pipeline } = await import('../src/modules/radar/m1Pipeline.js');

const app = express();
app.use(express.json());
app.use('/api/radar', m1Router);
const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
const BASE = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); globalThis.fetch = realFetch; });

function reiniciar() {
  clearMemCache();
  red.anthropic = 0; red.tavily = 0; red.respuestaModelo = null; red.demoraMs = 0;
}

async function postSearch(body) {
  const r = await realFetch(`${BASE}/api/radar/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

// Lee el SSE completo y devuelve los eventos JSON (sin pings ni [DONE]).
async function postStream(body) {
  const r = await realFetch(`${BASE}/api/radar/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const texto = await r.text();
  return texto.split('\n')
    .filter(l => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map(l => JSON.parse(l.slice(6)));
}

// --- Contrato de clave ---------------------------------------------------------

test('clave: mayúsculas, espacios y forma Unicode (NFD/NFC) de la misma búsqueda → misma clave', () => {
  const k = M.m1CacheKey('Vivienda rural Bolívar', {});
  assert.equal(M.m1CacheKey('  vivienda   RURAL bolívar ', {}), k);
  assert.equal(M.m1CacheKey('Vivienda rural Bolívar', {}), k, 'í descompuesta (NFD) = í compuesta');
  assert.notEqual(M.m1CacheKey('vivienda urbana bolívar', {}), k, 'búsquedas distintas no colisionan');
});

test('clave: filtros equivalentes comparten clave; el orden de las propiedades no importa', () => {
  const base = M.m1CacheKey('acueducto', {});
  assert.equal(M.m1CacheKey('acueducto', { sector: 'all', cobertura: '' }), base);
  assert.equal(M.m1CacheKey('acueducto', null), base);
  const a = M.m1CacheKey('acueducto', { sector: 'Agua', cobertura: 'Bolívar' });
  assert.equal(M.m1CacheKey('acueducto', { cobertura: ' bolívar', sector: 'AGUA ' }), a);
  assert.notEqual(a, base, 'un filtro real sí cambia la clave');
});

test('applyFilters conserva la semántica previa: nacional y multisectorial pasan; sin filtro devuelve todo', () => {
  assert.equal(M.applyFilters(OPORTUNIDADES, {}).length, 2);
  assert.deepEqual(M.applyFilters(OPORTUNIDADES, { cobertura: 'antioquia' }).map(o => o.titulo), ['Vivienda rural SGR']);
  assert.deepEqual(M.applyFilters(OPORTUNIDADES, { sector: 'AGUA' }).map(o => o.titulo), ['Acueducto veredal']);
  assert.equal(M.applyFilters(OPORTUNIDADES, { sector: 'all' }).length, 2);
  assert.deepEqual(M.applyFilters('no-es-array', {}), []);
});

test('safeParseJSON y esCacheable: bloque ```json se acepta; basura o lista vacía nunca se cachea', () => {
  assert.equal(M.safeParseJSON('```json\n{"oportunidades":[{"titulo":"x"}]}\n```').oportunidades.length, 1);
  assert.deepEqual(M.safeParseJSON('texto libre del modelo'), { oportunidades: [] });
  const vacio = M.construirResultado({ query: 'q', filters: {}, raw: 'no json', model: 'm', startMs: Date.now(), key: 'k' });
  assert.equal(vacio.rawTotal, 0);
  assert.equal(M.esCacheable(vacio), false);
  const lleno = M.construirResultado({ query: 'q', filters: {}, raw: JSON.stringify({ oportunidades: OPORTUNIDADES }), model: 'm', startMs: Date.now(), key: 'k' });
  assert.equal(M.esCacheable(lleno), true);
});

// --- Integración: /search y /stream comparten caché ------------------------------

test('/search paga la búsqueda y /stream (otra grafía, filtros en otro orden) la reutiliza: 1 sola llamada a Claude', async () => {
  reiniciar();
  const s = await postSearch({ query: 'Vivienda rural', filters: { sector: 'Vivienda', cobertura: 'all' } });
  assert.equal(s.status, 200);
  assert.equal(s.json.fromCache, false);
  assert.equal(red.anthropic, 1);

  const eventos = await postStream({ query: '  VIVIENDA   rural ', filters: { cobertura: '', sector: 'vivienda' } });
  const hit = eventos.find(e => e.event === 'cache_hit');
  assert.ok(hit, `se esperaba cache_hit, llegaron: ${eventos.map(e => e.event).join(',')}`);
  assert.equal(hit.data.fromCache, true);
  assert.deepEqual(hit.data.oportunidades, s.json.oportunidades);
  assert.equal(red.anthropic, 1, 'antes del fix: 2 llamadas (clave cruda en /stream)');
});

test('/stream paga primero, escribe la caché y emite "result"; /search y el cron (runM1Pipeline) la reutilizan', async () => {
  reiniciar();
  const eventos = await postStream({ query: 'Acueducto veredal', filters: {} });
  const res = eventos.find(e => e.event === 'result');
  assert.ok(res, `se esperaba result, llegaron: ${eventos.map(e => e.event).join(',')}`);
  assert.equal(res.data.rawTotal, 2);
  assert.equal(red.anthropic, 1);

  const s = await postSearch({ query: 'acueducto VEREDAL' });
  assert.equal(s.json.fromCache, true);
  const cron = await runM1Pipeline({ query: ' Acueducto veredal ', filters: {} });
  assert.equal(cron.fromCache, true);
  assert.equal(red.anthropic, 1, 'antes del fix: /stream nunca escribía la caché');
});

// --- Red Team ---------------------------------------------------------------------

test('RED TEAM 1 — envenenamiento: una respuesta no parseable del modelo NO se cachea 24 h para todos', async () => {
  reiniciar();
  red.respuestaModelo = 'Lo siento, no pude completar la búsqueda.';
  const a = await postSearch({ query: 'saneamiento básico' });
  assert.equal(a.json.rawTotal, 0);
  const evs = await postStream({ query: 'Saneamiento básico' });
  assert.equal(evs.find(e => e.event === 'result')?.data.rawTotal, 0);

  red.respuestaModelo = null; // el proveedor se recupera
  const c = await postSearch({ query: 'saneamiento básico' });
  assert.equal(c.json.fromCache, false, 'el vacío previo no debe servirse desde caché');
  assert.equal(c.json.rawTotal, 2);
  assert.equal(red.anthropic, 3);
});

test('RED TEAM 2 — inflado de caché: 500 propiedades basura en filters no generan claves nuevas', async () => {
  const basura = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`x${i}`, `v${i}`]));
  assert.equal(M.m1CacheKey('vías terciarias', basura), M.m1CacheKey('vías terciarias', {}));
  assert.equal(M.m1CacheKey('vías terciarias', { ...basura, sector: 'Transporte' }), M.m1CacheKey('vías terciarias', { sector: 'transporte' }));
  assert.equal(M.m1CacheKey('vías terciarias', ['sector', 'x']), M.m1CacheKey('vías terciarias', {}), 'un array no se interpreta como filtros');
});

test('RED TEAM 3 — evasión del bloqueo de consulta duplicada cambiando mayúsculas: la segunda se rechaza', async () => {
  reiniciar();
  red.demoraMs = 300;
  const [uno, dos] = await Promise.all([
    postStream({ query: 'Colegio modular' }),
    (async () => { await new Promise(r => setTimeout(r, 50)); return postStream({ query: 'COLEGIO   modular' }); })(),
  ]);
  assert.ok(uno.some(e => e.event === 'result'), 'la primera consulta completa');
  const err = dos.find(e => e.event === 'error');
  assert.ok(err && /consulta en curso/i.test(err.message), `la segunda debía rechazarse, llegó: ${JSON.stringify(dos)}`);
  assert.equal(red.anthropic, 1, 'una sola llamada pagada');
});
