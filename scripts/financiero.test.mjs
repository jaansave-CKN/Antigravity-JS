// financiero.test.mjs — primera cobertura determinista de la lógica FINANCIERA
// real de la app (Misión 2, directiva 005_INGENIERO_BACKEND, 2026-08-13).
// Antes de este archivo: 0% de cobertura sobre dinero real en COP.
//
// Bajo prueba: AGT-053 (AgentOperativo), la única clase que calcula dinero en
// este proyecto — src/orchestrator-engine.js:134-152. Fórmula fijada aquí
// (verificada línea por línea antes de escribir estos tests, no asumida):
//   costo_directo     = Σ (cantidad * precio_unitario) de bill_of_materials
//   aiu_25            = Math.round(costo_directo * 0.25)
//   iva_sobre_aiu     = Math.round(aiu_25 * 0.19)      ← IVA sobre el AIU, NO sobre costo_directo ni sobre el total
//   presupuesto_total = costo_directo + aiu_25 + iva_sobre_aiu
//
// No se accede a AgentOperativo directamente porque no se exporta desde el
// módulo (solo Orchestrator000 y setServerAuthToken son exports públicos) —
// se instancia Orchestrator000 y se usa su propiedad _agents.AGT_053, que es
// una propiedad de clase normal (no un campo privado `#`), así que es
// accesible desde este archivo de test sin tocar src/orchestrator-engine.js.
//
// Corre con: node --test scripts/financiero.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator000 } from '../src/orchestrator-engine.js';

function agenteOperativo() {
  // Orchestrator000 no expone un getter público para AGT_053; process()
  // completo requiere pasar el gate de diseño (validarDiseno/run), que es
  // más ceremonia de la necesaria para probar en aislamiento la fórmula
  // financiera pura de AGT-053. Se accede a la instancia directamente.
  return new Orchestrator000()._agents.AGT_053;
}

// Réplica INDEPENDIENTE de la fórmula real, calculada paso a paso (nunca en
// una sola expresión) para no arrastrar el mismo error de redondeo que el
// código bajo prueba pudiera tener — si el código real y esta réplica
// paso-a-paso alguna vez divergen, el test debe fallar, no coincidir por
// construcción.
function calcularEsperado(insumos) {
  const costo_directo = insumos.reduce((acc, item) => acc + ((item.cantidad || 0) * (item.precio_unitario || 0)), 0);
  const aiu_25 = Math.round(costo_directo * 0.25);
  const iva_sobre_aiu = Math.round(aiu_25 * 0.19);
  const presupuesto_total = costo_directo + aiu_25 + iva_sobre_aiu;
  return { costo_directo, aiu_25, iva_sobre_aiu, presupuesto_total };
}

test('AGT-053: caso normal — insumos con cantidad y precio_unitario válidos', async () => {
  const insumos = [
    { cantidad: 10, precio_unitario: 50000 },
    { cantidad: 5, precio_unitario: 20000 },
  ];
  const esperado = calcularEsperado(insumos);
  // Fijado a mano para que el test no dependa únicamente de la réplica de la
  // fórmula (si ambas tuvieran el mismo bug, coincidirían igual):
  // costo_directo = 500000 + 100000 = 600000
  // aiu_25 = round(600000 * 0.25) = 150000
  // iva_sobre_aiu = round(150000 * 0.19) = 28500
  // presupuesto_total = 600000 + 150000 + 28500 = 778500
  assert.deepEqual(esperado, {
    costo_directo: 600000, aiu_25: 150000, iva_sobre_aiu: 28500, presupuesto_total: 778500,
  });

  const ficha = { technical_core: { bill_of_materials: insumos } };
  const r = await agenteOperativo().process(ficha);
  assert.deepEqual(r.resumen_financiero, esperado);
});

test('AGT-053: IVA se calcula sobre el AIU, no sobre costo_directo ni sobre el total (no invierte el orden)', async () => {
  // costo_directo = 101 * 1 = 101 → intermedios no exactos, expone cualquier
  // desvío de orden de cálculo (redondeo intermedio vs. una sola expresión).
  const insumos = [{ cantidad: 101, precio_unitario: 1 }];
  const ficha = { technical_core: { bill_of_materials: insumos } };
  const r = await agenteOperativo().process(ficha);

  assert.equal(r.resumen_financiero.costo_directo, 101);
  assert.equal(r.resumen_financiero.aiu_25, 25, 'round(101 * 0.25) = round(25.25) = 25');
  assert.equal(r.resumen_financiero.iva_sobre_aiu, 5, 'round(25 * 0.19) = round(4.75) = 5 — IVA sobre AIU, no sobre costo_directo (round(101*0.19)=19) ni sobre el total');
  assert.equal(r.resumen_financiero.presupuesto_total, 131, '101 + 25 + 5');
});

test('AGT-053: caso límite — costo_directo = 0 (insumos con cantidad/precio en cero)', async () => {
  const insumos = [{ cantidad: 0, precio_unitario: 0 }, { cantidad: 10, precio_unitario: 0 }];
  const ficha = { technical_core: { bill_of_materials: insumos } };
  const r = await agenteOperativo().process(ficha);
  assert.deepEqual(r.resumen_financiero, {
    costo_directo: 0, aiu_25: 0, iva_sobre_aiu: 0, presupuesto_total: 0,
  });
});

test('AGT-053: caso límite — bill_of_materials es un arreglo vacío', async () => {
  const ficha = { technical_core: { bill_of_materials: [] } };
  const r = await agenteOperativo().process(ficha);
  assert.deepEqual(r.resumen_financiero, {
    costo_directo: 0, aiu_25: 0, iva_sobre_aiu: 0, presupuesto_total: 0,
  });
});

test('AGT-053: caso límite — bill_of_materials ausente (technical_core sin ese campo) usa fallback ?? []', async () => {
  const ficha = { technical_core: {} };
  const r = await agenteOperativo().process(ficha);
  assert.deepEqual(r.resumen_financiero, {
    costo_directo: 0, aiu_25: 0, iva_sobre_aiu: 0, presupuesto_total: 0,
  });
});

test('AGT-053: caso límite — technical_core ausente por completo (ficha vacía) usa fallback ?. y ?? []', async () => {
  const ficha = {};
  const r = await agenteOperativo().process(ficha);
  assert.deepEqual(r.resumen_financiero, {
    costo_directo: 0, aiu_25: 0, iva_sobre_aiu: 0, presupuesto_total: 0,
  });
});

test('AGT-053: caso límite — items sin cantidad o sin precio_unitario tratan el campo faltante como 0 (item.cantidad || 0)', async () => {
  const insumos = [
    { cantidad: 5 },                     // sin precio_unitario → aporta 0
    { precio_unitario: 30000 },          // sin cantidad → aporta 0
    { cantidad: 2, precio_unitario: 1000 }, // aporta 2000
  ];
  const ficha = { technical_core: { bill_of_materials: insumos } };
  const r = await agenteOperativo().process(ficha);
  assert.equal(r.resumen_financiero.costo_directo, 2000);
});

test('AGT-053: todo resultado de dinero es un entero (COP no usa decimales) — varios montos, ninguno debe ser float', async () => {
  const fixtures = [
    [{ cantidad: 1, precio_unitario: 1 }],
    [{ cantidad: 3, precio_unitario: 999 }],
    [{ cantidad: 7, precio_unitario: 123457 }],
    [{ cantidad: 101, precio_unitario: 1 }],
    [],
  ];
  for (const insumos of fixtures) {
    const ficha = { technical_core: { bill_of_materials: insumos } };
    const r = await agenteOperativo().process(ficha);
    const { costo_directo, aiu_25, iva_sobre_aiu, presupuesto_total } = r.resumen_financiero;
    for (const [campo, valor] of Object.entries({ costo_directo, aiu_25, iva_sobre_aiu, presupuesto_total })) {
      assert.equal(Number.isInteger(valor), true, `${campo} debe ser entero (COP), se obtuvo ${valor} para insumos=${JSON.stringify(insumos)}`);
    }
  }
});

test('AGT-053: ninguna ruta de este módulo introduce "USD" u otro código de moneda distinto de COP', async () => {
  // Mismo criterio que scripts/check_veto_008.cjs (verificarSQL/verificarJS):
  // heurística de texto sobre la cadena "USD" — sin reinventar un umbral
  // distinto al ya establecido como gate del proyecto.
  const insumos = [{ cantidad: 10, precio_unitario: 50000 }];
  const ficha = { technical_core: { bill_of_materials: insumos } };
  const r = await agenteOperativo().process(ficha);
  const serializado = JSON.stringify(r);
  assert.equal(/\bUSD\b/.test(serializado), false, `resultado de AGT-053 no debe contener "USD": ${serializado}`);
});
