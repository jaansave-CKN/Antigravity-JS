/**
 * mirofishReglas.test.mjs — F-09: reglas deterministas MIROFISH (puras).
 * Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emparejarMunicipioPdet, evaluarReglas, lineasDeSeguridad } from '../../backend/services/mirofishReglas.js';

const u = (valor, campo = 'entrada.municipio') => [{ campo, valor }];
const L = (...valores) => valores.map((valor, i) => ({ campo: `apu[${i + 1}].descripcion`, valor }));

test('emparejamiento PDET: exacta, homónimo de otro departamento, solo nombre, ambigua, sin ubicación', () => {
  const exacta = emparejarMunicipioPdet(u('Argelia, Cauca'));
  assert.equal(exacta.tipo, 'exacta');
  assert.equal(exacta.municipio.cod_muni, '19050');

  const homonimo = emparejarMunicipioPdet(u('Argelia - Valle del Cauca'));
  assert.equal(homonimo.tipo, 'no_pdet');
  assert.equal(homonimo.nota, 'homonimo_otro_departamento');

  assert.equal(emparejarMunicipioPdet(u('Tibú')).tipo, 'solo_nombre');
  assert.equal(emparejarMunicipioPdet(u('Morales')).tipo, 'ambigua');             // Bolívar y Cauca
  assert.equal(emparejarMunicipioPdet(u('Morales, Cauca')).tipo, 'exacta');
  assert.equal(emparejarMunicipioPdet(u('Medellín, Antioquia')).tipo, 'no_pdet');
  assert.equal(emparejarMunicipioPdet([{ campo: 'x', valor: '  ' }]).tipo, 'sin_ubicacion');
});

test('rubro de seguridad: la seguridad ocupacional (EPP) NO cuenta; vigilancia y orden público sí', () => {
  assert.equal(lineasDeSeguridad(L('Casco de seguridad industrial (EPP)', 'Seguridad y salud en el trabajo')).length, 0);
  assert.equal(lineasDeSeguridad(L('Servicio de vigilancia 24h')).length, 1);
  assert.equal(lineasDeSeguridad(L('Plan de manejo de orden público')).length, 1);
  assert.equal(lineasDeSeguridad(L('Escoltas para transporte de materiales')).length, 1);
});

test('R1: PDET sin rubro de seguridad → CRÍTICA; con rubro → sin hallazgo; sin presupuesto → INFO', () => {
  const sinSeg = evaluarReglas({ ubicacion: u('Argelia, Cauca'), lineasPresupuesto: L('Excavación manual', 'Casco de seguridad industrial (EPP)'), tramos: [] });
  const r1 = sinSeg.hallazgos.find(h => h.regla === 'R1');
  assert.equal(r1.severidad, 'CRITICA');
  assert.ok(r1.evidencia.some(e => e.campo === 'entrada.municipio'));

  const conSeg = evaluarReglas({ ubicacion: u('Argelia, Cauca'), lineasPresupuesto: L('Excavación', 'Servicio de vigilancia'), tramos: [] });
  assert.equal(conSeg.hallazgos.filter(h => h.regla === 'R1').length, 0);

  const sinPres = evaluarReglas({ ubicacion: u('Argelia, Cauca'), lineasPresupuesto: [], tramos: [] });
  assert.equal(sinPres.hallazgos.find(h => h.regla === 'R1').severidad, 'INFO');

  const noPdet = evaluarReglas({ ubicacion: u('Medellín, Antioquia'), lineasPresupuesto: L('Excavación'), tramos: [] });
  assert.equal(noPdet.hallazgos.length, 0);
});

test('R2: tramo con orden público "Sí" sin rubro de seguridad → ALTA con evidencia del tramo', () => {
  const r = evaluarReglas({
    ubicacion: u('Medellín, Antioquia'), lineasPresupuesto: L('Excavación'),
    tramos: [{ numero: '01', orden_publico: 'No' }, { numero: '02', orden_publico: 'Sí' }],
  });
  const r2 = r.hallazgos.find(h => h.regla === 'R2');
  assert.equal(r2.severidad, 'ALTA');
  assert.deepEqual(r2.evidencia, [{ campo: 'tramo[02].orden_publico', valor: 'Sí' }]);
});
