/**
 * puntosCiegos.test.mjs — sellado de puntos ciegos (2026-09-29):
 * control de planes en CI, curaduría (fondos continuos), purga única con
 * respaldo, sellado admin, URL pública única y respaldo AWS en espera.
 * Sin BD ni red. Ejecutar: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { motivoBasura } from '../../backend/utils/tituloBasura.js';
import { planificarPurga, purgarBasuraConRespaldo, TOPE_PURGA_AUTOMATICA, SQL_SOFT_DELETE_CON_RESPALDO } from '../../backend/services/purgaCatalogo.js';
import { validarCuraduria } from '../../backend/scripts/purgarBasuraCatalogo.mjs';
import { urlPublica } from '../../backend/utils/urlPublica.js';

const leer = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const srv = leer('server.js');

// ── Control de planes en CI ─────────────────────────────────────────────────
test('planes: una sola bandera y los 4 gates de planes la usan (sin bypass DEV directo)', () => {
  assert.match(leer('client/src/lib/planes.ts'), /!import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_TEST_PLAN_ENFORCEMENT === 'true'/);
  const main = leer('client/src/main.tsx');
  const gate = main.slice(main.indexOf('function PlanGate'), main.indexOf('function RouteLoadingFallback'));
  assert.match(gate, /if \(!planesAplicados\) return/);
  assert.doesNotMatch(gate, /import\.meta\.env\.DEV/);
  assert.match(leer('client/src/components/AppLeftNav.tsx'), /const devBypass = !planesAplicados;/);
  const top = leer('client/src/components/TopNavBar.tsx');
  assert.doesNotMatch(top, /!import\.meta\.env\.DEV && (isAuth|isDemo)/);
  assert.equal((top.match(/planesAplicados &&/g) || []).length, 3);
  const ci = leer('.github/workflows/playwright.yml');
  assert.match(ci, /VITE_TEST_PLAN_ENFORCEMENT: 'true'/);
  assert.match(ci, /test "\$restantes" = "0"/, 'residuos E2E hacen fallar el CI');
  assert.match(leer('tests/e2e/planes-bloqueo.spec.ts'), /process\.env\.CI[\s\S]{0,80}expect\(BANDERA/);
});

test('Entrada: la hidratación no pisa lo escrito durante la carga y siempre re-evalúa el autoguardado', () => {
  const s = leer('client/src/hooks/entrada/useEntradaPersistencia.ts');
  assert.match(s, /setSt\(actual => conservarEdicionesDuranteCarga\(st, merged, actual\)\)/, 'updater funcional que conserva ediciones');
  assert.doesNotMatch(s, /^\s*setSt\(merged\);/m, 'nunca reemplazo directo (en código, no en comentarios)');
  assert.match(s, /if \(!estadoActualizado\) setSt\(actual => \(\{ \.\.\.actual \}\)\)/, 'fuerza re-render al habilitar el auto-save');
});

// ── Filtro de basura ampliado ───────────────────────────────────────────────
test('ruido heredado: la basura real medida se detecta', () => {
  for (const t of ['Sign up to receive email updates', 'Download the full spreadsheet', 'Selector de idioma', 'Open access policy',
    'Tender opportunities', 'Valores Institucionales', 'Security and defence', 'LinkedIn ideas group', 'Innovation', 'Convocatorias']) {
    assert.ok(motivoBasura(t), `basura: ${t}`);
  }
});

test('ruido heredado: los nombres de fondos reales que traían las listas viejas NO se marcan', () => {
  for (const t of ['Green Climate Fund', 'Readiness Grant Program', 'Small Grants', 'Access Funding', 'Receive Funding',
    'Línea de crédito para pymes rurales', 'Sustainable Cities Challenge Fund', 'Empowering Women Fund', 'Become a Fellow',
    'Join our Fellowship Program', 'IMG call 2026', 'International Fellowships Program', 'Innovation Fund 2026',
    'Development Grants for Youth', 'Convocatoria de evaluadores 2026', 'Política de género – fondo de apoyo',
    'Capacity Building Grant', 'Resilience Fund for Coastal Communities',
    // Convocatoria real entre comillas (Fundación Munich Re): el patrón viejo de testimonios la habría borrado.
    '“NIÑOS, NIÑAS Y JÓVENES COMO AGENTES DE CAMBIO PARA LA RRD”']) {
    assert.equal(motivoBasura(t), null, `legítima: ${t}`);
  }
});

// ── Curaduría ────────────────────────────────────────────────────────────────
test('curaduría: listas disjuntas, tamaños fijados y ningún fondo sería purgado por el filtro', () => {
  const cur = JSON.parse(leer('backend/data/curaduria_catalogo_2026-09-29.json'));
  assert.deepEqual(validarCuraduria(cur), { fondos: 14, purgar: 204 });
  for (const f of cur.fondos_continuos) {
    assert.ok(f.motivo, `fondo con motivo: ${f.titulo}`);
    assert.equal(motivoBasura(f.titulo), null, `el filtro no marca el fondo ${f.titulo}`);
  }
  assert.throws(() => validarCuraduria({ fondos_continuos: [{ id: 'a', titulo: 'x' }], purgar: [{ id: 'a', titulo: 'x' }] }), /ambas listas/);
});

// ── Servicio único de purga ─────────────────────────────────────────────────
test('purga: nunca planifica fondos continuos', () => {
  const plan = planificarPurga([
    { id: '1', titulo: 'Terms of use', estado: 'abierta' },
    { id: '2', titulo: 'Terms of use', estado: 'fondo_continuo' },
  ]);
  assert.deepEqual(plan.map(p => p.id), ['1']);
  assert.match(SQL_SOFT_DELETE_CON_RESPALDO, /estado <> 'fondo_continuo'/);
  assert.match(SQL_SOFT_DELETE_CON_RESPALDO, /INSERT INTO convocatorias_saneamiento_respaldo/);
});

test('purga automática: sin Capa 1 no borra; sobre el tope no borra; omite filas referenciadas', async () => {
  const hacerDb = ({ pg = true, filas = [], refs = [] } = {}) => {
    const escritas = [];
    return {
      escritas,
      dbStatus: () => ({ pgReady: pg }),
      getRows: async (sql) => (/FROM convocatorias/.test(sql) ? filas : /user_favorites/.test(sql) ? refs.map(id => ({ id })) : []),
      runSql: async (sql, p) => { escritas.push(p[0]); return { rowCount: 1 }; },
    };
  };
  const sinPg = hacerDb({ pg: false });
  assert.deepEqual(await purgarBasuraConRespaldo(sinPg, { lote: 'l' }), { accion: 'omitida', motivo: 'sin_capa_1', eliminados: 0 });

  const muchas = Array.from({ length: TOPE_PURGA_AUTOMATICA + 1 }, (_, i) => ({ id: String(i), titulo: 'Terms of use', estado: 'abierta' }));
  const tope = hacerDb({ filas: muchas });
  const r1 = await purgarBasuraConRespaldo(tope, { lote: 'l' });
  assert.equal(r1.motivo, 'supera_tope');
  assert.equal(tope.escritas.length, 0);

  const db = hacerDb({ filas: [
    { id: 'a', titulo: 'Terms of use', estado: 'abierta' },
    { id: 'b', titulo: 'Skip to content', estado: 'cerrada' },
    { id: 'c', titulo: 'Green Climate Fund', estado: 'abierta' },
    { id: 'd', titulo: 'Terms of use', estado: 'fondo_continuo' },
  ], refs: ['b'] });
  const r2 = await purgarBasuraConRespaldo(db, { lote: 'l' });
  assert.deepEqual([r2.candidatos, r2.eliminados, r2.conReferencias], [2, 1, 1]);
  assert.deepEqual(db.escritas, ['a']);
});

test('purga: el cron y POST /api/radar/expirar usan el servicio único (sin listas propias ni borrado sin respaldo)', () => {
  const cron = leer('backend/pipeline/CronScheduler.js');
  assert.doesNotMatch(cron, /const NOISE_CRON_RE|SET deleted_at/);
  assert.match(cron, /purgarBasuraConRespaldo\(/);
  assert.doesNotMatch(srv, /const NOISE_RE = new RegExp/);
  const expirar = srv.slice(srv.indexOf("app.post('/api/radar/expirar'"), srv.indexOf("app.post('/api/radar/cerrar-ids'"));
  assert.match(expirar, /purgarBasuraConRespaldo\(/);
  assert.doesNotMatch(expirar, /SET deleted_at/);
});

// ── Estado fondo_continuo ────────────────────────────────────────────────────
test('fondo_continuo: la ingesta no lo revierte y queda fuera de búsqueda, cobertura y embeddings', () => {
  for (const f of ['backend/pipeline/EntityScraper.js', 'backend/pipeline/DataIngestor.js']) {
    const s = leer(f);
    assert.match(s, /existing\.estado === 'fondo_continuo'\s*\?\s*'UPDATE convocatorias SET fecha_limite = \? WHERE id = \?'/, f);
  }
  for (const f of ['backend/agents/radar/index.js', 'backend/pipeline/EmbeddingsBatch.js']) {
    const s = leer(f);
    assert.doesNotMatch(s, /estado != 'cerrada'/, f);
    assert.match(s, /estado NOT IN \('cerrada', 'fondo_continuo'\)/, f);
  }
  assert.match(srv, /estado === 'fondo_continuo'\) \{\s*\/\/[^\n]*\n[^\n]*\n\s*where \+= ` AND c\.estado = 'fondo_continuo'`/);
  assert.match(leer('client/src/pages/LayoutPadre.tsx'), /<option value="fondo_continuo">Fondos continuos<\/option>/);
  assert.match(leer('backend/validators/zodSchemas.js'), /'nueva', 'fondo_continuo'\]/);
});

// ── Sellado admin ────────────────────────────────────────────────────────────
test('sellado: las rutas que alteran el catálogo global exigen requireAdmin', () => {
  for (const [metodo, ruta] of [['post', '/api/radar/expirar'], ['post', '/api/radar/cerrar-ids'], ['put', '/api/convocatorias/:id/estado'],
    ['post', '/api/radar/rastreo1'], ['post', '/api/radar/trigger'], ['post', '/api/radar/enrich-montos'], ['post', '/api/radar/clasificar-sectores'], ['post', '/api/importar']]) {
    const linea = srv.split('\n').find(l => l.includes(`app.${metodo}('${ruta}'`));
    assert.ok(linea, ruta);
    assert.match(linea, /authenticateToken, requireAdmin,/, ruta);
  }
  assert.match(leer('client/src/pages/LayoutPadre.tsx'), /if \(!isAdmin\) return;/, 'el botón Rastreo 1 solo dispara el rastreo real para admin');
  assert.match(leer('backend/pipeline/EntityScraper.js'), /_rastreoCompletoEnCurso/, 'cerrojo del rastreo completo');
});

// ── URL pública única ────────────────────────────────────────────────────────
test('urlPublica: FRONTEND_URL > (producción) VITE_API_URL > localhost; nunca un /api ni barra final', () => {
  assert.equal(urlPublica({ FRONTEND_URL: 'https://app.radfor360.com/' }), 'https://app.radfor360.com');
  assert.equal(urlPublica({ NODE_ENV: 'production', VITE_API_URL: 'https://radar360-app.onrender.com/api' }), 'https://radar360-app.onrender.com');
  assert.equal(urlPublica({ NODE_ENV: 'development', VITE_API_URL: 'http://localhost:8000' }), 'http://localhost:5173', 'en dev VITE_API_URL es el backend');
  assert.equal(urlPublica({}), 'http://localhost:5173');
  for (const f of ['server.js', 'backend/routes/authGoogle.controller.js', 'backend/notifications/BrevoEmailAdapter.js', 'backend/routes/subscriptions.routes.js', 'backend/services/emailService.js']) {
    assert.doesNotMatch(leer(f), /FRONTEND_URL \|\| 'http:\/\/localhost:5173'|APP_URL = /, f);
  }
});

// ── Respaldo AWS en espera ───────────────────────────────────────────────────
test('backup S3: ámbar SOLO si faltan las 3 credenciales, antes de instalar nada; con llaves sigue en rojo', () => {
  const wf = leer('.github/workflows/backup-s3.yml');
  const iCreds = wf.indexOf('id: creds');
  assert.ok(iCreds > 0 && iCreds < wf.indexOf('Instalar pg_dump'), 'la verificación va antes de instalar pg_dump');
  assert.match(wf, /if \[ "\$presentes" -eq 0 \]/);
  assert.match(wf, /RESPALDO EN ESPERA DE CREDENCIALES/);
  assert.match(wf, /if \(r\.success !== true\) process\.exit\(1\)/, 'con credenciales, un respaldo fallido sigue en rojo');
});
