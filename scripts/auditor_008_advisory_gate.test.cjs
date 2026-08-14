// auditor_008_advisory_gate.test.cjs -- cobertura de las funciones puras del
// paso advisory de 008_AUDITOR_DE_CODIGO en CI (2026-08-13). Corre con:
// node --test scripts/auditor_008_advisory_gate.test.cjs
// No ejecuta ninguna llamada real a la API de Anthropic (ejecutarAuditor008CI
// no se testea end-to-end aqui, mismo criterio que check_veto_008.test.cjs
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
