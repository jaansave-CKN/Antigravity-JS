/**
 * aislamientoModulos.test.mjs — Fase 4 (dictamen architect 2026-09-28):
 * regla de aislamiento Radar (A) ↔ Formulador (B) por grafo de imports.
 * Incluye repos de prueba (mkdtemp) donde la regla DEBE fallar, para probar
 * que el test no pasa en verde por construcción.
 * Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analizarImports, extraerImports, globARegex } from '../../scripts/aislamiento.mjs';
import { MODULOS, FUNCIONES } from '../../backend/agents/modulos.map.js';
import { CATALOGO } from '../../scripts/agentes.mjs';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

function repoFalso(archivos) {
  const raiz = mkdtempSync(join(tmpdir(), 'aislamiento-'));
  for (const [rel, src] of Object.entries(archivos)) {
    mkdirSync(join(raiz, dirname(rel)), { recursive: true });
    writeFileSync(join(raiz, rel), src);
  }
  return raiz;
}
const MOD_PRUEBA = {
  A_RADAR: { rutas: ['backend/services/radar*.js', 'backend/agents/radar/**'] },
  B_FORMULADOR: { rutas: ['backend/services/form*.js', 'backend/agents/formulador/**'] },
  NEUTRAL: { rutas: ['backend/services/neutral*.js', 'backend/utils/**'] },
  GP: { rutas: ['backend/agents/gp/**'] },
  COMPOSICION: { rutas: ['server.js'] },
};

test('el repo real cumple: 0 violaciones A↔B y todos los archivos clasificados', () => {
  const { violaciones, sinClasificar } = analizarImports(RAIZ, MODULOS);
  assert.deepEqual(violaciones, []);
  assert.deepEqual(sinClasificar, []);
});

test('detecta A → B directo y B → A', () => {
  const raiz = repoFalso({
    'backend/services/radarX.js': "import { f } from './formY.js';",
    'backend/services/formY.js': "import { g } from './radarX.js';",
  });
  try {
    const { violaciones } = analizarImports(raiz, MOD_PRUEBA);
    assert.ok(violaciones.some(v => v.startsWith('A_RADAR alcanza B_FORMULADOR')));
    assert.ok(violaciones.some(v => v.startsWith('B_FORMULADOR alcanza A_RADAR')));
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('detecta el túnel A → NEUTRAL → B (y que NEUTRAL importe B)', () => {
  const raiz = repoFalso({
    'backend/services/radarX.js': "import { n } from './neutralZ.js';",
    'backend/services/neutralZ.js': "export * from './formY.js';",
    'backend/services/formY.js': 'export const y = 1;',
  });
  try {
    const { violaciones } = analizarImports(raiz, MOD_PRUEBA);
    assert.ok(violaciones.some(v => /^A_RADAR alcanza B_FORMULADOR: .*neutralZ\.js → .*formY\.js/.test(v)));
    assert.ok(violaciones.some(v => v.startsWith('NEUTRAL importa B_FORMULADOR')));
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('detecta un import DINÁMICO cruzado', () => {
  const raiz = repoFalso({
    'backend/services/formY.js': "const m = await import('./radarX.js');",
    'backend/services/radarX.js': 'export const x = 1;',
  });
  try {
    assert.ok(analizarImports(raiz, MOD_PRUEBA).violaciones.some(v => v.startsWith('B_FORMULADOR alcanza A_RADAR')));
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('GP solo puede importar coordinadores; solo COMPOSICION importa GP', () => {
  const raiz = repoFalso({
    'backend/agents/gp/g.js': "import * as a from '../radar/index.js'; import { f } from '../../services/formY.js';",
    'backend/agents/radar/index.js': 'export const a = 1;',
    'backend/services/formY.js': "import { g } from '../agents/gp/g.js';",
  });
  try {
    const { violaciones } = analizarImports(raiz, MOD_PRUEBA);
    assert.ok(violaciones.some(v => v.startsWith('GP importa una función hoja (B_FORMULADOR)')));
    assert.ok(violaciones.some(v => v.startsWith('solo COMPOSICION importa GP')));
    assert.equal(violaciones.some(v => v.includes('radar/index.js') && v.startsWith('GP importa')), false, 'el coordinador sí está permitido');
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('un archivo nuevo sin clasificar hace fallar la regla', () => {
  const raiz = repoFalso({ 'backend/services/nuevoServicio.js': 'export const x = 1;' });
  try {
    assert.deepEqual(analizarImports(raiz, MOD_PRUEBA).sinClasificar, ['backend/services/nuevoServicio.js']);
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});

test('extracción de imports: ignora comentarios y paquetes; glob con ** y *', () => {
  assert.deepEqual(extraerImports("// import x from './no.js'\nimport a from './si.js';\nimport 'pg';\nexport { b } from \"./tambien.js\";").sort(), ['./si.js', './tambien.js', 'pg'].sort());
  assert.ok(globARegex('backend/agents/radar/**').test('backend/agents/radar/sub/x.js'));
  assert.equal(globARegex('backend/services/radar*.js').test('backend/services/sub/radarX.js'), false);
});

test('las 14 funciones del Nivel 3 son exactamente las del CATALOGO de agentes.mjs (5 Radar + 9 Formulador; +expedienteFinanciador 2026-09-30)', () => {
  assert.deepEqual(FUNCIONES.map(f => f.id).sort(), CATALOGO.map(c => c.id).sort());
  assert.equal(FUNCIONES.filter(f => f.modulo === 'A_RADAR').length, 5);
  assert.equal(FUNCIONES.filter(f => f.modulo === 'B_FORMULADOR').length, 9);
});

test('regresión: el barrido ya no lee proyectos.embedding en línea (lo hace el GP vía el coordinador)', () => {
  assert.doesNotMatch(readFileSync(join(RAIZ, 'server.js'), 'utf8'), /SELECT embedding FROM proyectos/);
});
