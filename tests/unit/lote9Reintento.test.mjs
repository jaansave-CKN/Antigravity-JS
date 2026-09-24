/**
 * lote9Reintento.test.mjs — Lote 9 (2026-09-24): reintento exponencial ante
 * el 503 transitorio de Gemini (visto en vivo esta sesión) y guardia de CI
 * que impide volver a llamar a Gemini sin él. Sin red. Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
const avisos = [];
mock.module(u('utils/logger.js'), { namedExports: { logger: { warn: (m) => avisos.push(m), error: () => {}, info: () => {} } } });
const { fetchGeminiConReintento, conReintentoTransitorio, esErrorTransitorioSDK } = await import(u('services/geminiReintento.js'));

const esperas = [];
const dormir = async (ms) => { esperas.push(ms); };
const respuesta = (status) => new Response(JSON.stringify({ status }), { status });

test('503 → 503 → 200: reintenta con backoff exponencial y devuelve la respuesta buena', async () => {
  esperas.length = 0;
  const estados = [503, 503, 200];
  let llamadas = 0;
  globalThis.fetch = async () => respuesta(estados[llamadas++]);
  const res = await fetchGeminiConReintento('https://x', {}, { dormir, baseMs: 800 });
  assert.equal(res.status, 200);
  assert.equal(llamadas, 3);
  assert.ok(esperas[0] >= 800 && esperas[0] < 1200, `1ª espera ${esperas[0]}`);
  assert.ok(esperas[1] >= 1600 && esperas[1] < 2000, `2ª espera ${esperas[1]}`);
});

test('503 persistente: 3 intentos y devuelve el último 503 (el agente decide su respaldo)', async () => {
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; return respuesta(503); };
  const res = await fetchGeminiConReintento('https://x', {}, { dormir });
  assert.equal(res.status, 503);
  assert.equal(llamadas, 3);
});

test('429 y 400 NO se reintentan (cuota → rotación de llaves; 4xx → error real)', async () => {
  for (const status of [429, 400, 401]) {
    let llamadas = 0;
    globalThis.fetch = async () => { llamadas++; return respuesta(status); };
    const res = await fetchGeminiConReintento('https://x', {}, { dormir });
    assert.equal(res.status, status);
    assert.equal(llamadas, 1, `HTTP ${status} no debe reintentarse`);
  }
});

test('SDK: reintenta "[503 Service Unavailable]" y no reintenta cuota ni errores reales', async () => {
  let n = 0;
  const ok = await conReintentoTransitorio(async () => { if (++n < 3) throw new Error('[GoogleGenerativeAI Error]: [503 Service Unavailable] high demand'); return 'ok'; }, { dormir });
  assert.equal(ok, 'ok');
  assert.equal(n, 3);
  assert.equal(esErrorTransitorioSDK(new Error('[429 Too Many Requests] quota')), false);
  assert.equal(esErrorTransitorioSDK(new Error('Respuesta de Gemini sin JSON')), false);
  let m = 0;
  await assert.rejects(conReintentoTransitorio(async () => { m++; throw new Error('[429 Too Many Requests]'); }, { dormir }), /429/);
  assert.equal(m, 1);
});

test('guardia de CI: toda llamada a Gemini pasa por el reintento (salvo el ping de validación BYOK)', () => {
  const raiz = fileURLToPath(new URL('../../', import.meta.url));
  const archivos = [join(raiz, 'server.js')];
  const recorrer = (d) => { for (const n of readdirSync(d)) {
    if (n === 'node_modules') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) recorrer(p); else if (p.endsWith('.js')) archivos.push(p);
  } };
  recorrer(join(raiz, 'backend'));
  const fallos = [];
  let revisadas = 0;
  for (const f of archivos) {
    if (/byokService\.js$|geminiReintento\.js$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    // fetch directo al endpoint compatible-OpenAI de Gemini
    for (const m of src.matchAll(/\bfetch\(\s*(GEMINI_URL|'https:\/\/generativelanguage\.googleapis\.com[^']*')/g)) fallos.push(`${f}: fetch directo sin reintento (${m[1].slice(0, 40)})`);
    // SDK: toda generateContent debe ir envuelta en conReintentoTransitorio
    for (const m of src.matchAll(/model\.generateContent\(/g)) {
      revisadas++;
      const antes = src.slice(Math.max(0, m.index - 60), m.index);
      if (!/conReintentoTransitorio\(\(\) => $/.test(antes)) fallos.push(`${f}: generateContent sin conReintentoTransitorio`);
    }
    revisadas += (src.match(/fetchGeminiConReintento\(/g) || []).length;
  }
  assert.ok(revisadas >= 9, `se esperaban >= 9 llamadas revisadas, hubo ${revisadas}`);
  assert.deepEqual(fallos, []);
});
