/**
 * lote8Blindaje.test.mjs — Lote 8 (auditoría minera 2026-09-24).
 * 1. La cuota diaria de Gemini se renueva a medianoche del PACÍFICO, y un
 *    429 "PerDay" ya no se cree el retryDelay "34s" que Google adjunta.
 * 2. logCriticalError resuelve DESPUÉS del INSERT (antes process.exit lo mataba).
 * 3. aiTokenLogger ya no descarta el { error } de supabase-js.
 * 4. Guardia de CI: ninguna llamada compatible-OpenAI a Gemini puede volver
 *    a un max_tokens bajo o sin acotar el razonamiento.
 * Sin red, sin BD. Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
let resultadoInsert = { error: null };
const inserts = [];
const supabaseAdmin = { from: (tabla) => ({
  insert: async (filas) => { inserts.push({ tabla, filas }); return resultadoInsert; },
  upsert: async () => ({ error: null }),
}) };
mock.module(u('config/supabase.config.js'), { namedExports: { supabaseAdmin } });
mock.module(u('config/sentry.config.js'), { namedExports: { captureMessage: () => {} } });

let insertLento = null;
mock.module(u('db.js'), { namedExports: { runSql: (...a) => insertLento(...a) } });

const { nextMidnightPacific, retryDelayDe429 } = await import(u('services/geminiCircuitBreaker.js'));
const { logCriticalError } = await import(u('services/logService.js'));
const { logTokenUsage } = await import(u('services/aiTokenLogger.js'));

// Cuerpo real del 429 diario (transcript 2026-09-24): quotaId PerDay + retryDelay "34s" falso.
const CUERPO_DIARIO = JSON.stringify([{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{
    quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
    quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' },
] } }]);

test('medianoche del Pacífico: 07:00 UTC en horario de verano, 08:00 UTC en invierno', () => {
  assert.equal(nextMidnightPacific(new Date('2026-09-24T17:40:00Z')).toISOString(), '2026-09-25T07:00:00.000Z');
  assert.equal(nextMidnightPacific(new Date('2026-12-10T12:00:00Z')).toISOString(), '2026-12-11T08:00:00.000Z');
  // 02:00 UTC del 25 = 19:00 PDT del 24: la próxima medianoche sigue siendo la del 25.
  assert.equal(nextMidnightPacific(new Date('2026-09-25T02:00:00Z')).toISOString(), '2026-09-25T07:00:00.000Z');
});

test('429 diario: el cooldown dura hasta la medianoche del Pacífico, no 34 s', () => {
  const ahora = new Date('2026-09-24T17:40:00Z');
  const ms = retryDelayDe429(CUERPO_DIARIO, ahora);
  assert.equal(ms, new Date('2026-09-25T07:00:00Z') - ahora + 60_000);
  assert.ok(ms > 13 * 3_600_000, 'más de 13 horas, no 34 s');
});

test('429 por minuto: se respeta el retryDelay real (+2 s); sin dato → null', () => {
  assert.equal(retryDelayDe429('Please retry in 34.5s. quotaId GenerateRequestsPerMinutePerProjectPerModel-FreeTier'), 36_500);
  assert.equal(retryDelayDe429('{"retryDelay": "20s"}'), 22_000);
  assert.equal(retryDelayDe429('sin datos'), null);
});

test('logCriticalError resuelve después del INSERT (process.exit ya no lo pierde)', async () => {
  let persistido = false;
  insertLento = () => new Promise(r => setTimeout(() => { persistido = true; r(); }, 50));
  await logCriticalError('S3Backup', 'prueba', { x: 1 });
  assert.equal(persistido, true);
});

test('logCriticalError nunca cuelga: un INSERT que no responde se corta a los 5 s', async () => {
  insertLento = () => new Promise(() => {});
  const t0 = Date.now();
  await logCriticalError('S3Backup', 'bd colgada');
  assert.ok(Date.now() - t0 < 6000);
});

test('aiTokenLogger: un { error } de supabase-js queda registrado, no se descarta', async () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  try {
    resultadoInsert = { error: { message: 'violates check constraint' } };
    await logTokenUsage({ userId: 'u1', agentName: 'entrada-ia', tokensInput: 10, tokensOutput: 5 });
  } finally { console.warn = original; resultadoInsert = { error: null }; }
  assert.ok(avisos.some(a => /entrada-ia/.test(a) && /violates check constraint/.test(a)));
});

test('guardia de CI: toda llamada compatible-OpenAI a Gemini usa max_tokens >= 8192 y reasoning_effort', () => {
  const raiz = fileURLToPath(new URL('../../backend/', import.meta.url));
  const archivos = [];
  const recorrer = (d) => { for (const n of readdirSync(d)) {
    if (n === 'node_modules') continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) recorrer(p); else if (p.endsWith('.js')) archivos.push(p);
  } };
  recorrer(raiz);
  // byokService: ping de validación de llave (max_tokens 5) — no genera contenido.
  const EXCEPCIONES = [/byokService\.js$/];
  const fallos = [];
  let revisadas = 0;
  for (const f of archivos) {
    if (EXCEPCIONES.some(r => r.test(f))) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/max_tokens\s*:\s*(\d+)/g)) {
      revisadas++;
      const ventana = src.slice(Math.max(0, m.index - 400), m.index + 400);
      if (!/gemini-3\.6-flash|MODELO/.test(ventana)) continue;
      if (Number(m[1]) < 8192) fallos.push(`${f}: max_tokens ${m[1]} < 8192`);
      if (!/reasoning_effort/.test(ventana)) fallos.push(`${f}: sin reasoning_effort junto a max_tokens`);
    }
  }
  assert.ok(revisadas >= 4, `se esperaban >= 4 llamadas revisadas, hubo ${revisadas}`);
  assert.deepEqual(fallos, []);
});
