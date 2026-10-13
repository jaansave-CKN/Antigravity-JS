// skills.test.cjs — invariantes del inventario de skills (2026-10-12,
// directiva PMUI, hallazgo R6): importar una skill nunca escribe archivos,
// el registro solo apunta a archivos que existen, y nada en cuarentena se
// cuela en una sección activa.
// Corre con: node --test tests/gate/skills.test.cjs

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const REGISTRO = path.join(ROOT, 'skills', 'ag_skills_registry.json');
const CUARENTENA = path.join(ROOT, 'skills', '_quarantine', '2026-10-12');
const registro = () => JSON.parse(fs.readFileSync(REGISTRO, 'utf8'));
const sha = (ruta) => crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');

// Requiere el módulo en un proceso aparte con cwd en un directorio temporal
// vacío; devuelve lo que haya quedado escrito ahí.
function requerirAislado(ruta) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-require-'));
    try {
        const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(ruta)})`], { cwd, encoding: 'utf8', timeout: 30000 });
        return { status: r.status, stderr: r.stderr, escritos: fs.readdirSync(cwd) };
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
}

function archivosActivos(r) {
    const files = [];
    const visitar = (n) => {
        if (Array.isArray(n)) return n.forEach(visitar);
        if (n && typeof n === 'object') {
            if (typeof n.file === 'string' && n.status !== 'EN_CUARENTENA') files.push(n.file);
            Object.values(n).forEach(visitar);
        }
    };
    [r.agent_mappings, r.transversal_skills_cjs, r.global_skills, r.global_skills_auto_discovered].forEach(visitar);
    return files;
}

test('registro: toda entrada activa apunta a un archivo que existe y ninguna a _quarantine/', () => {
    const activos = archivosActivos(registro());
    assert.ok(activos.length > 0);
    const inexistentes = activos.filter(f => !fs.existsSync(path.join(ROOT, f)));
    assert.deepEqual(inexistentes, []);
    assert.deepEqual(activos.filter(f => f.includes('_quarantine/')), []);
});

test('registro: cada entrada en cuarentena existe en disco y conserva su ruta de origen', () => {
    const q = registro().cuarentena_2026_10_12;
    assert.equal(q.status, 'EN_CUARENTENA');
    for (const s of q.skills) {
        assert.ok(fs.existsSync(path.join(ROOT, s.file)), s.file);
        assert.ok(s.origen && !fs.existsSync(path.join(ROOT, s.origen)), `${s.origen} no debe seguir activo`);
    }
});

test('R6: requerir cualquier skill .cjs/.js activa no escribe archivos ni toca el registro', () => {
    const antes = sha(REGISTRO);
    const modulos = [...new Set(archivosActivos(registro()).filter(f => /\.(cjs|js)$/.test(f)))].concat('skills/sync_registry.cjs');
    for (const f of modulos) {
        const r = requerirAislado(path.join(ROOT, f));
        assert.equal(r.status, 0, `${f}: ${r.stderr}`);
        assert.deepEqual(r.escritos, [], `${f} escribió al ser requerido`);
    }
    assert.equal(sha(REGISTRO), antes, 'ninguna skill puede modificar ag_skills_registry.json al ser requerida');
});

// Toda .cjs.disabled de la cuarentena (H7, auditoría cruzada 008): requerirla
// no escribe nada; las que tienen bloque CLI lo llevan tras la guarda.
test('R6: toda skill .cjs en cuarentena es inerte al requerirse (no escribe, no falla)', () => {
    const disabled = [];
    (function recorrer(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const ruta = path.join(dir, e.name);
            if (e.isDirectory() && e.name !== 'agents-skills-md') recorrer(ruta);
            else if (e.name.endsWith('.cjs.disabled')) disabled.push(ruta);
        }
    })(CUARENTENA);
    assert.equal(disabled.length, 10, 'precondición: 7 de skills/ + 3 de agents/skills/');
    for (const ruta of disabled) {
        const r = requerirAislado(ruta);
        assert.equal(r.status, 0, `${path.basename(ruta)}: ${r.stderr}`);
        assert.deepEqual(r.escritos, [], `${path.basename(ruta)} escribió al ser requerido`);
        const fuente = fs.readFileSync(ruta, 'utf8');
        if (/process\.argv/.test(fuente)) assert.match(fuente, /require\.main === module/, `${path.basename(ruta)} lee argv sin guarda`);
    }
});

test('R6: sync_registry no fija la fecha de migración con un literal', () => {
    const fuente = fs.readFileSync(path.join(ROOT, 'skills', 'sync_registry.cjs'), 'utf8');
    assert.ok(!/last_migration\s*=\s*['"]\d{4}-/.test(fuente), 'last_migration debe salir de la fecha real de la sincronización');
    assert.match(fuente, /require\.main === module/);
});
