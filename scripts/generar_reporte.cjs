const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const rootDir = path.join(__dirname, '..');

let db = null;
try {
    if (!admin.apps.length) {
        const serviceAccount = require(path.join(rootDir, 'serviceAccountKey.json'));
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    db = admin.firestore();
} catch (err) {
    console.warn('[GenerarReporte] serviceAccountKey.json no disponible — el reporte solo se guardará en local:', err.message);
}

// Criterio mínimo verificable de que una carpeta de agente está "definida" (no "operativa" —
// esto es una librería de prompts/skills para uso interactivo, no un runtime; ver
// docs/RADIOGRAFIA_FORENSE_360_2026-08-06.md §4 y docs/analisis_gaps_v1.md A2. Ningún agente
// de agents/ corre como proceso en server.js — "definido" no implica ejecución real.
function inspeccionarAgente(agentsDir, carpeta) {
    const ruta = path.join(agentsDir, carpeta);
    const archivos = fs.readdirSync(ruta, { withFileTypes: true });
    const tieneIdentity = archivos.some(f => f.isFile() && f.name === 'IDENTITY.md');
    const skillsNoVacios = archivos
        .filter(f => f.isFile() && f.name.endsWith('.cjs'))
        .filter(f => fs.statSync(path.join(ruta, f.name)).size > 0);
    // También busca skills dentro de una subcarpeta skills/ (patrón mayoritario en agents/)
    const skillsDir = path.join(ruta, 'skills');
    const skillsAnidados = fs.existsSync(skillsDir)
        ? fs.readdirSync(skillsDir).filter(f => f.endsWith('.cjs') && fs.statSync(path.join(skillsDir, f)).size > 0)
        : [];
    const totalSkills = skillsNoVacios.length + skillsAnidados.length;
    return {
        id: carpeta,
        definido: tieneIdentity && totalSkills > 0,
        tiene_identity: tieneIdentity,
        skills_no_vacios: totalSkills,
    };
}

async function generarReporteAntigravity() {
    const agentsDir = path.join(rootDir, 'agents'); // jerarquía canónica desde 2026-08-04 (antes: '.agents', ya no existe)
    if (!fs.existsSync(agentsDir)) {
        console.error('[GenerarReporte] No existe la carpeta de agentes:', agentsDir);
        return;
    }
    const agentes = fs.readdirSync(agentsDir).filter(f =>
        f !== 'skills' && fs.lstatSync(path.join(agentsDir, f)).isDirectory()
    );
    const detalles = agentes.map(a => inspeccionarAgente(agentsDir, a));
    const reporte = {
        titulo: "REPORTE INTEGRAL ANTIGRAVITY OS",
        disenador: "Jairo Salinas",
        fecha: new Date().toLocaleString(),
        nota: "Inventario de carpetas de agentes (definiciones de prompt/skill para uso interactivo). " +
              "NO implica un proceso en ejecución — ver docs/RADIOGRAFIA_FORENSE_360_2026-08-06.md §4.",
        agentes_definidos: detalles.filter(d => d.definido).length,
        agentes_incompletos: detalles.filter(d => !d.definido).length,
        detalles,
    };

    fs.writeFileSync(path.join(rootDir, 'public', 'estado_antigravity.json'), JSON.stringify(reporte, null, 2));

    if (db) {
        try {
            await db.collection('system_reports').add(reporte);
            console.log('✅ REPORTE GENERADO: Antigravity OS actualizado en Local y Firestore.');
        } catch (err) {
            console.error('[GenerarReporte] Firestore falló, reporte quedó solo en local:', err.message);
        }
    } else {
        console.log('✅ REPORTE GENERADO: Antigravity OS actualizado en Local (Firestore no disponible).');
    }
}

generarReporteAntigravity();
setInterval(generarReporteAntigravity, 600000);
