/**
 * higieneCatalogo.test.mjs — higiene de datos del catálogo (2026-09-29):
 * decodificador único de entidades, parser único de montos, plan del script
 * de saneamiento y que ningún parser duplicado sobreviva en server.js.
 * Sin BD. Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodificarEntidades } from '../../backend/utils/textoHtml.js';
import { extraerMonto, resolverMoneda, montoPlausible, montoParaGuardar, parsearNumero } from '../../backend/utils/montos.js';
import { planificarSaneamiento } from '../../backend/scripts/sanearCatalogo.mjs';

// Cadenas reales de producción (auditoría 2026-09-29), guardadas sin ';'.
const REALES = [
  ['2024 &#8211 Alianza Latinoamericana de Turismo Sostenible', '2024 – Alianza Latinoamericana de Turismo Sostenible'],
  ['CFC Commends Côte d&#039Ivoire–Netherlands Initiative', "CFC Commends Côte d'Ivoire–Netherlands Initiative"],
  ['Dashboard Real-time data on GCF&#039s portfolio', "Dashboard Real-time data on GCF's portfolio"],
  ['Complaints &amp Reports', 'Complaints & Reports'],
  ['Gender Equality &amp Social Inclusion (GESI)', 'Gender Equality & Social Inclusion (GESI)'],
];

test('entidades reales sin ";" se decodifican y el resultado es idempotente', () => {
  for (const [crudo, esperado] of REALES) {
    assert.equal(decodificarEntidades(crudo), esperado);
    assert.equal(decodificarEntidades(decodificarEntidades(crudo)), esperado, 'una segunda pasada no cambia nada');
  }
  assert.equal(decodificarEntidades('Tom &amp; Jerry &lt;b&gt;'), 'Tom & Jerry <b>');
});

test('una sola pasada, nombres desconocidos intactos y códigos peligrosos rechazados sin lanzar', () => {
  assert.equal(decodificarEntidades('&amp;lt;b&amp;gt;'), '&lt;b&gt;', 'nunca itera hasta estabilizar');
  assert.equal(decodificarEntidades('&amplt'), '&amplt', 'nombrada sin ";" seguida de letra: intacta');
  assert.equal(decodificarEntidades('&copy2024'), '&copy2024');
  for (const peligroso of ['&#1', '&#x202E', '&#x2066', '&#xD800', '&#9999999', '&#x110000', '&#127', '&#x9F']) {
    assert.equal(decodificarEntidades(`a ${peligroso} b`), `a ${peligroso} b`, `${peligroso} queda como texto`);
  }
  assert.equal(decodificarEntidades('tab&#9fin'), 'tab\tfin');
  assert.equal(decodificarEntidades(null), null);
});

test('parsearNumero distingue miles de decimales en notación española e inglesa', () => {
  assert.equal(parsearNumero('45.249'), 45249);
  assert.equal(parsearNumero('45.249.000'), 45249000);
  assert.equal(parsearNumero('1,000,000.50'), 1000000.5);
  assert.equal(parsearNumero('1.000.000,75'), 1000000.75);
  assert.equal(parsearNumero('1.5'), 1.5);
  assert.equal(parsearNumero('2,5'), 2.5);
  assert.equal(parsearNumero('50 000'), 50000);
});

test('extraerMonto + resolverMoneda + montoParaGuardar sobre textos reales', () => {
  const casos = [
    ['hasta 30 millones de pesos', 'Colombia', 'COP', 30_000_000],
    ['Monto máximo: $ 45.249.000', 'Colombia', 'COP', 45_249_000],
    ['up to $50,000 per project', 'Estados Unidos', 'USD', 50_000],
    ['5 million USD available', '', 'USD', 5_000_000],
    ['Grants of €500K', '', 'EUR', 500_000],
    ['financiación de 1.500 millones COP', 'Colombia', 'COP', 1_500_000_000],
    ['hasta 2,5 millones de dólares', '', 'USD', 2_500_000],
    ['£ 1.2 million', '', 'GBP', 1_200_000],
    ['Convocatoria 2026 USD', '', 'USD', 0],
    ['$ 30', 'Colombia', 'COP', 0],
  ];
  for (const [texto, pais, moneda, guardado] of casos) {
    const info = extraerMonto(texto);
    const m = resolverMoneda(info, pais);
    assert.equal(m, moneda, `${texto}: moneda`);
    assert.equal(montoParaGuardar(info.valor, m), guardado, `${texto}: monto`);
  }
  assert.equal(extraerMonto('Sin monto aquí'), null);
  assert.equal(extraerMonto('up to $50,000').ambigua, true, '"$" suelto se marca ambiguo');
  assert.equal(resolverMoneda({ moneda: 'USD', ambigua: true }, '["Colombia"]'), 'COP', 'paises_elegibles en JSON también sirve');
});

test('montoPlausible: pisos por moneda, años sueltos y techo', () => {
  assert.equal(montoPlausible(877.8, 'COP'), false);
  assert.equal(montoPlausible(999_999, 'COP'), false);
  assert.equal(montoPlausible(1_000_000, 'COP'), true);
  assert.equal(montoPlausible(55, 'USD'), false);
  assert.equal(montoPlausible(2026, 'USD'), false);
  assert.equal(montoPlausible(1_000, 'EUR'), true);
  assert.equal(montoPlausible(1e14, 'USD'), false);
  assert.equal(montoPlausible(0, 'USD'), false);
  assert.equal(montoPlausible(Number.NaN, 'USD'), false);
});

test('planificarSaneamiento: cambia entidades y montos, manda a revisión lo que sanitize alteraría', () => {
  const sanitizar = s => s.replace(/<[^>]*>/g, '').replace(/;/g, '').trim().slice(0, 512);
  const filas = [
    { id: 'a', titulo: 'GCF&#039s portfolio', descripcion: 'sin entidades', donante: 'GCF', monto_min: 0, monto_max: 30, moneda: 'COP' },
    { id: 'b', titulo: 'Menores de &lt; 5 años y &gt; 60', descripcion: '', donante: '', monto_min: 0, monto_max: 5e6, moneda: 'USD' },
    { id: 'c', titulo: 'Doble &amp;amp codificado', descripcion: null, donante: null, monto_min: 55, monto_max: 2026, moneda: 'USD' },
  ];
  const { cambios, revision } = planificarSaneamiento(filas, { sanitizar });
  assert.deepEqual(cambios.filter(c => c.id === 'a').map(c => [c.campo, c.nuevo]), [['titulo', "GCF's portfolio"], ['monto_max', 0]]);
  assert.equal(cambios.some(c => c.id === 'b'), false, 'fila b: monto plausible y título a revisión');
  assert.deepEqual(revision.map(r => [r.id, r.razon]), [
    ['b', 'sanitizeInput borraría algo más que entidades'],
    ['c', 'doble codificación: no sería idempotente'],
  ]);
  assert.deepEqual(cambios.filter(c => c.id === 'c').map(c => c.campo).sort(), ['monto_max', 'monto_min']);
  // Idempotencia: aplicar el plan y re-planificar no produce cambios.
  const aplicadas = filas.map(f => ({ ...f }));
  for (const c of cambios) aplicadas.find(f => f.id === c.id)[c.campo] = c.nuevo;
  assert.equal(planificarSaneamiento(aplicadas, { sanitizar }).cambios.length, 0);
});

test('un solo parser de montos: server.js y EntityScraper usan backend/utils/montos.js', () => {
  const srv = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const scr = fs.readFileSync(new URL('../../backend/pipeline/EntityScraper.js', import.meta.url), 'utf8');
  const ing = fs.readFileSync(new URL('../../backend/pipeline/DataIngestor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(srv, /MONTO_ENRICH_RE/);
  assert.doesNotMatch(scr, /const MONTO_RE\b|CURRENCY_MAP/);
  for (const [nombre, src] of [['server.js', srv], ['EntityScraper.js', scr], ['DataIngestor.js', ing]]) {
    assert.match(src, /from '\.{1,2}\/(backend\/)?utils\/montos\.js'/, `${nombre} importa el parser único`);
  }
  assert.doesNotMatch(ing, /item\.moneda \|\| 'USD'/, 'DataIngestor ya no fija USD');
  assert.match(scr, /function stripTags[\s\S]{0,200}decodificarEntidades/, 'stripTags decodifica entidades');
});
