// gate-proveedor.test.cjs — capa de proveedor de IA: ADR-0004 (2026-10-08,
// Claude primario + Gemini de respaldo + descubrimiento dinámico) sobre el
// contrato de ADR-0002 (breaker, relojes, clasificación, filtrado de
// secretos) y su integración con el gate.
// Corre con: node --test tests/gate/
//
// Nunca toca la red: todo fetch es un doble inyectado. Breakers y caché del
// descubrimiento viven en directorios temporales, nunca en agents/pmu/ real.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Sandbox de estado antes de requerir el gate (R3/R4, 2026-10-12).
const { prepararSandboxEstado, huellaEstadoReal } = require('./sandbox-estado.cjs');
const SANDBOX = prepararSandboxEstado();

const P = require('../../agents/gate-proveedor.cjs');
const gate = require('../../agents/architecture-gate.cjs');

const KEY = 'sk-ant-api03-TESTKEY_abcdefghijklmnopqrstuvwxyz0123456789';
const KEY_G = 'AIzaTESTKEYG_abcdefghijklmnopqrstuvwxyz0123';
const ENV = { ANTHROPIC_API_KEY: KEY };
const MODELO = 'claude-sonnet-4-6';
const CFG = P.configModelo('anthropic', MODELO, ENV);

function tmpDir(prefijo) { return fs.mkdtempSync(path.join(os.tmpdir(), prefijo)); }
function breakerTmp() { return path.join(tmpDir('breaker-test-'), 'circuit_breaker.json'); }
function cacheTmp() { return path.join(tmpDir('modelos-test-'), 'modelos_descubiertos.json'); }

function respuesta(status, cuerpo, tipo = 'req-test') {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return { ok: status >= 200 && status < 300, status, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' && tipo !== 'req-test' ? tipo : 'req-test') }, text: async () => texto };
}

const mensajeClaude = (texto, usage = { input_tokens: 10, output_tokens: 5 }) => ({ id: 'msg_t', type: 'message', role: 'assistant', model: MODELO, content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', usage });
const OK_BODY = mensajeClaude('análisis {"aprobado": true, "razones": []}');

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
// Un solo modelo, breaker en `bp` exacto (pruebas del contrato de ADR-0002).
const llamar = (opciones = {}, cfg = CFG) => P.llamarProveedor(cfg, MSG, { env: ENV, sleep: sinEspera, ...opciones });

// ---------------------------------------------------------------------------
// Contrato de ADR-0002 sobre el transporte nuevo (Claude, Messages API)
// ---------------------------------------------------------------------------

test('clasificarHttp: cada código HTTP cae en su categoría', () => {
    assert.deepEqual(P.clasificarHttp(401, ''), { codigo: 'http_401_auth', categoria: 'auth' });
    assert.deepEqual(P.clasificarHttp(403, ''), { codigo: 'http_403_auth', categoria: 'auth' });
    assert.equal(P.clasificarHttp(402, '').categoria, 'cuota');
    assert.equal(P.clasificarHttp(429, '').categoria, 'cuota');
    assert.equal(P.clasificarHttp(400, '{"detail":"Quota exceeded for this account"}').codigo, 'http_400_cuota');
    assert.equal(P.clasificarHttp(400, '{"detail":"Model claude-x not found"}').categoria, 'politica');
    assert.equal(P.clasificarHttp(404, '').categoria, 'politica');
    assert.equal(P.clasificarHttp(400, '{"detail":"messages: field required"}').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(500, '').categoria, 'caida');
    assert.equal(P.clasificarHttp(503, '').codigo, 'http_503');
});

test('Claude: éxito devuelve texto y uso real, cierra el breaker y llama a /v1/messages oficial con streaming', async () => {
    const bp = breakerTmp();
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    const r = await llamar({ fetchImpl: f, breakerPath: bp });
    assert.match(r.texto, /"aprobado": true/);
    assert.deepEqual(r.uso, { prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(r.proveedor, 'anthropic');
    assert.equal(r.modelo, MODELO);
    assert.equal(f.llamadas[0].url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(f.llamadas[0].init.body);
    assert.equal(body.model, MODELO);
    assert.equal(body.stream, true);
    assert.equal(f.llamadas[0].init.headers['x-api-key'], KEY);
    assert.equal(f.llamadas[0].init.headers['anthropic-version'], P.ANTHROPIC_VERSION);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('401: NO se reintenta, abre el breaker de inmediato y NO es elegible para soft-fail (el gate no se abre)', async () => {
    const bp = breakerTmp();
    const f = fetchSecuencia([respuesta(401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')]);
    await assert.rejects(llamar({ fetchImpl: f, breakerPath: bp }), (e) => {
        assert.equal(e.categoria, 'auth');
        assert.equal(P.esElegibleSoftFail(e), false);
        assert.equal(gate.clasificarFalloApi(e), null, 'clasificarFalloApi debe devolver null → bloqueo duro');
        return true;
    });
    assert.equal(f.llamadas.length, 1);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'abierto');
    assert.equal(b.ultimo_error.categoria, 'auth');
    const alertas = P.alertasDeProveedor(b, 'anthropic', MODELO);
    assert.equal(alertas[0].tipo, 'ALERTA CRÍTICA DE PROVEEDOR EXTERNO');
    assert.equal(alertas[0].efecto, 'bloqueo_duro');
});

test('circuito abierto por 401: siguiente llamada no toca la red y sigue siendo bloqueo duro', async () => {
    const bp = breakerTmp();
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(403, '')]), breakerPath: bp }));
    const f2 = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(llamar({ fetchImpl: f2, breakerPath: bp }), (e) => {
        assert.equal(e.codigo, 'circuito_abierto');
        assert.equal(e.categoria, 'auth');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.equal(f2.llamadas.length, 0);
});

test('breaker abierto por auth: con la MISMA key sigue cerrado a la red; con key NUEVA hace 1 llamada de prueba', async () => {
    const bp = breakerTmp();
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(401, '')]), breakerPath: bp }));
    const b = P.leerBreaker(bp);
    assert.equal(b.ultimo_error.huella_key, P.huellaKey(KEY));
    assert.ok(!JSON.stringify(b).includes(KEY), 'la huella no es la key');

    const mismaKey = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(llamar({ fetchImpl: mismaKey, breakerPath: bp }));
    assert.equal(mismaKey.llamadas.length, 0);

    const envB = { ANTHROPIC_API_KEY: 'sk-ant-api03-OTRAKEY_zyxwvutsrqponmlkjihgfedcba98765' };
    const keyNueva = fetchSecuencia([respuesta(200, OK_BODY)]);
    await llamar({ env: envB, fetchImpl: keyNueva, breakerPath: bp }, P.configModelo('anthropic', MODELO, envB));
    assert.equal(keyNueva.llamadas.length, 1);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('breaker con llamadas en paralelo: los fallos concurrentes se acumulan, no se pisan', async () => {
    const bp = breakerTmp();
    const lento = (status) => async () => { await new Promise(r => setTimeout(r, 10)); return respuesta(status, ''); };
    await Promise.allSettled([1, 2, 3].map(() => llamar({ fetchImpl: lento(402), breakerPath: bp })));
    const b = P.leerBreaker(bp);
    assert.equal(b.fallos_consecutivos, 3);
    assert.equal(b.estado, 'abierto');
});

test('503 → reintenta con backoff (2 reintentos) y termina con éxito', async () => {
    const esperas = [];
    const f = fetchSecuencia([respuesta(503, 'x'), respuesta(503, 'x'), respuesta(200, OK_BODY)]);
    const r = await llamar({ fetchImpl: f, breakerPath: breakerTmp(), sleep: async (ms) => { esperas.push(ms); }, aleatorio: () => 0 });
    assert.equal(r.intentos, 3);
    assert.deepEqual(esperas, [1000, 2000]);
});

test('400/402 de cuota: sin reintento, elegible para soft-fail, clasificarFalloApi del gate lo reconoce', async () => {
    const f = fetchSecuencia([respuesta(402, '{"detail":"Payment required"}')]);
    await assert.rejects(llamar({ fetchImpl: f, breakerPath: breakerTmp() }), (e) => {
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
    await assert.rejects(llamar({ fetchImpl: colgado, breakerPath: bp, timeoutMs: 20, primerByteMs: 20 }), (e) => {
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
        await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(500, '')]), breakerPath: bp, ahora }));
    }
    assert.equal(P.leerBreaker(bp).estado, 'abierto');

    const sinRed = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(llamar({ fetchImpl: sinRed, breakerPath: bp, ahora }), (e) => {
        assert.equal(e.codigo, 'circuito_abierto');
        assert.equal(e.categoria, 'caida');
        assert.ok(gate.clasificarFalloApi(e), 'abierto por caída → soft-fail elegible');
        return true;
    });
    assert.equal(sinRed.llamadas.length, 0, 'abierto: cero llamadas de red');

    t += 901 * 1000;
    const prueba = fetchSecuencia([respuesta(200, OK_BODY)]);
    await llamar({ fetchImpl: prueba, breakerPath: bp, ahora });
    assert.equal(prueba.llamadas.length, 1);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'cerrado');
    assert.equal(b.fallos_consecutivos, 0);
    assert.deepEqual(P.alertasDeProveedor(b, 'anthropic', MODELO), []);
});

test('breaker: fallo en semiabierto vuelve a abierto con 1 solo intento (sin reintentos)', async () => {
    const bp = breakerTmp();
    let t = 1_000_000;
    P.escribirBreaker(bp, { ...P.BREAKER_DEFAULT, estado: 'abierto', fallos_consecutivos: 3, abierto_desde: new Date(t).toISOString(), ultimo_error: { codigo: 'http_500', categoria: 'caida' } });
    t += 901 * 1000;
    const f = fetchSecuencia([respuesta(500, '')]);
    await assert.rejects(llamar({ fetchImpl: f, breakerPath: bp, ahora: () => t }));
    assert.equal(f.llamadas.length, 1);
    assert.equal(P.leerBreaker(bp).estado, 'abierto');
});

test('config: sin ninguna key → sin_proveedor_ia; key ausente en un modelo concreto → bloqueo duro sin tocar la red', async () => {
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: {}, fetchImpl: f }), (e) => {
        assert.equal(e.codigo, 'sin_proveedor_ia');
        assert.equal(e.categoria, 'config');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    await assert.rejects(P.llamarProveedor(P.configModelo('anthropic', MODELO, {}), MSG, { env: {}, fetchImpl: f }), (e) => {
        assert.equal(e.codigo, 'ANTHROPIC_API_KEY_ausente');
        return true;
    });
    assert.equal(f.llamadas.length, 0);
});

test('filtrarSecretosDiff: omite .env, conserva .env.example, redacta keys y JWT', () => {
    // Fixtures armados en tiempo de ejecución: el literal de un JWT o de una
    // asignación "apiKey = '<valor largo>'" en el fuente dispararía (con razón)
    // escanearSecretos() del propio gate al commitear este archivo.
    const jwt = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnop'].join('.');
    const asignacion = 'const api' + 'Key = "' + 'Z'.repeat(24) + '";';
    const diff = [
        'diff --git a/.env b/.env\n+ANTHROPIC_API_KEY=sk-' + 'ant-AAAAAAAAAAAAAAAAAAAA\n',
        'diff --git a/.env.example b/.env.example\n+ANTHROPIC_API_KEY=\n',
        `diff --git a/src/x.js b/src/x.js\n+const k = "sk-${'ant'}-BBBBBBBBBBBBBBBBBBBBBBBB";\n+const g = "AI${'za'}${'C'.repeat(35)}";\n+const t = "${jwt}";\n+${asignacion}\n`,
    ].join('');
    const { diff: out, omitidos } = P.filtrarSecretosDiff(diff);
    assert.deepEqual(omitidos, ['.env']);
    assert.ok(!out.includes('ant-AAAA'));
    assert.ok(!out.includes('ant-BBBB'));
    assert.ok(!out.includes('C'.repeat(35)));
    assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9.eyJzdWIi'));
    assert.ok(!out.includes('ZZZZZZZZZZZZZZZZZZZZ'));
    assert.ok(out.includes('diff --git a/.env.example b/.env.example\n+ANTHROPIC_API_KEY=\n'));
    assert.ok(out.includes('[contenido omitido: archivo sensible'));
});

test('P6: ninguna key (Claude ni Gemini) aparece en error, breaker ni consola aunque el proveedor la devuelva', async () => {
    for (const [cfg, key] of [[CFG, KEY], [P.configModelo('gemini', 'gemini-2.5-pro', { GEMINI_API_KEY: KEY_G }), KEY_G]]) {
        const bp = breakerTmp();
        const capturado = [];
        const orig = { log: console.log, warn: console.warn, error: console.error };
        for (const k of Object.keys(orig)) console[k] = (...a) => capturado.push(a.join(' '));
        let err;
        try {
            const f = fetchSecuencia([respuesta(401, `{"detail":"invalid key ${key}","auth":"Bearer ${key}","x-goog-api-key":"${key}"}`)]);
            await P.llamarProveedor(cfg, MSG, { env: { ANTHROPIC_API_KEY: KEY, GEMINI_API_KEY: KEY_G }, fetchImpl: f, breakerPath: bp, sleep: sinEspera }).catch(e => { err = e; });
        } finally {
            Object.assign(console, orig);
        }
        assert.ok(err);
        for (const texto of [err.message, err.detalle, fs.readFileSync(bp, 'utf8'), capturado.join('\n'), JSON.stringify(err)]) {
            assert.ok(!texto.includes(key), `la key de ${cfg.proveedor} se filtró`);
            assert.ok(!texto.includes('TESTKEY'), 'fragmento de la key se filtró');
        }
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
// Regresiones de la auditoría 008 (Protocolo Titán, 2026-09-26), adaptadas.
// ---------------------------------------------------------------------------

test('008#2: key malformada (no-ByteString / espacios) → config, cero red; TypeError de fetch sin código de red → solicitud, no caída', async () => {
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    for (const k of ['sk-ant-abcédefghijklmnop', 'sk-ant-abc defghijklmnop', 'corta']) {
        const env = { ANTHROPIC_API_KEY: k };
        await assert.rejects(P.llamarProveedor(P.configModelo('anthropic', MODELO, env), MSG, { env, fetchImpl: f, breakerPath: breakerTmp() }), (e) => {
            assert.equal(e.codigo, 'ANTHROPIC_API_KEY_malformada');
            assert.equal(gate.clasificarFalloApi(e), null);
            return true;
        });
    }
    assert.equal(f.llamadas.length, 0);
    const byteString = fetchSecuencia([new TypeError('Cannot convert argument to a ByteString')]);
    await assert.rejects(llamar({ fetchImpl: byteString, breakerPath: breakerTmp() }), (e) => {
        assert.equal(e.categoria, 'solicitud');
        assert.equal(gate.clasificarFalloApi(e), null);
        return true;
    });
    assert.equal(byteString.llamadas.length, 1, 'sin reintentos para un error no de red');
    const red = fetchSecuencia([Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })]);
    await assert.rejects(llamar({ fetchImpl: red, breakerPath: breakerTmp() }), (e) => {
        assert.equal(e.categoria, 'caida');
        return true;
    });
});

test('008#3: 403 y 503 concurrentes → el circuito queda abierto por auth y circuito_abierto sigue siendo bloqueo duro', async () => {
    const bp = breakerTmp();
    const demora = (ms, status) => async () => { await new Promise(r => setTimeout(r, ms)); return respuesta(status, ''); };
    await Promise.allSettled([
        llamar({ fetchImpl: demora(5, 403), breakerPath: bp }),
        llamar({ fetchImpl: demora(20, 503), breakerPath: bp }),
    ]);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'abierto');
    assert.equal(b.categoria_apertura, 'auth');
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: bp }), (e) => {
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
    await assert.rejects(llamar({ fetchImpl: colgado, breakerPath: breakerTmp(), timeoutMs: 30 }), (e) => {
        assert.equal(e.codigo, 'timeout_inactividad');
        return true;
    });
    assert.ok(Date.now() - t0 < 2000, 'no debe colgarse');
});

// --- Streaming SSE + tres relojes -----------------------------------------------

const dormirMs = (ms) => new Promise(r => setTimeout(r, ms));
const enc = new TextEncoder();
const evA = (obj) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
const inicioA = (input = 42) => evA({ type: 'message_start', message: { usage: { input_tokens: input, output_tokens: 1 } } });
const textoA = (t) => evA({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const finA = (stop, out) => evA({ type: 'message_delta', delta: { stop_reason: stop }, ...(out != null ? { usage: { output_tokens: out } } : {}) });
const STOP_A = evA({ type: 'message_stop' });
const chunkG = (partes, extra = {}) => `data: ${JSON.stringify({ candidates: [{ content: { parts: partes }, ...extra.cand }], ...extra.raiz })}\r\n\r\n`;

// Respuesta SSE simulada: emite `partes` con `intervaloMs` entre cada una.
// `infinito` sigue emitiendo hasta que la cancelen (para el plazo total).
function respuestaSSE(partes, { intervaloMs = 0, infinito = false } = {}) {
    let i = 0;
    let cancelado = false;
    const body = new ReadableStream({
        async pull(ctrl) {
            if (cancelado) return;
            if (intervaloMs) await dormirMs(intervaloMs);
            if (infinito) { ctrl.enqueue(enc.encode(textoA('.'))); return; }
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

test('SSE Claude: ensambla text_delta, ignora ping, mide thinking sin guardarlo, uso real de message_start/message_delta', async () => {
    const bp = breakerTmp();
    const partes = [
        evA({ type: 'ping' }), inicioA(42),
        evA({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pensando...' } }),
        textoA('análisis '), textoA('{"aprobado": true, '), textoA('"razones": []}'),
        finA('end_turn', 7), STOP_A,
    ];
    const f = fetchSecuencia([respuestaSSE(partes)]);
    const r = await llamar({ fetchImpl: f, breakerPath: bp });
    assert.equal(r.texto, 'análisis {"aprobado": true, "razones": []}');
    assert.equal(r.fin, 'end_turn');
    assert.deepEqual(r.uso, { prompt_tokens: 42, completion_tokens: 7 });
    assert.equal(r.request_id, 'req-sse');
    assert.equal(r.razonamiento_chars, 'pensando...'.length);
    assert.equal(r.texto_chars, r.texto.length);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('SSE: generación lenta pero viva supera el reloj de inactividad acumulado sin cortarse', async () => {
    const partes = [...Array.from({ length: 7 }, (_, i) => textoA(`p${i} `)), finA('end_turn'), STOP_A];
    const r = await llamar({ fetchImpl: fetchSecuencia([respuestaSSE(partes, { intervaloMs: 25 })]), breakerPath: breakerTmp(), timeoutMs: 60, primerByteMs: 60, deadlineMs: 5000 });
    assert.equal(r.texto, 'p0 p1 p2 p3 p4 p5 p6 ');
});

test('SSE: stream que se calla a mitad → timeout_inactividad (caída, elegible soft-fail)', async () => {
    const colgado = () => {
        const body = new ReadableStream({ start(ctrl) { ctrl.enqueue(enc.encode(textoA('hola'))); } });
        return { ok: true, status: 200, body, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, text: async () => '' };
    };
    const t0 = Date.now();
    await assert.rejects(llamar({ fetchImpl: async () => colgado(), breakerPath: breakerTmp(), timeoutMs: 40, primerByteMs: 40, deadlineMs: 5000 }), (e) => {
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
    await assert.rejects(llamar({ fetchImpl: f, breakerPath: breakerTmp(), timeoutMs: 1000, primerByteMs: 1000, deadlineMs: 80 }), (e) => {
        assert.equal(e.codigo, 'timeout_total');
        assert.equal(e.categoria, 'caida');
        return true;
    });
    assert.equal(llamadas, 1, 'timeout_total no se reintenta');
    assert.equal(P.esReintentable('caida', 'timeout_inactividad'), true);
    assert.equal(P.esReintentable('caida', 'timeout_total'), false);
});

test('SSE: stream cerrado sin message_stop ni stop_reason → stream_incompleto (caída), nunca un veredicto parcial', async () => {
    let llamadas = 0;
    const f = async () => { llamadas++; return respuestaSSE([textoA('{"aprobado": tr')]); };
    await assert.rejects(llamar({ fetchImpl: f, breakerPath: breakerTmp() }), (e) => {
        assert.equal(e.codigo, 'stream_incompleto');
        assert.equal(e.categoria, 'caida');
        return true;
    });
    assert.equal(llamadas, 3, 'corte de conexión = caída → se reintenta');
});

test('SSE: max_tokens sin texto → respuesta_truncada; error a mitad de stream se clasifica (auth / sobrecarga)', async () => {
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuestaSSE([finA('max_tokens'), STOP_A])]), breakerPath: breakerTmp() }), (e) => e.codigo === 'respuesta_truncada');
    const errAuth = evA({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuestaSSE([errAuth])]), breakerPath: breakerTmp() }), (e) => {
        assert.equal(e.codigo, 'stream_http_400_auth');
        assert.equal(e.categoria, 'auth');
        assert.ok(!e.detalle.includes(KEY));
        return true;
    });
    const errSobrecarga = evA({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuestaSSE([inicioA(), errSobrecarga])]), breakerPath: breakerTmp(), maxIntentos: 1 }), (e) => e.codigo === 'stream_sobrecargada' && e.categoria === 'caida');
});

test('GATE_TIMEOUT_TOTAL_MS: default 600 s, rango 30-900 s, inválido = bloqueo duro por configuración', async () => {
    assert.equal(P.resolverTimeoutTotal({}), 600000);
    assert.equal(P.resolverTimeoutTotal({ GATE_TIMEOUT_TOTAL_MS: '120000' }), 120000);
    assert.equal(P.resolverTimeoutTotal({ GATE_TIMEOUT_TOTAL_MS: '900000' }), 900000);
    for (const malo of ['abc', '1000', '900001', '-5', '1e5']) {
        assert.throws(() => P.resolverTimeoutTotal({ GATE_TIMEOUT_TOTAL_MS: malo }), (e) => e.codigo === 'timeout_total_invalido' && e.categoria === 'config', malo);
    }
    const f = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(P.llamarModelo(MSG, { env: { ...ENV, LLM_MODELOS_CLAUDE: MODELO, GATE_TIMEOUT_TOTAL_MS: 'x' }, fetchImpl: f }), (e) => e.codigo === 'timeout_total_invalido');
    assert.equal(f.llamadas.length, 0, 'config inválida no toca la red');
});

test('key rotada: sonda de la key NUEVA que falla por caída reemplaza la evidencia 403 de la key vieja y respeta el cooldown', async () => {
    const bp = breakerTmp();
    let t = Date.parse('2026-09-26T22:02:08Z');
    const ahora = () => t;
    await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(403, '')]), breakerPath: bp, ahora }));
    const envB = { ANTHROPIC_API_KEY: 'sk-ant-api03-KEYB_zyxwvutsrqponmlkjihgfedcba0123456789' };
    const cfgB = P.configModelo('anthropic', MODELO, envB);
    t += 60 * 1000;
    await assert.rejects(llamar({ env: envB, fetchImpl: fetchSecuencia([respuesta(503, '')]), breakerPath: bp, ahora }, cfgB));
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'abierto');
    assert.equal(b.categoria_apertura, 'caida', 'el 403 era de la key vieja');
    assert.equal(b.ultimo_error.huella_key, P.huellaKey(envB.ANTHROPIC_API_KEY));
    assert.equal(b.ultimo_error.codigo, 'http_503');
    const sinRed = fetchSecuencia([respuesta(200, OK_BODY)]);
    await assert.rejects(llamar({ env: envB, fetchImpl: sinRed, breakerPath: bp, ahora }, cfgB), (e) => e.codigo === 'circuito_abierto');
    assert.equal(sinRed.llamadas.length, 0, 'dentro del cooldown no hay sonda');
    t += 901 * 1000;
    await llamar({ env: envB, fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: bp, ahora }, cfgB);
    assert.equal(P.leerBreaker(bp).estado, 'cerrado');
});

test('008#7: 400 context_length_exceeded / max_tokens → solicitud (bloqueo), no cuota', () => {
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"context_length_exceeded"}}').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, 'max_tokens exceeded the limit').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, 'rate limit reached for model').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"insufficient_quota"}}').categoria, 'cuota');
});

test('008#11: contenido vacío → respuesta_vacia (bloqueo duro), stop_reason max_tokens → respuesta_truncada', async () => {
    const vacio = fetchSecuencia([respuesta(200, { ...OK_BODY, content: [] })]);
    await assert.rejects(llamar({ fetchImpl: vacio, breakerPath: breakerTmp() }), (e) => e.codigo === 'respuesta_vacia' && gate.clasificarFalloApi(e) === null);
    const trunco = fetchSecuencia([respuesta(200, { ...OK_BODY, content: [], stop_reason: 'max_tokens' })]);
    await assert.rejects(llamar({ fetchImpl: trunco, breakerPath: breakerTmp() }), (e) => e.codigo === 'respuesta_truncada');
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
        await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(403, '')]), breakerPath: bp, ahora }));
        t += 901 * 1000;
        await assert.rejects(llamar({ fetchImpl: fetchSecuencia([falla]), breakerPath: bp, ahora }));
        assert.equal(P.leerBreaker(bp).categoria_apertura, 'auth');
        await assert.rejects(llamar({ fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: bp, ahora }), (e) => {
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
    assert.ok(!JSON.stringify(P.alertasDeProveedor(conHuella, 'anthropic', MODELO)).includes('abc123abc123'));
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
});

// ---------------------------------------------------------------------------
// PMU Titán V2 (2026-09-26)
// ---------------------------------------------------------------------------

test('V2#2: clasificarHttp decide por HTTP → campos estructurados → texto (fallback)', () => {
    assert.equal(P.clasificarHttp(403, { error: { code: 'insufficient_quota' } }).categoria, 'auth');
    assert.equal(P.clasificarHttp(429, '').categoria, 'cuota');
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"insufficient_quota","message":"x"}}').codigo, 'http_400_cuota');
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"model_not_found","message":"x"}}').categoria, 'politica');
    assert.equal(P.clasificarHttp(400, { type: 'error', error: { type: 'authentication_error', message: 'x' } }).categoria, 'auth');
    assert.equal(P.clasificarHttp(400, '{"error":{"code":"context_length_exceeded","message":"quota exceeded wording"}}').categoria, 'solicitud');
    assert.equal(P.clasificarHttp(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }).codigo, 'http_400_sin_saldo');
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
    const sinHistorial = gate.verificarVigenciaAgentes(() => '');
    assert.equal(sinHistorial[0].tipo, 'alerta_git_inaccesible');
    const sha = 'a'.repeat(40);
    const parcial = (args) => {
        if (args[0] === 'log') return sha;
        if (args[0] === 'rev-parse') return sha;
        return null;
    };
    const dirAg = path.join(__dirname, '..', '..', '.claude', 'agents');
    const conAcuse = fs.readdirSync(dirAg).some(f => /^doc_revisado:/m.test(fs.readFileSync(path.join(dirAg, f), 'utf8')));
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
// ADR-0004 — Gemini: transporte, errores y keys
// ---------------------------------------------------------------------------

const ENV_G = { GEMINI_API_KEY: KEY_G };
const CFG_G = P.configModelo('gemini', 'gemini-2.5-pro', ENV_G);

test('Gemini SSE: URL streamGenerateContent?alt=sse, x-goog-api-key, margen de razonamiento y uso real con thoughts', async () => {
    const partes = [
        chunkG([{ text: 'razono...', thought: true }]),
        chunkG([{ text: 'ho' }]),
        chunkG([{ text: 'la' }], { cand: { finishReason: 'STOP' }, raiz: { usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 5 } } }),
    ];
    const f = fetchSecuencia([respuestaSSE(partes)]);
    const r = await P.llamarProveedor(CFG_G, MSG, { env: ENV_G, fetchImpl: f, breakerPath: breakerTmp(), sleep: sinEspera });
    assert.equal(r.texto, 'hola');
    assert.equal(r.fin, 'stop');
    assert.deepEqual(r.uso, { prompt_tokens: 9, completion_tokens: 7 });
    assert.equal(r.razonamiento_chars, 'razono...'.length);
    assert.equal(f.llamadas[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    assert.equal(f.llamadas[0].init.headers['x-goog-api-key'], KEY_G);
    const body = JSON.parse(f.llamadas[0].init.body);
    assert.equal(body.generationConfig.maxOutputTokens, MSG.max_tokens + P.MARGEN_RAZONAMIENTO_GEMINI);
    assert.equal(body.systemInstruction.parts[0].text, 's');
    assert.equal(body.contents[0].parts[0].text, 'u');
});

test('Gemini: respuesta JSON (arreglo de fragmentos) también se interpreta; bloqueo de seguridad → respuesta_bloqueada', async () => {
    const arreglo = [{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } }];
    const r = await P.llamarProveedor(CFG_G, MSG, { env: ENV_G, fetchImpl: fetchSecuencia([respuesta(200, arreglo)]), sleep: sinEspera });
    assert.equal(r.texto, 'ok');
    const bloqueado = [{ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }];
    await assert.rejects(P.llamarProveedor(CFG_G, MSG, { env: ENV_G, fetchImpl: fetchSecuencia([respuesta(200, bloqueado)]), sleep: sinEspera }), (e) => e.codigo === 'respuesta_bloqueada' && e.categoria === 'solicitud');
});

test('Gemini: errores de Google se clasifican por campos estructurados (API_KEY_INVALID, RESOURCE_EXHAUSTED, FAILED_PRECONDITION)', () => {
    const g = (code, status, reason) => ({ error: { code, status, message: 'x', details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [] } });
    assert.equal(P.clasificarHttp(400, g(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID')).categoria, 'auth');
    assert.equal(P.clasificarHttp(400, g(400, 'RESOURCE_EXHAUSTED')).categoria, 'cuota');
    assert.equal(P.clasificarHttp(400, g(400, 'FAILED_PRECONDITION')).categoria, 'politica');
    assert.equal(P.clasificarHttp(429, g(429, 'RESOURCE_EXHAUSTED')).categoria, 'cuota');
    assert.equal(P.clasificarHttp(400, g(400, 'INVALID_ARGUMENT')).categoria, 'solicitud');
});

test('keyDe: Gemini acepta GEMINI_API_KEY y, en su ausencia, GOOGLE_API_KEY; nada de keys de otros proveedores', () => {
    assert.equal(P.keyDe('gemini', { GEMINI_API_KEY: 'a', GOOGLE_API_KEY: 'b' }), 'a');
    assert.equal(P.keyDe('gemini', { GOOGLE_API_KEY: 'b' }), 'b');
    assert.equal(P.keyDe('anthropic', { ANTHROPIC_API_KEY: ' k ' }), 'k');
    assert.deepEqual(P.proveedoresConKey({ NVIDIA_API_KEY: 'x', OPENROUTER_API_KEY: 'y', GROQ_API_KEY: 'z' }), { anthropic: false, gemini: false });
    assert.deepEqual(P.PROVEEDORES, ['anthropic', 'gemini']);
});

// ---------------------------------------------------------------------------
// ADR-0004 — Descubrimiento dinámico y selección por gama
// ---------------------------------------------------------------------------

const LISTA_CLAUDE = [
    { id: 'claude-opus-4-6', created_at: '2026-02-05T00:00:00Z' },
    { id: 'claude-opus-5-5', created_at: '2026-09-01T00:00:00Z' },
    { id: 'claude-sonnet-4-6', created_at: '2026-02-17T00:00:00Z' },
    { id: 'claude-sonnet-5-5', created_at: '2026-09-01T00:00:00Z' },
    { id: 'claude-haiku-4-5', created_at: '2025-10-01T00:00:00Z' },
    { id: 'claude-3-5-sonnet-20241022', created_at: '2024-10-22T00:00:00Z' },
];
const LISTA_GEMINI = [
    'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
    'gemini-flash-latest', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-image',
].map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent', 'countTokens'] }))
    .concat([{ name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }]);

test('clasificarModelo: gama, versión, fecha y estabilidad se leen del id (formatos viejos y nuevos)', () => {
    assert.deepEqual(P.clasificarModelo('anthropic', 'claude-opus-5-5'), { gama: 'opus', version: [5, 5], estable: true, fecha: null });
    assert.deepEqual(P.clasificarModelo('anthropic', 'claude-3-5-sonnet-20241022'), { gama: 'sonnet', version: [3, 5], estable: true, fecha: '20241022' });
    assert.equal(P.clasificarModelo('anthropic', 'claude-fable-5-1').gama, 'otra', 'familia nueva bajo el prefijo');
    assert.deepEqual(P.clasificarModelo('gemini', 'gemini-2.5-flash-lite'), { gama: 'flash-lite', version: [2, 5], estable: true, fecha: null });
    assert.equal(P.clasificarModelo('gemini', 'gemini-3.1-pro-preview').estable, false);
    assert.equal(P.clasificarModelo('gemini', 'gemini-2.0-flash-001').gama, 'flash');
});

test('filtrarModelos: solo modelos de texto de la familia, sin embeddings/tts/imagen/alias -latest; orden por recencia', () => {
    const claude = P.filtrarModelos('anthropic', LISTA_CLAUDE.map(m => ({ id: m.id, creado: Date.parse(m.created_at) })).concat([{ id: 'gpt-x' }]));
    // Por created_at del API, el más nuevo primero (empate → versión → id).
    assert.deepEqual(claude.map(m => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022']);
    assert.ok(!claude.some(m => m.id === 'gpt-x'));
    const gemini = P.filtrarModelos('gemini', LISTA_GEMINI.map(m => ({ id: m.name.slice(7), metodos: m.supportedGenerationMethods })));
    assert.deepEqual(gemini.map(m => m.id), ['gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
});

test('seleccionarModelos: Claude Opus→Sonnet para razonamiento y Sonnet→Haiku para rapido; Gemini Pro→Flash y Flash→Flash-Lite', () => {
    const claude = P.filtrarModelos('anthropic', LISTA_CLAUDE.map(m => ({ id: m.id, creado: Date.parse(m.created_at) })));
    const gemini = P.filtrarModelos('gemini', LISTA_GEMINI.map(m => ({ id: m.name.slice(7), metodos: m.supportedGenerationMethods })));
    assert.deepEqual(P.seleccionarModelos('anthropic', claude, 'razonamiento'), ['claude-opus-5-5', 'claude-sonnet-5-5']);
    assert.deepEqual(P.seleccionarModelos('anthropic', claude, 'rapido'), ['claude-sonnet-5-5', 'claude-haiku-4-5']);
    assert.deepEqual(P.seleccionarModelos('gemini', gemini, 'razonamiento'), ['gemini-3.1-pro-preview', 'gemini-2.5-flash']);
    assert.deepEqual(P.seleccionarModelos('gemini', gemini, 'rapido'), ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.throws(() => P.seleccionarModelos('anthropic', claude, 'poesia'), (e) => e.codigo === 'tarea_desconocida');
});

test('versión nueva o familia nueva entra sola, sin tocar código (requisito "Dynamic Model Discovery")', () => {
    const lista = (extra) => P.filtrarModelos('anthropic', [...LISTA_CLAUDE.map(m => ({ id: m.id, creado: Date.parse(m.created_at) })), ...extra]);
    assert.deepEqual(P.seleccionarModelos('anthropic', lista([{ id: 'claude-opus-7-0', creado: Date.parse('2027-03-01') }]), 'razonamiento')[0], 'claude-opus-7-0');
    const sinOpus = P.filtrarModelos('anthropic', [{ id: 'claude-sonnet-4-6', creado: 1 }, { id: 'claude-fable-9-9', creado: 2 }]);
    assert.deepEqual(P.seleccionarModelos('anthropic', sinOpus, 'razonamiento'), ['claude-sonnet-4-6', 'claude-fable-9-9']);
    const gem = P.filtrarModelos('gemini', [{ id: 'gemini-2.5-pro' }, { id: 'gemini-4.0-pro' }, { id: 'gemini-4.0-pro-preview-01-2027' }]);
    assert.equal(P.seleccionarModelos('gemini', gem, 'razonamiento')[0], 'gemini-4.0-pro', 'versión más alta; estable antes que preview');
});

test('LLM_MODELOS_*: fija el catálogo (sin listado), la gama se sigue aplicando; un id ajeno a la familia es bloqueo duro', () => {
    const fijados = P.pinesDe('anthropic', { LLM_MODELOS_CLAUDE: 'claude-sonnet-4-6, claude-opus-4-6' });
    assert.deepEqual(P.seleccionarModelos('anthropic', fijados, 'razonamiento'), ['claude-opus-4-6', 'claude-sonnet-4-6']);
    assert.equal(P.pinesDe('gemini', {}), null);
    assert.throws(() => P.pinesDe('anthropic', { LLM_MODELOS_CLAUDE: 'gpt-5' }), (e) => e.codigo === 'modelo_fijado_invalido' && e.categoria === 'config');
    assert.throws(() => P.pinesDe('gemini', { LLM_MODELOS_GEMINI: 'nvidia/nemotron' }), (e) => e.codigo === 'modelo_fijado_invalido');
});

// Doble de red completo: listados de ambos proveedores + generación por modelo.
// plan: { claude: {modelo: accion}, gemini: {modelo: accion}, listaClaude, listaGemini }
// accion: 'ok' | 'colgado' | 'sin_saldo' | código HTTP.
function redIA(plan = {}) {
    const llamadas = [];
    const f = async (url, init) => {
        const u = String(url);
        if (u.startsWith('https://api.anthropic.com/v1/models')) {
            llamadas.push('anthropic:(listado)');
            if (typeof plan.listaClaude === 'number') return respuesta(plan.listaClaude, '');
            return respuesta(200, { data: plan.listaClaude ?? LISTA_CLAUDE, has_more: false }, 'application/json');
        }
        if (u.startsWith('https://generativelanguage.googleapis.com/v1beta/models?')) {
            llamadas.push('gemini:(listado)');
            if (typeof plan.listaGemini === 'number') return respuesta(plan.listaGemini, '');
            return respuesta(200, { models: plan.listaGemini ?? LISTA_GEMINI }, 'application/json');
        }
        let proveedor;
        let modelo;
        if (u === 'https://api.anthropic.com/v1/messages') { proveedor = 'claude'; modelo = JSON.parse(init.body).model; }
        else { proveedor = 'gemini'; modelo = decodeURIComponent(u.match(/models\/([^:]+):/)[1]); }
        llamadas.push(`${proveedor === 'claude' ? 'anthropic' : 'gemini'}:${modelo}`);
        const accion = plan[proveedor]?.[modelo] ?? 'ok';
        if (accion === 'colgado') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        if (accion === 'sin_saldo') return respuesta(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } });
        if (typeof accion === 'number') return respuesta(accion, '');
        return proveedor === 'claude'
            ? respuesta(200, mensajeClaude(`ok-${modelo}`), 'application/json')
            : respuesta(200, [{ candidates: [{ content: { parts: [{ text: `ok-${modelo}` }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }], 'application/json');
    };
    f.llamadas = llamadas;
    return f;
}
const ENV_AMBAS = { ANTHROPIC_API_KEY: KEY, GEMINI_API_KEY: KEY_G };
const conRed = (red, extra = {}) => ({ env: ENV_AMBAS, fetchImpl: red, cachePath: cacheTmp(), breakerPath: breakerTmp(), sleep: sinEspera, primerByteMs: 30, ...extra });

test('cadena: Claude sano responde primero (Opus más reciente) y Gemini ni siquiera se lista', async () => {
    const red = redIA();
    const r = await P.llamarModelo(MSG, conRed(red));
    assert.equal(`${r.proveedor}:${r.modelo}`, 'anthropic:claude-opus-5-5');
    assert.equal(r.failover, null);
    assert.deepEqual(red.llamadas, ['anthropic:(listado)', 'anthropic:claude-opus-5-5']);
    const rapido = await P.llamarModelo(MSG, conRed(redIA(), { tarea: 'rapido' }));
    assert.equal(rapido.modelo, 'claude-sonnet-5-5');
});

test('cadena: Opus sin primer byte → 1 intento contenido y pasa a Sonnet (misma familia)', async () => {
    const red = redIA({ claude: { 'claude-opus-5-5': 'colgado' } });
    const opciones = conRed(red);
    const r = await P.llamarModelo(MSG, opciones);
    assert.equal(r.modelo, 'claude-sonnet-5-5');
    assert.deepEqual(r.failover, { desde: 'anthropic:claude-opus-5-5', hacia: 'anthropic:claude-sonnet-5-5', fallos: ['anthropic:claude-opus-5-5=timeout_sin_respuesta'] });
    const bpOpus = P.rutaBreakerModelo(opciones.breakerPath, P.configModelo('anthropic', 'claude-opus-5-5', ENV_AMBAS));
    assert.equal(P.leerBreaker(bpOpus).fallos_consecutivos, 1, 'la falla queda en el breaker propio de Opus');
});

test('cadena: Claude sin saldo → salta DIRECTO a Gemini (no gasta intentos en Sonnet con la misma cuenta)', async () => {
    const red = redIA({ claude: { 'claude-opus-5-5': 'sin_saldo', 'claude-sonnet-5-5': 'sin_saldo' } });
    const r = await P.llamarModelo(MSG, conRed(red));
    assert.equal(`${r.proveedor}:${r.modelo}`, 'gemini:gemini-3.1-pro-preview');
    assert.deepEqual(red.llamadas, ['anthropic:(listado)', 'anthropic:claude-opus-5-5', 'gemini:(listado)', 'gemini:gemini-3.1-pro-preview']);
    assert.equal(r.failover.fallos[0], 'anthropic:claude-opus-5-5=http_400_sin_saldo');
});

test('cadena: key de Claude revocada (401) → salta a Gemini; el listado con 401 también', async () => {
    const r = await P.llamarModelo(MSG, conRed(redIA({ claude: { 'claude-opus-5-5': 401 } })));
    assert.equal(r.proveedor, 'gemini');
    const red2 = redIA({ listaClaude: 401 });
    const r2 = await P.llamarModelo(MSG, conRed(red2));
    assert.equal(r2.proveedor, 'gemini');
    assert.equal(r2.failover.fallos[0], 'anthropic:(catálogo)=listado_http_401_auth');
});

test('cadena: sin key de Claude, Gemini es el primario sin aviso ni llamadas a Anthropic', async () => {
    const red = redIA();
    const r = await P.llamarModelo(MSG, conRed(red, { env: { GEMINI_API_KEY: KEY_G } }));
    assert.equal(r.proveedor, 'gemini');
    assert.equal(r.failover, null);
    assert.ok(!red.llamadas.some(l => l.startsWith('anthropic')));
});

test('cadena: todos caídos → error del último con el recorrido completo; solo el último eslabón reintenta', async () => {
    const red = redIA({
        claude: { 'claude-opus-5-5': 503, 'claude-sonnet-5-5': 503 },
        gemini: { 'gemini-3.1-pro-preview': 503, 'gemini-2.5-flash': 503 },
    });
    await assert.rejects(P.llamarModelo(MSG, conRed(red)), (e) => {
        assert.equal(e.codigo, 'http_503');
        assert.match(e.detalle, /cadena: anthropic:claude-opus-5-5=http_503, anthropic:claude-sonnet-5-5=http_503, gemini:gemini-3.1-pro-preview=http_503, gemini:gemini-2.5-flash=http_503/);
        return true;
    });
    assert.equal(red.llamadas.filter(m => m === 'gemini:gemini-2.5-flash').length, 3);
    assert.equal(red.llamadas.filter(m => m === 'anthropic:claude-opus-5-5').length, 1);
});

test('cadena: breaker de Opus abierto → se salta al instante, sin red hacia Opus', async () => {
    const opciones = conRed(redIA());
    const bpOpus = P.rutaBreakerModelo(opciones.breakerPath, P.configModelo('anthropic', 'claude-opus-5-5', ENV_AMBAS));
    P.escribirBreaker(bpOpus, { ...P.BREAKER_DEFAULT, estado: 'abierto', fallos_consecutivos: 3, abierto_desde: new Date().toISOString(), categoria_apertura: 'caida', modelo: 'anthropic:claude-opus-5-5', ultimo_error: { codigo: 'http_503', categoria: 'caida', huella_key: P.huellaKey(KEY) } });
    const r = await P.llamarModelo(MSG, opciones);
    assert.equal(r.modelo, 'claude-sonnet-5-5');
    assert.ok(!opciones.fetchImpl.llamadas.includes('anthropic:claude-opus-5-5'));
    assert.equal(r.failover.fallos[0], 'anthropic:claude-opus-5-5=circuito_abierto');
});

test('breaker atado al modelo: un circuito abierto por OTRO modelo no bloquea al actual (regresión en vivo 2026-10-04)', async () => {
    const bp = breakerTmp();
    P.escribirBreaker(bp, { ...P.BREAKER_DEFAULT, estado: 'abierto', fallos_consecutivos: 3, abierto_desde: new Date().toISOString(), categoria_apertura: 'caida', modelo: 'anthropic:claude-otro', ultimo_error: { codigo: 'timeout_sin_respuesta', categoria: 'caida', huella_key: P.huellaKey(KEY) } });
    const r = await llamar({ fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: bp });
    assert.equal(r.modelo, MODELO);
    const b = P.leerBreaker(bp);
    assert.equal(b.estado, 'cerrado');
    assert.equal(b.modelo, `anthropic:${MODELO}`, 'el breaker queda etiquetado con su modelo');
    const breakers = P.breakersDe(path.join(path.dirname(bp), 'circuit_breaker.json'));
    assert.ok(Array.isArray(breakers));
});

test('caché del descubrimiento: dentro del TTL no se vuelve a listar; rotar la key fuerza un listado nuevo', async () => {
    const cachePath = cacheTmp();
    const red = redIA();
    await P.llamarModelo(MSG, conRed(red, { cachePath }));
    await P.llamarModelo(MSG, conRed(red, { cachePath }));
    assert.equal(red.llamadas.filter(l => l === 'anthropic:(listado)').length, 1, 'segunda llamada sale de la caché');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.ok(cache.anthropic.modelos.length > 0);
    assert.ok(!JSON.stringify(cache).includes(KEY), 'la caché guarda huella, nunca la key');
    const envB = { ...ENV_AMBAS, ANTHROPIC_API_KEY: 'sk-ant-api03-ROTADA_zyxwvutsrqponmlkjihgfedcba98765' };
    await P.llamarModelo(MSG, conRed(red, { cachePath, env: envB }));
    assert.equal(red.llamadas.filter(l => l === 'anthropic:(listado)').length, 2);
});

test('caché del descubrimiento: TTL vencido + listado caído → usa la caché vencida; listado con 401 NO la usa', async () => {
    const cachePath = cacheTmp();
    let t = Date.parse('2026-10-08T00:00:00Z');
    await P.llamarModelo(MSG, conRed(redIA(), { cachePath, ahora: () => t }));
    t += 25 * 3600 * 1000;
    const caido = redIA({ listaClaude: 503 });
    const r = await P.llamarModelo(MSG, conRed(caido, { cachePath, ahora: () => t }));
    assert.equal(r.modelo, 'claude-opus-5-5', 'caché vencida antes que perder la familia');
    assert.equal((await P.catalogo('anthropic', { env: ENV_AMBAS, fetchImpl: redIA({ listaClaude: 503 }), cachePath, ahora: () => t })).origen, 'cache_vencida');
    await assert.rejects(P.catalogo('anthropic', { env: ENV_AMBAS, fetchImpl: redIA({ listaClaude: 401 }), cachePath, ahora: () => t }), (e) => e.categoria === 'auth');
});

test('sondearModelos: lista el catálogo real de cada familia y hace ping a cada modelo que alguna tarea elegiría', async () => {
    const red = redIA({ claude: { 'claude-haiku-4-5': 503 } });
    const { resultados, descubiertos } = await P.sondearModelos({ env: ENV_AMBAS, fetchImpl: red, cachePath: cacheTmp() });
    assert.equal(descubiertos.anthropic.modelos[0], 'claude-opus-5-5');
    assert.equal(descubiertos.gemini.origen, 'descubierto');
    const porModelo = Object.fromEntries(resultados.map(r => [r.modelo, r]));
    assert.equal(porModelo['anthropic:claude-opus-5-5'].vivo, true);
    assert.deepEqual(porModelo['anthropic:claude-sonnet-5-5'].tareas, ['razonamiento', 'rapido']);
    assert.equal(porModelo['anthropic:claude-haiku-4-5'].vivo, false);
    assert.ok(porModelo['gemini:gemini-2.5-flash-lite']);
    const sinGemini = await P.sondearModelos({ env: { ANTHROPIC_API_KEY: KEY }, fetchImpl: redIA(), cachePath: cacheTmp() });
    assert.deepEqual(sinGemini.descubiertos.gemini, { key_configurada: false, modelos: [] });
});

// ---------------------------------------------------------------------------
// FinOps (ADR-0004 §2.6): tarifa por gama, uso real, COP con TRM configurable
// ---------------------------------------------------------------------------

test('FinOps: SSE sin uso reportado → estimación volumétrica marcada estimado:true, costo Sonnet > 0', async () => {
    const partes = [textoA('a'.repeat(310)), finA('end_turn'), STOP_A];
    const msg = { system: 's'.repeat(155), user: 'u'.repeat(155), max_tokens: 100 };
    const r = await P.llamarProveedor(CFG, msg, { env: ENV, fetchImpl: fetchSecuencia([respuestaSSE(partes)]), breakerPath: breakerTmp(), sleep: sinEspera });
    assert.deepEqual(r.uso, { prompt_tokens: 100, completion_tokens: 100, estimado: true, caracteres_por_token: P.CARACTERES_POR_TOKEN_DEFAULT });
    assert.equal(r.costo.estimado, true);
    assert.equal(r.costo.cop, Number((((100 * 3 + 100 * 15) / 1e6) * P.TRM_COP_USD_DEFAULT).toFixed(2)));
});

test('FinOps: el uso real del proveedor se respeta (no se sobreescribe con la estimación)', async () => {
    const r = await llamar({ fetchImpl: fetchSecuencia([respuesta(200, OK_BODY)]), breakerPath: breakerTmp() });
    assert.deepEqual(r.uso, { prompt_tokens: 10, completion_tokens: 5 });
    assert.equal(r.costo.estimado, false);
});

test('FinOps: tarifa por gama (un modelo nuevo hereda la de su gama), LLM_TARIFAS_USD la reemplaza, TRM configurable', () => {
    const uso = { prompt_tokens: 1_000_000, completion_tokens: 100_000 };
    const sonnet = { proveedor: 'anthropic', modelo: 'claude-sonnet-4-6' };
    assert.deepEqual(P.costoEnCOP(uso, sonnet, { TRM_COP_USD: '4000' }), { usd: 4.5, cop: 18000, trm: 4000, estimado: false });
    assert.equal(P.costoEnCOP(uso, { proveedor: 'anthropic', modelo: 'claude-sonnet-9-9' }, { TRM_COP_USD: '4000' }).cop, 18000, 'versión futura de la gama');
    assert.equal(P.costoEnCOP(uso, { proveedor: 'anthropic', modelo: 'claude-opus-5-5' }, { TRM_COP_USD: '4000' }).usd, 7.5);
    assert.equal(P.costoEnCOP(uso, { proveedor: 'gemini', modelo: 'gemini-2.5-flash' }, { TRM_COP_USD: '4000' }).usd, 0.8);
    assert.equal(P.costoEnCOP(uso, sonnet, { TRM_COP_USD: 'abc' }).trm, P.TRM_COP_USD_DEFAULT);
    assert.equal(P.costoEnCOP(uso, { proveedor: 'anthropic', modelo: 'claude-fable-1-0' }, {}).motivo, 'tarifa_desconocida');
    const override = { LLM_TARIFAS_USD: JSON.stringify({ 'claude-fable-1-0': { entrada: 1, salida: 1 }, sonnet: { entrada: 0, salida: 0 } }) };
    assert.equal(P.costoEnCOP(uso, { proveedor: 'anthropic', modelo: 'claude-fable-1-0' }, override).usd, 1.1);
    assert.equal(P.costoEnCOP(uso, sonnet, override).usd, 0);
    assert.equal(P.costoEnCOP(uso, sonnet, { LLM_TARIFAS_USD: '{roto' }).usd, 4.5, 'JSON inválido no rompe: tarifa por defecto');
    assert.equal(P.estimarUso({ system: 'x'.repeat(30), user: '', texto: 'y'.repeat(30) }, { LLM_CARACTERES_POR_TOKEN: '3' }).prompt_tokens, 10);
    assert.equal(P.estimarUso({ system: 'x', user: '', texto: '' }, { LLM_CARACTERES_POR_TOKEN: '99' }).caracteres_por_token, P.CARACTERES_POR_TOKEN_DEFAULT);
    assert.equal(P.costoEnCOP(null, sonnet, {}), null);
});

test('FinOps: el razonamiento del modelo cuenta como tokens de salida en la estimación', () => {
    const u = P.estimarUso({ system: '', user: '', texto: 'z'.repeat(31), razonamientoChars: 310 }, {});
    assert.equal(u.completion_tokens, Math.ceil(341 / P.CARACTERES_POR_TOKEN_DEFAULT));
});

// ---------------------------------------------------------------------------
// Supresión de proveedores externos (ADR-0004 §2.1, punto 4 de la orden)
// ---------------------------------------------------------------------------

test('la capa no conoce ningún proveedor externo: sin endpoints, keys ni rutas de NIM/OpenRouter/Groq/DeepSeek', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', '..', 'agents', 'gate-proveedor.cjs'), 'utf8')
        // El filtro de secretos detecta keys de cualquier vendor en un diff (seguridad), no las usa.
        .replace(/const PATRONES_REDACCION = \[[\s\S]*?\n\];/, '');
    for (const prohibido of ['integrate.api.nvidia.com', 'NVIDIA_API_KEY', 'openrouter.ai', 'OPENROUTER_API_KEY', 'api.groq.com', 'GROQ_API_KEY', 'api.deepseek.com', 'GATE_PROVIDER', 'GATE_FALLBACK_CHAIN']) {
        assert.ok(!fuente.includes(prohibido), `quedó "${prohibido}" en gate-proveedor.cjs`);
    }
    assert.deepEqual(Object.keys(P.BASE_URLS), ['anthropic', 'gemini']);
    assert.ok(!('CADENA_NIM_DEFAULT' in P) && !('NIM_BASE_URL_OFICIAL' in P) && !('resolverConfig' in P));
});

// ---------------------------------------------------------------------------
// R2 (2026-10-12, directiva PMUI) — el PMU valida la key contra el proveedor
// ---------------------------------------------------------------------------

// Doble por URL: el listado de Anthropic y el de Gemini responden distinto.
function fetchPorProveedor({ anthropic, gemini }) {
    const llamadas = [];
    const fn = async (url, init) => {
        llamadas.push({ url, init });
        const r = String(url).includes('anthropic') ? anthropic : gemini;
        if (r instanceof Error) throw r;
        return r;
    };
    fn.llamadas = llamadas;
    return fn;
}
const LISTADO_OK_A = respuesta(200, { data: [{ id: 'claude-sonnet-5-5', created_at: '2026-06-01T00:00:00Z' }], has_more: false });
const LISTADO_OK_G = respuesta(200, { models: [{ name: 'models/gemini-3-pro', supportedGenerationMethods: ['generateContent'] }] });
const GEMINI_KEY_INVALIDA = respuesta(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });

test('R2 validarKeys: HTTP 200 → CONECTADO_Y_VALIDADO; "API key not valid" (400) → ERROR_AUTENTICACION_O_SALDO, nunca "configurada"', async () => {
    const r = await P.validarKeys({ env: { ANTHROPIC_API_KEY: KEY, GEMINI_API_KEY: KEY_G }, fetchImpl: fetchPorProveedor({ anthropic: LISTADO_OK_A, gemini: GEMINI_KEY_INVALIDA }) });
    const de = Object.fromEntries(r.map(v => [v.proveedor, v]));
    assert.equal(de.anthropic.estado, 'CONECTADO_Y_VALIDADO');
    assert.equal(de.anthropic.http, 200);
    assert.equal(de.gemini.estado, 'ERROR_AUTENTICACION_O_SALDO');
    assert.equal(de.gemini.http, 400);
    assert.ok(!JSON.stringify(r).includes(KEY_G) && !JSON.stringify(r).includes(KEY), 'la validación nunca devuelve la key');
});

test('R2 validarKeys: 401/402/403 → ERROR_AUTENTICACION_O_SALDO; timeout/5xx/429 → NO_VERIFICABLE (nunca cuenta como válida); sin key → SIN_KEY', async () => {
    for (const status of [401, 402, 403]) {
        const [a] = await P.validarKeys({ env: { ANTHROPIC_API_KEY: KEY }, fetchImpl: fetchPorProveedor({ anthropic: respuesta(status, { type: 'error', error: { type: 'authentication_error', message: 'x' } }) }) });
        assert.equal(a.estado, 'ERROR_AUTENTICACION_O_SALDO', `HTTP ${status}`);
    }
    for (const r of [respuesta(503, 'overloaded'), respuesta(429, 'rate'), Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })]) {
        const [a] = await P.validarKeys({ env: { ANTHROPIC_API_KEY: KEY }, fetchImpl: fetchPorProveedor({ anthropic: r }) });
        assert.equal(a.estado, 'NO_VERIFICABLE');
    }
    const r = await P.validarKeys({ env: {}, fetchImpl: fetchPorProveedor({}) });
    assert.deepEqual(r.map(v => v.estado), ['SIN_KEY', 'SIN_KEY']);
    const mala = await P.validarKeys({ env: { ANTHROPIC_API_KEY: 'con espacio' }, fetchImpl: fetchPorProveedor({ anthropic: LISTADO_OK_A }) });
    assert.equal(mala[0].estado, 'ERROR_AUTENTICACION_O_SALDO', 'key malformada no se envía y no se da por buena');
});

test('R2 PMU: todas rechazadas/sin key → cadena_ia_operativa=false y bloqueo_duro; una validada → true', () => {
    const validacionKeys = [
        { proveedor: 'anthropic', estado: 'ERROR_AUTENTICACION_O_SALDO', http: 401, codigo: 'listado_http_401_auth' },
        { proveedor: 'gemini', estado: 'ERROR_AUTENTICACION_O_SALDO', http: 400, codigo: 'listado_http_400_auth' },
    ];
    const estado = gate.generarEstadoOperativo({ validacionKeys });
    assert.deepEqual(estado.proveedor_ia.familias.map(f => f.estado_key), ['ERROR_AUTENTICACION_O_SALDO', 'ERROR_AUTENTICACION_O_SALDO']);
    assert.ok(estado.proveedor_ia.familias.every(f => !('key_configurada' in f)), 'la categoría "configurada" ya no existe');
    assert.equal(estado.proveedor_ia.cadena_ia_operativa, false);
    const codigos = estado.alertas_criticas_proveedor.map(a => a.ultimo_error?.codigo);
    assert.ok(codigos.includes('listado_http_400_auth') && codigos.includes('listado_http_401_auth'));
    assert.ok(codigos.includes('cadena_sin_proveedor_validado'));
    assert.ok(estado.alertas_criticas_proveedor.filter(a => ['listado_http_400_auth', 'cadena_sin_proveedor_validado'].includes(a.ultimo_error?.codigo)).every(a => a.efecto === 'bloqueo_duro'));

    const sano = gate.generarEstadoOperativo({ validacionKeys: [{ proveedor: 'anthropic', estado: 'CONECTADO_Y_VALIDADO', http: 200, codigo: 'ok' }, { proveedor: 'gemini', estado: 'SIN_KEY', http: null, codigo: 'sin_key' }] });
    assert.equal(sano.proveedor_ia.cadena_ia_operativa, true);
    assert.ok(!sano.alertas_criticas_proveedor.some(a => ['cadena_sin_proveedor_validado', 'cadena_indeterminada'].includes(a.ultimo_error?.codigo)));
});

// H3 (auditoría cruzada 008): sin red no es bloqueo duro — es la condición
// de soft-fail con opt-in; el PMU no puede afirmar un bloqueo que no ocurre.
test('H3 PMU: alguna NO_VERIFICABLE y ninguna validada → cadena indeterminada (null), alerta soft_fail_con_opt_in, nunca bloqueo_duro de cadena', () => {
    const estado = gate.generarEstadoOperativo({ validacionKeys: [
        { proveedor: 'anthropic', estado: 'NO_VERIFICABLE', http: null, codigo: 'listado_timeout' },
        { proveedor: 'gemini', estado: 'ERROR_AUTENTICACION_O_SALDO', http: 400, codigo: 'listado_http_400_auth' },
    ] });
    assert.equal(estado.proveedor_ia.cadena_ia_operativa, null);
    const codigos = estado.alertas_criticas_proveedor.map(a => a.ultimo_error?.codigo);
    assert.ok(!codigos.includes('cadena_sin_proveedor_validado'));
    const ind = estado.alertas_criticas_proveedor.find(a => a.ultimo_error?.codigo === 'cadena_indeterminada');
    assert.equal(ind?.efecto, 'soft_fail_con_opt_in');

    // Caso real 2026-10-12: Claude sin saldo (cuota) + Gemini key inválida (auth).
    const real = gate.generarEstadoOperativo({ validacionKeys: [
        { proveedor: 'anthropic', estado: 'ERROR_AUTENTICACION_O_SALDO', http: 400, codigo: 'http_400_sin_saldo', categoria: 'cuota' },
        { proveedor: 'gemini', estado: 'ERROR_AUTENTICACION_O_SALDO', http: 400, codigo: 'listado_http_400_auth', categoria: 'auth' },
    ] });
    assert.equal(real.proveedor_ia.cadena_ia_operativa, null, 'sin saldo es soft-fail con opt-in, igual que en el gate — no bloqueo duro');
    assert.ok(!real.alertas_criticas_proveedor.some(a => a.ultimo_error?.codigo === 'cadena_sin_proveedor_validado'));
    // modelo null = alerta de la validación de keys (las de breaker llevan modelo).
    const saldo = real.alertas_criticas_proveedor.find(a => a.modelo === null && a.ultimo_error?.codigo === 'http_400_sin_saldo');
    assert.equal(saldo.efecto, 'soft_fail_con_opt_in');
    assert.match(saldo.accion, /recargar/);
    assert.ok(!/reemplazarla|fuera de la cadena/.test(saldo.accion), 'sin saldo no es "reemplazar la key" ni "fuera de la cadena"');
    const auth = real.alertas_criticas_proveedor.find(a => a.modelo === null && a.ultimo_error?.codigo === 'listado_http_400_auth');
    assert.equal(auth.efecto, 'bloqueo_duro');
});

// H2 (auditoría cruzada 008): --check-gate/--aprobar-* regeneran el PMU sin
// sonda; heredan la última validación vigente (24 h) en vez de pisarla.
test('H2 PMU: sin validación en la corrida hereda la última vigente con su fecha; vencida o ausente → NO_VERIFICADO y cadena null', () => {
    const ruta = gate.RUTAS_ESTADO.VALIDACION_KEYS_PATH;
    assert.ok(ruta.startsWith(SANDBOX.dir), 'la validación persistida vive en el sandbox');
    const original = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : null;
    const ahora = Date.parse('2026-10-12T12:00:00Z');
    try {
        fs.writeFileSync(ruta, JSON.stringify({ validado_en: '2026-10-12T08:00:00Z', resultados: [{ proveedor: 'anthropic', estado: 'CONECTADO_Y_VALIDADO', http: 200, codigo: 'ok' }, { proveedor: 'gemini', estado: 'ERROR_AUTENTICACION_O_SALDO', http: 400, codigo: 'listado_http_400_auth' }] }));
        const heredado = gate.generarEstadoOperativo({ ahora });
        assert.equal(heredado.proveedor_ia.cadena_ia_operativa, true);
        assert.equal(heredado.proveedor_ia.familias[0].validacion_key.validado_en, '2026-10-12T08:00:00Z', 'la fecha de la validación queda visible');

        const vencido = gate.generarEstadoOperativo({ ahora: ahora + 25 * 3600 * 1000 });
        assert.equal(vencido.proveedor_ia.cadena_ia_operativa, null);
        assert.ok(vencido.proveedor_ia.familias.every(f => ['NO_VERIFICADO', 'SIN_KEY'].includes(f.estado_key)));

        const sinHerencia = gate.generarEstadoOperativo({ ahora, heredarValidacion: false });
        assert.equal(sinHerencia.proveedor_ia.cadena_ia_operativa, null);
        assert.ok(Object.values(P.ESTADOS_KEY).includes('NO_VERIFICADO'), 'NO_VERIFICADO es un estado declarado, no un literal suelto');
    } finally {
        if (original === null) fs.rmSync(ruta, { force: true });
        else fs.writeFileSync(ruta, original, 'utf8');
    }
});

// H4 (auditoría cruzada 008): un 400 que no es de auth/cuota (ej.
// FAILED_PRECONDITION de Gemini) no se reporta como "reemplace la key".
test('H4 validarKeys: HTTP 400 por política/precondición → NO_VERIFICABLE, no ERROR_AUTENTICACION_O_SALDO', async () => {
    const precondicion = respuesta(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } });
    const [, g] = await P.validarKeys({ env: { GEMINI_API_KEY: KEY_G }, fetchImpl: fetchPorProveedor({ gemini: precondicion }) });
    assert.equal(g.estado, 'NO_VERIFICABLE');
    assert.equal(P.keyRechazada({ http: 400, categoria: 'cuota' }), true);
    assert.equal(P.keyRechazada({ http: 429, categoria: 'cuota' }), false);
});

test('R3/R4 invariante final (proveedor): esta suite tampoco tocó el estado real de agents/', () => {
    assert.deepEqual(huellaEstadoReal(), SANDBOX.huellaInicial);
});

// ---------------------------------------------------------------------------
// Omega (2026-10-12, directiva PMUI): familia con key rechazada fuera de la
// cadena — el fallo transitorio del primario no termina en el auth del respaldo
// ---------------------------------------------------------------------------

test('Omega familiasRechazadas: solo excluye si la key actual es la MISMA que se rechazó (rotarla la reincorpora)', () => {
    const h = (k) => P.huellaKey(k);
    const resultados = [
        { proveedor: 'anthropic', estado: 'CONECTADO_Y_VALIDADO', huella_key: h(KEY) },
        { proveedor: 'gemini', estado: 'ERROR_AUTENTICACION_O_SALDO', categoria: 'auth', huella_key: h(KEY_G) },
    ];
    assert.deepEqual(P.familiasRechazadas(resultados, ENV_AMBAS), ['gemini']);
    assert.deepEqual(P.familiasRechazadas([{ proveedor: 'anthropic', estado: 'ERROR_AUTENTICACION_O_SALDO', categoria: 'cuota', huella_key: h(KEY) }], ENV_AMBAS), [], 'sin saldo NO excluye: sigue siendo soft-fail con opt-in');
    assert.deepEqual(P.familiasRechazadas(resultados, { ...ENV_AMBAS, GEMINI_API_KEY: 'AIzaKEYNUEVA_rotada_0123456789abcdef' }), [], 'key rotada → vuelve a la cadena');
    assert.deepEqual(P.familiasRechazadas([{ proveedor: 'gemini', estado: 'ERROR_AUTENTICACION_O_SALDO', categoria: 'auth' }], ENV_AMBAS), [], 'sin huella no excluye');
    assert.deepEqual(P.familiasRechazadas(null, ENV_AMBAS), []);
});

test('Omega cadena: Gemini excluido + Claude caído → el error final es el de Claude (caída, elegible a soft-fail) y Gemini no recibe ni una llamada', async () => {
    const red = redIA({ claude: { 'claude-opus-5-5': 503, 'claude-sonnet-5-5': 503 } });
    await assert.rejects(P.llamarModelo(MSG, conRed(red, { familiasExcluidas: ['gemini'] })), (e) => {
        assert.equal(e.codigo, 'http_503');
        assert.ok(P.esElegibleSoftFail(e), 'una caída del primario sigue siendo soft-fail con opt-in, no bloqueo duro por el auth del respaldo');
        return true;
    });
    assert.ok(!red.llamadas.some(l => l.startsWith('gemini:')), JSON.stringify(red.llamadas));
});

test('Omega cadena: Claude sano con Gemini excluido responde igual; todas excluidas → todas_las_keys_rechazadas (auth, bloqueo duro)', async () => {
    const r = await P.llamarModelo(MSG, conRed(redIA(), { familiasExcluidas: ['gemini'] }));
    assert.equal(r.proveedor, 'anthropic');
    await assert.rejects(P.llamarModelo(MSG, conRed(redIA(), { familiasExcluidas: ['anthropic', 'gemini'] })), (e) => {
        assert.equal(e.codigo, 'todas_las_keys_rechazadas');
        assert.equal(e.categoria, 'auth');
        assert.ok(!P.esElegibleSoftFail(e));
        return true;
    });
});

test('Omega validarKeys: devuelve huella_key para la exclusión, pero el PMU generado con ella no la expone', async () => {
    const r = await P.validarKeys({ env: ENV_AMBAS, fetchImpl: fetchPorProveedor({ anthropic: LISTADO_OK_A, gemini: GEMINI_KEY_INVALIDA }) });
    assert.equal(r.find(v => v.proveedor === 'gemini').huella_key, P.huellaKey(KEY_G));
    const estado = gate.generarEstadoOperativo({ validacionKeys: r });
    assert.ok(!JSON.stringify(estado).includes(P.huellaKey(KEY_G)), 'el PMU no lleva la huella');
});

// Caso real 2026-10-12: el listado de Anthropic dio 200 con la cuenta sin
// saldo y el PMU marcó CONECTADO_Y_VALIDADO; la firma de 002 falló con
// "credit balance is too low". La sonda de saldo lo detecta.
test('Omega sondaSaldo: listado 200 + cuenta sin saldo → ERROR_AUTENTICACION_O_SALDO (no un falso CONECTADO_Y_VALIDADO)', async () => {
    const env = { ANTHROPIC_API_KEY: KEY };
    const sinSonda = await P.validarKeys({ env, fetchImpl: redIA({ claude: { 'claude-haiku-4-5': 'sin_saldo' } }) });
    assert.equal(sinSonda[0].estado, 'CONECTADO_Y_VALIDADO', 'precondición: el listado solo no ve el saldo');

    const red = redIA({ claude: { 'claude-haiku-4-5': 'sin_saldo' } });
    const [a] = await P.validarKeys({ env, fetchImpl: red, sondaSaldo: true });
    assert.equal(a.estado, 'ERROR_AUTENTICACION_O_SALDO');
    assert.equal(a.codigo, 'http_400_sin_saldo');
    assert.deepEqual(red.llamadas, ['anthropic:(listado)', 'anthropic:claude-haiku-4-5'], 'una sola llamada real, al modelo más barato, sin reintentos');

    const [ok] = await P.validarKeys({ env, fetchImpl: redIA(), sondaSaldo: true });
    assert.equal(ok.estado, 'CONECTADO_Y_VALIDADO');
    assert.equal(ok.codigo, 'ok_con_saldo');
});
