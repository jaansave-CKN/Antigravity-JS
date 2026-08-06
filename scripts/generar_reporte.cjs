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

async function generarReporteAntigravity() {
    const agentsDir = path.join(rootDir, 'agents'); // jerarquía canónica desde 2026-08-04 (antes: '.agents', ya no existe)
    if (!fs.existsSync(agentsDir)) {
        console.error('[GenerarReporte] No existe la carpeta de agentes:', agentsDir);
        return;
    }
    const agentes = fs.readdirSync(agentsDir).filter(f =>
        f !== 'skills' && fs.lstatSync(path.join(agentsDir, f)).isDirectory()
    );
    const reporte = {
        titulo: "REPORTE INTEGRAL ANTIGRAVITY OS",
        disenador: "Jairo Salinas",
        fecha: new Date().toLocaleString(),
        estado: "ONLINE",
        agentes_activos: agentes.length,
        detalles: agentes.map(a => ({ id: a, status: "READY 24/7" }))
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
