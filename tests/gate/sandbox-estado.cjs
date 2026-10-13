// sandbox-estado.cjs — aislamiento del estado del gate para la suite de tests
// (2026-10-12, hallazgos R3/R4 del diagnóstico PMUI: los tests escribían en
// agents/pmu/telemetria.jsonl y mutaban agents/diseno_aprobado.json y
// agents/veredicto_005.json en caliente; si la corrida moría a mitad, el
// estado de aprobación real quedaba corrupto).
//
// Uso: requerir y llamar prepararSandboxEstado() ANTES de requerir
// agents/architecture-gate.cjs — el gate resuelve GATE_ESTADO_DIR al cargar.
// No es un archivo de test (no matchea los patrones de `node --test`).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR_AGENTS_REAL = path.join(__dirname, '..', '..', 'agents');
const ES_ESTADO_RAIZ = /^(diseno_aprobado|veredicto_\d{3})\.json$/;

// Archivos de estado reales que la suite jamás debe modificar.
function archivosEstadoReal() {
    const out = [];
    for (const f of fs.readdirSync(DIR_AGENTS_REAL)) {
        if (ES_ESTADO_RAIZ.test(f)) out.push(path.join(DIR_AGENTS_REAL, f));
    }
    const pmu = path.join(DIR_AGENTS_REAL, 'pmu');
    if (fs.existsSync(pmu)) {
        for (const f of fs.readdirSync(pmu)) {
            const ruta = path.join(pmu, f);
            if (fs.statSync(ruta).isFile()) out.push(ruta);
        }
    }
    return out.sort();
}

// Huella byte a byte del estado real: { ruta relativa: sha256 }.
function huellaEstadoReal() {
    return Object.fromEntries(archivosEstadoReal().map(ruta => [
        path.relative(DIR_AGENTS_REAL, ruta).replace(/\\/g, '/'),
        crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex'),
    ]));
}

let sandbox = null;

// Crea el sandbox una sola vez por proceso, copia el estado real (solo
// lectura) para que los tests vean los mismos datos, y lo borra al salir.
function prepararSandboxEstado() {
    if (sandbox) return sandbox;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmui-sandbox-'));
    fs.mkdirSync(path.join(dir, 'pmu'), { recursive: true });
    for (const origen of archivosEstadoReal()) {
        fs.copyFileSync(origen, path.join(dir, path.relative(DIR_AGENTS_REAL, origen)));
    }
    process.env.GATE_ESTADO_DIR = dir;
    process.on('exit', () => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* tmp del sistema: limpieza best-effort */ }
    });
    sandbox = { dir, huellaInicial: huellaEstadoReal() };
    return sandbox;
}

module.exports = { prepararSandboxEstado, huellaEstadoReal, archivosEstadoReal, DIR_AGENTS_REAL };
