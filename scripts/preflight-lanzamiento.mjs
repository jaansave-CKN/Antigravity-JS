#!/usr/bin/env node
/**
 * preflight-lanzamiento.mjs — valida las PRECONDICIONES de un despliegue
 * ANTES de comprometerse a un plan secuencial.
 *
 * POR QUÉ EXISTE
 * --------------
 * Auditoría causal 2026-10-12. El "Protocolo ALPHA-9" se declaró obligatorio y
 * secuencial, con aborto ante cualquier fallo, pero tres de sus fases asumían
 * hechos que eran FALSOS en el momento de ejecutarlas:
 *
 *   - Fase 4.1 ordenaba `git push origin main`. La API de GitHub responde que
 *     `main` tiene enforce_admins=true, PR obligatorio, historial lineal y
 *     force-push prohibido: el push se habría rechazado.
 *   - Fase 4.2 exigía verde en el job `ci` de radar.yml. Los checks que la rama
 *     realmente requiere son `test` y `react-doctor`.
 *   - Fase 2.1 ordenaba verificar la consola de Render. No hay credenciales de
 *     Render en el entorno local (viven como secretos de GitHub Actions).
 *   - Fase 1.5 ordenaba aislar trabajo ajeno "sin tests", cuando ese trabajo
 *     traía 4 archivos de test (14 pruebas), lo que contradecía la Fase 3.2.
 *
 * Es el mismo patrón que CLAUDE.md ya documenta de una auditoría de 2026-08-03:
 * prosa técnica plausible construida sobre notas, sin ejecutar una sola
 * verificación. La regla estaba escrita; lo que faltaba era la herramienta.
 *
 * REGLA DE ORO DE ESTE SCRIPT: distingue tres estados, nunca dos.
 *   CUMPLE          → verificado en vivo, con la evidencia impresa.
 *   FALLA           → verificado en vivo, y no cumple.
 *   NO_VERIFICABLE  → no se pudo comprobar desde aquí. NO es un aprobado.
 * Un plan de despliegue no puede avanzar sobre un NO_VERIFICABLE: eso es
 * precisamente lo que convierte una suposición en un incidente.
 *
 * Uso:
 *   node scripts/preflight-lanzamiento.mjs
 *   node scripts/preflight-lanzamiento.mjs --json
 *
 * Salida: 0 si no hay FALLA ni NO_VERIFICABLE; 1 en cualquier otro caso.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

/** CRLF → LF. Sin esto, un chequeo por expresión regular da FALSOS NEGATIVOS:
 *  ocurrió en vivo el 2026-10-12 con .github/workflows/radar.yml. */
const lf = (s) => s.replace(/\r\n/g, '\n');
const leer = (rel) => (existsSync(join(RAIZ, rel)) ? lf(readFileSync(join(RAIZ, rel), 'utf8')) : null);

const resultados = [];
const anotar = (fase, chequeo, estado, evidencia) => resultados.push({ fase, chequeo, estado, evidencia });

// ── Resolución de binarios a prueba de PATH ──────────────────────────────────
// En este entorno (Windows + Git Bash) los shells no-login no heredan el PATH
// interactivo: `node`, `npm` y `gh` existen instalados pero no se resuelven.
// Ya hay DOS parches del mismo problema dentro de .husky/pre-commit, fechados
// como hallazgos reproducidos en vivo. Se centraliza aquí para no sumar un
// tercer parche local.
const CANDIDATOS = {
  git: ['git', 'C:/Program Files/Git/cmd/git.exe'],
  gh: ['gh', 'C:/Program Files/GitHub CLI/gh.exe'],
};

function resolver(nombre) {
  for (const ruta of CANDIDATOS[nombre] ?? [nombre]) {
    try {
      execFileSync(ruta, ['--version'], { stdio: 'ignore' });
      return ruta;
    } catch { /* siguiente candidato */ }
  }
  return null;
}

function correr(bin, args) {
  return execFileSync(bin, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const GIT = resolver('git');
const GH = resolver('gh');

// ─────────────────────────────────────────────────────────────────────────────
// FASE A — Estado del repositorio: ¿hay algo que un reset destruiría?
// ─────────────────────────────────────────────────────────────────────────────
if (!GIT) {
  anotar('A', 'git disponible', 'NO_VERIFICABLE', 'no se resolvió el binario de git');
} else {
  const rama = correr(GIT, ['rev-parse', '--abbrev-ref', 'HEAD']);
  anotar('A', 'rama actual', rama === 'main' || rama === 'master' ? 'FALLA' : 'CUMPLE',
    `rama = ${rama}` + (rama === 'main' ? ' — un despliegue se prepara en una rama de release, no en main' : ''));

  // Trabajo sin commitear: la Fase 1.3 de ALPHA-9 ordenaba `reset --hard`, que
  // habría borrado 4 archivos de trabajo validado (entre ellos el fix del
  // defecto de doble contabilidad del tope). Nunca se resetea a ciegas.
  const sucio = correr(GIT, ['status', '--porcelain']).split('\n').filter(Boolean);
  anotar('A', 'árbol limpio (un reset --hard no destruiría nada)',
    sucio.length === 0 ? 'CUMPLE' : 'FALLA',
    sucio.length === 0 ? 'sin cambios pendientes' : `${sucio.length} archivo(s) sin commitear:\n    ${sucio.join('\n    ')}`);

  // Commits locales no empujados: de dónde salieron y si los hizo esta sesión.
  let adelante = [];
  try {
    adelante = correr(GIT, ['log', '--oneline', 'origin/main..HEAD']).split('\n').filter(Boolean);
  } catch { /* sin origin/main local */ }
  anotar('A', 'commits locales sin empujar',
    adelante.length === 0 ? 'CUMPLE' : 'FALLA',
    adelante.length === 0 ? 'ninguno' : `${adelante.length}:\n    ${adelante.join('\n    ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE B — Reglas reales de la rama destino (no las que el plan supone)
// ─────────────────────────────────────────────────────────────────────────────
if (!GH) {
  anotar('B', 'protección de la rama destino', 'NO_VERIFICABLE',
    'gh CLI no resuelto — NO asumir que el push directo funciona');
} else {
  try {
    const crudo = correr(GH, ['api', 'repos/jaansave-CKN/Antigravity-JS/branches/main/protection']);
    const p = JSON.parse(crudo);
    const prObligatorio = !!p.required_pull_request_reviews;
    const admins = !!p.enforce_admins?.enabled;
    const lineal = !!p.required_linear_history?.enabled;
    const checks = p.required_status_checks?.contexts ?? [];

    anotar('B', 'vía de entrega a main',
      prObligatorio || admins ? 'FALLA' : 'CUMPLE',
      prObligatorio || admins
        ? `push directo RECHAZADO (PR obligatorio=${prObligatorio}, enforce_admins=${admins}) — usar PR`
        : 'push directo permitido');
    anotar('B', 'tipo de fusión admitida', lineal ? 'FALLA' : 'CUMPLE',
      lineal ? 'required_linear_history=true → un merge commit se rechaza; usar rebase o squash' : 'merge commit permitido');
    anotar('B', 'checks que la rama exige de verdad', checks.length ? 'CUMPLE' : 'NO_VERIFICABLE',
      checks.length ? `[${checks.join(', ')}] — gatear sobre ESTOS, no sobre los que suponga el plan` : 'ninguno declarado');
  } catch (e) {
    anotar('B', 'protección de la rama destino', 'NO_VERIFICABLE', `la API no respondió: ${String(e.message).slice(0, 120)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE C — Presupuesto de IA explícito (nunca por defecto en producción)
// ─────────────────────────────────────────────────────────────────────────────
const render = leer('render.yaml');
for (const clave of ['LLM_TOPE_USD_DIA', 'LLM_TOPE_USD_MES']) {
  if (!render) { anotar('C', `${clave} en render.yaml`, 'NO_VERIFICABLE', 'no se pudo leer render.yaml'); continue; }
  const bloque = render.match(new RegExp(`- key: ${clave}\\s*\\n\\s*(value: *(\\S+)|sync: *false)`));
  if (!bloque) anotar('C', `${clave} en render.yaml`, 'FALLA', 'la variable no está declarada');
  else if (bloque[2]) anotar('C', `${clave} en render.yaml`, 'CUMPLE', `value: ${bloque[2]} (explícito y versionado)`);
  else anotar('C', `${clave} en render.yaml`, 'NO_VERIFICABLE',
    'sync:false → el valor vive solo en la consola de Render. Sin credenciales de Render aquí NO se puede confirmar que exista; si falta, el código cae a su tope de respaldo');
}

// La consola de Render: decir con claridad que no se puede mirar desde aquí.
const tieneRender = !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID);
anotar('C', 'lectura del entorno real de Render', tieneRender ? 'CUMPLE' : 'NO_VERIFICABLE',
  tieneRender ? 'RENDER_API_KEY y RENDER_SERVICE_ID presentes'
    : 'RENDER_API_KEY / RENDER_SERVICE_ID ausentes (son secretos de GitHub Actions) — ninguna afirmación sobre el entorno de producción puede darse por verificada desde aquí');

// ─────────────────────────────────────────────────────────────────────────────
// FASE D — Lo que el despliegue monetiza y observa
// ─────────────────────────────────────────────────────────────────────────────
// Se leen del .env LOCAL y se dice explícitamente que es local: el estado de
// producción no es inferible desde aquí (ver Fase C).
const env = leer('.env');
const valorEnv = (k) => {
  if (!env) return null;
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  const v = m?.[1]?.trim();
  return v && !/^(tu_|<|cambia|placeholder)/i.test(v) ? v : null;
};
for (const [clave, porque] of [
  ['STRIPE_SECRET_KEY', 'sin esto no se puede cobrar'],
  ['WOMPI_PRIVATE_KEY', 'alternativa de cobro para COP/PSE'],
  ['SENTRY_DSN', 'sin esto los errores de los primeros usuarios se sabrán por queja, no por alerta'],
]) {
  anotar('D', `${clave} (.env local)`, valorEnv(clave) ? 'CUMPLE' : 'NO_VERIFICABLE',
    valorEnv(clave) ? 'presente en el .env local' : `vacía en el .env local — ${porque}. Confirmar en la consola de Render`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Informe
// ─────────────────────────────────────────────────────────────────────────────
const cuenta = (e) => resultados.filter(r => r.estado === e).length;
const resumen = { cumple: cuenta('CUMPLE'), falla: cuenta('FALLA'), no_verificable: cuenta('NO_VERIFICABLE') };
const autorizado = resumen.falla === 0 && resumen.no_verificable === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ resumen, autorizado, resultados }, null, 2));
} else {
  const icono = { CUMPLE: '✅', FALLA: '❌', NO_VERIFICABLE: '⚠️ ' };
  console.log('\n  PREFLIGHT DE LANZAMIENTO — RadarFondos 360');
  console.log('  ' + '─'.repeat(72));
  let faseActual = null;
  for (const r of resultados) {
    if (r.fase !== faseActual) { faseActual = r.fase; console.log(`\n  FASE ${r.fase}`); }
    console.log(`  ${icono[r.estado]} ${r.chequeo}`);
    console.log(`       ${r.evidencia.replace(/\n/g, '\n       ')}`);
  }
  console.log('\n  ' + '─'.repeat(72));
  console.log(`  CUMPLE ${resumen.cumple}   FALLA ${resumen.falla}   NO VERIFICABLE ${resumen.no_verificable}`);
  console.log(autorizado
    ? '  → PRECONDICIONES COMPLETAS. El plan de despliegue puede ejecutarse.\n'
    : '  → NO AUTORIZADO. Un ⚠️  NO VERIFICABLE no es un aprobado: resuélvelo\n    o decláralo asumido por escrito antes de avanzar.\n');
}

process.exit(autorizado ? 0 : 1);
