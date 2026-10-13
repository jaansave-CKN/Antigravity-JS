// auditor_008_advisory_gate.test.cjs -- cobertura de las funciones puras del
// paso advisory de 008_AUDITOR_DE_CODIGO en CI (2026-08-13). Corre con:
// node --test scripts/auditor_008_advisory_gate.test.cjs
// No ejecuta ninguna llamada real a ningún proveedor (ejecutarAuditor008CI
// se prueba con fetch simulado de Claude y Gemini, abajo; mismo criterio que check_veto_008.test.cjs
// no testea main() -- solo las funciones puras/deterministas).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    obtenerBase, construirMensajeUsuario, validarVeredicto008,
    SCHEMA_008_CI, formatearResumen,
} = require('./auditor_008_advisory_gate.cjs');

test('obtenerBase: usa --base si se pasa por CLI', () => {
    const argvOriginal = process.argv;
    process.argv = [...argvOriginal.slice(0, 2), '--base', 'origin/master'];
    try {
        assert.equal(obtenerBase(), 'origin/master');
    } finally {
        process.argv = argvOriginal;
    }
});

test('obtenerBase: sin --base ni CHECK_VETO_BASE, default HEAD~1', () => {
    const argvOriginal = process.argv;
    const envOriginal = process.env.CHECK_VETO_BASE;
    process.argv = argvOriginal.slice(0, 2);
    delete process.env.CHECK_VETO_BASE;
    try {
        assert.equal(obtenerBase(), 'HEAD~1');
    } finally {
        process.argv = argvOriginal;
        if (envOriginal !== undefined) process.env.CHECK_VETO_BASE = envOriginal;
    }
});

test('validarVeredicto008: acepta la forma exacta {apto, score, hallazgos_criticos}', () => {
    const r = validarVeredicto008({ apto: true, score: 100, hallazgos_criticos: [] });
    assert.deepEqual(r, { ok: true });
});

test('validarVeredicto008: rechaza score fuera de rango 0-100', () => {
    const r = validarVeredicto008({ apto: false, score: 150, hallazgos_criticos: ['x'] });
    assert.equal(r.ok, false);
});

test('validarVeredicto008: rechaza hallazgos_criticos que no es array de strings', () => {
    const r = validarVeredicto008({ apto: false, score: 40, hallazgos_criticos: 'no es array' });
    assert.equal(r.ok, false);
});

test('validarVeredicto008: rechaza apto no booleano', () => {
    const r = validarVeredicto008({ apto: 'si', score: 90, hallazgos_criticos: [] });
    assert.equal(r.ok, false);
});

test('SCHEMA_008_CI: es el contrato usado por validarVeredicto008 (consistencia interna)', () => {
    const parse = SCHEMA_008_CI.safeParse({ apto: true, score: 100, hallazgos_criticos: [] });
    assert.equal(parse.success, true);
});

test('construirMensajeUsuario: exige explicitamente el JSON final con las 3 claves del contrato CI', () => {
    const msg = construirMensajeUsuario('diff falso', ['a.js'], false, []);
    assert.match(msg, /"apto"/);
    assert.match(msg, /"score"/);
    assert.match(msg, /"hallazgos_criticos"/);
});

test('construirMensajeUsuario: aclara que es una llamada de API sin herramientas reales (mismo criterio que 002/subgates)', () => {
    const msg = construirMensajeUsuario('diff falso', ['a.js'], false, []);
    assert.match(msg, /Read\/Grep\/Glob\/Bash/);
});

test('construirMensajeUsuario: incluye el diff literal al final', () => {
    const msg = construirMensajeUsuario('CONTENIDO_UNICO_DEL_DIFF', ['a.js'], false, []);
    assert.match(msg, /CONTENIDO_UNICO_DEL_DIFF/);
});

test('formatearResumen: caso "no se pudo ejecutar" (sin API key)', () => {
    const out = formatearResumen({ ejecutado: false, razon: 'ANTHROPIC_API_KEY no configurada.' });
    assert.match(out, /No se pudo ejecutar/);
    assert.match(out, /ANTHROPIC_API_KEY no configurada/);
});

test('formatearResumen: caso "sin cambios" contra la base', () => {
    const out = formatearResumen({ ejecutado: true, sinCambios: true, razon: "Sin diff contra 'HEAD~1'." });
    assert.match(out, /Sin diff contra/);
});

test('formatearResumen: caso "no parseable" incluye la respuesta narrativa cruda', () => {
    const out = formatearResumen({ ejecutado: true, parseable: false, razon: 'sin JSON', textoCompleto: 'ANALISIS_NARRATIVO_UNICO' });
    assert.match(out, /Sin senal accionable/);
    assert.match(out, /ANALISIS_NARRATIVO_UNICO/);
});

test('formatearResumen: veredicto apto:true muestra APTO y el score', () => {
    const out = formatearResumen({
        ejecutado: true, parseable: true,
        veredicto: { apto: true, score: 95, hallazgos_criticos: [] },
        textoCompleto: 'narrativa', archivosAuditados: ['a.js', 'b.sql'],
    });
    assert.match(out, /APTO/);
    assert.match(out, /95\/100/);
    assert.match(out, /2/); // archivos auditados
});

test('formatearResumen: veredicto apto:false lista los hallazgos criticos', () => {
    const out = formatearResumen({
        ejecutado: true, parseable: true,
        veredicto: { apto: false, score: 20, hallazgos_criticos: ['fuga multi-tenant en X', 'sin idempotencia en Y'] },
        textoCompleto: 'narrativa', archivosAuditados: ['a.sql'],
    });
    assert.match(out, /NO APTO/);
    assert.match(out, /fuga multi-tenant en X/);
    assert.match(out, /sin idempotencia en Y/);
});

test('formatearResumen: siempre incluye la aclaracion de modo ADVISORY (no bloqueante)', () => {
    for (const resultado of [
        { ejecutado: false, razon: 'x' },
        { ejecutado: true, sinCambios: true, razon: 'y' },
        { ejecutado: true, parseable: true, veredicto: { apto: true, score: 100, hallazgos_criticos: [] }, textoCompleto: '', archivosAuditados: [] },
    ]) {
        const out = formatearResumen(resultado);
        assert.match(out, /ADVISORY/);
        assert.match(out, /002_ARQUITECTO_DE_SOFTWARE/);
    }
});

// --- ADR-0004 (2026-10-08): ejecutarAuditor008CI con Claude primario y Gemini
// de respaldo, con mocks. Ninguna prueba toca la red: fetchImpl simula los
// listados de modelos y la generación de ambos proveedores. Keys ficticias.
const { ejecutarAuditor008CI, lineaModelo } = require('./auditor_008_advisory_gate.cjs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const KEY_CLAUDE = 'sk-ant-api03-PRUEBA_abcdefghijklmnopqrstuvwxyz0123456789';
const KEY_GEMINI = 'AIzaPRUEBA_abcdefghijklmnopqrstuvwxyz012345';
const DIFF_FALSO = {
    diff: 'diff --git a/src/x.js b/src/x.js\n+const TOKEN_SECRETO = "sk-live-abcdefghijklmnopqrstuvwxyz123456";\n',
    archivos: ['src/x.js'], truncado: false, omitidos: [],
};
const sinEspera = async () => {};
const diffFijo = () => DIFF_FALSO;
const VEREDICTO = 'TOP 15 ... SCORE 92/100 ... VEREDICTO\n{"apto": false, "score": 92, "hallazgos_criticos": ["falta idempotencia en X"]}';

function respuestaJSON(status, cuerpo) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return { ok: status >= 200 && status < 300, status, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'application/json' : 'req-008') }, text: async () => texto };
}

// plan: { claude: estado HTTP o 'ok', gemini: estado HTTP o 'ok' }
function redIA(plan = {}) {
    const llamadas = [];
    const fn = async (url, init) => {
        const u = String(url);
        llamadas.push({ url: u, init });
        if (u.startsWith('https://api.anthropic.com/v1/models')) {
            return respuestaJSON(200, { data: [{ id: 'claude-opus-5-5', created_at: '2026-09-01T00:00:00Z' }, { id: 'claude-sonnet-5-5', created_at: '2026-09-01T00:00:00Z' }], has_more: false });
        }
        if (u.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) {
            return respuestaJSON(200, { models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
        }
        if (u === 'https://api.anthropic.com/v1/messages') {
            const e = plan.claude ?? 'ok';
            if (e !== 'ok') return respuestaJSON(e, { type: 'error', error: { type: 'authentication_error', message: `clave ${KEY_CLAUDE} rechazada` } });
            return respuestaJSON(200, { type: 'message', content: [{ type: 'text', text: VEREDICTO }], stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 300 } });
        }
        const e = plan.gemini ?? 'ok';
        if (e !== 'ok') return respuestaJSON(e, { error: { code: e, status: 'UNAVAILABLE', message: 'x' } });
        return respuestaJSON(200, [{ candidates: [{ content: { parts: [{ text: VEREDICTO }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 250 } }]);
    };
    fn.llamadas = llamadas;
    return fn;
}
const generacion = (f) => f.llamadas.filter(l => /\/messages$|:streamGenerateContent/.test(l.url));

test('ADR-0004: sin ninguna key el paso se omite (exit 0); keys de proveedores externos no cuentan', async () => {
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { NVIDIA_API_KEY: 'nvapi-x', OPENROUTER_API_KEY: 'y' }, diffContraBase: diffFijo, fetchImpl: redIA() });
    assert.equal(r.ejecutado, false);
    assert.match(r.razon, /Sin ANTHROPIC_API_KEY ni GEMINI_API_KEY/);
});

test('ADR-0004: Claude responde primero (Opus más reciente) y el veredicto 008 se parsea', async () => {
    const f = redIA();
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { ANTHROPIC_API_KEY: KEY_CLAUDE, GEMINI_API_KEY: KEY_GEMINI }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    assert.equal(r.ejecutado, true);
    assert.equal(r.parseable, true);
    assert.deepEqual(r.veredicto, { apto: false, score: 92, hallazgos_criticos: ['falta idempotencia en X'] });
    assert.equal(`${r.meta.proveedor}:${r.meta.modelo}`, 'anthropic:claude-opus-5-5');
    assert.equal(r.meta.uso.prompt_tokens, 1200);
    assert.ok(r.meta.costo.cop > 0, 'costo en COP registrado');
    assert.equal(generacion(f).length, 1);
    assert.equal(generacion(f)[0].init.headers['x-api-key'], KEY_CLAUDE);
    assert.ok(!f.llamadas.some(l => l.url.includes('googleapis')), 'con Claude sano Gemini ni se lista');
});

test('ADR-0004: el diff sale filtrado — el secreto literal nunca llega al proveedor', async () => {
    const f = redIA();
    await ejecutarAuditor008CI('HEAD~1', 60000, { env: { ANTHROPIC_API_KEY: KEY_CLAUDE }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    const cuerpo = String(generacion(f)[0].init.body);
    assert.ok(!cuerpo.includes('sk-live-abcdefghijklmnopqrstuvwxyz123456'), 'secreto filtrado antes de salir');
    assert.match(cuerpo, /SECRETO_REDACTADO/);
});

test('ADR-0004: Claude con key revocada (401) → Gemini resuelve y la conmutación queda registrada', async () => {
    const f = redIA({ claude: 401 });
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { ANTHROPIC_API_KEY: KEY_CLAUDE, GEMINI_API_KEY: KEY_GEMINI }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    assert.equal(r.parseable, true);
    assert.equal(r.meta.proveedor, 'gemini');
    assert.match(r.meta.failover, /anthropic:claude-opus-5-5 -> gemini:gemini-2.5-pro/);
});

test('ADR-0004: ambos proveedores fallan → omitido con causa clasificada, sin filtrar ninguna key en el log de CI', async () => {
    const f = redIA({ claude: 401, gemini: 503 });
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { ANTHROPIC_API_KEY: KEY_CLAUDE, GEMINI_API_KEY: KEY_GEMINI }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    assert.equal(r.ejecutado, false);
    assert.match(r.razon, /Fallo de los proveedores de IA \[caida\//);
    assert.ok(!r.razon.includes(KEY_CLAUDE) && !r.razon.includes(KEY_GEMINI), 'ninguna key aparece en el log de CI');
});

test('lineaModelo + formatearResumen: reportan proveedor:modelo, conmutación y tokens (FinOps)', () => {
    const linea = lineaModelo({ proveedor: 'anthropic', modelo: 'claude-opus-5-5', failover: 'anthropic:a -> gemini:b', uso: { prompt_tokens: 10, completion_tokens: 5 }, costo: { cop: 12.5 }, archivosSensiblesOmitidos: [] });
    assert.match(linea, /\*\*Modelo\*\*: anthropic:claude-opus-5-5/);
    assert.match(linea, /conmutacion anthropic:a -> gemini:b/);
    assert.match(linea, /tokens 10 in \/ 5 out/);
    assert.match(linea, /costo COP 12.5/);
    const out = formatearResumen({ ejecutado: true, parseable: true, veredicto: { apto: true, score: 100, hallazgos_criticos: [] }, textoCompleto: '', archivosAuditados: [], meta: { proveedor: 'gemini', modelo: 'gemini-2.5-pro' } });
    assert.match(out, /\*\*Modelo\*\*: gemini:gemini-2.5-pro/);
});

test('main (proceso real): sin keys de Claude ni Gemini sale con exit 0 y lo informa — nunca bloquea el pipeline', () => {
    const env = { ...process.env };
    // Vacías (no borradas): dotenv no sobrescribe variables ya definidas, así
    // el .env local no se cuela en el proceso hijo.
    env.ANTHROPIC_API_KEY = ''; env.GEMINI_API_KEY = ''; env.GOOGLE_API_KEY = ''; delete env.GITHUB_STEP_SUMMARY;
    const salida = execFileSync(process.execPath, [path.join(__dirname, 'auditor_008_advisory_gate.cjs'), '--base', 'HEAD'], { env, encoding: 'utf8' });
    assert.match(salida, /Sin ANTHROPIC_API_KEY ni GEMINI_API_KEY/);
});
