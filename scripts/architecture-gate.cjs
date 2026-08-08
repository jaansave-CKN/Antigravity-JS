/**
 * scripts/architecture-gate.cjs — Gate de arquitectura "cero código sin diseño
 * aprobado" para RadarFondos 360. Adaptado del patrón ya construido y
 * verificado en `Antigravity JS/agents/architecture-gate.cjs` (proyecto raíz),
 * simplificado: este repo no tiene una jerarquía de 15 agentes numerados, así
 * que no hay batch executor — solo el gate (veredicto + firma).
 *
 * Sin dependencia de @anthropic-ai/sdk (no está en package.json de este repo,
 * y no se agrega una dependencia nueva para esto) — llama la API de Anthropic
 * directo vía fetch nativo (Node >=20, ya requerido por este proyecto).
 *
 * DEGRADACIÓN SEGURA (a propósito, distinto del proyecto raíz): si
 * ANTHROPIC_API_KEY no está configurada, `--check-gate` NO bloquea el commit
 * — imprime un aviso y sale con éxito. Bloquear todos los commits porque falta
 * una clave que nadie ha decidido pagar todavía sería peor que no tener gate.
 * El mismo patrón de "standby, no bloqueo" que Stripe/Wompi/Sentry en este
 * repo (ver backend/config/production.config.js). Se vuelve obligatorio de
 * verdad solo cuando exista al menos una aprobación vigente.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const dirRoot = path.join(__dirname, '..');
const APROBACION_PATH = path.join(__dirname, 'diseno_aprobado.json');
const ARCHITECT_PROMPT_PATH = path.join(dirRoot, '.claude', 'agents', 'architect.md');
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const CODE_DIRS = ['backend', 'client/src'];

function listarArchivosRecursivo(dir, base) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listarArchivosRecursivo(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

// Firma cubre backend/ + client/src/ — los dos árboles de código real de este
// repo (ver .claude/agents/architect.md). Cualquier cambio en cualquiera de
// los dos invalida la aprobación vigente.
function hashEstado() {
  const payload = CODE_DIRS.map((d) => {
    const dir = path.join(dirRoot, d);
    const archivos = listarArchivosRecursivo(dir, dirRoot).sort();
    return `${d}:${archivos.join(',')}`;
  }).join('||');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function validarDisenoAprobado() {
  if (!fs.existsSync(APROBACION_PATH)) {
    return { aprobado: false, razon: 'No existe firma vigente (diseno_aprobado.json ausente).' };
  }
  let firma;
  try {
    firma = JSON.parse(fs.readFileSync(APROBACION_PATH, 'utf8'));
  } catch (e) {
    return { aprobado: false, razon: `diseno_aprobado.json corrupto: ${e.message}` };
  }
  if (firma.aprobado !== true) {
    return { aprobado: false, razon: 'El Agente Arquitecto marcó el último diseño evaluado como NO aprobado.' };
  }
  const hashActual = hashEstado();
  if (firma.firma !== hashActual) {
    return { aprobado: false, razon: 'backend/ o client/src/ cambiaron después de la firma — se requiere re-aprobación.' };
  }
  return { aprobado: true, firma: firma.firma, timestamp: firma.timestamp };
}

// Invoca al Agente Arquitecto real (system prompt = architect.md) sobre el git
// diff pendiente, vía llamada directa a la API de Anthropic (fetch, sin SDK).
async function pedirVeredictoArquitecto() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { aprobado: false, sinClave: true, razones: ['ANTHROPIC_API_KEY no configurada — no se puede invocar al Agente Arquitecto.'] };
  }
  if (!fs.existsSync(ARCHITECT_PROMPT_PATH)) {
    return { aprobado: false, razones: [`No existe ${ARCHITECT_PROMPT_PATH} — sin criterio de arquitectura que aplicar.`] };
  }
  const systemPrompt = fs.readFileSync(ARCHITECT_PROMPT_PATH, 'utf8');

  let diff;
  try {
    diff = execFileSync('git', ['diff', 'HEAD'], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (e) {
    return { aprobado: false, razones: [`No se pudo leer 'git diff HEAD': ${e.message}`] };
  }
  if (!diff || !diff.trim()) {
    return { aprobado: false, razones: ['git diff HEAD está vacío — no hay cambios pendientes que aprobar.'] };
  }

  let data;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Fiscaliza el siguiente diff pendiente de aprobación (git diff HEAD, truncado a 60000 caracteres si aplica). ` +
            `IMPORTANTE: esta invocación es una llamada directa a la API de Anthropic, no una sesión de Claude Code — ` +
            `no tienes acceso real a Read/Grep/Glob aquí pese a lo que indique tu system prompt para tu uso habitual. ` +
            `No emitas tool_call ni nada similar: no se ejecutará. Basa tu fiscalización únicamente en el diff de texto ` +
            `provisto abajo. Sé conciso en el análisis narrativo — el veredicto JSON obligatorio al final es lo único ` +
            `que este proceso puede parsear; prioriza terminar con el JSON sobre extender el análisis.\n\n${diff.slice(0, 60000)}`,
        }],
      }),
    });
    data = await res.json();
    if (!res.ok) {
      return { aprobado: false, razones: [`Fallo de la API de Anthropic (HTTP ${res.status}): ${data?.error?.message || JSON.stringify(data)}`] };
    }
  } catch (e) {
    return { aprobado: false, razones: [`Fallo de red llamando a la API de Anthropic: ${e.message}`] };
  }

  const text = data?.content?.[0]?.text ?? '';
  const match = text.match(/\{[^{}]*"aprobado"\s*:\s*(true|false)[^{}]*\}/s);
  if (!match) {
    return { aprobado: false, razones: ['El Agente Arquitecto no devolvió un veredicto JSON parseable.'], respuestaCruda: text.slice(0, 800) };
  }
  let veredicto;
  try {
    veredicto = JSON.parse(match[0]);
  } catch (e) {
    return { aprobado: false, razones: [`Veredicto JSON corrupto: ${e.message}`], respuestaCruda: text.slice(0, 800) };
  }
  return { aprobado: veredicto.aprobado === true, razones: veredicto.razones || [] };
}

// `node scripts/architecture-gate.cjs --check-gate` — modo sin costo, para el
// hook de pre-commit. Solo valida que exista una firma vigente ya emitida por
// --aprobar-diseno; cero llamadas a la API.
if (process.argv.includes('--check-gate')) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ℹ️  [GATE_ARQUITECTURA] Inactivo — falta ANTHROPIC_API_KEY. No se bloquea el commit (standby, igual que Stripe/Wompi/Sentry en este repo).');
    console.log('    Para activarlo: configura ANTHROPIC_API_KEY en .env y corre: node scripts/architecture-gate.cjs --aprobar-diseno');
    process.exitCode = 0;
  } else {
    const veredicto = validarDisenoAprobado();
    if (!veredicto.aprobado) {
      console.error('\n🛑 [GATE_ARQUITECTURA] Sin aprobación vigente: ' + veredicto.razon);
      console.error('   Ejecuta: node scripts/architecture-gate.cjs --aprobar-diseno');
      process.exitCode = 1;
    } else {
      console.log(`✅ [GATE_ARQUITECTURA] Aprobación vigente (firma ${veredicto.firma.slice(0, 12)}…, ${veredicto.timestamp})`);
      process.exitCode = 0;
    }
  }
} else if (process.argv.includes('--aprobar-diseno')) {
  // `node scripts/architecture-gate.cjs --aprobar-diseno` — invoca al Agente
  // Arquitecto real sobre el diff pendiente. Solo si aprobado:true se firma.
  (async () => {
    console.log('\n🔎 [Agente Arquitecto] Evaluando git diff HEAD contra .claude/agents/architect.md...');
    const veredicto = await pedirVeredictoArquitecto();

    if (!veredicto.aprobado) {
      console.error('\n🛑 [GATE_ARQUITECTURA] El Agente Arquitecto RECHAZÓ el diseño — o no pudo evaluarlo.');
      (veredicto.razones || []).forEach((r) => console.error(`   - ${r}`));
      if (veredicto.respuestaCruda) console.error(`   Respuesta cruda: ${veredicto.respuestaCruda}`);
      process.exitCode = 1;
      return;
    }

    const firma = hashEstado();
    fs.writeFileSync(APROBACION_PATH, JSON.stringify({
      aprobado: true,
      firma,
      timestamp: new Date().toISOString(),
      firmado_por: 'Agente Arquitecto (.claude/agents/architect.md, vía API Anthropic directa)',
      razones: veredicto.razones,
    }, null, 2) + '\n', 'utf8');
    console.log(`\n✅ [Agente Arquitecto] Diseño aprobado. Firma: ${firma}`);
    (veredicto.razones || []).forEach((r) => console.log(`   - ${r}`));
    process.exitCode = 0;
  })();
} else {
  console.log('Uso: node scripts/architecture-gate.cjs --check-gate | --aprobar-diseno');
  process.exitCode = 1;
}
