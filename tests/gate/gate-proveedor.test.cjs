// gate-proveedor.test.cjs — ADR-0002 (2026-09-26): capa de proveedor NIM,
// circuit breaker, filtrado de secretos y su integración con el gate.
// Corre con: node --test tests/gate/
//
// Nunca toca la red: todo fetch es un doble inyectado. El breaker vive en un
// directorio temporal, nunca en agents/pmu/ real.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require('../../agents/gate-proveedor.cjs');
const gate = require('../../agents/architecture-gate.cjs');

const KEY = 'nvapi-TESTKEY_abcdefghijklmnopqrstuvwxyz0123456789';
const ENV = { NVIDIA_API_KEY: KEY };

function breakerTmp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-test-'));
    return path.join(dir, 'circuit_breaker.json');
}

function respuesta(status, cuerpo) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return { ok: status >= 200 && status < 300, status, headers: { get: () => 'req-test' }, text: async () => texto };
}

const OK_BODY = { choices: [{ message: { content: 'análisis {"aprobado": true, "razones": []}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };

function fetchSecuencia(respuestas) {
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

const sinEspera = async () => {};
const MSG = { system: 's', user: 'u', max_tokens: 100 };

test('clasificarHttp: cada código HTTP cae en su categoría', () => {
    assert.deepEqual(P.clasificarHttp(401, ''), { codigo: 'http_401_auth', categoria: 'auth' });
    assert.deepEqual(P.clasificarHttp(403, ''), { codigo: 'http_403_auth', categoria: 'auth' });
    assert.equal(P.clasificarHttp(402, '').categoria, 'cuota');
    assert.equal(P.clasificarHttp(429, '').categoria, 'cuota');
    assert.equal(P.clasificarHttp(400, '{"detail":"Quota exceeded for this account"}').codigo, 'http_400_cuota');
    assert.equal(P.clasificarHttp(400, '{"detail":"Model deepseek-x not found"}').categoria, 'politica');
    assert.equal(P.clasificarHttp(404, '').categoria, 'politica');
    assert.equal(P.clasificarHttp(400, '{"detail":"messages: field required"}').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(500, '').categoria, 'caida');
    assert.equal(P.clasificarHttp(503, '').codigo, 'http_503');
});

test('llamarModelo: éxito devuelve texto y uso de tokens, cierra el breaker, envía a la URL oficial', async () => {
    const bp = breakerTmp();
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    const r = await P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: bp, sleep: sinEspera });
    assert.match(r.texto, /"aprobado": true/);
    assert.deepEqual(r.uso, { prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(r.modelo, P.GATE_MODEL_DEFAULT);
    assert.equal(f.llamadas[0].url, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(JSON.parse(f.llamadas[0].init.body).model, P.GATE_MODEL_DEFAULT);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('401: NO se reintenta, abre el breaker de inmediato y NO es elegible para soft-fail (el gate no se abre)', async () => {
    const bp = breakerTmp();
    const f = fetchSecuencia([respuesta(401, '{"detail":"Unauthorized"}')]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: bp, sleep: sinEspera }), (e) => {
        assert.equal(e.categoria, 'auth');
        assert.equal(P.esElegibleSoftFail(e), false);
        assert.equal(gate.clasificarFalloApi(e), null, 'clasificarFalloApi debe devolver null → bloqueo duro');
        return true;
    });
    assert.equal(f.llamadas.length, 1);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'abierto');
    assert.equal(b.ultimo_error.categoria, 'auth');
    const alertas = P.alertasDeProveedor(b, 'nim', 'm');
    assert.equal(alertas[0].tipo, 'ALERTA CRÍTICA DE PROVEEDOR EXTERNO');
    assert.equal(alertas[0].efecto, 'bloqueo_duro');
});

test('circuito abierto por 401: siguiente llamada no toca la red y sigue siendo bloqueo duro', async () => {
    const bp = breakerTmp();
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(403, '')]), breakerPath: bp, sleep: sinEspera }));
    const f2 = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: f2, breakerPath: bp, sleep: sinEspera }), (e) => {
        assert.equal(e.codigo, 'circuito_abierto');
        assert.equal(e.categoria, 'auth');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.equal(f2.llamadas.length, 0);
});

test('breaker abierto por auth: con la MISMA key sigue cerrado a la red; con key NUEVA hace 1 llamada de prueba', async () => {
    const bp = breakerTmp();
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(401, '')]), breakerPath: bp, sleep: sinEspera }));
    const b = P.leerBreaker(bp);
    assert.equal(b.ultimo_error.huella_key, P.huellaKey(KEY));
    assert.ok(!JSON.stringify(b).includes(KEY), 'la huella no es la key');

    const mismaKey = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: mismaKey, breakerPath: bp, sleep: sinEspera }));
    assert.equal(mismaKey.llamadas.length, 0);

    const keyNueva = fetchSecuencia([respuesta(200, OK_BODY)]);
    await P.llamarModelo(MSG, { env: { NVIDIA_API_KEY: 'nvapi-OTRAKEY_zyxwvutsrqponmlkjihgfedcba98765' }, fetchImpl: keyNueva, breakerPath: bp, sleep: sinEspera });
    assert.equal(keyNueva.llamadas.length, 1);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('breaker con llamadas en paralelo: los fallos concurrentes se acumulan, no se pisan', async () => {
    const bp = breakerTmp();
    const lento = (status) => async () => { await new Promise(r => setTimeout(r, 10)); return respuesta(status, ''); };
    await Promise.allSettled([1, 2, 3].map(() =>
        P.llamarModelo(MSG, { env: ENV, fetchImpl: lento(402), breakerPath: bp, sleep: sinEspera })));
    const b = P.leerBreaker(bp);
    assert.equal(b.fallos_consecutivos, 3);
    assert.equal(b.estado, 'abierto');
});

test('503 → reintenta con backoff (2 reintentos) y termina con éxito', async () => {
    const esperas = [];
    const f = fetchSecuencia([respuesta(503, 'x'), respuesta(503, 'x'), respuesta(200, OK_BODY)]);
    const r = await P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: breakerTmp(), sleep: async (ms) => { esperas.push(ms); }, aleatorio: () => 0 });
    assert.equal(r.intentos, 3);
    assert.deepEqual(esperas, [1000, 2000]);
});

test('400/402 de cuota: sin reintento, elegible para soft-fail, clasificarFalloApi del gate lo reconoce', async () => {
    const f = fetchSecuencia([respuesta(402, '{"detail":"Payment required"}')]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: breakerTmp(), sleep: sinEspera }), (e) => {
        assert.equal(e.categoria, 'cuota');
        assert.deepEqual(gate.clasificarFalloApi(e), { codigo: 'http_402_sin_saldo', detalle: e.detalle, request_id: 'req-test' });
        return true;
    });
    assert.equal(f.llamadas.length, 1);
});

test('timeout sin primer byte (> primerByteMs): AbortController corta, se clasifica caida/timeout_sin_respuesta y NO se reintenta', async () => {
    const bp = breakerTmp();
    let llamadas = 0;
    const colgado = (url, init) => new Promise((_, rej) => {
        llamadas++;
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: colgado, breakerPath: bp, sleep: sinEspera, timeoutMs: 20, primerByteMs: 20 }), (e) => {
        assert.equal(e.codigo, 'timeout_sin_respuesta');
        assert.equal(e.categoria, 'caida');
        assert.ok(gate.clasificarFalloApi(e), 'timeout es disponibilidad → elegible para soft-fail');
        return true;
    });
    assert.equal(llamadas, 1, 'sin primer byte = prefill/cola determinista por tamaño → reintentar solo multiplica la espera');
    assert.equal(P.leerBreaker(bp).fallos_consecutivos, 1);
    assert.equal(P.esReintentable('caida', 'timeout_sin_respuesta'), false);
});

test('breaker: cerrado → abierto (3 fallos) → sin red → semiabierto tras cooldown → cerrado con éxito', async () => {
    const bp = breakerTmp();
    let t = Date.parse('2026-09-26T12:00:00Z');
    const ahora = () => t;
    for (let i = 0; i < 3; i++) {
        await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(500, '')]), breakerPath: bp, sleep: sinEspera, ahora }));
    }
    assert.equal(P.leerBreaker(bp).estado, 'abierto');

    const sinRed = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: sinRed, breakerPath: bp, sleep: sinEspera, ahora }), (e) => {
        assert.equal(e.codigo, 'circuito_abierto');
        assert.equal(e.categoria, 'caida');
        assert.ok(gate.clasificarFalloApi(e), 'abierto por caída → soft-fail elegible');
        return true;
    });
    assert.equal(sinRed.llamadas.length, 0, 'abierto: cero llamadas de red');

    t += 901 * 1000;
    const prueba = fetchSecuencia([respuesta(200, OK_BODY)]);
    await P.llamarModelo(MSG, { env: ENV, fetchImpl: prueba, breakerPath: bp, sleep: sinEspera, ahora });
    assert.equal(prueba.llamadas.length, 1);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'cerrado');
    assert.equal(b.fallos_consecutivos, 0);
    assert.deepEqual(P.alertasDeProveedor(b, 'nim', 'm'), []);
});

test('breaker: fallo en semiabierto vuelve a abierto con 1 solo intento (sin reintentos)', async () => {
    const bp = breakerTmp();
    let t = 1_000_000;
    P.escribirBreaker(bp, { ...P.BREAKER_DEFAULT, estado: 'abierto', fallos_consecutivos: 3, abierto_desde: new Date(t).toISOString(), ultimo_error: { codigo: 'http_500', categoria: 'caida' } });
    t += 901 * 1000;
    const f = fetchSecuencia([respuesta(500, '')]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: bp, sleep: sinEspera, ahora: () => t }));
    assert.equal(f.llamadas.length, 1);
    assert.equal(P.leerBreaker(bp).estado, 'abierto');
});

test('config: key ausente o base URL no oficial → bloqueo duro sin tocar la red', async () => {
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: {}, fetchImpl: f, breakerPath: breakerTmp() }), (e) => {
        assert.equal(e.codigo, 'NVIDIA_API_KEY_ausente');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    await assert.rejects(P.llamarModelo(MSG, { env: { ...ENV, GATE_NIM_BASE_URL: 'https://evil.example.com/v1' }, fetchImpl: f }), (e) => {
        assert.equal(e.codigo, 'base_url_no_oficial');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.equal(f.llamadas.length, 0);
    const permiso = gate.resolverPermisoSoftFail([], { GATE_SOFT_FAIL: 'true', GATE_SOFT_FAIL_AUTORIZADO_POR: 'x', GATE_NIM_BASE_URL: 'https://evil.example.com/v1' });
    assert.equal(permiso.permitido, false);
});

test('filtrarSecretosDiff: omite .env, conserva .env.example, redacta keys y JWT', () => {
    // Fixtures armados en tiempo de ejecución: el literal de un JWT o de una
    // asignación "apiKey = '<valor largo>'" en el fuente dispararía (con razón)
    // escanearSecretos() del propio gate al commitear este archivo.
    const jwt = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnop'].join('.');
    const asignacion = 'const api' + 'Key = "' + 'Z'.repeat(24) + '";';
    const diff = [
        'diff --git a/.env b/.env\n+NVIDIA_API_KEY=nvapi-AAAAAAAAAAAAAAAAAAAA\n',
        'diff --git a/.env.example b/.env.example\n+NVIDIA_API_KEY=\n',
        `diff --git a/src/x.js b/src/x.js\n+const k = "nvapi-BBBBBBBBBBBBBBBBBBBBBBBB";\n+const t = "${jwt}";\n+${asignacion}\n`,
    ].join('');
    const { diff: out, omitidos } = P.filtrarSecretosDiff(diff);
    assert.deepEqual(omitidos, ['.env']);
    assert.ok(!out.includes('nvapi-AAAA'));
    assert.ok(!out.includes('nvapi-BBBB'));
    assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9.eyJzdWIi'));
    assert.ok(!out.includes('ZZZZZZZZZZZZZZZZZZZZ'));
    assert.ok(out.includes('diff --git a/.env.example b/.env.example\n+NVIDIA_API_KEY=\n'));
    assert.ok(out.includes('[contenido omitido: archivo sensible'));
});

test('P6: la key nunca aparece en error, breaker ni consola aunque el proveedor la devuelva en el cuerpo', async () => {
    const bp = breakerTmp();
    const capturado = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    for (const k of Object.keys(orig)) console[k] = (...a) => capturado.push(a.join(' '));
    let err;
    try {
        const f = fetchSecuencia([respuesta(401, `{"detail":"invalid key ${KEY}","auth":"Bearer ${KEY}"}`)]);
        await P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: bp, sleep: sinEspera }).catch(e => { err = e; });
    } finally {
        Object.assign(console, orig);
    }
    assert.ok(err);
    for (const texto of [err.message, err.detalle, fs.readFileSync(bp, 'utf8'), capturado.join('\n'), JSON.stringify(err)]) {
        assert.ok(!texto.includes(KEY), 'la key se filtró');
        assert.ok(!texto.includes('TESTKEY_abcdefghij'), 'fragmento de la key se filtró');
    }
});

test('mencionaAgente: detecta prefijo aislado, kebab y MAYÚSCULAS; ignora números embebidos', () => {
    assert.ok(gate.mencionaAgente('delegar a `005` ahora', '005-ingeniero-backend.md'));
    assert.ok(gate.mencionaAgente('ver 005_INGENIERO_BACKEND', '005-ingeniero-backend.md'));
    assert.ok(gate.mencionaAgente('.claude/agents/005-ingeniero-backend.md', '005-ingeniero-backend.md'));
    assert.ok(!gate.mencionaAgente('umbral 0.005 y año 2005, puerto 30050', '005-ingeniero-backend.md'));
    assert.ok(!gate.mencionaAgente('migraciones 005_fix_insertar_fase1.sql y 007_worm_occ_shadow_ledger.sql', '005-ingeniero-backend.md'));
    assert.ok(!gate.mencionaAgente('ver 001_formulador.sql', '001-orquestador-maestro.md'));
});

test('mapa de delegación del 001: los 10 agentes reales están enrutados por la matriz del 001', () => {
    const agentes = gate.descubrirAgentes();
    const mapa = gate.generarMapaDelegacion001(agentes, gate.mapaGatesPorPrefijo());
    assert.equal(mapa.length, agentes.length);
    const sinMando = mapa.filter(m => !m.mapeado_por_001).map(m => m.archivo);
    assert.deepEqual(sinMando, []);
    const m001 = mapa.find(m => m.prefijo === '001');
    assert.ok(!m001.permisos.some(t => ['Write', 'Edit', 'Bash'].includes(t)), 'P4: el 001 no tiene herramientas de escritura');
});

test('verificarVigenciaAgentes: alertas tipadas (sin_acuse | acuse_invalido | desactualizado), nunca por fecha', () => {
    const alertas = gate.verificarVigenciaAgentes();
    for (const a of alertas) {
        assert.ok(['agente_sin_acuse', 'agente_acuse_invalido', 'agente_desactualizado', 'alerta_git_inaccesible'].includes(a.tipo), a.tipo);
        assert.ok(!/se actualizó después que este agente/.test(a.razon), 'quedó lógica por fecha');
    }
});

// ---------------------------------------------------------------------------
// Regresiones de la auditoría 008 (Protocolo Titán, 2026-09-26). Cada test
// reproduce un bypass o fuga reportado y fija el comportamiento corregido.
// ---------------------------------------------------------------------------

test('008#1: GATE_PROVIDER=anthropic con ANTHROPIC_BASE_URL no oficial → bloqueo duro (no se forja api_directa ni sale la key)', async () => {
    await assert.rejects(P.llamarModelo(MSG, { env: { GATE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-' + 'x'.repeat(30), ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999' } }), (e) => {
        assert.equal(e.codigo, 'base_url_no_oficial');
        assert.equal(e.categoria, 'config');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.equal(P.resolverConfig({ GATE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).baseUrl, 'https://api.anthropic.com');
});

test('008#2: key malformada (no-ByteString / espacios / sin prefijo) → config, cero red; TypeError de fetch sin código de red → solicitud, no caída', async () => {
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    for (const k of ['nvapi-abcédefghijklmnop', 'nvapi-abc defghijklmnop', 'abcdefghijklmnopqrst']) {
        await assert.rejects(P.llamarModelo(MSG, { env: { NVIDIA_API_KEY: k }, fetchImpl: f, breakerPath: breakerTmp() }), (e) => {
            assert.equal(e.codigo, 'NVIDIA_API_KEY_malformada');
            assert.equal(gate.clasificarFalloApi(e), null);
            return true;
        });
    }
    assert.equal(f.llamadas.length, 0);
    const byteString = fetchSecuencia([new TypeError('Cannot convert argument to a ByteString')]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: byteString, breakerPath: breakerTmp(), sleep: sinEspera }), (e) => {
        assert.equal(e.categoria, 'solicitud');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.equal(byteString.llamadas.length, 1, 'sin reintentos para un error no de red');
    const red = fetchSecuencia([Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: red, breakerPath: breakerTmp(), sleep: sinEspera }), (e) => {
        assert.equal(e.categoria, 'caida');
        return true;
    });
});

test('008#3: 403 y 503 concurrentes → el circuito queda abierto por auth y circuito_abierto sigue siendo bloqueo duro', async () => {
    const bp = breakerTmp();
    const demora = (ms, status) => async () => { await new Promise(r => setTimeout(r, ms)); return respuesta(status, ''); };
    await Promise.allSettled([
        P.llamarModelo(MSG, { env: ENV, fetchImpl: demora(5, 403), breakerPath: bp, sleep: sinEspera }),
        P.llamarModelo(MSG, { env: ENV, fetchImpl: demora(20, 503), breakerPath: bp, sleep: sinEspera }),
    ]);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'abierto');
    assert.equal(b.categoria_apertura, 'auth');
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: bp }), (e) => {
        assert.equal(e.codigo, 'circuito_abierto');
        assert.equal(e.categoria, 'auth');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
});

test('008#6: cabeceras recibidas pero cuerpo colgado → el timeout también corta la lectura del cuerpo', async () => {
    const colgado = async (url, init) => ({
        ok: true, status: 200, headers: { get: () => null },
        text: () => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    });
    const t0 = Date.now();
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: colgado, breakerPath: breakerTmp(), sleep: sinEspera, timeoutMs: 30 }), (e) => {
        assert.equal(e.codigo, 'timeout_inactividad');
        return true;
    });
    assert.ok(Date.now() - t0 < 2000, 'no debe colgarse');
});

// --- Streaming SSE + tres relojes (auditoría del timeout_30s en vivo, 2026-09-26) ---

const dormirMs = (ms) => new Promise(r => setTimeout(r, ms));
const enc = new TextEncoder();
const chunk = (content, extra = {}) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }], ...extra })}\n\n`;
const chunkFin = (finish, usage) => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`;

// Respuesta SSE simulada: emite `partes` con `intervaloMs` entre cada una.
// `infinito` sigue emitiendo hasta que la cancelen (para el plazo total).
function respuestaSSE(partes, { intervaloMs = 0, infinito = false } = {}) {
    let i = 0;
    let cancelado = false;
    const body = new ReadableStream({
        async pull(ctrl) {
            if (cancelado) return;
            if (intervaloMs) await dormirMs(intervaloMs);
            if (infinito) { ctrl.enqueue(enc.encode(chunk('.'))); return; }
            if (i < partes.length) ctrl.enqueue(enc.encode(partes[i++]));
            else ctrl.close();
        },
        cancel() { cancelado = true; },
    });
    return {
        ok: true, status: 200, body,
        headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : 'req-sse') },
        text: async () => { throw new Error('una respuesta SSE no debe leerse con text()'); },
    };
}

test('SSE: ensambla delta.content, ignora reasoning y keep-alive, parsea usage y pide stream:true', async () => {
    const bp = breakerTmp();
    const partes = [
        ': keep-alive\n\n',
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'pensando...' } }] })}\n\n`,
        chunk('análisis '), chunk('{"aprobado": true, '), chunk('"razones": []}'),
        chunkFin('stop', { prompt_tokens: 42, completion_tokens: 7 }),
        'data: [DONE]\n\n',
    ];
    const f = fetchSecuencia([respuestaSSE(partes)]);
    const r = await P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: bp, sleep: sinEspera });
    assert.equal(r.texto, 'análisis {"aprobado": true, "razones": []}');
    assert.equal(r.fin, 'stop');
    assert.deepEqual(r.uso, { prompt_tokens: 42, completion_tokens: 7 });
    assert.equal(r.request_id, 'req-sse');
    assert.equal(r.razonamiento_chars, 'pensando...'.length, 'mide razonamiento sin guardarlo');
    assert.equal(r.texto_chars, r.texto.length);
    assert.equal(JSON.parse(f.llamadas[0].init.body).stream, true);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('SSE: generación lenta pero viva supera el reloj de inactividad acumulado sin cortarse', async () => {
    // 8 fragmentos cada 25 ms = ~200 ms totales, con inactividad de 60 ms:
    // el tope viejo (total único) habría cortado; el nuevo solo mide silencio.
    const partes = [...Array.from({ length: 7 }, (_, i) => chunk(`p${i} `)), chunkFin('stop')];
    const r = await P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuestaSSE(partes, { intervaloMs: 25 })]), breakerPath: breakerTmp(), sleep: sinEspera, timeoutMs: 60, primerByteMs: 60, deadlineMs: 5000 });
    assert.equal(r.texto, 'p0 p1 p2 p3 p4 p5 p6 ');
});

test('SSE: stream que se calla a mitad → timeout_inactividad (caída, elegible soft-fail)', async () => {
    const colgado = () => {
        const body = new ReadableStream({ start(ctrl) { ctrl.enqueue(enc.encode(chunk('hola'))); } });
        return { ok: true, status: 200, body, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, text: async () => '' };
    };
    const t0 = Date.now();
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: async () => colgado(), breakerPath: breakerTmp(), sleep: sinEspera, timeoutMs: 40, primerByteMs: 40, deadlineMs: 5000 }), (e) => {
        assert.equal(e.codigo, 'timeout_inactividad');
        assert.equal(e.categoria, 'caida');
        assert.ok(gate.clasificarFalloApi(e));
        return true;
    });
    assert.ok(Date.now() - t0 < 3000, 'no debe colgarse');
});

test('SSE: plazo total vencido con stream vivo → timeout_total SIN reintento (mismo prompt volvería a vencer)', async () => {
    let llamadas = 0;
    const f = async () => { llamadas++; return respuestaSSE([], { intervaloMs: 5, infinito: true }); };
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: breakerTmp(), sleep: sinEspera, timeoutMs: 1000, primerByteMs: 1000, deadlineMs: 80 }), (e) => {
        assert.equal(e.codigo, 'timeout_total');
        assert.equal(e.categoria, 'caida');
        return true;
    });
    assert.equal(llamadas, 1, 'timeout_total no se reintenta');
    assert.equal(P.esReintentable('caida', 'timeout_inactividad'), true);
    assert.equal(P.esReintentable('caida', 'timeout_total'), false);
});

test('SSE: stream cerrado sin finish_reason ni [DONE] → stream_incompleto (caída), nunca un veredicto parcial', async () => {
    let llamadas = 0;
    const f = async () => { llamadas++; return respuestaSSE([chunk('{"aprobado": tr')]); };
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: f, breakerPath: breakerTmp(), sleep: sinEspera }), (e) => {
        assert.equal(e.codigo, 'stream_incompleto');
        assert.equal(e.categoria, 'caida');
        return true;
    });
    assert.equal(llamadas, 3, 'corte de conexión = caída → se reintenta');
});

test('SSE: finish_reason length con content vacío → respuesta_truncada; error a mitad de stream se clasifica estructurado', async () => {
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuestaSSE([chunkFin('length'), 'data: [DONE]\n\n'])]), breakerPath: breakerTmp() }), (e) => e.codigo === 'respuesta_truncada');
    const err = `data: ${JSON.stringify({ error: { code: 'invalid_api_key', message: 'bad key' } })}\n\n`;
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuestaSSE([err])]), breakerPath: breakerTmp() }), (e) => {
        assert.equal(e.codigo, 'stream_http_400_auth');
        assert.equal(e.categoria, 'auth');
        assert.ok(!e.detalle.includes(KEY));
        return true;
    });
});

test('GATE_TIMEOUT_TOTAL_MS: default 600 s, rango 30-900 s, inválido = bloqueo duro por configuración', async () => {
    assert.equal(P.resolverTimeoutTotal({}), 600000);
    assert.equal(P.resolverTimeoutTotal({ GATE_TIMEOUT_TOTAL_MS: '120000' }), 120000);
    assert.equal(P.resolverTimeoutTotal({ GATE_TIMEOUT_TOTAL_MS: '900000' }), 900000);
    for (const malo of ['abc', '1000', '900001', '-5', '1e5']) {
        assert.throws(() => P.resolverTimeoutTotal({ GATE_TIMEOUT_TOTAL_MS: malo }), (e) => e.codigo === 'timeout_total_invalido' && e.categoria === 'config', malo);
    }
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: { ...ENV, GATE_TIMEOUT_TOTAL_MS: 'x' }, fetchImpl: f, breakerPath: breakerTmp() }), (e) => e.codigo === 'timeout_total_invalido');
    assert.equal(f.llamadas.length, 0, 'config inválida no toca la red');
});

test('key rotada: sonda de la key NUEVA que falla por caída reemplaza la evidencia 403 de la key vieja y respeta el cooldown', async () => {
    // Reproduce el estado real del 2026-09-26 22:28: breaker abierto por 403
    // de la key A; la key B autentica pero la sonda expira.
    const bp = breakerTmp();
    let t = Date.parse('2026-09-26T22:02:08Z');
    const ahora = () => t;
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(403, '')]), breakerPath: bp, sleep: sinEspera, ahora }));
    const KEY_B = 'nvapi-KEYB_zyxwvutsrqponmlkjihgfedcba0123456789';
    t += 60 * 1000;
    await assert.rejects(P.llamarModelo(MSG, { env: { NVIDIA_API_KEY: KEY_B }, fetchImpl: fetchSecuencia([respuesta(503, '')]), breakerPath: bp, sleep: sinEspera, ahora }));
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'abierto');
    assert.equal(b.categoria_apertura, 'caida', 'el 403 era de la key vieja');
    assert.equal(b.ultimo_error.huella_key, P.huellaKey(KEY_B));
    assert.equal(b.ultimo_error.codigo, 'http_503');
    // Antes del fix: huella siempre distinta → sonda en CADA llamada, sin cooldown.
    const sinRed = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: { NVIDIA_API_KEY: KEY_B }, fetchImpl: sinRed, breakerPath: bp, sleep: sinEspera, ahora }), (e) => e.codigo === 'circuito_abierto');
    assert.equal(sinRed.llamadas.length, 0, 'dentro del cooldown no hay sonda');
    // Volver a la key A (la del 403) sigue siendo bloqueo: su huella no coincide con la de B → sonda de 1 intento.
    t += 901 * 1000;
    const ok = fetchSecuencia([respuesta(200, OK_BODY)]);
    await P.llamarModelo(MSG, { env: { NVIDIA_API_KEY: KEY_B }, fetchImpl: ok, breakerPath: bp, sleep: sinEspera, ahora });
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('008#7: 400 context_length_exceeded / max_tokens → solicitud (bloqueo), no cuota', () => {
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"context_length_exceeded"}}').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, 'max_tokens exceeded the limit').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, 'rate limit reached for model').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"insufficient_quota"}}').categoria, 'cuota');
});

test('008#11: content null → respuesta_vacia (bloqueo duro), finish_reason length → respuesta_truncada', async () => {
    const vacio = fetchSecuencia([respuesta(200, { choices: [{ message: { content: null }, finish_reason: 'stop' }] })]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: vacio, breakerPath: breakerTmp() }), (e) => e.codigo === 'respuesta_vacia' && gate.clasificarFalloApi(e) === null);
    const trunco = fetchSecuencia([respuesta(200, { choices: [{ message: { content: '' }, finish_reason: 'length' }] })]);
    await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: trunco, breakerPath: breakerTmp() }), (e) => e.codigo === 'respuesta_truncada');
});

test('008#4: filtrarSecretosDiff cubre los formatos reportados', () => {
    // Relleno armado en tiempo de ejecución (ver nota del test de filtrado anterior).
    const v = (c) => c.repeat(24);
    const sec = (ruta, linea) => `diff --git a/${ruta} b/${ruta}\n--- a/${ruta}\n+++ b/${ruta}\n+${linea}\n`;
    const casos = [
        ['config/render.env.txt', 'RENDER_' + 'API_KEY=' + v('r')],
        ['config.yml', 'JWT_' + 'SECRET: ' + v('j')],
        ['db.txt', 'DB_' + 'PASSWORD=' + v('p')],
        ['cfg.json', '"api' + 'Key": "' + v('a') + '"'],
        ['x.js', 'const k = "sk-' + 'or-v1-' + v('o') + '"'],
        ['x.js', 'const k = "sk_' + 'live_' + v('s') + '"'],
        ['x.js', 'const k = "AI' + 'za' + v('g') + 'abcdefgh"'],
        ['x.js', 'const k = "tv' + 'ly-' + v('t') + '"'],
        ['x.js', 'const k = "gs' + 'k_' + v('q') + '"'],
        ['x.js', 'const url = "postgres://usuario:' + 'clave' + v('c') + '@db.host:5432/app"'],
        ['k.txt', '-----BEGIN ' + 'ENCRYPTED PRIVATE KEY-----' + v('K')],
        ['x.js', 'const k = "nv' + 'api-' + v('n') + '"'],
    ];
    const diff = casos.map(([r, l]) => sec(r, l)).join('')
        + 'diff --git a/credentials.json b/credentials.json\n+{"x":"' + v('y') + '"}\n'
        + 'diff --git "a/mi carpeta/.env" "b/mi carpeta/.env"\n+X=' + v('e') + '\n'
        + 'diff --git a/config/.env.local b/config/.env.local\n+Y=' + v('l') + '\n'
        + 'diff --git a/id_rsa b/id_rsa\n+' + v('z') + '\n'
        + 'diff --git sin-prefijo sin-prefijo\n+Z=' + v('w') + '\n';
    const { diff: out, omitidos } = P.filtrarSecretosDiff(diff);
    for (const c of ['r', 'j', 'p', 'a', 'o', 's', 'g', 't', 'q', 'c', 'K', 'n', 'y', 'e', 'l', 'z', 'w']) {
        assert.ok(!out.includes(v(c)), `se filtró el secreto de relleno "${c}"`);
    }
    assert.ok(omitidos.includes('credentials.json') && omitidos.includes('mi carpeta/.env') && omitidos.includes('id_rsa'), JSON.stringify(omitidos));
    const ref = P.filtrarSecretosDiff(sec('x.js', 'const t = process.env.JWT_SECRET_DE_PRODUCCION;')).diff;
    assert.ok(ref.includes('process.env.JWT_SECRET_DE_PRODUCCION'), 'las referencias a variables de entorno se conservan');
});

test('008 N1: tras cooldown, una sonda semiabierta que falla por 503/red NO degrada una apertura por auth', async () => {
    let t = Date.parse('2026-09-26T12:00:00Z');
    const ahora = () => t;
    for (const falla of [respuesta(503, ''), Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })]) {
        const bp = breakerTmp();
        await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(403, '')]), breakerPath: bp, sleep: sinEspera, ahora }));
        t += 901 * 1000;
        await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([falla]), breakerPath: bp, sleep: sinEspera, ahora }));
        assert.equal(P.leerBreaker(bp).categoria_apertura, 'auth');
        await assert.rejects(P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: bp, ahora }), (e) => {
            assert.equal(e.codigo, 'circuito_abierto');
            assert.equal(gate.clasificarFalloApi(e), null, 'debe seguir siendo bloqueo duro');
            return true;
        });
    }
});

test('008 N1b: breaker con formato previo (sin categoria_apertura) conserva la apertura por auth', () => {
    const bp = breakerTmp();
    fs.writeFileSync(bp, JSON.stringify({ estado: 'abierto', fallos_consecutivos: 1, umbral: 3, abierto_desde: new Date().toISOString(), cooldown_s: 900, ultimo_error: { codigo: 'http_403_auth', http: 403, categoria: 'auth', huella_key: 'aaaaaaaaaaaa' } }));
    const b = P.leerBreaker(bp);
    assert.equal(b.categoria_apertura, 'auth');
    P.registrarFallo(b, new P.ErrorProveedor({ codigo: 'http_503', categoria: 'caida' }), Date.now());
    assert.equal(b.categoria_apertura, 'auth');
    assert.equal(P.evaluarBreaker(P.leerBreaker(bp), Date.now(), 'bbbbbbbbbbbb'), 'permitir_prueba', 'key rotada → sonda');
});

test('008 N2: códigos UND_ERR_* que no son de red → solicitud (bloqueo), los de red → caída', () => {
    for (const code of ['UND_ERR_INVALID_ARG', 'UND_ERR_NOT_SUPPORTED', 'UND_ERR_PRX_TLS']) assert.equal(P.esErrorDeRed({ cause: { code } }), false, code);
    for (const code of ['UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET']) assert.equal(P.esErrorDeRed({ cause: { code } }), true, code);
});

test('008 N3: formatos adicionales redactados (_KEY, Supabase, Wompi, render.yaml, YAML en bloque, passphrase, diff --cc, Basic)', () => {
    const v = (c) => c.repeat(24);
    const diff = [
        'diff --git a/.env.example b/.env.example\n+INNGEST_EVENT_' + 'KEY=' + v('i') + '\n+SUPABASE_SERVICE_' + 'KEY=' + v('s') + '\n+ENCRYPTION_' + 'KEY=' + v('e') + '\n',
        'diff --git a/x.js b/x.js\n+const a = "sb_' + 'secret_' + v('b') + '";\n+WOMPI_PRIVADA=prv_' + 'prod_' + v('w') + '\n+headers.Authorization = "Basic ' + v('B') + '";\n',
        'diff --git a/render.yaml b/render.yaml\n+  - key: SUPABASE_SERVICE_' + 'KEY\n+    value: ' + v('r') + '\n',
        'diff --git a/c.yml b/c.yml\n+api_' + 'key: >-\n+  ' + v('y') + '\n',
        'diff --git a/d.env.txt b/d.env.txt\n+PASS' + 'PHRASE="correct horse battery staple ' + v('p') + '"\n',
        'diff --cc .env.production\n+++ b/.env.production\n+X=' + v('c') + '\n',
    ].join('');
    const { diff: out, omitidos } = P.filtrarSecretosDiff(diff);
    for (const c of ['i', 's', 'e', 'b', 'w', 'B', 'r', 'y', 'p', 'c']) assert.ok(!out.includes(v(c)), `se filtró "${c}"`);
    assert.ok(omitidos.includes('.env.production'), JSON.stringify(omitidos));
});

test('008 N4: el código de autorización NO se redacta (002 debe verlo)', () => {
    const linea = '+const authorized = isAdminOrOwnerOfTenant(user, tenantId);\n+const token = await obtenerTokenDeSesion(req);\n+  if (!authBypassDisabled) throw new Error(x);\n';
    const out = P.filtrarSecretosDiff('diff --git a/src/rbac.js b/src/rbac.js\n' + linea).diff;
    assert.ok(out.includes('isAdminOrOwnerOfTenant(user, tenantId)'));
    assert.ok(out.includes('obtenerTokenDeSesion(req)'));
    assert.ok(!out.includes('SECRETO_REDACTADO'));
});

test('008#12/15: mencionaAgente ignora hashes hex; el PMU no expone huella_key', () => {
    assert.ok(!gate.mencionaAgente('commit a004e3f y b005c1d', '004-sentinela-frontend.md'));
    assert.ok(!gate.mencionaAgente('commit a004e3f y b005c1d', '005-ingeniero-backend.md'));
    const conHuella = { ...P.BREAKER_DEFAULT, estado: 'abierto', ultimo_error: { codigo: 'x', categoria: 'auth', huella_key: 'abc123abc123' } };
    assert.ok(!JSON.stringify(P.breakerPublico(conHuella)).includes('abc123abc123'));
    assert.ok(!JSON.stringify(P.alertasDeProveedor(conHuella, 'nim', 'm')).includes('abc123abc123'));
    // Estructural, no por substring (2026-09-26): el PMU incluye veredictos
    // reales cuyo texto puede MENCIONAR "huella_key" en prosa (002 lo hizo en
    // su aprobación) — lo prohibido es exponer el CAMPO o el VALOR.
    const estado = gate.generarEstadoOperativo();
    const camposHuella = [];
    (function recorrer(o, ruta) {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o)) {
            if (k === 'huella_key') camposHuella.push(`${ruta}.${k}`);
            recorrer(v, `${ruta}.${k}`);
        }
    })(estado, 'estado');
    assert.deepEqual(camposHuella, [], 'el PMU no debe exponer ningún campo huella_key');
    const huellaReal = P.leerBreaker(gate.BREAKER_PATH).ultimo_error?.huella_key;
    if (huellaReal) assert.ok(!JSON.stringify(estado).includes(huellaReal), 'ni el valor de la huella real');
});

// ---------------------------------------------------------------------------
// PMU Titán V2 (2026-09-26)
// ---------------------------------------------------------------------------

test('V2#2: clasificarHttp decide por HTTP → campos estructurados → texto (fallback)', () => {
    // HTTP manda aunque el cuerpo diga otra cosa.
    assert.equal(P.clasificarHttp(403, { error: { code: 'insufficient_quota' } }).categoria, 'auth');
    assert.equal(P.clasificarHttp(429, '').categoria, 'cuota');
    // 400 → estructurado (OpenAI-compatible), sin texto útil.
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"insufficient_quota","message":"x"}}').codigo, 'http_400_cuota');
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"model_not_found","message":"x"}}').categoria, 'politica');
    assert.equal(P.clasificarHttp(400, { type: 'error', error: { type: 'authentication_error', message: 'x' } }).categoria, 'auth');
    // Estructurado gana al texto: el code dice contexto aunque el texto mencione "quota".
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"context_length_exceeded","message":"quota exceeded wording"}}').categoria, 'solicitud');
    // Anthropic sin saldo: invalid_request_error genérico → fallback de texto.
    assert.equal(P.clasificarHttp(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }).codigo, 'http_400_sin_saldo');
    // Texto plano sin JSON sigue funcionando como último recurso.
    assert.equal(P.clasificarHttp(400, 'insufficient_quota for this account').categoria, 'cuota');
    assert.equal(P.clasificarHttp(400, 'algo raro').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(529, '').codigo, 'http_529_sobrecargada');
});

test('V2#3: VEREDICTO_SCHEMAS tiene contrato para 010 conforme a su "Salida obligatoria"', () => {
    const ok = gate.validarFormaVeredicto('010_INGENIERO_QA_AUTOMATIZACION', { suite_valida: true, specs: [{ archivo: 'tests/e2e/a.spec.js', flujo: 'login', resultado: 'pass' }] });
    assert.equal(ok.ok, true);
    const malResultado = gate.validarFormaVeredicto('010_INGENIERO_QA_AUTOMATIZACION', { suite_valida: true, specs: [{ archivo: 'x', flujo: 'y', resultado: 'ok' }] });
    assert.equal(malResultado.ok, false);
    const sinSpecs = gate.validarFormaVeredicto('010_INGENIERO_QA_AUTOMATIZACION', { suite_valida: true });
    assert.equal(sinSpecs.ok, false, 'sin contrato asimétrico: 010 ya no pasa sin validar forma');
    for (const id of ['003_ESP_DISENO_STITCH', '004_SENTINELA_FRONTEND', '005_INGENIERO_BACKEND', '006_DEVSECOPS_INFRAESTRUCTURA', '009_INGENIERO_FRONTEND', '010_INGENIERO_QA_AUTOMATIZACION']) {
        assert.ok(gate.VEREDICTO_SCHEMAS[id], `falta contrato Zod para ${id}`);
    }
});

test('V2#4: git inaccesible (null o excepción) → alerta_git_inaccesible, nunca crash ni verde silencioso', () => {
    const caido = () => null;
    const lanza = () => { throw new Error('spawn git ENOENT'); };
    for (const git of [caido, lanza]) {
        const alertas = gate.verificarVigenciaAgentes(git);
        assert.equal(alertas.length, 1);
        assert.equal(alertas[0].tipo, 'alerta_git_inaccesible');
        assert.equal(alertas[0].estado, 'alerta_git_inaccesible');
    }
    // Checkout superficial: git responde pero sin historial del documento.
    const sinHistorial = gate.verificarVigenciaAgentes(() => '');
    assert.equal(sinHistorial[0].tipo, 'alerta_git_inaccesible');
    // git log responde, pero rev-list falla a mitad → una sola alerta de git, sin crash.
    const sha = 'a'.repeat(40);
    const parcial = (args) => {
        if (args[0] === 'log') return sha;
        if (args[0] === 'rev-parse') return sha;
        return null;
    };
    const fs2 = require('fs');
    const dirAg = path.join(__dirname, '..', '..', '.claude', 'agents');
    const conAcuse = fs2.readdirSync(dirAg).some(f => /^doc_revisado:/m.test(fs2.readFileSync(path.join(dirAg, f), 'utf8')));
    const r = gate.verificarVigenciaAgentes(parcial);
    if (conAcuse) assert.ok(r.some(a => a.tipo === 'alerta_git_inaccesible'));
    assert.ok(Array.isArray(r));
});

test('V2#1: firmado_por registra el proveedor y modelo reales, sin literal "vía API Anthropic"', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', '..', 'agents', 'architecture-gate.cjs'), 'utf8');
    assert.ok(!/vía API Anthropic\)/.test(fuente), 'quedó el literal quemado');
    assert.equal((fuente.match(/firmaEvaluador\(/g) || []).length >= 3, true, 'definición + 2 usos (002 y subgates)');
});


// ---------------------------------------------------------------------------
// Cadena de conmutación entre modelos (orden del dueño 2026-10-04, enmienda
// ADR-0002 §2.1): primario → modelos NIM del catálogo → Anthropic solo si se
// lista. NIM se simula con fetchImpl (por body.model); Anthropic con
// globalThis.fetch (el SDK lo captura al construir el cliente).
// ---------------------------------------------------------------------------

const KEY_ANT = 'sk-ant-api03-' + 'a'.repeat(40);
const CADENA = ['org/modelo-b', 'org/modelo-c'];
const ENV_CADENA = { NVIDIA_API_KEY: KEY, GATE_MODEL: 'org/modelo-a' };

// Doble NIM por modelo: 'colgado' | 'ok' | código HTTP.
function nimPorModelo(plan) {
    const llamadas = [];
    const f = (url, init) => {
        const modelo = JSON.parse(init.body).model;
        llamadas.push(modelo);
        const accion = plan[modelo] ?? 'colgado';
        if (accion === 'colgado') {
            return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        }
        return Promise.resolve(accion === 'ok' ? respuesta(200, OK_BODY) : respuesta(accion, ''));
    };
    f.llamadas = llamadas;
    return f;
}

test('cadena: sin cadenaPorDefecto ni GATE_FALLBACK_CHAIN no hay conmutación; "none" la apaga explícitamente', () => {
    const cfg = P.resolverConfig(ENV_CADENA);
    assert.deepEqual(P.resolverCadena(ENV_CADENA, cfg), []);
    assert.deepEqual(P.resolverCadena({ ...ENV_CADENA, GATE_FALLBACK_CHAIN: 'none' }, cfg, CADENA), []);
    assert.deepEqual(P.resolverCadena(ENV_CADENA, cfg, CADENA).map(P.etiquetaModelo), ['nim:org/modelo-b', 'nim:org/modelo-c']);
});

test('cadena: primario sin primer byte → 1 solo intento contenido y conmuta al siguiente modelo NIM, sin costo', async () => {
    const bp = breakerTmp();
    const nim = nimPorModelo({ 'org/modelo-b': 'ok' });
    const r = await P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nim, breakerPath: bp, sleep: sinEspera, primerByteMs: 30, cadenaPorDefecto: CADENA });
    assert.deepEqual(nim.llamadas, ['org/modelo-a', 'org/modelo-b'], 'el primario no se reintenta: conmuta');
    assert.equal(r.modelo, 'org/modelo-b');
    assert.deepEqual(r.failover, { desde: 'nim:org/modelo-a', hacia: 'nim:org/modelo-b', fallos: ['nim:org/modelo-a=timeout_sin_respuesta'] });
    assert.equal(P.leerBreaker(bp).fallos_consecutivos, 1, 'la falla queda en el breaker del primario');
    const cfgB = P.resolverCadena(ENV_CADENA, P.resolverConfig(ENV_CADENA), CADENA)[0];
    assert.equal(P.leerBreaker(P.rutaBreakerModelo(bp, cfgB)).estado, 'cerrado');
});

test('cadena: breaker del primario abierto → se salta al instante, sin esperar el plazo de 15 s', async () => {
    const bp = breakerTmp();
    P.escribirBreaker(bp, { ...P.BREAKER_DEFAULT, estado: 'abierto', fallos_consecutivos: 3, abierto_desde: new Date().toISOString(), categoria_apertura: 'caida', ultimo_error: { codigo: 'timeout_sin_respuesta', categoria: 'caida', huella_key: P.huellaKey(KEY) } });
    const nim = nimPorModelo({ 'org/modelo-a': 'ok', 'org/modelo-b': 'ok' });
    const r = await P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nim, breakerPath: bp, sleep: sinEspera, cadenaPorDefecto: CADENA });
    assert.deepEqual(nim.llamadas, ['org/modelo-b']);
    assert.equal(r.failover.fallos[0], 'nim:org/modelo-a=circuito_abierto');
});

test('cadena: 403 aborta toda la cadena (misma key para todos los NIM: conmutar no lo arregla ni debe ocultarlo)', async () => {
    const nim = nimPorModelo({ 'org/modelo-a': 403, 'org/modelo-b': 'ok' });
    await assert.rejects(P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nim, breakerPath: breakerTmp(), sleep: sinEspera, cadenaPorDefecto: CADENA }), (e) => {
        assert.equal(e.categoria, 'auth');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.deepEqual(nim.llamadas, ['org/modelo-a']);
});

test('cadena: modelo retirado (404) o contexto excedido (400) en un eslabón → salta al siguiente', async () => {
    const nim = nimPorModelo({ 'org/modelo-a': 404, 'org/modelo-b': 400, 'org/modelo-c': 'ok' });
    const r = await P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nim, breakerPath: breakerTmp(), sleep: sinEspera, cadenaPorDefecto: CADENA });
    assert.equal(r.modelo, 'org/modelo-c');
    assert.deepEqual(r.failover.fallos, ['nim:org/modelo-a=http_404_modelo_no_disponible', 'nim:org/modelo-b=http_400']);
});

test('cadena: todos caídos → error del último con el recorrido completo en el detalle', async () => {
    const nim = nimPorModelo({ 'org/modelo-a': 503, 'org/modelo-b': 503, 'org/modelo-c': 503 });
    await assert.rejects(P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nim, breakerPath: breakerTmp(), sleep: sinEspera, cadenaPorDefecto: CADENA }), (e) => {
        assert.equal(e.codigo, 'http_503');
        assert.match(e.detalle, /cadena: nim:org\/modelo-a=http_503, nim:org\/modelo-b=http_503, nim:org\/modelo-c=http_503/);
        return true;
    });
    assert.equal(nim.llamadas.filter(m => m === 'org/modelo-c').length, 3, 'solo el último eslabón usa la política normal de reintentos');
});

test('cadena: Anthropic solo entra si se lista explícitamente, y al final', async () => {
    const original = globalThis.fetch;
    const ant = [];
    globalThis.fetch = async (url) => {
        ant.push(String(url));
        return new Response(JSON.stringify({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const env = { ...ENV_CADENA, ANTHROPIC_API_KEY: KEY_ANT, GATE_FALLBACK_CHAIN: 'nim:org/modelo-b,anthropic' };
        const r = await P.llamarModelo(MSG, { env, fetchImpl: nimPorModelo({}), breakerPath: breakerTmp(), sleep: sinEspera, primerByteMs: 30, cadenaPorDefecto: CADENA });
        assert.equal(r.proveedor, 'anthropic');
        assert.equal(r.failover.hacia, 'anthropic:claude-sonnet-4-6');
        assert.equal(ant.length, 1);
        await P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nimPorModelo({ 'org/modelo-c': 'ok' }), breakerPath: breakerTmp(), sleep: sinEspera, primerByteMs: 30, cadenaPorDefecto: CADENA });
        assert.equal(ant.length, 1, 'la cadena por defecto nunca toca Anthropic');
    } finally {
        globalThis.fetch = original;
    }
});

test('cadena: configuración inválida es bloqueo duro; duplicados y el propio primario se ignoran', () => {
    const cfg = P.resolverConfig(ENV_CADENA);
    const malo = (chain) => () => P.resolverCadena({ ...ENV_CADENA, GATE_FALLBACK_CHAIN: chain }, cfg, CADENA);
    assert.throws(malo('nim:sin-barra'), (e) => e.codigo === 'cadena_modelo_invalido' && e.categoria === 'config');
    assert.throws(malo('openai:gpt'), (e) => e.codigo === 'proveedor_desconocido');
    assert.throws(malo(Array.from({ length: 7 }, (_, i) => `nim:o/m${i}`).join(',')), (e) => e.codigo === 'cadena_demasiado_larga');
    assert.throws(() => P.resolverPlazoFailover({ GATE_FAILOVER_PRIMER_BYTE_MS: '1000' }), (e) => e.codigo === 'failover_primer_byte_invalido');
    assert.equal(P.resolverPlazoFailover({}), 15000);
    assert.deepEqual(P.resolverCadena({ ...ENV_CADENA, GATE_FALLBACK_CHAIN: 'nim:org/modelo-a,nim:org/modelo-b,nim:org/modelo-b' }, cfg).map(P.etiquetaModelo), ['nim:org/modelo-b']);
});

test('cadena por defecto: solo modelos NIM (sin costo), primario fuera de la lista, máximo de eslabones respetado', () => {
    assert.ok(P.CADENA_NIM_DEFAULT.length > 0 && P.CADENA_NIM_DEFAULT.length <= 6);
    assert.ok(!P.CADENA_NIM_DEFAULT.includes(P.GATE_MODEL_DEFAULT));
    for (const m of P.CADENA_NIM_DEFAULT) assert.match(m, /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/);
});

test('sondearModelos: reporta vivo/ms/código por modelo; respuesta vacía de un modelo de razonamiento cuenta como vivo', async () => {
    const vacio = { choices: [{ message: { content: '' }, finish_reason: 'length' }] };
    const f = (url, init) => {
        const modelo = JSON.parse(init.body).model;
        if (modelo === 'org/modelo-a') return Promise.resolve(respuesta(503, ''));
        if (modelo === 'org/modelo-b') return Promise.resolve(respuesta(200, vacio));
        return Promise.resolve(respuesta(200, OK_BODY));
    };
    const r = await P.sondearModelos({ env: ENV_CADENA, fetchImpl: f, cadenaPorDefecto: CADENA });
    assert.deepEqual(r.map(x => [x.modelo, x.vivo, x.codigo]), [
        ['nim:org/modelo-a', false, 'http_503'],
        ['nim:org/modelo-b', true, 'respuesta_truncada'],
        ['nim:org/modelo-c', true, 'ok'],
    ]);
    assert.ok(r.every(x => Number.isInteger(x.ms)));
});

test('breaker atado al modelo: un circuito abierto por OTRO modelo no bloquea al primario actual (regresión en vivo 2026-10-04)', async () => {
    const bp = breakerTmp();
    P.escribirBreaker(bp, { ...P.BREAKER_DEFAULT, estado: 'abierto', fallos_consecutivos: 3, abierto_desde: new Date().toISOString(), categoria_apertura: 'caida', modelo: 'nim:deepseek-ai/deepseek-v4.1-flash', ultimo_error: { codigo: 'timeout_sin_respuesta', categoria: 'caida', huella_key: P.huellaKey(KEY) } });
    const nim = nimPorModelo({ 'org/modelo-a': 'ok' });
    const r = await P.llamarModelo(MSG, { env: ENV_CADENA, fetchImpl: nim, breakerPath: bp, sleep: sinEspera, cadenaPorDefecto: CADENA });
    assert.equal(r.modelo, 'org/modelo-a');
    assert.equal(r.failover, null);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'cerrado');
    assert.equal(b.modelo, 'nim:org/modelo-a', 'el breaker queda etiquetado con su modelo');
});

// ---------------------------------------------------------------------------
// FinOps (orden del dueño 2026-10-04): NIM no reporta usage en streaming →
// estimación volumétrica marcada como tal; costo en COP con TRM configurable.
// ---------------------------------------------------------------------------

test('FinOps: SSE sin usage → estimación volumétrica (factor medido 3,1) marcada estimado:true; NIM cuesta COP 0', async () => {
    const partes = [chunk('a'.repeat(310)), chunkFin('stop'), 'data: [DONE]\n\n'];
    const msg = { system: 's'.repeat(155), user: 'u'.repeat(155), max_tokens: 100 };
    const r = await P.llamarModelo(msg, { env: ENV, fetchImpl: fetchSecuencia([respuestaSSE(partes)]), breakerPath: breakerTmp(), sleep: sinEspera });
    assert.deepEqual(r.uso, { prompt_tokens: 100, completion_tokens: 100, estimado: true, caracteres_por_token: P.CARACTERES_POR_TOKEN_DEFAULT });
    assert.deepEqual(r.costo, { usd: 0, cop: 0, trm: P.TRM_COP_USD_DEFAULT, estimado: true });
});

test('FinOps: el usage real del proveedor se respeta (no se sobreescribe con la estimación)', async () => {
    const r = await P.llamarModelo(MSG, { env: ENV, fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: breakerTmp(), sleep: sinEspera });
    assert.deepEqual(r.uso, { prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(r.costo.estimado, false);
});

test('FinOps: costo en COP por tarifa del modelo y TRM configurable; factor y TRM inválidos caen al valor por defecto', () => {
    const uso = { prompt_tokens: 1_000_000, completion_tokens: 100_000 };
    const sonnet = { proveedor: 'anthropic', modelo: 'claude-sonnet-4-6' };
    assert.deepEqual(P.costoEnCOP(uso, sonnet, { TRM_COP_USD: '4000' }), { usd: 4.5, cop: 18000, trm: 4000, estimado: false });
    assert.equal(P.costoEnCOP(uso, sonnet, { TRM_COP_USD: 'abc' }).trm, P.TRM_COP_USD_DEFAULT);
    assert.equal(P.costoEnCOP(uso, { proveedor: 'anthropic', modelo: 'claude-desconocido' }, {}).motivo, 'tarifa_desconocida');
    assert.equal(P.costoEnCOP(uso, { proveedor: 'nim', modelo: 'moonshotai/kimi-k3' }, {}).cop, 0);
    assert.equal(P.estimarUso({ system: 'x'.repeat(30), user: '', texto: 'y'.repeat(30) }, { LLM_CARACTERES_POR_TOKEN: '3' }).prompt_tokens, 10);
    assert.equal(P.estimarUso({ system: 'x', user: '', texto: '' }, { LLM_CARACTERES_POR_TOKEN: '99' }).caracteres_por_token, P.CARACTERES_POR_TOKEN_DEFAULT);
    assert.equal(P.costoEnCOP(null, sonnet, {}), null);
});

test('FinOps: el razonamiento del modelo cuenta como tokens de salida en la estimación', () => {
    const u = P.estimarUso({ system: '', user: '', texto: 'z'.repeat(31), razonamientoChars: 310 }, {});
    assert.equal(u.completion_tokens, Math.ceil(341 / P.CARACTERES_POR_TOKEN_DEFAULT));
});


// ---------------------------------------------------------------------------
// Enrutamiento por aptitud para la aplicación (orden del dueño 2026-10-04):
// perfil de modelos NIM por tarea, Anthropic al final solo si hay key.
// ---------------------------------------------------------------------------

test('tarea: NIM primero por aptitud y Anthropic al final como respaldo de pago solo si hay su key', () => {
    const conAmbas = P.configuracionPorTarea('razonamiento', { NVIDIA_API_KEY: KEY, ANTHROPIC_API_KEY: KEY_ANT });
    assert.equal(conAmbas.GATE_PROVIDER, 'nim');
    assert.equal(conAmbas.GATE_MODEL, P.PERFILES_TAREA.razonamiento[0]);
    assert.equal(conAmbas.GATE_FALLBACK_CHAIN, [...P.PERFILES_TAREA.razonamiento.slice(1).map(m => `nim:${m}`), 'anthropic'].join(','));

    const soloNim = P.configuracionPorTarea('rapido', { NVIDIA_API_KEY: KEY });
    assert.equal(soloNim.GATE_MODEL, P.PERFILES_TAREA.rapido[0]);
    assert.ok(!soloNim.GATE_FALLBACK_CHAIN.includes('anthropic'), 'sin key de pago no hay respaldo de pago');

    const soloPago = P.configuracionPorTarea('razonamiento', { ANTHROPIC_API_KEY: KEY_ANT });
    assert.equal(soloPago.GATE_PROVIDER, 'anthropic');
    assert.equal(soloPago.GATE_FALLBACK_CHAIN, 'none');

    assert.throws(() => P.configuracionPorTarea('razonamiento', {}), (e) => e.codigo === 'sin_proveedor_ia' && e.categoria === 'config');
    assert.throws(() => P.configuracionPorTarea('poesia', { NVIDIA_API_KEY: KEY }), (e) => e.codigo === 'tarea_desconocida');
});

test('tarea: LLM_PERFIL_<TAREA> reemplaza el orden; un id inválido es bloqueo duro', () => {
    assert.deepEqual(P.resolverPerfil('rapido', { LLM_PERFIL_RAPIDO: 'org/x, org/y' }), ['org/x', 'org/y']);
    assert.throws(() => P.resolverPerfil('rapido', { LLM_PERFIL_RAPIDO: 'sin-barra' }), (e) => e.codigo === 'perfil_modelo_invalido');
});

test('tarea: NIM se usa también con NODE_ENV=production (decisión del dueño, ADR-0003 enmendado)', () => {
    assert.equal(P.resolverConfig({ NVIDIA_API_KEY: KEY, NODE_ENV: 'production' }).proveedor, 'nim');
});

test('tarea: llamarPorTarea conmuta dentro del perfil y termina en Anthropic si todo NIM cae', async () => {
    const original = globalThis.fetch;
    const ant = [];
    globalThis.fetch = async (url) => {
        ant.push(String(url));
        return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'respaldo' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const env = { NVIDIA_API_KEY: KEY, ANTHROPIC_API_KEY: KEY_ANT, LLM_PERFIL_RAPIDO: 'org/a,org/b' };
        const nimCaido = nimPorModelo({ 'org/a': 503, 'org/b': 503 });
        const r = await P.llamarPorTarea(MSG, { tarea: 'rapido', env, fetchImpl: nimCaido, breakerPath: breakerTmp(), sleep: sinEspera });
        assert.deepEqual(nimCaido.llamadas, ['org/a', 'org/b']);
        assert.equal(r.proveedor, 'anthropic');
        assert.equal(r.texto, 'respaldo');
        assert.equal(r.costo.estimado, false);
        assert.ok(r.costo.cop > 0, 'el respaldo de pago sí cuesta');

        const nimOk = nimPorModelo({ 'org/a': 'ok' });
        const r2 = await P.llamarPorTarea(MSG, { tarea: 'rapido', env, fetchImpl: nimOk, breakerPath: breakerTmp(), sleep: sinEspera });
        assert.equal(r2.modelo, 'org/a');
        assert.equal(r2.costo.cop, 0);
        assert.equal(ant.length, 1, 'con NIM sano no se toca el respaldo de pago');
    } finally {
        globalThis.fetch = original;
    }
});
