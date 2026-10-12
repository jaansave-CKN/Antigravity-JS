/**
 * invariantesLanzamiento.test.mjs — GUARDAS EJECUTABLES de los invariantes de
 * lanzamiento (auditoría causal 2026-10-12).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * La auditoría de la sesión 2026-09-30/10-12 encontró que TODOS los fallos
 * tenían la misma causa: las reglas críticas del proyecto vivían como PROSA
 * (CLAUDE.md, memoria del asistente, comentarios en el código) y no como un
 * gate mecánico. Consecuencias reales, no hipotéticas:
 *
 *   - "ningún proceso con cheque en blanco" estaba escrito en un comentario de
 *     iaTopeSistema.js — y la rama Gemini de llmProveedor.js estuvo sin techo
 *     en USD hasta el fix de H1, siendo el ÚNICO proveedor realmente en uso.
 *   - El gating de plan estaba en el frontend (PlanGate) y 50 endpoints de
 *     pago quedaron abiertos a cuentas free durante meses.
 *   - El veto de montos del Expediente cubría 3 de 9 secciones; la regla decía
 *     "el presupuesto vive en el documento externo", sin excepciones.
 *   - withTenant() degradaba a BYPASSRLS con un console.warn que nadie lee.
 *   - El tope por usuario se aplicó por error también al tráfico de sistema
 *     (defecto introducido y corregido el 2026-09-30): el invariante "el Radar
 *     de fondo no toca el libro de USD" solo existía en un comentario.
 *
 * Cada prueba de aquí convierte uno de esos invariantes en un fallo de CI.
 * No prueban comportamiento nuevo: prueban que lo YA APROBADO no se deshaga
 * sola ni silenciosamente. Si una de estas falla, alguien quitó una
 * protección — no es un test "frágil" que haya que relajar.
 *
 * REGLA DE MANTENIMIENTO: al agregar una ruta a un módulo del Formulador, o
 * una sección al Expediente, esta suite falla hasta que la nueva pieza quede
 * protegida. Eso es lo que se busca.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (rel) => readFileSync(join(RAIZ, rel), 'utf8');

/** Normaliza CRLF → LF. Un chequeo que no haga esto da FALSOS NEGATIVOS:
 *  ocurrió en vivo el 2026-10-12 (una verificación reportó "AUSENTE" un paso
 *  de CI que sí estaba, porque el archivo tiene CRLF). */
const lf = (s) => s.replace(/\r\n/g, '\n');

// ── Invariante 1: gating de plan en el BACKEND, no solo en el frontend ───────
// PlanGate (client/src/main.tsx) es navegación de cliente: se salta con curl.
// requireAccess('formulador') es el control real. Estos 10 archivos son los
// módulos de pago del Formulador: TODA ruta suya debe exigir el plan.
const ARCHIVOS_FORMULADOR = [
  'anexos', 'matrizRaci', 'biblioteca', 'exportacion', 'presupuesto',
  'marcoNormativo', 'compliance', 'motorDialectico', 'reporte', 'radicacion',
];

test('INVARIANTE: toda ruta de los módulos de pago del Formulador exige requireAccess (no solo PlanGate del frontend)', () => {
  const sinProteger = [];
  let total = 0;
  for (const nombre of ARCHIVOS_FORMULADOR) {
    const rel = `backend/routes/${nombre}.routes.js`;
    const lineas = lf(leer(rel)).split('\n');
    // Análisis por LÍNEAS, no por expresión regular sobre la cadena de
    // middlewares. La primera versión de esta prueba usaba un regex con
    // cuantificador perezoso que se cortaba en el primer paréntesis y marcaba
    // las 50 rutas como desprotegidas — un FALSO POSITIVO, con el código
    // correcto (verificado en vivo: 403 en los 10 archivos). Una prueba que
    // miente es peor que no tenerla, así que se mide lo que de verdad hay:
    // el registro de la ruta y, por si alguien parte la cadena en varias
    // líneas, las dos siguientes.
    for (let i = 0; i < lineas.length; i++) {
      const m = lineas[i].match(/app\.(get|post|put|patch|delete)\(\s*([`'"][^`'"]+[`'"])/);
      if (!m) continue;
      total++;
      const ventana = lineas.slice(i, i + 3).join('\n');
      if (!ventana.includes("requireAccess('formulador')")) {
        sinProteger.push(`${rel} → ${m[1].toUpperCase()} ${m[2]}`);
      }
    }
    const src = lf(leer(rel));
    // El register debe recibir requireAccess por inyección, o la llamada
    // reventaría en el arranque (así se detectó que faltaba el call site).
    assert.match(src, /export (async )?function register\w+Routes\(app, \{[^}]*requireAccess/,
      `${rel}: el register debe recibir requireAccess por inyección de dependencias`);
  }
  assert.ok(total >= 50, `se esperaban al menos 50 rutas auditadas, se encontraron ${total}`);
  assert.deepEqual(sinProteger, [], `rutas de pago SIN requireAccess('formulador'):\n${sinProteger.join('\n')}`);
});

test('INVARIANTE: server.js inyecta requireAccess en los 10 registers de módulos de pago', () => {
  const src = lf(leer('server.js'));
  const faltantes = [];
  for (const nombre of ARCHIVOS_FORMULADOR) {
    const Reg = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    const re = new RegExp(`register${Reg}Routes\\(app,\\s*\\{[^}]*requireAccess`);
    if (!re.test(src)) faltantes.push(`register${Reg}Routes`);
  }
  assert.deepEqual(faltantes, [], `call sites sin requireAccess inyectado: ${faltantes.join(', ')}`);
});

// ── Invariante 2: ningún proveedor de IA pagado sin techo de gasto ───────────
test('INVARIANTE: la rama Gemini del servidor reserva contra el tope por usuario (H1) y falla cerrado', () => {
  const src = lf(leer('backend/services/llmProveedor.js'));
  assert.match(src, /cfgPresupuestoGemini/, 'debe existir la config de presupuesto con tarifas Gemini');
  assert.match(src, /reservar\(\{\s*userId,\s*agente,\s*modelo: MODELO_GEMINI/,
    'el paso Gemini debe RESERVAR antes de llamar — sin esto la rama vuelve a quedar sin techo');
  assert.match(src, /presupuesto_no_verificable/,
    'debe fallar cerrado cuando el gasto no se puede verificar');
});

test('INVARIANTE: siempre hay un techo en USD, incluso sin LLM_TOPE_USD_* en el entorno', async () => {
  // En Render esas variables son `sync:false` y pueden faltar. Sin respaldo, la
  // rama Gemini volvería a ser un cheque en blanco.
  const { cfgPresupuestoGemini } = await import('../../backend/services/llmProveedor.js');
  const cfg = cfgPresupuestoGemini({});
  assert.equal(cfg.ok, true, 'sin entorno, el presupuesto debe seguir siendo verificable');
  assert.ok(cfg.topeDia > 0, 'tope diario de respaldo > 0');
  assert.ok(cfg.topeMes > 0, 'tope mensual de respaldo > 0');
});

test('INVARIANTE: el techo de IA de cada plan no pasa del 20% de lo que ese plan paga', async () => {
  // Antes el tope era UNO para todos: con USD 30/mes plano, un usuario de
  // Radar (~USD 37) podía quemar el 81% de su propio ingreso en un solo
  // insumo, mientras en Suite (~USD 125) el mismo tope era el 24%. El techo
  // no guardaba relación con el precio. Esta prueba fija esa relación.
  const { PLANES, TOPES_IA_POR_PLAN, USD_COP_REF, topesDePlan } = await import('../../backend/config/planes.config.js');

  assert.deepEqual(Object.keys(TOPES_IA_POR_PLAN).sort(), Object.keys(PLANES).sort(),
    'todo plano del catálogo debe tener su techo de IA — si agregas un plan, agrégalo aquí');

  for (const [plan, tope] of Object.entries(TOPES_IA_POR_PLAN)) {
    assert.ok(tope.dia > 0 && tope.mes > 0, `${plan}: el techo nunca es cero (ni ilimitado)`);
    assert.ok(tope.dia <= tope.mes, `${plan}: el techo diario no puede exceder el mensual`);

    const ingresoUsd = PLANES[plan].precio / USD_COP_REF;
    if (ingresoUsd > 0) {
      const fraccion = tope.mes / ingresoUsd;
      assert.ok(fraccion <= 0.25,
        `${plan}: el techo de IA (USD ${tope.mes}) es el ${(fraccion * 100).toFixed(0)}% del ingreso (USD ${ingresoUsd.toFixed(2)}). Máximo 25%.`);
    } else {
      // free: cortesía de adquisición, acotada a propósito.
      assert.ok(tope.mes <= 5, 'el plan gratuito debe tener una cortesía pequeña y acotada');
    }
  }

  // Un plan desconocido no debe inventar un techo: cae al del entorno.
  assert.equal(topesDePlan('plan-que-no-existe'), null);
  assert.equal(topesDePlan(undefined), null);
});

test('INVARIANTE: el tope por plan se consulta en la cadena de resolución del presupuesto', () => {
  const src = lf(leer('backend/services/iaPresupuesto.js'));
  assert.match(src, /topesDePlan/, 'iaPresupuesto debe resolver el tope del plan');
  assert.match(src, /FROM user_subscriptions WHERE user_id/, 'y leer el plan del usuario');
  // El override por usuario sigue mandando sobre el del plan.
  assert.match(src, /numPositivo\(fila\?\.tope_usd_dia\) \?\? plan\?\.dia \?\? cfg\.topeDia/,
    'precedencia: override del usuario → tope del plan → entorno');
});

test('INVARIANTE: el tráfico de SISTEMA no entra al libro de USD por usuario (doble contabilidad)', () => {
  // Defecto real introducido y corregido el 2026-09-30: reservar también para
  // soloServidor cortaba el batch del Radar contra el tope de un "usuario"
  // sintético y contaba dos veces el mismo gasto.
  const src = lf(leer('backend/services/llmProveedor.js'));
  assert.match(src, /soloServidor \? null : cfgPresupuestoGemini\(\)/,
    'soloServidor debe quedar EXENTO de la reserva en USD (ya lo acota iaTopeSistema)');
});

// ── Invariante 3: aislamiento multi-tenant que no degrada en silencio ────────
test('INVARIANTE: en producción withTenant() falla cerrado en vez de degradar a BYPASSRLS (H8)', () => {
  const src = lf(leer('backend/config/database.config.js'));
  assert.match(src, /class RlsNoDisponibleError/, 'debe existir el error de corte');
  assert.match(src, /strictProduction && \(!scopedConfigured \|\| !_pgScopedReady\)[\s\S]{0,80}throw new RlsNoDisponibleError/,
    'el corte en producción debe lanzar, no advertir');
});

// ── Invariante 4: cero montos en TODAS las secciones del Expediente ──────────
test('INVARIANTE: las 9 secciones del Expediente tienen vetado el monto, sin excepción', async () => {
  const X = await import('../../backend/services/expedienteFinanciador.js');
  const src = lf(leer('backend/services/expedienteFinanciador.js'));
  const bloque = src.match(/const SIN_MONTOS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(bloque, 'SIN_MONTOS debe declararse como objeto congelado');
  const vetadas = [...bloque[1].matchAll(/^\s*([a-z_]+):/gm)].map(m => m[1]);
  assert.deepEqual(
    [...vetadas].sort(),
    [...X.SECCIONES_IDS].sort(),
    'toda sección del Expediente debe estar en SIN_MONTOS — si agregaste una sección, agrégala aquí',
  );
  for (const id of X.SECCIONES_IDS) {
    assert.equal(bloque[1].includes(`${id}: null`), true,
      `la sección ${id} debe tener el veto en TODOS sus grupos (null), no parcial`);
  }
});

// ── Invariante 5: el pipeline de despliegue ejecuta las pruebas ──────────────
// El job se llama `ci-gate` desde el 2026-10-12: el nombre declara su función
// (es la puerta, no "unas pruebas más"). Si alguien lo renombra otra vez, hay
// que actualizar también el contexto en la protección de rama de main.
const JOB_GATE = '\n  ci-gate:';

test('INVARIANTE: el job ci-gate de radar.yml corre las pruebas unitarias y el deploy depende de él (H9)', () => {
  const yml = lf(leer('.github/workflows/radar.yml'));   // lf(): el archivo tiene CRLF
  assert.match(yml, /run: npm run test:unit/, 'el job ci-gate debe ejecutar npm run test:unit');
  // El step de pruebas tiene que estar DENTRO del gate, antes del job deploy.
  const iCi = yml.indexOf(JOB_GATE);
  const iDeploy = yml.indexOf('\n  deploy:');
  const iTest = yml.indexOf('run: npm run test:unit');
  assert.ok(iCi >= 0, 'debe existir el job ci-gate');
  assert.ok(iDeploy > iCi, 'se esperan los jobs ci-gate y deploy en ese orden');
  assert.ok(iTest > iCi && iTest < iDeploy, 'npm run test:unit debe estar en el gate, no después del deploy');
  assert.match(yml.slice(iDeploy), /needs: ci-gate/, 'el deploy debe depender del job ci-gate');
});

test('INVARIANTE: el job ci-gate corre en los pull requests (un gate que solo mira el merge no es un gate)', () => {
  const yml = lf(leer('.github/workflows/radar.yml'));
  const iJobs = yml.indexOf('\njobs:');
  const disparadores = yml.slice(0, iJobs);
  assert.match(disparadores, /^\s{2}pull_request:/m,
    'radar.yml debe dispararse en pull_request — si no, test:unit y estos invariantes corren DESPUÉS del merge');

  // Y el gate no puede excluirse a sí mismo de los PRs con un `if`.
  const bloqueCi = yml.slice(yml.indexOf(JOB_GATE), yml.indexOf('\n  deploy:'));
  assert.doesNotMatch(bloqueCi, /if:.*github\.event_name/,
    'el job ci-gate no debe filtrar por event_name: eso lo apaga en los PRs');

  // Pero el deploy SÍ debe excluirlos: un PR valida, nunca despliega.
  const bloqueDeploy = yml.slice(yml.indexOf('\n  deploy:'));
  assert.match(bloqueDeploy, /if: github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/,
    'el deploy debe seguir restringido a push/workflow_dispatch — un PR jamás debe desplegar');
});

// ── Invariante: el smoke test tolera el arranque en frío y falla con motivo ──
test('INVARIANTE: el smoke test calienta el servicio antes de juzgar, y su timeout cubre el arranque en frío medido', () => {
  // Causa medida en vivo (2026-09-30 y 2026-10-12): el servicio de Render se
  // duerme por inactividad y despertó en 28,5 s. Con el tope viejo de 15 s por
  // petición y sin calentamiento, los checks 1 y 2 fallaban SIEMPRE que el
  // servicio estuviera dormido, y los 3–6 pasaban: se leía como "producción
  // rota" cuando era la prueba rindiéndose antes de tiempo.
  const src = lf(leer('backend/scripts/smokeTest.js'));

  const timeout = Number(src.match(/const TIMEOUT\s*=\s*(\d+)/)?.[1]);
  assert.ok(Number.isFinite(timeout), 'debe declararse TIMEOUT');
  assert.ok(timeout >= 30000,
    `TIMEOUT=${timeout}ms no cubre el arranque en frío medido (28.500ms). Subirlo, no bajarlo.`);

  const warmup = Number(src.match(/const WARMUP_TIMEOUT\s*=\s*(\d+)/)?.[1]);
  assert.ok(warmup >= 45000, 'el intento despertador debe esperar al menos 45s');
  assert.ok(Number(src.match(/const WARMUP_INTENTOS\s*=\s*(\d+)/)?.[1]) >= 3, 'al menos 3 reintentos de calentamiento');
  assert.match(src, /async function calentar\(/, 'debe existir la rutina de calentamiento');
  assert.match(src, /await calentar\(\)/, 'y debe invocarse antes de la batería de pruebas');

  // Un servicio que no levanta es fallo de INFRAESTRUCTURA, no un defecto de
  // la app: la distinción tiene que seguir siendo explícita en la salida.
  assert.match(src, /FALLO DE INFRAESTRUCTURA/, 'el fallo de arranque debe reportarse como infraestructura');
});

test('INVARIANTE: el smoke test corta de inmediato si falta SMOKE_TEST_TOKEN, con el motivo exacto', () => {
  // Antes, el secreto ausente aparecía como el check 7 fallido al final de una
  // corrida de 3 minutos, mezclado con resultados reales: parecía un problema
  // de producción cuando era un secreto no registrado en GitHub Actions.
  const src = lf(leer('backend/scripts/smokeTest.js'));
  assert.match(src, /process\.env\.SMOKE_TEST_TOKEN/, 'debe leer el secreto');
  assert.match(src, /\[FATAL\] SMOKE_TEST_TOKEN no presente/, 'mensaje explícito exigido');
  assert.match(src, /process\.exit\(1\)/, 'debe abortar con código 1');

  // Y el workflow tiene que seguir resolviéndolo y exportándolo al script,
  // venga del secreto de Actions o de la API de Render (fuente única).
  const yml = lf(leer('.github/workflows/radar.yml'));
  assert.match(yml, /SMOKE_TEST_TOKEN=\$TOKEN" >> "\$GITHUB_ENV"/,
    'radar.yml debe exportar el token resuelto al entorno del step del smoke test');
});

test('INVARIANTE: el token del smoke test se resuelve de UNA fuente (Render), sin copia manual que desincronizar', () => {
  // Causa raíz eliminada el 2026-10-12: el mismo secreto tenía que existir a la
  // vez en Render (donde lo lee server.js) y en los secretos de Actions, sin
  // nada que mantuviera las copias sincronizadas ni que detectara la deriva.
  // El único síntoma era un smoke test rojo tras desplegar.
  const yml = lf(leer('.github/workflows/radar.yml'));
  assert.match(yml, /api\.render\.com\/v1\/services\/\$\{RENDER_SERVICE_ID\}\/env-vars/,
    'el job debe resolver el token desde la API de Render (fuente única)');
  assert.match(yml, /::add-mask::\$TOKEN/,
    'el valor debe enmascararse antes de exportarse, o puede filtrarse a los logs');
  assert.match(yml, /TOKEN_MANUAL: \$\{\{ secrets\.SMOKE_TEST_TOKEN \}\}/,
    'el secreto de Actions se conserva como primera opción: este cambio no debe romper lo existente');
});

test('INVARIANTE: playwright.yml no puede volver a bloquear la fusión por un puerto ocupado', () => {
  // `test` es un check OBLIGATORIO de la protección de main: un flake suyo
  // bloquea la fusión con el código intacto. Ya ocurrió con
  // "failed to bind host port 0.0.0.0:54322 → address already in use".
  const yml = lf(leer('.github/workflows/playwright.yml'));
  assert.match(yml, /^concurrency:/m, 'debe haber un grupo de concurrencia por rama');
  assert.match(yml, /cancel-in-progress: true/, 'el run viejo se cancela: vale el commit más nuevo');
  assert.match(yml, /supabase stop --no-backup/, 'debe derribar el stack para no dejar puertos tomados');
  assert.match(yml, /docker ps -aq --filter "name=supabase_"/, 'red de seguridad para contenedores huérfanos');
  assert.match(yml, /if \[ ! -f \.\/supabase\.env \]/,
    'la comprobación de residuos no debe fallar por un archivo ausente y tapar la causa real');
});

// ── Invariante 6: la guarda local de rama existe (causa de 6f5495d) ──────────
test('INVARIANTE: el pre-commit bloquea commits directos sobre main (protección local, no solo en GitHub)', () => {
  const hook = join(RAIZ, '.husky', 'pre-commit');
  assert.ok(existsSync(hook), 'debe existir .husky/pre-commit');
  const src = lf(readFileSync(hook, 'utf8'));
  assert.match(src, /RAMA_ACTUAL|rev-parse --abbrev-ref HEAD/,
    'el hook debe leer la rama actual — sin esto, un agente puede commitear en main (incidente 6f5495d, 2026-10-12)');
  assert.match(src, /PERMITIR_COMMIT_MAIN/,
    'debe existir una salida de emergencia explícita y documentada');
});

// ── Invariante 7: los secretos siguen bloqueados (protección ya aprobada) ────
test('INVARIANTE: el pre-commit conserva el bloqueo de .env y de patrones de API key', () => {
  // Esta prueba NO añade nada nuevo: vigila que una edición futura del hook no
  // borre la protección instalada tras el incidente de .env commiteado.
  const src = lf(readFileSync(join(RAIZ, '.husky', 'pre-commit'), 'utf8'));
  assert.match(src, /COMMIT BLOQUEADO — archivo de secretos/, 'bloqueo de archivos de secretos');
  assert.match(src, /SECRET_PATTERN=/, 'patrones de API key');
  assert.match(src, /architecture-gate\.cjs/, 'gate de arquitectura');
});
