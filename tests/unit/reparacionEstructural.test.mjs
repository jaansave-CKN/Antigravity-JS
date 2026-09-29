/**
 * reparacionEstructural.test.mjs — reparación estructural (2026-09-29):
 *   F1 sellado admin de enrich-montos / importar / clasificar-sectores,
 *   F2 importador de convocatorias sobre el esquema real (skip-on-error),
 *   F3 filtro único de títulos basura + plan de purga.
 * Sin BD ni red (db.js, tokenBlacklist, llmProveedor y el store de rate-limit simulados).
 * Ejecutar: npm run test:unit
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const u = (p) => new URL(`../../backend/${p}`, import.meta.url).href;

// ── BD simulada: registra INSERTs y permite forzar duplicados o fallos ──────
const bd = { existentes: new Set(), inserts: [], fallarEn: null };
mock.module(u('db.js'), { namedExports: {
  getRow: async (sql, params) => (params?.some(p => bd.existentes.has(p)) ? { id: 'ya' } : null),
  runSql: async (sql, params) => {
    if (bd.fallarEn && params?.includes(bd.fallarEn.titulo)) throw new Error(bd.fallarEn.error);
    bd.inserts.push({ sql, params });
    return { rowCount: 1 };
  },
  getRows: async () => [],
} });
mock.module(u('middlewares/tokenBlacklist.js'), { namedExports: {
  isRevoked: async () => false, checkSessionValid: async () => true, checkAccountStatus: async () => ({ ok: true }),
} });
mock.module(u('services/llmProveedor.js'), { namedExports: { generarConIA: async () => { throw new Error('sin IA en tests'); } } });
class StoreFalso { async increment() { return { totalHits: 1, resetTime: new Date() }; } async decrement() {} async resetKey() {} }
mock.module(u('middlewares/PostgresRateLimitStore.js'), { namedExports: { PostgresRateLimitStore: StoreFalso } });

const { requireAdmin } = await import(u('middlewares/auth.middleware.js'));
const { importToConvocatorias, prepararFilaConvocatoria, MAX_FILAS_IMPORTACION } = await import(u('pipeline/FileImporter.js'));
const { motivoBasura, esRuidoDeNavegacion } = await import(u('utils/tituloBasura.js'));
const { normalizarFechaLimite, calcEstado } = await import(u('utils/fechasConvocatoria.js'));
const { planificarPurga, TOPE } = await import(u('scripts/purgarBasuraCatalogo.mjs'));

const srv = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

// ── F1 ───────────────────────────────────────────────────────────────────────
test('F1: requireAdmin rechaza con 403 a un usuario estándar y deja pasar al admin', () => {
  const respuesta = () => { const r = { code: null, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  for (const rol of ['user', 'usuario', 'radar', undefined]) {
    const res = respuesta(); let siguio = false;
    requireAdmin({ userRole: rol }, res, () => { siguio = true; });
    assert.equal(res.code, 403, `rol ${rol}: 403`);
    assert.equal(siguio, false, `rol ${rol}: no llega al handler`);
  }
  const res = respuesta(); let siguio = false;
  requireAdmin({ userRole: 'admin' }, res, () => { siguio = true; });
  assert.equal(siguio, true);
  assert.equal(res.code, null);
});

test('F1: las rutas que escriben el catálogo global exigen authenticateToken + requireAdmin', () => {
  for (const ruta of ['/api/radar/enrich-montos', '/api/radar/clasificar-sectores', '/api/importar']) {
    const linea = srv.split('\n').find(l => l.includes(`app.post('${ruta}'`));
    assert.ok(linea, `${ruta} existe`);
    assert.match(linea, /authenticateToken, requireAdmin,/, `${ruta} lleva requireAdmin justo tras authenticateToken`);
    assert.doesNotMatch(linea, /requireAccess\('radar'\)/, `${ruta} ya no se abre con el plan Radar`);
  }
  const importar = srv.split('\n').find(l => l.includes("app.post('/api/importar'"));
  assert.ok(importar.indexOf('requireAdmin') < importar.indexOf('upload.single'), 'requireAdmin antes de procesar el archivo');
});

// ── F2 ───────────────────────────────────────────────────────────────────────
const COLS = { titulo: 'titulo', url: 'url', donante: 'donante', monto: 'monto', moneda: 'moneda', fecha_limite: 'fecha_limite', sectores: 'sectores', pais: 'pais', descripcion: 'descripcion' };

test('F2: prepararFilaConvocatoria mapea al esquema real (montos, moneda, fechas, sectores)', () => {
  const p = prepararFilaConvocatoria({ titulo: 'Convocatoria de agua potable rural 2027', url: 'https://ejemplo.gov.co/agua', donante: 'Minvivienda', monto: '30 millones de pesos', fecha_limite: '15/03/2099', sectores: 'Agua; Saneamiento', pais: 'Colombia' }, COLS);
  assert.equal(p.ok, true);
  assert.equal(p.datos.montoMax, 30_000_000);
  assert.equal(p.datos.moneda, 'COP');
  assert.equal(p.datos.fechaLimite, '2099-03-15');
  assert.equal(p.datos.estado, 'abierta');
  assert.deepEqual(p.datos.sectores, ['Agua', 'Saneamiento']);
  assert.equal(p.datos.rootDomain, 'ejemplo.gov.co');
  assert.equal(p.datos.externoId.length, 64);

  const num = prepararFilaConvocatoria({ titulo: 'Grant for climate resilience projects', url: 'https://fund.org/call', monto: 250000, moneda: 'usd', pais: 'Perú', fecha_limite: new Date('2020-01-31') }, COLS);
  assert.equal(num.datos.montoMax, 250000);
  assert.equal(num.datos.moneda, 'USD');
  assert.equal(num.datos.estado, 'cerrada');

  assert.equal(prepararFilaConvocatoria({ titulo: 'Fondo para huertas escolares', url: 'https://x.org/y', monto: '30' }, COLS).datos.montoMax, 0, 'monto imposible → 0');
});

test('F2: filas inválidas se rechazan con motivo claro y la basura se omite', () => {
  assert.match(prepararFilaConvocatoria({ titulo: 'abc', url: 'https://x.org/y' }, COLS).motivo, /título/);
  const sinUrl = prepararFilaConvocatoria({ titulo: 'Convocatoria sin enlace verificable', url: 'no-es-url' }, COLS);
  assert.equal(sinUrl.ok, false); assert.equal(sinUrl.omitida, false); assert.match(sinUrl.motivo, /URL requerida/);
  const basura = prepararFilaConvocatoria({ titulo: 'Request an Event Space', url: 'https://x.org/y' }, COLS);
  assert.equal(basura.ok, false); assert.equal(basura.omitida, true); assert.match(basura.motivo, /reserva_de_espacio/);
});

test('F2: importToConvocatorias sigue tras cada fila mala (skip-on-error) y reporta fila y motivo', async () => {
  bd.existentes = new Set(['https://ya.org/existente']); bd.inserts = []; bd.fallarEn = { titulo: 'Convocatoria que choca con la BD', error: 'connection reset' };
  const filas = [
    { titulo: 'Convocatoria válida número uno', url: 'https://a.org/1' },
    { titulo: 'x', url: 'https://a.org/2' },                                  // error de formato
    { titulo: 'Convocatoria ya existente en catálogo', url: 'https://ya.org/existente' }, // omitida
    { titulo: 'Terms of use', url: 'https://a.org/3' },                       // basura: omitida
    { titulo: 'Convocatoria que choca con la BD', url: 'https://a.org/4' },   // error de BD
    { titulo: 'Convocatoria válida número dos', url: 'https://a.org/5' },
  ];
  const r = await importToConvocatorias(filas);
  assert.equal(r.inserted, 2);
  assert.equal(r.skipped, 2);
  assert.equal(r.errors, 2);
  assert.deepEqual(r.errores.map(e => e.fila), [3, 6], 'fila del archivo (encabezado = fila 1)');
  assert.match(r.errores[1].motivo, /connection reset/);
  const sql = bd.inserts[0].sql;
  assert.match(sql, /INSERT INTO convocatorias[\s\S]*externo_id[\s\S]*url_convocatoria[\s\S]*fecha_limite/);
  assert.doesNotMatch(sql, /fecha_cierre|tipo_financiamiento|formato_formulacion|\bscore,|\bmonto,|\burl,/, 'sin columnas inexistentes');
  assert.equal(typeof bd.inserts[0].params[0], 'string', 'genera id');
  assert.equal(bd.inserts[0].params[4], null, 'entidad_id nunca recibe texto libre');
});

test('F2: "duplicate key" cuenta como omitida; lote demasiado grande o sin columna obligatoria → error del lote', async () => {
  bd.existentes = new Set(); bd.inserts = []; bd.fallarEn = { titulo: 'Convocatoria duplicada por carrera', error: 'duplicate key value violates unique constraint' };
  const r = await importToConvocatorias([{ titulo: 'Convocatoria duplicada por carrera', url: 'https://a.org/d' }]);
  assert.deepEqual([r.inserted, r.skipped, r.errors], [0, 1, 0]);
  await assert.rejects(importToConvocatorias(Array.from({ length: MAX_FILAS_IMPORTACION + 1 }, (_, i) => ({ titulo: `Convocatoria ${i} larga`, url: `https://a.org/${i}` }))), { code: 'IMPORT_DEMASIADAS_FILAS' });
  await assert.rejects(importToConvocatorias([{ nombre_raro: 'x' }]), { code: 'IMPORT_COLUMNA_FALTANTE' });
});

test('F2: normalizarFechaLimite acepta ISO, DD/MM/AAAA, Date y seriales de Excel; rechaza lo imposible', () => {
  assert.equal(normalizarFechaLimite('2026-12-31'), '2026-12-31');
  assert.equal(normalizarFechaLimite('2026/1/5'), '2026-01-05');
  assert.equal(normalizarFechaLimite('31/12/2026'), '2026-12-31');
  assert.equal(normalizarFechaLimite('5-1-2027'), '2027-01-05');
  assert.equal(normalizarFechaLimite(46022), '2025-12-31', 'serial de Excel');
  assert.equal(normalizarFechaLimite(new Date('2026-06-30T00:00:00Z')), '2026-06-30');
  for (const malo of ['31/02/2026', 'mañana', '', 12, null]) assert.equal(normalizarFechaLimite(malo), '', String(malo));
  assert.equal(calcEstado('2000-01-01'), 'cerrada');
  assert.equal(calcEstado(''), 'abierta');
});

// ── F3 ───────────────────────────────────────────────────────────────────────
test('F3: basura real del catálogo (títulos exactos de producción) se detecta', () => {
  const basura = ['Ford Foundation Gallery', 'Request an Event Space', 'Instructivo: ¿Cómo crear un usuario en Quantum? PDF (8,637kb) Descarga',
    'Manual de Convocatorias', 'Projects Photo View', 'Projects Table View', 'Active Grants Dashboards', 'Accessibility statement',
    'Work for us: jobs and advisory roles', 'Policies, standards and data', 'More about news and media', 'Imatge corporativa',
    'Complaints & Reports', 'Terms of use', 'Terms of use | Wellcome', 'Login to Wellcome Funding', 'Formulario de solicitud',
    'Careers in research for development', 'الميزانية العمومية وبيان الدخل', 'Skip to content', 'Media Enquiries', 'Publications',
    'Document library', 'Logo Minciencias', 'Viceministerios', '2024 – AGUA-C', '101 jobs that change the world', 'Vacancies and Internships'];
  for (const t of basura) assert.ok(motivoBasura(t), `basura: ${t}`);
});

test('F3: convocatorias legítimas NUNCA se marcan (lista de protección propia)', () => {
  const legitimas = ['Green Jobs Fund', 'NSF CAREER Award', 'Career Development Fellowship', 'Gallery Grant Program',
    'Complaints Handling Capacity Grant', 'Community Fund for Local Jobs', 'The Green Climate Fund Call for Proposals',
    'Manualidades: convocatoria de arte 2025', 'Enterprise Development and Job Skills', 'BECA GKS 2024', 'ERASMUS+ 2026',
    'Synergy Grant', 'Advanced Grant', '2025 – Convocatoria de innovación social', 'Social inclusion', 'Food Security',
    'Farming Futures R&D fund: Automation and Robotics Round 2', 'Fondo de Becas para Mujeres Científicas'];
  for (const t of legitimas) assert.equal(motivoBasura(t), null, `legítima: ${t}`);
});

test('F3: fuente única de listas y filtro en las 3 vías de INSERT', () => {
  const scr = fs.readFileSync(new URL('../../backend/pipeline/EntityScraper.js', import.meta.url), 'utf8');
  const ing = fs.readFileSync(new URL('../../backend/pipeline/DataIngestor.js', import.meta.url), 'utf8');
  const imp = fs.readFileSync(new URL('../../backend/pipeline/FileImporter.js', import.meta.url), 'utf8');
  assert.doesNotMatch(scr, /const NOISE_TITLES|const NOISE_TITLE_RE|function calcEstado/);
  assert.doesNotMatch(srv, /GARBAGE_TITLE_RE/);
  assert.doesNotMatch(ing, /calcEstadoR2/);
  for (const [n, s] of [['EntityScraper', scr], ['DataIngestor', ing], ['FileImporter', imp], ['server', srv]]) {
    assert.match(s, /utils\/tituloBasura\.js'/, `${n} importa la fuente única`);
  }
  // En EntityScraper el descarte va DESPUÉS de registrar el externo_id (detección de desaparición).
  const iAdd = scr.indexOf('foundExternoIds.add(externoId);');
  const iBasura = scr.indexOf('if (esTituloBasura(titulo))');
  assert.ok(iAdd > 0 && iBasura > iAdd, 'basura se descarta tras foundExternoIds.add');
  assert.match(ing, /if \(esTituloBasura\(titulo\)\)/);
  // clasificarSectores ya no borra sin respaldo.
  const iClasif = srv.indexOf('async function clasificarSectoresEnBatch');
  const clasif = srv.slice(iClasif, srv.slice(iClasif).search(/\r?\n}\r?\n/) + iClasif);
  assert.ok(clasif.includes('isGarbageTitle(row.titulo)'), 'recorte correcto de la función');
  assert.doesNotMatch(clasif, /SET deleted_at/, 'clasificarSectores no borra');
  // El ruido de navegación movido conserva su comportamiento.
  assert.equal(esRuidoDeNavegacion('Política de privacidad'), true);
  assert.equal(esRuidoDeNavegacion('Our mission'), true);
});

test('F3: planificarPurga solo toma basura y el tope cubre lo medido', () => {
  const plan = planificarPurga([{ id: 'a', titulo: 'Terms of use' }, { id: 'b', titulo: 'Green Jobs Fund' }, { id: 'c', titulo: 'Skip to content' }]);
  assert.deepEqual(plan.map(p => [p.id, p.motivo]), [['a', 'fuerte:terminos'], ['c', 'fuerte:navegacion']]);
  assert.ok(TOPE >= 87 && TOPE <= 150);
});
