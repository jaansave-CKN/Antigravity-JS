#!/usr/bin/env node
'use strict';
// auditor_008_advisory_gate.cjs -- integra el PROTOCOLO TITAN completo de
// 008_AUDITOR_DE_CODIGO al pipeline de CI, en MODO ADVISORY.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { z } = require('zod');

const dirRoot = path.join(__dirname, '..');
const { extraerJSONConCampo, bucketDe } = require('../agents/architecture-gate.cjs');
// Misma capa de proveedor que el gate 002 (ADR-0004, 2026-10-08): Claude
// primero (Opus → Sonnet más recientes), Gemini de respaldo, modelos
// descubiertos por gama, clasificación de errores y filtro de secretos del
// diff. Sin SDK.
const proveedorIA = require('../agents/gate-proveedor.cjs');

const PROMPT_008_PATH = path.join(dirRoot, '.claude', 'agents', '008-auditor-de-codigo.md');


const SCHEMA_008_CI = z.object({
    apto: z.boolean(),
    score: z.number().min(0).max(100),
    hallazgos_criticos: z.array(z.string()),
});

function validarVeredicto008(veredicto) {
    const resultado = SCHEMA_008_CI.safeParse(veredicto);
    if (resultado.success) return { ok: true };
    const detalle = resultado.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, razon: `El JSON final de 008 no cumple el contrato CI: ${detalle}` };
}

function obtenerBase() {
    const idx = process.argv.indexOf('--base');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    if (process.env.CHECK_VETO_BASE) return process.env.CHECK_VETO_BASE;
    return 'HEAD~1';
}

function diffContraBase(base, limiteChars) {
    let archivos;
    try {
        archivos = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: dirRoot, encoding: 'utf8' })
            .split('\n').map(l => l.trim()).filter(Boolean);
    } catch (e) {
        return { diff: '', archivos: [], truncado: false, error: `No se pudo diferenciar contra '${base}': ${e.message}` };
    }
    if (archivos.length === 0) return { diff: '', archivos: [], truncado: false };

    archivos.sort((a, b) => bucketDe(a) - bucketDe(b));

    let acumulado = '';
    const omitidos = [];
    for (const archivo of archivos) {
        if (acumulado.length >= limiteChars) { omitidos.push(archivo); continue; }
        let diffArchivo;
        try {
            diffArchivo = execFileSync('git', ['diff', `${base}...HEAD`, '--', archivo], { cwd: dirRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        } catch (e) {
            diffArchivo = `[No se pudo leer el diff de ${archivo}: ${e.message}]\n`;
        }
        const espacioRestante = limiteChars - acumulado.length;
        if (diffArchivo.length > espacioRestante) {
            acumulado += diffArchivo.slice(0, espacioRestante) + `\n[... ${archivo} truncado ...]\n`;
            omitidos.push(...archivos.slice(archivos.indexOf(archivo) + 1));
            break;
        }
        acumulado += diffArchivo;
    }
    return { diff: acumulado, archivos, truncado: omitidos.length > 0, omitidos };
}

function construirMensajeUsuario(diff, archivos, truncado, omitidos) {
    const avisoTruncamiento = truncado
        ? `\n\nAVISO: el diff completo no cabia en el presupuesto de caracteres. ` +
          `Fuera: ${omitidos.slice(0, 10).join(', ')}${omitidos.length > 10 ? ` (+${omitidos.length - 10} mas)` : ''}.`
        : '';
    return `Ejecuta tu PROTOCOLO TITAN completo (Capas 0-9, matriz de auditoria, pruebas de ruptura, BLOQUE FINAL) ` +
        `sobre el siguiente diff de un push/PR pendiente de merge (git diff contra la base, ${archivos.length} archivo(s) tocado(s)). ` +
        `IMPORTANTE: esta invocacion es una llamada directa a la API de un modelo (Claude, con Gemini de respaldo) dentro de un pipeline de CI, no una sesion ` +
        `de Claude Code -- NO tienes acceso real a Read/Grep/Glob/Bash pese a lo que indique tu mandato para tu uso habitual. ` +
        `No emitas tool_call, no intentes ejecutar comandos: no se ejecutara nada. Basa tu auditoria exclusivamente en el texto ` +
        `del diff provisto abajo -- para las capas que requieren ejecucion real (arranque de backend, ataques en vivo, simulacion ` +
        `de caos, logs de Render) declara explicitamente que no son verificables desde un diff estatico y trata esa capa como ` +
        `no evaluable, en vez de omitir la capa o inventar evidencia.\n\n` +
        `ADEMAS de tu BLOQUE FINAL narrativo (tal como exige tu protocolo: TOP 15 fallas, SCORE X/100, VEREDICTO, RIESGO, IMPACTO ` +
        `REAL), termina tu respuesta con UN bloque JSON de una sola linea, balanceado, con esta forma EXACTA (este JSON es la ` +
        `unica senal que este pipeline de CI puede parsear automaticamente):\n` +
        `{"apto": true o false, "score": numero 0 a 100 (tu SCORE TOTAL), "hallazgos_criticos": [hasta 5 strings concisos, tus fallas mas criticas del TOP 15]}\n` +
        `"apto" debe ser true unicamente si tu VEREDICTO es APTO 100/100 -- cualquier NO APTO o BLOQUEADO es apto:false, sin ` +
        `excepcion, incluyendo empates o dudas razonables (mismo criterio ZERO TRUST de tu protocolo).\n\n${diff}${avisoTruncamiento}`;
}

// opciones.env / opciones.fetchImpl: inyección para pruebas (mocks de Claude/Gemini).
async function ejecutarAuditor008CI(base, limiteChars = 60000, opciones = {}) {
    const env = opciones.env ?? process.env;
    const conKey = proveedorIA.proveedoresConKey(env);
    if (!conKey.anthropic && !conKey.gemini) {
        return { ejecutado: false, razon: 'Sin ANTHROPIC_API_KEY ni GEMINI_API_KEY -- paso advisory omitido (no bloquea el pipeline).' };
    }
    if (!fs.existsSync(PROMPT_008_PATH)) {
        return { ejecutado: false, razon: `No existe ${PROMPT_008_PATH} -- sin protocolo que aplicar.` };
    }
    const systemPrompt = fs.readFileSync(PROMPT_008_PATH, 'utf8');

    const { diff, archivos, truncado, omitidos, error } = (opciones.diffContraBase ?? diffContraBase)(base, limiteChars);
    if (error) {
        return { ejecutado: false, razon: error };
    }
    if (!diff || !diff.trim()) {
        return { ejecutado: true, sinCambios: true, razon: `Sin diff contra '${base}' -- nada que auditar en esta corrida.` };
    }

    // El diff sale a un tercero: mismo filtro de secretos que el gate 002.
    const { diff: mensajeFiltrado, omitidos: archivosSensibles } =
        proveedorIA.filtrarSecretosDiff(construirMensajeUsuario(diff, archivos, truncado, omitidos));

    let respuesta;
    try {
        respuesta = await proveedorIA.llamarModelo({
            // 16000, no 8192 (hallazgo real 2026-08-13, verificado en vivo con una
            // corrida real contra el repo): el protocolo COMPLETO de 008 (9 capas +
            // matriz de hallazgos + matriz de validaciones + TOP 15 + score + veredicto)
            // es mas verboso que el de 006 (que ya necesito 8192 en su propio hallazgo
            // documentado) -- una corrida real con 8192 se quedo sin espacio antes de
            // emitir el JSON final, resultando en parseable:false pese a un analisis
            // narrativo completo y valido. Mas presupuesto es mas confiable que depender
            // de que el modelo se autolimite (mismo criterio que 006).
            max_tokens: 16000,
            system: systemPrompt,
            user: mensajeFiltrado,
        }, { tarea: 'razonamiento', env, fetchImpl: opciones.fetchImpl, sleep: opciones.sleep });
    } catch (e) {
        const codigo = e instanceof proveedorIA.ErrorProveedor ? ` [${e.categoria}/${e.codigo}]` : '';
        const detalle = proveedorIA.redactar(proveedorIA.redactar(e?.detalle || e?.message || e, proveedorIA.keyDe('anthropic', env)), proveedorIA.keyDe('gemini', env));
        return { ejecutado: false, razon: `Fallo de los proveedores de IA${codigo}: ${detalle}` };
    }

    const text = respuesta.texto ?? '';
    const meta = {
        proveedor: respuesta.proveedor,
        modelo: respuesta.modelo,
        failover: respuesta.failover ? `${respuesta.failover.desde} -> ${respuesta.failover.hacia}` : null,
        uso: respuesta.uso || null,
        costo: respuesta.costo || null,
        archivosSensiblesOmitidos: archivosSensibles,
    };
    const veredicto = extraerJSONConCampo(text, 'apto');
    if (!veredicto) {
        return { ejecutado: true, parseable: false, razon: '008 no devolvio un JSON final parseable con el campo apto.', respuestaCruda: text.slice(0, 4000), textoCompleto: text, archivosAuditados: archivos, meta };
    }
    const forma = validarVeredicto008(veredicto);
    if (!forma.ok) {
        return { ejecutado: true, parseable: false, razon: forma.razon, respuestaCruda: text.slice(0, 4000), textoCompleto: text, archivosAuditados: archivos, meta };
    }
    return { ejecutado: true, parseable: true, veredicto, textoCompleto: text, archivosAuditados: archivos, meta };
}

// FinOps: modelo que respondió, conmutación, tokens y costo en COP.
function lineaModelo(meta) {
    const partes = [`**Modelo**: ${meta.proveedor || 'desconocido'}:${meta.modelo || 'desconocido'}`];
    if (meta.failover) partes.push(`conmutacion ${meta.failover}`);
    if (meta.uso) partes.push(`tokens ${meta.uso.prompt_tokens ?? '?'} in / ${meta.uso.completion_tokens ?? '?'} out${meta.uso.estimado ? ' (estimado)' : ''}`);
    if (meta.costo && typeof meta.costo.cop === 'number') partes.push(`costo COP ${meta.costo.cop}`);
    if (meta.archivosSensiblesOmitidos && meta.archivosSensiblesOmitidos.length) partes.push(`${meta.archivosSensiblesOmitidos.length} archivo(s) sensible(s) no enviado(s)`);
    return partes.join('  |  ');
}

function formatearResumen(resultado) {
    const lineas = [];
    lineas.push('## 008_AUDITOR_DE_CODIGO -- PROTOCOLO TITAN (advisory, no bloqueante)');
    lineas.push('');
    if (!resultado.ejecutado) {
        lineas.push(`_No se pudo ejecutar: ${resultado.razon}_`);
    } else if (resultado.sinCambios) {
        lineas.push(`_${resultado.razon}_`);
    } else if (!resultado.parseable) {
        lineas.push(`**Sin senal accionable**: ${resultado.razon}`);
        if (resultado.meta) lineas.push(lineaModelo(resultado.meta));
        lineas.push('');
        lineas.push('<details><summary>Analisis narrativo completo de 008 (sin JSON final parseable)</summary>');
        lineas.push('');
        lineas.push('```');
        lineas.push(resultado.textoCompleto || '(vacio)');
        lineas.push('```');
        lineas.push('</details>');
    } else {
        const v = resultado.veredicto;
        lineas.push(`**Veredicto**: ${v.apto ? 'APTO' : 'NO APTO -- BLOQUEADO'}  |  **Score**: ${v.score}/100`);
        lineas.push(`**Archivos auditados**: ${(resultado.archivosAuditados || []).length}`);
        if (resultado.meta) lineas.push(lineaModelo(resultado.meta));
        if (v.hallazgos_criticos && v.hallazgos_criticos.length > 0) {
            lineas.push('');
            lineas.push('**Hallazgos criticos:**');
            for (const h of v.hallazgos_criticos) lineas.push(`- ${h}`);
        }
        lineas.push('');
        lineas.push('<details><summary>Analisis narrativo completo (Capas 0-9, BLOQUE FINAL)</summary>');
        lineas.push('');
        lineas.push('```');
        lineas.push(resultado.textoCompleto || '(vacio)');
        lineas.push('```');
        lineas.push('</details>');
    }
    lineas.push('');
    lineas.push('_Modo ADVISORY: este paso NUNCA bloquea el pipeline -- condicion explicita de 002_ARQUITECTO_DE_SOFTWARE. ' +
        'Un veredicto "NO APTO" aqui requiere revision humana, no aborta el build._');
    return lineas.join('\n');
}

async function main() {
    const base = obtenerBase();
    let resultado;
    try {
        resultado = await ejecutarAuditor008CI(base);
    } catch (e) {
        resultado = { ejecutado: false, razon: `Excepcion no controlada en auditor_008_advisory_gate.cjs: ${e.message}` };
    }

    const resumen = formatearResumen(resultado);
    console.log('\n' + resumen + '\n');

    if (process.env.GITHUB_STEP_SUMMARY) {
        try {
            fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + resumen + '\n');
        } catch (e) {
            console.warn(`[auditor_008_advisory_gate] No se pudo escribir GITHUB_STEP_SUMMARY: ${e.message}`);
        }
    }

    process.exitCode = 0;
}

if (require.main === module) main();

module.exports = {
    obtenerBase, diffContraBase, construirMensajeUsuario,
    validarVeredicto008, SCHEMA_008_CI, formatearResumen, ejecutarAuditor008CI, lineaModelo,
};
