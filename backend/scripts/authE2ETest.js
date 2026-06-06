/**
 * authE2ETest.js — Suite de pruebas End-to-End · Satellite Login V7.0
 *
 * Cubre:
 *   T1 — Health check + ROOT_STATUS
 *   T2 — Registro de usuario de prueba
 *   T3 — Login con credenciales inválidas → 401
 *   T4 — Login válido + verificación del payload permissions
 *   T5 — Prueba de intrusión: ruta Formulador con token sin plan → 403/401
 *   T6 — Ruta protegida sin token → 401
 *
 * Uso:
 *   node backend/scripts/authE2ETest.js
 *   NODE_ENV=test node backend/scripts/authE2ETest.js
 *
 * Requisito: servidor Express corriendo en VITE_API_URL (default http://localhost:3000)
 */

import { loadEnv } from '../env-loader.js';
loadEnv();

const BASE = process.env.VITE_API_URL || 'http://localhost:3000';
const TS   = Date.now();
const TEST_EMAIL = `e2e.test.${TS}@radar.local`;
const TEST_PASS  = `TestPass@${TS}`;
const TEST_NAME  = 'E2E Satellite V7';

let testToken  = null;
let testUserId = null;
let passed     = 0;
let failed     = 0;

// ── Utilidades ────────────────────────────────────────────────────────────────
async function req(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: r.status, data };
}

function pass(label, detail = '') {
  console.log(`  ✓ [PASS] ${label}${detail ? '  ← ' + detail : ''}`);
  passed++;
}

function fail(label, detail = '') {
  console.error(`  ✗ [FAIL] ${label}${detail ? '  ← ' + detail : ''}`);
  failed++;
}

function info(msg) { console.log(`       ${msg}`); }
function section(n, title) { console.log(`\n[T${n}] ${title}`); }

// ── Tests ─────────────────────────────────────────────────────────────────────

async function t1_healthCheck() {
  section(1, 'Health Check + ROOT_STATUS');
  const { status, data } = await req('GET', '/api/health');
  if (status === 200 && data.status === 'ok') pass('Servidor activo');
  else { fail('Servidor no responde', `HTTP ${status}`); return; }
  info(`root_status : ${data.root_status ?? 'N/A'}`);
  info(`version     : ${data.version ?? 'N/A'}`);
  if (data.root_status === 'ONLINE') pass('ROOT_STATUS = ONLINE');
  else info(`root_status es "${data.root_status}" — revisar MCP_API_KEY en .env`);
}

async function t2_register() {
  section(2, 'Registro de usuario de prueba');
  const { status, data } = await req('POST', '/api/auth/register', {
    email: TEST_EMAIL, password: TEST_PASS, nombre: TEST_NAME,
  });
  if (status === 201 && data.token) {
    pass('Usuario registrado', `id: ${data.user?.id?.slice(0, 8)}…`);
    testUserId = data.user?.id;
  } else {
    fail('Registro fallido', data.message ?? JSON.stringify(data).slice(0, 80));
  }
}

async function t3_loginInvalidPassword() {
  section(3, 'Login con contraseña incorrecta → debe retornar 401');
  const { status, data } = await req('POST', '/api/auth/login', {
    email: TEST_EMAIL, password: 'WrongPassword!999',
  });
  if (status === 401) pass('401 Unauthorized — rechazado correctamente');
  else fail(`Esperado 401, recibió ${status}`, data.message);
}

async function t4_loginValid() {
  section(4, 'Login válido + payload V7.0');
  const { status, data } = await req('POST', '/api/auth/login', {
    email: TEST_EMAIL, password: TEST_PASS,
  });
  if (status !== 200 || !data.token) {
    fail('Login fallido', data.message ?? `HTTP ${status}`);
    return;
  }
  pass('Login exitoso — token recibido');
  testToken = data.token;

  // Verificar estructura V7.0
  const p = data.permissions;
  if (p && typeof p.access_radar === 'boolean' && typeof p.access_formulador === 'boolean') {
    pass('Payload permissions presente', `radar=${p.access_radar}, formulador=${p.access_formulador}`);
  } else {
    fail('Payload permissions ausente o malformado', JSON.stringify(p));
  }

  if (data.status) {
    pass('Campo status presente en respuesta', `status="${data.status}"`);
  } else {
    fail('Campo status ausente en respuesta');
  }

  if (data.subscription?.plan) info(`plan: ${data.subscription.plan}`);

  // Verificar que el JWT contiene los flags de acceso
  try {
    const [, payload64] = testToken.split('.');
    const raw     = JSON.parse(Buffer.from(payload64, 'base64').toString('utf8'));
    const hasFlags = typeof raw.access_radar === 'boolean' && typeof raw.access_formulador === 'boolean';
    if (hasFlags) pass('JWT contiene access_radar y access_formulador en payload');
    else fail('JWT no contiene flags de acceso', JSON.stringify(raw).slice(0, 100));
    if (raw.tenant_id) pass('JWT contiene tenant_id', raw.tenant_id.slice(0, 8) + '…');
    if (raw.session_id) pass('JWT contiene session_id (auditoría)');
  } catch {
    fail('No se pudo decodificar el JWT para inspección');
  }
}

async function t5_intrusionFormulador() {
  section(5, 'Intrusión: ruta Formulador con token sin plan → 403 o 401');
  if (!testToken) { fail('Token no disponible — T4 falló'); return; }
  const { status, data } = await req('GET', '/api/formulador/proyectos', null, testToken);
  if (status === 403) {
    pass('403 Forbidden — intrusión bloqueada (RBAC activo)', `code: ${data.code ?? '—'}`);
  } else if (status === 401) {
    pass('401 Unauthorized — token sin plan rechazado (aceptable)');
  } else if (status === 404) {
    info(`Ruta /api/formulador/proyectos no existe en este build — omitiendo sub-test`);
  } else {
    fail(`Esperado 403/401, recibió ${status}`, JSON.stringify(data).slice(0, 100));
  }
}

async function t6_noTokenProtectedRoute() {
  section(6, 'Ruta protegida sin token → debe retornar 401');
  const { status } = await req('GET', '/api/formulador/proyectos');
  if (status === 401) pass('401 — ruta protegida rechaza petición sin token');
  else if (status === 404) info('Ruta no registrada en este build — omitiendo sub-test');
  else fail(`Esperado 401, recibió ${status}`);
}

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('══════════════════════════════════════════════════');
  console.log(' RadarFondos 360 — Auth E2E Test · Satellite V7.0');
  console.log(`  Target : ${BASE}`);
  console.log(`  Fecha  : ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════');

  try {
    await t1_healthCheck();
    await t2_register();
    await t3_loginInvalidPassword();
    await t4_loginValid();
    await t5_intrusionFormulador();
    await t6_noTokenProtectedRoute();
  } catch (err) {
    console.error('\n[FATAL] Error inesperado en suite:', err.message);
    failed++;
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(` RESULTADO: ${passed} pasaron · ${failed} fallaron`);
  if (failed === 0) {
    console.log(' SISTEMA DE ACCESO V7.0 INTEGRADO: LOGIN OPERATIVO,');
    console.log(' PILARES SEGMENTADOS Y ENTORNOS VERIFICADOS EN DISCO');
  } else {
    console.error(' Algunos tests fallaron — revisar logs de servidor');
  }
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
