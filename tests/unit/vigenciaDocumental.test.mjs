/**
 * vigenciaDocumental.test.mjs — F-10: reglas de vigencia (puras, sin BD).
 * Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularVigencia, hoyBogota, esFechaValida } from '../../backend/services/vigenciaDocumental.js';

const v = (tipo_vigencia, fecha_documento, hoy) => calcularVigencia({ tipo_vigencia, fecha_documento }, hoy);

test('Libertad y Tradición: vigente hasta el día 30, vencido el 31', () => {
  assert.equal(v('libertad_tradicion', '2026-09-01', '2026-10-01').estado, 'vigente');   // día 30
  assert.equal(v('libertad_tradicion', '2026-09-01', '2026-10-01').dias_restantes, 0);
  assert.equal(v('libertad_tradicion', '2026-09-01', '2026-10-02').estado, 'vencido');   // día 31
  assert.equal(v('libertad_tradicion', '2026-09-01', '2026-10-02').vence_el, '2026-10-01');
});

test('APU / Cotización: 6 meses calendario con recorte a fin de mes', () => {
  assert.equal(v('apu_cotizacion', '2026-03-15', '2026-09-15').estado, 'vigente');
  assert.equal(v('apu_cotizacion', '2026-03-15', '2026-09-16').estado, 'vencido');
  assert.equal(v('apu_cotizacion', '2025-08-31', '2026-02-28').vence_el, '2026-02-28');   // no bisiesto
  assert.equal(v('apu_cotizacion', '2027-08-31', '2028-02-29').vence_el, '2028-02-29');   // bisiesto
  assert.equal(v('apu_cotizacion', '2025-08-31', '2026-03-01').estado, 'vencido');
});

test('General (topografía, suelos, POT): nunca vence, advertencia pasado 1 año', () => {
  assert.equal(v('general', '2025-09-24', '2026-09-24').estado, 'vigente');
  assert.equal(v('general', '2025-09-24', '2026-09-25').estado, 'advertencia');
  assert.equal(v('general', '2025-09-24', '2026-09-25').vence_el, null);
  assert.equal(v('general', '2025-09-24', '2026-09-25').revisar_desde, '2026-09-24');
});

test('sin fecha, fecha imposible y tipo desconocido', () => {
  assert.equal(v('apu_cotizacion', null, '2026-09-24').estado, 'sin_fecha');
  assert.equal(v('general', '2026-02-30', '2026-09-24').estado, 'fecha_invalida');
  assert.equal(v('inventado', '2026-01-01', '2026-09-24').tipo_vigencia, 'general');
  assert.equal(esFechaValida('2026-02-29'), false);
  assert.equal(esFechaValida('2028-02-29'), true);
});

test('hoyBogota usa la zona de Colombia (UTC-5), no la del servidor', () => {
  // 2026-09-25 03:00 UTC es todavía 2026-09-24 22:00 en Bogotá.
  assert.equal(hoyBogota(new Date('2026-09-25T03:00:00Z')), '2026-09-24');
  assert.equal(hoyBogota(new Date('2026-09-25T05:00:00Z')), '2026-09-25');
});
