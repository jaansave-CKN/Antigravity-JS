/**
 * nucleoRadar.test.mjs — directiva "Contención y sincronización de núcleo"
 * (dueño 2026-09-28; dictamen architect APROBADO CON CAMBIOS).
 *  - Guardia de CI: el SDK @google/generative-ai solo puede importarse en
 *    backend/services/llmProveedor.js (estático, dinámico o require).
 *  - Los agentes del Radar pasan por generarConIA({ soloServidor: true }) y
 *    conservan su contrato de NUNCA lanzar (caen a su respaldo).
 * llmProveedor se simula: sin red ni BD.
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;

const ia = { llamadas: [], impl: null };
class IaTopeSistemaError extends Error { constructor() { super('tope'); this.code = 'IA_TOPE_SISTEMA'; } }
mock.module(u('services/llmProveedor.js'), { namedExports: {
  generarConIA: async (op) => { ia.llamadas.push(op); return ia.impl(op); },
} });

const { classifySectors, SECTOR_NAMES } = await import(u('services/sectorClassifier.js'));
const { extractConvocatoriaFields } = await import(u('services/markitdownService.js'));

function archivosJs(dir, out = []) {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosJs(ruta, out);
    else if (/\.(m|c)?js$/.test(nombre)) out.push(ruta);
  }
  return out;
}
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('GUARDIA: el SDK @google/generative-ai solo se importa en llmProveedor.js (estático, dinámico o require)', () => {
  const archivos = [join(RAIZ, 'server.js'), ...archivosJs(join(RAIZ, 'backend'))];
  const importadores = archivos.filter((f) => {
    const src = sinComentarios(readFileSync(f, 'utf8'));
    return /from\s+['"]@google\/generative-ai['"]|import\(\s*['"]@google\/generative-ai['"]\s*\)|require\(\s*['"]@google\/generative-ai['"]\s*\)/.test(src);
  }).map((f) => f.slice(RAIZ.length).replace(/\\/g, '/'));
  assert.deepEqual(importadores, ['backend/services/llmProveedor.js']);
});

test('GUARDIA: nadie crea un cliente del SDK (new GoogleGenerativeAI) fuera de llmProveedor.js', () => {
  const archivos = [join(RAIZ, 'server.js'), ...archivosJs(join(RAIZ, 'backend'))];
  const creadores = archivos.filter((f) => /new\s+GoogleGenerativeAI\s*\(/.test(sinComentarios(readFileSync(f, 'utf8'))))
    .map((f) => f.slice(RAIZ.length).replace(/\\/g, '/'));
  assert.deepEqual(creadores, ['backend/services/llmProveedor.js']);
});

test('classifySectors: pasa por soloServidor con la cuenta y el agente FinOps de siempre; valida contra el taxonomy', async () => {
  ia.llamadas.length = 0;
  ia.impl = async (op) => ({ valor: op.validar('["Vivienda", "Inventado", "Transporte"]'), modelo: 'gemini-3.6-flash' });
  const r = await classifySectors('Mejoramiento de vivienda rural', 'desc', 'BID');
  assert.deepEqual(r, ['Vivienda', 'Transporte'], 'descarta sectores que no existen');
  const op = ia.llamadas[0];
  assert.deepEqual([op.userId, op.agente, op.soloServidor], ['sistema-radar-batch', 'sector-classifier', true]);
  assert.ok(op.maxTokens >= 2048, 'el razonamiento de gemini-3.6-flash consume max_tokens (512 truncaba)');
  assert.throws(() => op.validar('["Nada válido"]'), /Sin sectores válidos/);
  assert.ok(SECTOR_NAMES.includes('Vivienda'));
});

test('classifySectors NUNCA lanza: tope del sistema agotado, bucle o cualquier error → palabras clave', async () => {
  for (const error of [new IaTopeSistemaError(), Object.assign(new Error('bucle'), { code: 'LLM_LOOP_GUARD' }), new TypeError('x')]) {
    ia.impl = async () => { throw error; };
    const r = await classifySectors('Construcción de acueducto veredal', 'agua potable y saneamiento', '');
    assert.ok(Array.isArray(r), `${error.message}: devuelve array`);
  }
});

test('extractConvocatoriaFields: soloServidor + valida y recorta campos; NUNCA lanza (→ null)', async () => {
  const md = 'x'.repeat(200);
  ia.llamadas.length = 0;
  ia.impl = async (op) => ({ valor: op.validar('{"titulo":"Convocatoria 2026","monto_max":"5000","moneda":"USD"}') });
  const r = await extractConvocatoriaFields(md);
  assert.deepEqual([r.titulo, r.monto_max, r.moneda], ['Convocatoria 2026', 5000, 'USD']);
  const op = ia.llamadas[0];
  assert.deepEqual([op.userId, op.agente, op.soloServidor], ['sistema-radar-batch', 'markitdown-extract', true]);
  assert.ok(op.maxTokens >= 2048);
  ia.impl = async () => { throw new IaTopeSistemaError(); };
  assert.equal(await extractConvocatoriaFields(md), null);
  assert.equal(await extractConvocatoriaFields('corto'), null, 'markdown corto no gasta una llamada');
});

test('lookupEntidad y su búsqueda profunda pasan por llmProveedor (solo pool, tope, FinOps con el usuario real)', () => {
  const src = sinComentarios(readFileSync(join(RAIZ, 'server.js'), 'utf8'));
  assert.match(src, /agente:\s*'lookup-entidad',\s*soloServidor:\s*true/);
  // El middleware de auth define req.userId (req.user no existe): con
  // req.user?.id todo el gasto de lookup quedaba como 'sistema-lookup'.
  assert.match(src, /userId:\s*req\.userId \|\| 'sistema-lookup',\s*agente:\s*'lookup-entidad'/);
  assert.match(src, /runDeepSearch\(nombre, hostname, req\.userId \|\| 'sistema-lookup'\)/);
  assert.doesNotMatch(src, /req\.user\?\.id/, 'req.user no existe en este backend');
  assert.match(src, /buscarConGroundingServidor\(\{\s*userId:\s*userIdDeep/);
  assert.doesNotMatch(src, /GEMINI_API_KEY_FALLBACK/, 'ya no se usa una llave suelta fuera del pool');
});

test('el tope del sistema se configura al arrancar ANTES de startScheduler, con el pool principal', () => {
  const src = readFileSync(join(RAIZ, 'server.js'), 'utf8');
  const config = src.indexOf('configurarTopeSistema({ getRow, dbStatus })');
  const scheduler = src.indexOf('startScheduler();');
  assert.ok(config > 0 && scheduler > config);
});
