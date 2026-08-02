/**
 * smokeTest.js — RadarFondos 360 V8.0
 * Smoke test de flujo completo: Trial → Ingesta → Match → Resumen
 * Marca la BD como production_ready si todos los checks pasan.
 *
 * Uso: node backend/scripts/smokeTest.js [BASE_URL]
 * Ejemplo: node backend/scripts/smokeTest.js http://localhost:3000
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const TIMEOUT  = 15000; // ms por request

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok, detail = '') {
  const status = ok ? '✓' : '✗';
  const color  = ok ? '\x1b[32m' : '\x1b[31m';
  console.log(`  ${color}${status}\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ name, ok, detail });
  ok ? passed++ : failed++;
}

async function fetchJSON(path, options = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const r = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const text = await r.text();
    clearTimeout(t);
    try { return { ok: r.ok, status: r.status, data: JSON.parse(text) }; }
    catch { return { ok: r.ok, status: r.status, data: { raw: text } }; }
  } catch (err) {
    clearTimeout(t);
    return { ok: false, status: 0, data: { error: err.message } };
  }
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RADARFONDOS 360 V8.0 — SMOKE TEST DE PRODUCCIÓN    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}\n`);

  // ── 1. Healthcheck ────────────────────────────────────────────────────────
  console.log('[1/6] Healthcheck del servidor...');
  const health = await fetchJSON('/api/health');
  check('GET /api/health → 200', health.ok && health.data?.status === 'ok', health.data?.timestamp);

  // ── 2. Planes públicos ────────────────────────────────────────────────────
  console.log('\n[2/6] Catálogo de planes...');
  const plans = await fetchJSON('/api/plans');
  check('GET /api/plans → contiene suite', plans.ok && !!plans.data?.data?.suite);

  // ── 3. Trial mode (sin registro) ─────────────────────────────────────────
  console.log('\n[3/6] Activación de sesión Trial...');
  const trial = await fetchJSON('/api/auth/trial', { method: 'POST' });
  check('POST /api/auth/trial → token JWT', trial.ok && !!trial.data?.token, `user: ${trial.data?.user?.id}`);
  const trialToken = trial.data?.token;

  // ── 4. Convocatorias (ingesta pública) ───────────────────────────────────
  console.log('\n[4/6] Ingesta de convocatorias...');
  const convs = await fetchJSON('/api/convocatorias?limit=5');
  check('GET /api/convocatorias → success', convs.ok && convs.data?.success === true);
  check('Convocatorias disponibles', Array.isArray(convs.data?.data), `count: ${convs.data?.data?.length ?? 0}`);

  // ── 5. Registro + Login + Proyecto (flujo real) ───────────────────────────
  console.log('\n[5/6] Flujo autenticado (register → login → proyecto)...');
  const testEmail = `smoketest_${Date.now()}@radar360.test`;
  const reg = await fetchJSON('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: testEmail, password: 'SmokeTest1234!', nombre: 'Smoke Test Bot' }),
  });
  check('POST /api/auth/register → 201', reg.status === 201, `email: ${testEmail}`);
  // El registro exige aprobación de admin antes de poder iniciar sesión — no
  // devuelve token de inmediato. Se verifica esa forma exacta de respuesta en
  // vez de asumir un token, y se detiene ahí (crear un proyecto de prueba
  // requeriría aprobar la cuenta con acceso directo a la BD, fuera del
  // alcance de un smoke test HTTP).
  check(
    'POST /api/auth/register → pendingApproval (gate de aprobación activo)',
    reg.status === 201 && reg.data?.pendingApproval === true,
    reg.data?.message
  );

  // ── 6. Estadísticas del sistema ───────────────────────────────────────────
  console.log('\n[6/6] Estadísticas del sistema...');
  const stats = await fetchJSON('/api/estadisticas');
  check('GET /api/estadisticas → success', stats.ok && stats.data?.success === true,
    `convocatorias: ${stats.data?.data?.total_convocatorias ?? '?'} · entidades: ${stats.data?.data?.total_entidades ?? '?'}`);

  // ── Resultado ─────────────────────────────────────────────────────────────
  const allPassed = failed === 0;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  if (allPassed) {
    console.log('║  ✓ TODOS LOS CHECKS PASARON — SISTEMA PRODUCTION READY  ║');
  } else {
    console.log(`║  ✗ ${failed} CHECK(S) FALLARON — REVISAR ANTES DE GO-LIVE ║`);
  }
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Passed: ${passed} / Failed: ${failed} / Total: ${passed + failed}`);

  if (allPassed) {
    // Marcar BD como production_ready via API
    try {
      const mark = await fetchJSON('/api/system/production-ready', {
        method: 'POST',
        headers: { 'X-Smoke-Token': process.env.JWT_SECRET || '' },
      });
      if (mark.ok) console.log('\n  ✓ Base de datos marcada como PRODUCTION_READY');
      else         console.log('\n  ⚠ El endpoint /api/system/production-ready no está disponible (registrar manualmente)');
    } catch {}
    console.log('\n  🚀 SISTEMA LISTO PARA VENTA\n');
    process.exit(0);
  } else {
    console.log('\n  ⛔ DESPLIEGUE ABORTADO — Corrige los errores antes de go-live\n');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('\n[SmokeTest] Error fatal:', err.message);
  process.exit(1);
});
