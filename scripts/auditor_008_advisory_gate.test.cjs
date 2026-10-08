// auditor_008_advisory_gate.test.cjs -- cobertura de las funciones puras del
// paso advisory de 008_AUDITOR_DE_CODIGO en CI (2026-08-13). Corre con:
// node --test scripts/auditor_008_advisory_gate.test.cjs
// No ejecuta ninguna llamada real a ningún proveedor (ejecutarAuditor008CI
// se prueba con fetch simulado de NVIDIA NIM, abajo; mismo criterio que check_veto_008.test.cjs
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

// --- Pivote a NVIDIA NIM (2026-10-08): ejecutarAuditor008CI con mocks -------
// Ninguna prueba toca la red: fetchImpl simula la API compatible con OpenAI
// de integrate.api.nvidia.com/v1. La key es ficticia (formato nvapi-).
const { ejecutarAuditor008CI, entornoNim, lineaModelo } = require('./auditor_008_advisory_gate.cjs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const KEY_FALSA = 'nvapi-PRUEBA_abcdefghijklmnopqrstuvwxyz0123456789';
const DIFF_FALSO = {
    diff: 'diff --git a/src/x.js b/src/x.js\n+const TOKEN_SECRETO = "sk-live-abcdefghijklmnopqrstuvwxyz123456";\n',
    archivos: ['src/x.js'], truncado: false, omitidos: [],
};
const sinEspera = async () => {};
const diffFijo = () => DIFF_FALSO;

function respuestaNim(status, cuerpo) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, text: async () => texto };
}
const cuerpoOk = (contenido) => ({ choices: [{ message: { content: contenido }, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 300 } });
function fetchMock(respuestas) {
    const llamadas = [];
    const fn = async (url, init) => {
        llamadas.push({ url, init });
        const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
        if (r instanceof Error) throw r;
        return r;
    };
    fn.llamadas = llamadas;
    return fn;
}
const VEREDICTO_OK = 'TOP 15 ... SCORE 92/100 ... VEREDICTO APTO\n{"apto": false, "score": 92, "hallazgos_criticos": ["falta idempotencia en X"]}';

test('NIM: sin NVIDIA_API_KEY el paso se omite (exit 0 garantizado), aunque exista ANTHROPIC_API_KEY', async () => {
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { ANTHROPIC_API_KEY: 'sk-ant-x' }, diffContraBase: diffFijo, fetchImpl: fetchMock([]) });
    assert.equal(r.ejecutado, false);
    assert.match(r.razon, /NVIDIA_API_KEY no configurada/);
});

test('NIM: llama a integrate.api.nvidia.com/v1 con Bearer, sin Anthropic, y parsea el veredicto 008', async () => {
    const f = fetchMock([respuestaNim(200, cuerpoOk(VEREDICTO_OK))]);
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { NVIDIA_API_KEY: KEY_FALSA }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    assert.equal(r.ejecutado, true);
    assert.equal(r.parseable, true);
    assert.deepEqual(r.veredicto, { apto: false, score: 92, hallazgos_criticos: ['falta idempotencia en X'] });
    assert.equal(f.llamadas.length, 1);
    assert.match(f.llamadas[0].url, /^https:\/\/integrate\.api\.nvidia\.com\/v1\/chat\/completions$/);
    assert.equal(f.llamadas[0].init.headers.Authorization || f.llamadas[0].init.headers.authorization, `Bearer ${KEY_FALSA}`);
    assert.ok(r.meta.modelo, 'registra el modelo que respondió');
    assert.equal(r.meta.uso.prompt_tokens, 1200);
});

test('NIM: el diff sale filtrado — el secreto literal nunca llega al proveedor', async () => {
    const f = fetchMock([respuestaNim(200, cuerpoOk(VEREDICTO_OK))]);
    await ejecutarAuditor008CI('HEAD~1', 60000, { env: { NVIDIA_API_KEY: KEY_FALSA }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    const cuerpo = String(f.llamadas[0].init.body);
    assert.ok(!cuerpo.includes('sk-live-abcdefghijklmnopqrstuvwxyz123456'), 'secreto filtrado antes de salir');
    assert.match(cuerpo, /SECRETO_REDACTADO/);
});

test('NIM: modelo primario caído (503) → conmuta al siguiente de la cadena gratuita y lo registra', async () => {
    const f = fetchMock([respuestaNim(503, 'overloaded'), respuestaNim(200, cuerpoOk(VEREDICTO_OK))]);
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { NVIDIA_API_KEY: KEY_FALSA }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    assert.equal(r.parseable, true);
    assert.ok(r.meta.failover, 'deja constancia de la conmutación');
    assert.ok(f.llamadas.every(l => l.url.startsWith('https://integrate.api.nvidia.com/v1')), 'toda la cadena es NIM');
});

test('NIM: key revocada (401) → omitido con causa clasificada, sin filtrar la key en el mensaje', async () => {
    const f = fetchMock([respuestaNim(401, { error: { message: `invalid key ${KEY_FALSA}` } })]);
    const r = await ejecutarAuditor008CI('HEAD~1', 60000, { env: { NVIDIA_API_KEY: KEY_FALSA }, diffContraBase: diffFijo, fetchImpl: f, sleep: sinEspera });
    assert.equal(r.ejecutado, false);
    assert.match(r.razon, /NVIDIA NIM \[auth\//);
    assert.ok(!r.razon.includes(KEY_FALSA), 'la key nunca aparece en el log de CI');
});

test('entornoNim: fuerza GATE_PROVIDER=nim y descarta cadena/keys de Anthropic heredadas', () => {
    const e = entornoNim({ GATE_PROVIDER: 'anthropic', GATE_FALLBACK_CHAIN: 'anthropic', ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: 'y', NVIDIA_API_KEY: KEY_FALSA });
    assert.equal(e.GATE_PROVIDER, 'nim');
    assert.equal(e.GATE_FALLBACK_CHAIN, undefined);
    assert.equal(e.ANTHROPIC_API_KEY, undefined);
    assert.equal(e.NVIDIA_API_KEY, KEY_FALSA);
});

test('lineaModelo + formatearResumen: reportan modelo NIM, conmutación y tokens (FinOps)', () => {
    const linea = lineaModelo({ modelo: 'nvidia/nemotron-3-ultra-550b-a55b', failover: 'nim:a -> nim:b', uso: { prompt_tokens: 10, completion_tokens: 5 }, costo: { cop: 0 }, archivosSensiblesOmitidos: [] });
    assert.match(linea, /nim:nvidia\/nemotron-3-ultra-550b-a55b/);
    assert.match(linea, /conmutacion nim:a -> nim:b/);
    assert.match(linea, /tokens 10 in \/ 5 out/);
    const out = formatearResumen({ ejecutado: true, parseable: true, veredicto: { apto: true, score: 100, hallazgos_criticos: [] }, textoCompleto: '', archivosAuditados: [], meta: { modelo: 'm/x' } });
    assert.match(out, /\*\*Modelo\*\*: nim:m\/x/);
});

test('main (proceso real): sin NVIDIA_API_KEY sale con exit 0 y lo informa — nunca bloquea el pipeline', () => {
    const env = { ...process.env };
    // Vacías (no borradas): dotenv no sobrescribe variables ya definidas, así
    // el .env local no se cuela en el proceso hijo.
    env.NVIDIA_API_KEY = ''; env.ANTHROPIC_API_KEY = ''; delete env.GITHUB_STEP_SUMMARY;
    const salida = execFileSync(process.execPath, [path.join(__dirname, 'auditor_008_advisory_gate.cjs'), '--base', 'HEAD'], { env, encoding: 'utf8' });
    assert.match(salida, /NVIDIA_API_KEY no configurada/);
});
