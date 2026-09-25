/**
 * agentes.test.mjs — scripts/agentes.mjs (lista honesta de agentes).
 * Un agente solo sale "activo" con archivo, ruta registrada y llamador reales;
 * un dominio sin código sale "definido, sin código". Sin red.
 * Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectarContexto, rutaARegex, parseFrontmatter, calcularEstado, reunirEvidencia, RAIZ_PROYECTO } from '../../scripts/agentes.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/agentes.mjs', import.meta.url));
const ruta = (o = {}) => ({ registrada: true, pantallas: ['client/src/pages/X.tsx'], soloDev: [], ...o });

test('contexto: dentro del proyecto → saas; fuera → elite; las banderas mandan', () => {
  assert.equal(detectarContexto({ cwd: RAIZ_PROYECTO }), 'saas');
  assert.equal(detectarContexto({ cwd: join(RAIZ_PROYECTO, 'backend', 'services') }), 'saas');
  assert.equal(detectarContexto({ cwd: join(RAIZ_PROYECTO, '..', '..') }), 'elite');
  assert.equal(detectarContexto({ cwd: join(RAIZ_PROYECTO, '..', 'Proy_03_RadarFondos_copia') }), 'elite', 'un prefijo parecido no cuenta como dentro');
  assert.equal(detectarContexto({ cwd: join(RAIZ_PROYECTO, '..', '..'), argv: ['--saas'] }), 'saas');
});

test('rutaARegex reconoce la llamada del cliente con parámetros y no confunde rutas vecinas', () => {
  const re = rutaARegex('/api/proyectos/:id/mirofish');
  assert.ok(re.test('http.post(`/api/proyectos/${proyectoId}/mirofish`, {})'));
  assert.ok(!re.test('`/api/proyectos/${id}/mirofish-extra`'));
  assert.ok(rutaARegex('/api/radar/buscar').test("fetchApi('/api/radar/buscar?q=x')"));
  assert.ok(!rutaARegex('/api/radar/buscar').test("fetchApi('/api/radar/buscar-masivo')"));
});

test('parseFrontmatter lee name/description/tools/gate', () => {
  const fm = parseFrontmatter('---\nname: 006-devsecops\ndescription: Fiscaliza infra\ntools: Read, Bash\ngate: {"x":1}\n---\ncuerpo');
  assert.equal(fm.name, '006-devsecops');
  assert.equal(fm.tools, 'Read, Bash');
  assert.ok(fm.gate);
  assert.deepEqual(parseFrontmatter('sin frontmatter'), {});
});

test('calcularEstado: nunca "activo" sin archivo, ruta registrada o pantalla real', () => {
  const base = { archivo: true, rutas: [ruta()], llamaLLM: true, uso: { n: 3, ultima: '2026-09-01' } };
  assert.equal(calcularEstado(base).estado, 'ACTIVO · en uso');
  assert.equal(calcularEstado({ ...base, archivo: false }).estado, 'NO EXISTE');
  assert.equal(calcularEstado({ ...base, rutas: [ruta({ registrada: false })] }).estado, 'DESCONECTADO');
  assert.equal(calcularEstado({ ...base, rutas: [ruta({ pantallas: [], soloDev: ['client/src/Dashboard.tsx'] })] }).estado, 'SIN INTERFAZ');
  assert.equal(calcularEstado({ ...base, rutas: [ruta({ pantallas: [] })], datos: { con: 0, total: 10 } }).estado, 'SIN INTERFAZ · SIN DATOS', 'ningún problema oculta al otro');
  assert.equal(calcularEstado({ ...base, rutas: [], invocadores: [{ ok: false }] }).estado, 'DESCONECTADO');
  assert.equal(calcularEstado({ ...base, uso: { n: 0, ultima: '—' } }).estado, 'ACTIVO · sin uso registrado');
  assert.equal(calcularEstado({ ...base, uso: null }).estado, 'ACTIVO · uso desconocido');
});

test('evidencia real del repo: rutas registradas, BYOK y llamadores correctos', () => {
  const ev = Object.fromEntries(reunirEvidencia().map(a => [a.id, a]));
  for (const a of Object.values(ev)) assert.ok(a.archivoOk, `${a.id}: archivo ${a.archivo}`);
  assert.equal(ev.mirofish.rutasEv[0].registrada, true);
  assert.equal(ev.mirofish.rutasEv[0].byok, true);
  assert.ok(ev.mirofish.rutasEv[0].pantallas.some(p => p.endsWith('ViabilidadPage.tsx')));
  assert.equal(ev.lookupEntidad.rutasEv[0].byok, false, 'la búsqueda de entidades no exige BYOK');
  assert.deepEqual(ev.busquedaSemantica.rutasEv.flatMap(r => r.pantallas), [], 'la búsqueda semántica no tiene pantalla real');
  assert.ok(ev.sectorClassifier.invocadores.some(i => i.ok));
});

test('script real modo SaaS (sin BD): GP "definido, sin código"; Radar y Formulador con funciones reales', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--saas', '--sin-bd', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { contexto, dominios } = JSON.parse(r.stdout);
  assert.equal(contexto, 'saas');
  const d = Object.fromEntries(dominios.map(x => [x.id, x]));
  assert.equal(d.GP.estado, 'definido, sin código');
  assert.equal(d.GP.miembros.length, 0);
  assert.ok(d.Radar.miembros.some(m => m.id === 'sectorClassifier'));
  assert.ok(d.Formulador.miembros.some(m => m.id === 'mirofish'));
  for (const m of [...d.Radar.miembros, ...d.Formulador.miembros]) assert.notEqual(m.estado, 'ACTIVO · en uso', 'sin BD nadie puede declararse "en uso"');
});

test('script real modo élite: lista las definiciones .claude/agents/NNN-*.md de la carpeta', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rf360-elite-'));
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', '001-orquestador.md'), '---\nname: 001-orquestador\ndescription: Coordina\n---\n');
  writeFileSync(join(dir, '.claude', 'agents', '002-arquitecto.md'), '---\nname: 002-arquitecto\ndescription: Fiscaliza\ngate: {}\n---\n');
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const salida = JSON.parse(r.stdout);
  assert.equal(salida.contexto, 'elite');
  assert.deepEqual(salida.agentes.map(a => a.nombre), ['001-orquestador', '002-arquitecto']);
  assert.equal(salida.agentes[1].gate, true);
});
