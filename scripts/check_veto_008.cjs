#!/usr/bin/env node
// check_veto_008.cjs — "Guillotina CI/CD" (Fase 2, orden explícita del
// usuario 2026-08-13): checks deterministas, sin costo de API, que corren
// en CI como el nodo de barrera final de 008_AUDITOR_DE_CODIGO. Vetan el
// pipeline (exit 1) si detectan, en los archivos .sql que cambió el commit/PR:
//   1. Una función RPC con parámetro p_tenant_id cuyo cuerpo nunca filtra
//      por tenant_id (fuga de aislamiento multi-tenant).
//   2. Una función que hace INSERT (crea registros nuevos) sin ningún
//      mecanismo de idempotencia/concurrencia detectable (idempotency_key,
//      ON CONFLICT, OCC con hash esperado, o lock FOR UPDATE).
//   3. La cadena "USD" en cualquier archivo .sql o .js tocado — divisa
//      distinta a COP.
//
// Son heurísticas de texto, no un parser SQL real — documentado así a
// propósito (mismo criterio de honestidad que el resto del gate: mejor un
// chequeo simple y explicado que uno que finge más precisión de la que
// tiene). Si da un falso positivo real, la salida dice exactamente qué
// patrón faltó, para que se pueda corregir el código o (si de verdad es un
// falso positivo) ajustar la heurística — nunca silenciarla sin corregirla.
//
// Uso: node scripts/check_veto_008.cjs [--base <git-ref>]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dirRoot = path.join(__dirname, '..');

function obtenerBase() {
    const idx = process.argv.indexOf('--base');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    if (process.env.CHECK_VETO_BASE) return process.env.CHECK_VETO_BASE;
    return 'HEAD~1';
}

function archivosTocados(base) {
    try {
        return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: dirRoot, encoding: 'utf8' })
            .split('\n').map(l => l.trim()).filter(Boolean);
    } catch (e) {
        // Base inexistente (ej. primer commit del repo, o shallow clone sin
        // ese ref) — no bloquear el pipeline por un problema de git, solo
        // avisar que no se pudo evaluar el diff.
        console.warn(`[check_veto_008] No se pudo diferenciar contra '${base}': ${e.message}. Sin veto por esta corrida.`);
        return [];
    }
}

function extraerFuncionesSQL(sql) {
    const regex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\(([^;]*?)\)\s*RETURNS[\s\S]*?\$(?:BODY)?\$([\s\S]*?)\$(?:BODY)?\$/gi;
    const funciones = [];
    let m;
    while ((m = regex.exec(sql)) !== null) {
        funciones.push({ nombre: m[1], params: m[2], cuerpo: m[3] });
    }
    return funciones;
}

// Funciones exentas por convención de nombre ya establecida en este
// proyecto: "registrar_*" son logs/auditoría append-only (ej.
// registrar_violacion_seguridad, registrar_version_hash) — su tenant_id es
// contextual/opcional por diseño (DEFAULT NULL) y duplicados son eventos
// distintos válidos, no un recurso que la idempotencia deba proteger.
function esFuncionDeAuditoria(nombre) {
    return /^registrar_/i.test(nombre);
}

function verificarSQL(archivo, contenido, hallazgos) {
    const funciones = extraerFuncionesSQL(contenido);
    for (const fn of funciones) {
        if (fn.nombre.toLowerCase() === 'set_tenant_context') continue; // es el mecanismo en sí, no un consumidor
        if (esFuncionDeAuditoria(fn.nombre)) continue;

        // Solo cuenta como "requiere tenant_id" si el parámetro es obligatorio
        // (sin DEFAULT) — un p_tenant_id opcional es contextual, no un
        // requisito de aislamiento que esta función deba cumplir.
        const tenantParamMatch = fn.params.match(/p_tenant_id\s+UUID(\s+DEFAULT\s+\w+)?/i);
        const tenantEsRequerido = tenantParamMatch && !tenantParamMatch[1];
        if (tenantEsRequerido) {
            const filtraPorTenant = /tenant_id\s*=\s*p_tenant_id/i.test(fn.cuerpo) || /set_tenant_context\s*\(/i.test(fn.cuerpo);
            if (!filtraPorTenant) {
                hallazgos.push({
                    archivo, funcion: fn.nombre, tipo: 'fuga_multi_tenant',
                    razon: `recibe p_tenant_id obligatorio pero su cuerpo no filtra por 'tenant_id = p_tenant_id' ni llama a set_tenant_context() — posible fuga de aislamiento entre tenants.`,
                });
            }
        }
        const haceInsert = /INSERT\s+INTO/i.test(fn.cuerpo);
        if (haceInsert) {
            const tieneMecanismoResiliencia = /idempotency_key|ON\s+CONFLICT|expected_hash|version_hash|FOR\s+UPDATE/i.test(fn.cuerpo);
            if (!tieneMecanismoResiliencia) {
                hallazgos.push({
                    archivo, funcion: fn.nombre, tipo: 'sin_idempotencia',
                    razon: `hace INSERT (crea registros) sin ningún mecanismo de idempotencia/concurrencia detectado (idempotency_key, ON CONFLICT, OCC con hash, o FOR UPDATE).`,
                });
            }
        }
    }
    if (/\bUSD\b/.test(contenido)) {
        hallazgos.push({ archivo, funcion: null, tipo: 'divisa_no_cop', razon: `contiene la cadena "USD" — este proyecto opera exclusivamente en COP.` });
    }
}

function verificarJS(archivo, contenido, hallazgos) {
    if (/\bUSD\b/.test(contenido)) {
        hallazgos.push({ archivo, funcion: null, tipo: 'divisa_no_cop', razon: `contiene la cadena "USD" — este proyecto opera exclusivamente en COP.` });
    }
}

function main() {
    const base = obtenerBase();
    const archivos = archivosTocados(base).filter(f => fs.existsSync(path.join(dirRoot, f)));
    const hallazgos = [];

    for (const archivo of archivos) {
        const ext = path.extname(archivo);
        const contenido = fs.readFileSync(path.join(dirRoot, archivo), 'utf8');
        if (ext === '.sql') verificarSQL(archivo, contenido, hallazgos);
        else if (ext === '.js' || ext === '.jsx' || ext === '.cjs') verificarJS(archivo, contenido, hallazgos);
    }

    if (hallazgos.length === 0) {
        console.log(`✅ [008_AUDITOR_DE_CODIGO · veto CI] Sin hallazgos sobre ${archivos.length} archivo(s) evaluado(s) (base: ${base}).`);
        process.exitCode = 0;
        return;
    }

    console.error(`\n🛑 [008_AUDITOR_DE_CODIGO · VETO] ${hallazgos.length} hallazgo(s) bloqueante(s):\n`);
    for (const h of hallazgos) {
        console.error(`   [${h.tipo}] ${h.archivo}${h.funcion ? ` :: ${h.funcion}()` : ''}`);
        console.error(`     ${h.razon}\n`);
    }
    process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { extraerFuncionesSQL, verificarSQL, verificarJS, archivosTocados };
