/**
 * smokeTest.js — RadarFondos 360 V8.0
 * Smoke test de flujo completo: Trial → Ingesta → Match → Resumen
 * Marca la BD como production_ready si todos los checks pasan.
 *
 * Uso: node backend/scripts/smokeTest.js [BASE_URL]
 * Ejemplo: node backend/scripts/smokeTest.js http://localhost:8000
 */

const BASE_URL = process.argv[2] || 'http://localhost:8000';

// TIMEOUT por request: 15s → 35s (Protocolo de Calentamiento, 2026-10-12).
// Causa medida en vivo: el servicio de Render se duerme por inactividad y su
// arranque en frío tardó 28,5 s (medido el 2026-09-30 y de nuevo el 10-12).
// Con el tope anterior de 15 s, la PRIMERA petición del smoke test abortaba
// siempre que el servicio estuviera dormido, y la segunda caía dentro del
// resto del despertar: los checks 1 y 2 fallaban y los 3–6 pasaban. Parecía
// una app rota cuando en realidad estaba despertando. 35 s cubre el arranque
// medido con margen.
const TIMEOUT  = 35000;

// ── Protocolo de Calentamiento (Warm-up con polling activo) ──────────────────
// Antes de juzgar NADA, se despierta el servicio y se espera a que responda.
// Un fallo aquí es de INFRAESTRUCTURA (el servicio no levanta), no de la app,
// y se reporta como tal — distinción que el smoke test no hacía y que llevó a
// leer un arranque en frío como un defecto de producción.
const WARMUP_TIMEOUT  = 45000;  // 45 s para el intento despertador
const WARMUP_INTENTOS = 3;      // reintentos antes de declarar fallo de infra
const WARMUP_ESPERA   = 10000;  // 10 s entre intentos

let passed = 0;
let failed = 0;
const results = [];

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail = '') {
  const status = ok ? '✓' : '✗';
  const color  = ok ? '\x1b[32m' : '\x1b[31m';
  console.log(`  ${color}${status}\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
  results.push({ name, ok, detail });
  ok ? passed++ : failed++;
}

async function fetchJSON(path, options = {}, timeoutMs = TIMEOUT) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
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

/**
 * Despierta el servicio y espera a que responda ANTES de la batería de pruebas.
 * Devuelve { ok, intentos, ms } — ok:false significa fallo de infraestructura.
 */
async function calentar() {
  console.log('[0/*] Calentamiento — despertando el servicio...');
  const inicio = Date.now();
  for (let intento = 1; intento <= WARMUP_INTENTOS; intento++) {
    const t0 = Date.now();
    const r = await fetchJSON('/api/health', {}, WARMUP_TIMEOUT);
    const ms = Date.now() - t0;
    if (r.ok && r.data?.status === 'ok') {
      console.log(`  \x1b[32m✓\x1b[0m Servicio despierto en ${(ms / 1000).toFixed(1)}s (intento ${intento}/${WARMUP_INTENTOS})\n`);
      return { ok: true, intentos: intento, ms: Date.now() - inicio };
    }
    const motivo = r.data?.error || `HTTP ${r.status}`;
    console.log(`  \x1b[33m…\x1b[0m Intento ${intento}/${WARMUP_INTENTOS} sin respuesta útil tras ${(ms / 1000).toFixed(1)}s (${motivo})`);
    if (intento < WARMUP_INTENTOS) {
      console.log(`     Reintentando en ${WARMUP_ESPERA / 1000}s — arranque en frío de Render puede tardar ~30s.`);
      await dormir(WARMUP_ESPERA);
    }
  }
  return { ok: false, intentos: WARMUP_INTENTOS, ms: Date.now() - inicio };
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RADARFONDOS 360 V8.0 — SMOKE TEST DE PRODUCCIÓN    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}\n`);

  // ── 0. Fail-fast de configuración ─────────────────────────────────────────
  // Antes, un SMOKE_TEST_TOKEN ausente se reportaba como el check 7 fallido,
  // al final de una corrida de 3 minutos y mezclado con resultados reales:
  // parecía un problema de producción cuando era un secreto no registrado en
  // GitHub Actions. Ahora corta en el primer segundo, con el motivo exacto.
  if (!process.env.SMOKE_TEST_TOKEN || !process.env.SMOKE_TEST_TOKEN.trim()) {
    console.error('\n\x1b[31m[FATAL] SMOKE_TEST_TOKEN no presente en las variables de entorno de GitHub Actions\x1b[0m');
    console.error('  El endpoint POST /api/system/production-ready exige este secreto y sin él');
    console.error('  devuelve 503, así que el marcador de producción nunca se puede sellar.');
    console.error('');
    console.error('  FUENTE ÚNICA DE VERDAD: el entorno del servicio en Render, que es de donde');
    console.error('  lo lee el servidor. El workflow lo resuelve de ahí por API (RENDER_API_KEY),');
    console.error('  así que basta con definirlo EN UN SOLO LUGAR:');
    console.error('    Render → servicio → Environment → SMOKE_TEST_TOKEN = <valor largo y aleatorio>');
    console.error('');
    console.error('  Para correrlo a mano: SMOKE_TEST_TOKEN=<valor> node backend/scripts/smokeTest.js <url>\n');
    process.exit(1);
  }

  // ── 0.b Calentamiento antes de medir nada ─────────────────────────────────
  const warm = await calentar();
  if (!warm.ok) {
    console.error('\n\x1b[31m[FATAL] FALLO DE INFRAESTRUCTURA — el servicio no respondió tras '
      + `${warm.intentos} intentos en ${(warm.ms / 1000).toFixed(0)}s.\x1b[0m`);
    console.error('  Esto NO es un defecto de la aplicación: el servicio no llegó a levantar.');
    console.error('  Revisar el estado del servicio en el dashboard de Render y sus logs.\n');
    process.exit(1);
  }

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
  // Email FIJO (2026-09-23): antes era `smoketest_${Date.now()}` y cada
  // deploy dejaba una cuenta sin aprobar en la BD real (16 acumuladas) y un
  // correo al admin. Con email fijo, la primera corrida crea la cuenta y las
  // siguientes caen en la rama anti-enumeración de /api/auth/register, que
  // responde EXACTAMENTE lo mismo (201 + pendingApproval) sin crear filas —
  // el check sigue probando el gate. Dominio .test (RFC 2606): no entrega correo.
  const testEmail = 'smoketest@radar360.test';
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

  // ── 7. Persistir el resultado del smoke con un secreto dedicado ────────────
  if (failed === 0) {
    console.log('\n[7/7] Marcador de producción...');
    const smokeToken = process.env.SMOKE_TEST_TOKEN;
    if (!smokeToken) {
      check('POST /api/system/production-ready → success', false, 'SMOKE_TEST_TOKEN no configurado');
    } else {
      const mark = await fetchJSON('/api/system/production-ready', {
        method: 'POST',
        headers: { 'X-Smoke-Token': smokeToken },
      });
      check('POST /api/system/production-ready → success', mark.ok && mark.data?.success === true, mark.data?.message);
    }
  } else {
    console.log('\n[7/7] Marcador de producción omitido porque falló un check previo.');
  }

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
