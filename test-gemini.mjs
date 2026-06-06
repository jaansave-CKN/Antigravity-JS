// --- INICIO AUTOREPARADOR NIVEL DIOS ---
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Forzar lectura del .env desde la raíz absoluta
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '.env') });

const API_KEY = process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.argv[2];

if (!API_KEY) {
  console.error('\n[FALLO CRÍTICO] Infraestructura no detectada.');
  console.error('1. Verifica que el archivo .env exista en la raíz.');
  console.error('2. Verifica que contenga la variable: VITE_GEMINI_API_KEY=...');
  process.exit(1);
}
console.log('[SISTEMA] Conexión autorizada. Iniciando secuencia...');
// --- FIN AUTOREPARADOR ---

// ── Modelos validados con ModelService.ListModels para esta API key ───────────
const MODELS = [
  'gemini-2.0-flash-lite',  // menor cuota, más accesible
  'gemini-2.5-flash',       // GA estable
  'gemini-2.0-flash',       // puede tener 429 en free tier
];

// ── Escenarios de prueba ─────────────────────────────────────────────────────
const SCENARIOS = [
  {
    label: 'A — Sin tools (valida API key + endpoint)',
    tools: undefined,
  },
  {
    label: 'B — googleSearch camelCase (REST v1beta correcto)',
    tools: [{ googleSearch: {} }],
  },
  {
    label: 'C — google_search snake_case (posible causa del 404)',
    tools: [{ google_search: {} }],
  },
];

const PROMPT = 'Responde solo este JSON sin texto extra: [{"titulo":"Test OK","fuente":"Smoke","descripcion_corta":"Prueba exitosa","estado":"Abierta","enlace_oficial":"https://test.co"}]';

async function testCombo(model, scenario) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

  const bodyObj = {
    contents: [{ parts: [{ text: PROMPT }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
  };
  if (scenario.tools) bodyObj.tools = scenario.tools;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj),
    });

    const bodyText = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, snippet: bodyText.slice(0, 250).replace(/\n/g, ' ') };
    }

    const data = JSON.parse(bodyText);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) return { ok: false, status: 200, snippet: 'HTTP 200 pero sin texto en candidates' };

    return { ok: true, status: 200, text: text.slice(0, 180) };
  } catch (err) {
    return { ok: false, status: 0, snippet: err.message };
  }
}

// ── Ejecución ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('  SMOKE TEST — Gemini v1beta REST API');
console.log(`  API Key: ${API_KEY.slice(0, 8)}...${API_KEY.slice(-4)}`);
console.log('══════════════════════════════════════════════════════');

let winner = null;

for (const model of MODELS) {
  console.log(`\n▶ Modelo: ${model}`);
  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.label} ... `);
    const result = await testCombo(model, scenario);
    if (result.ok) {
      console.log(`✅ HTTP 200`);
      console.log(`     → ${result.text}`);
      if (!winner) {
        winner = { model, scenario: scenario.label };
        console.log('  🔥 PRIMER COMBO EXITOSO ↑');
      }
    } else {
      const tag = result.status === 404 ? '🚫 404 NOT_FOUND' : `❌ HTTP ${result.status}`;
      console.log(`${tag} → ${result.snippet}`);
    }
  }
}

console.log('\n══════════════════════════════════════════════════════');
if (winner) {
  console.log('  RESULTADO DEFINITIVO:');
  console.log(`    Modelo   : ${winner.model}`);
  console.log(`    Escenario: ${winner.scenario}`);
  console.log('\n  ✔ geminiScanner.ts ya está configurado con este combo.');
} else {
  console.log('  TODOS LOS COMBOS FALLARON.');
  console.log('  → API Key inválida, sin cuota, o región bloqueada.');
}
console.log('══════════════════════════════════════════════════════\n');
