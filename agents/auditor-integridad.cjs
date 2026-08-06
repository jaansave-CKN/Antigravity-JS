const fs = require('fs');
const path = require('path');

const estructuraRequerida = {
    "Raíz": ["bridge-server.cjs", "index.html", "package.json"],
    "skills": [
        "consultor-pro.cjs", 
        "cost-analyst.cjs", 
        "gestor-carpetas.cjs", 
        "redactor-universal.cjs",
        "selector-metodologia.cjs"
    ],
    "agents": [
        "000_orquestador_maestro.cjs",
        "054-gestion-riesgos.cjs",
        "055-analista-financiero.cjs"
    ]
};

console.log("🔍 INICIANDO AUDITORÍA DE INTEGRIDAD - ANTIGRAVITY OS");
console.log("====================================================");

let faltantes = 0;

for (const [directorio, archivos] of Object.entries(estructuraRequerida)) {
    const rutaDir = directorio === "Raíz" ? "." : directorio;
    console.log(`\n📁 Revisando ${directorio}...`);
    
    archivos.forEach(archivo => {
        const rutaCompleta = path.join(rutaDir, archivo);
        if (fs.existsSync(rutaCompleta)) {
            const stats = fs.statSync(rutaCompleta);
            console.log(` ✅ ${archivo.padEnd(30)} [OK] (${stats.size} bytes)`);
        } else {
            console.log(` ❌ ${archivo.padEnd(30)} [FALTANTE]`);
            faltantes++;
        }
    });
}

console.log("\n====================================================");
if (faltantes === 0) {
    console.log("🚀 ¡SISTEMA ÍNTEGRO! Todas las piezas están en su lugar.");
    console.log("El Agente 00 está listo para la Fase 056 (Evaluador).");
} else {
    console.log(`⚠️ ATENCIÓN: Faltan ${faltantes} componente(s).`);
    console.log("Revisa los pasos anteriores para completar la instalación.");
}
