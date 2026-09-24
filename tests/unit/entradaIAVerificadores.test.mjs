/**
 * entradaIAVerificadores.test.mjs — regresión de F-07 y F-08 (auditoría V3,
 * 2026-09-23): verificación determinista de citas de fuente y de la lista
 * negra del Motor Dialéctico sobre la salida de la IA. Supabase, Gemini,
 * BYOK y scoring se simulan: ningún caso toca red ni BD.
 *
 * Ejecutar: npm run test:unit   (requiere Node >= 22.3 por mock.module)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;
class E extends Error {}
mock.module(u('config/supabase.config.js'), { namedExports: { supabaseStorage: {}, supabaseAdmin: {} } });
mock.module(u('services/markitdownService.js'), { namedExports: { convertBufferToMarkdown: async () => '' } });
mock.module(u('services/geminiCircuitBreaker.js'), {
  namedExports: { withKeyRotation: async () => { throw new E(); }, isQuotaError: () => false, GeminiPoolExhaustedError: E },
});
mock.module(u('services/byokService.js'), { namedExports: { withUserKeyRotation: async () => { throw new E(); }, UserKeyPoolExhaustedError: E } });
mock.module(u('services/aiTokenLogger.js'), { namedExports: { logTokenUsage: async () => {} } });
mock.module(u('services/scoringDinamico.js'), { namedExports: { calcularScoringDinamico: async () => ({}) } });
// SecurityMiddleware → PostgresRateLimitStore → database.config abriría pools reales.
class StoreFalso {
  async increment() { return { totalHits: 1, resetTime: new Date() }; }
  async decrement() {}
  async resetKey() {}
}
mock.module(u('middlewares/PostgresRateLimitStore.js'), { namedExports: { PostgresRateLimitStore: StoreFalso } });

const { verificarCitasFuente, verificarListaNegra, conListasDialectica } = await import('../../backend/services/EntradaIAService.js');

const MATERIAL = '### investigacion Cantagallo GEMA.pdf\nTexto...\n\n---\n\n### Censo DANE 2018\nMás texto';

test('F-07: cita que existe en el material queda intacta (con o sin extensión, sin tildes)', () => {
  const t = 'Déficit de 320 viviendas (Fuente: investigacion Cantagallo GEMA). Población (Fuentes: Censo DANE 2018, investigación cantagallo gema)';
  assert.equal(verificarCitasFuente(t, MATERIAL), t);
});

test('F-07: cita inventada se marca como NO VERIFICABLE, no se borra', () => {
  const r = verificarCitasFuente('Cobertura del 45% (Fuente: Informe BID 2025)', MATERIAL);
  assert.match(r, /\(Fuente: Informe BID 2025\) \[⚠️ CITA NO VERIFICABLE: "Informe BID 2025"/);
});

test('F-07: mezcla de cita real e inventada marca solo la inventada', () => {
  const r = verificarCitasFuente('Dato (Fuentes: Censo DANE 2018, Estudio Fantasma)', MATERIAL);
  assert.match(r, /NO VERIFICABLE: "Estudio Fantasma"/);
  assert.doesNotMatch(r, /NO VERIFICABLE: "Censo/);
});

test('F-07: texto sin citas y "ND" pasan sin cambios', () => {
  for (const t of ['ND (No Disponible en la investigación)', 'Texto técnico sin cita', '']) assert.equal(verificarCitasFuente(t, MATERIAL), t);
});

test('F-08: término de la lista negra se detecta (sin importar tildes/mayúsculas), subpalabras no', () => {
  const negra = ['sinergia', 'empoderamiento', 'de clase mundial'];
  assert.match(verificarListaNegra('Generar SINERGÍA institucional', negra), /LENGUAJE VETADO.*"sinergia"/);
  assert.match(verificarListaNegra('Un acueducto de clase mundial', negra), /"de clase mundial"/);
  assert.equal(verificarListaNegra('Sinergias no es igual', ['sinergia']), 'Sinergias no es igual');
  assert.equal(verificarListaNegra('Texto limpio', negra), 'Texto limpio');
  assert.equal(verificarListaNegra('Texto', []), 'Texto');
});

test('F-08: las listas se inyectan antes del material; sin listas el prompt no cambia', () => {
  const p = 'REGLAS...\n\nMATERIAL DE INVESTIGACIÓN REAL DEL PROYECTO:\nabc';
  const r = conListasDialectica(p, { oro: ['MGA', 'SGR'], negra: ['sinergia'] });
  assert.ok(r.indexOf('lista de oro): MGA, SGR') < r.indexOf('MATERIAL DE INVESTIGACIÓN'));
  assert.ok(r.includes('lista negra — nunca los uses, reformula sin ellos): sinergia'));
  assert.equal(conListasDialectica(p, { oro: [], negra: [] }), p);
});
