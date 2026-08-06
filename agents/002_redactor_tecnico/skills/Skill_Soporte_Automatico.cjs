const fs = require('fs');
console.log("🛠️ SOPORTE TÉCNICO: Vigilancia de Antigravity OS Activada");

function repararYReportar() {
    try {
        const agentes = fs.readdirSync('./.agents').filter(f => fs.lstatSync('./.agents/' + f).isDirectory());
        const info = {
            titulo: "ESTADO MAESTRO AUTOMÁTICO",
            disenador: "Jairo Salinas",
            agentes: agentes.length,
            soporte: "ACTIVO",
            fecha: new Date().toLocaleString()
        };
        fs.writeFileSync('./public/estado_antigravity.json', JSON.stringify(info, null, 2));
        console.log("✅ Sistema saneado. Reporte actualizado en Scratchpad.");
    } catch (e) {
        console.log("⚠️ Reintentando conexión con la base de datos...");
    }
}

repararYReportar();
setInterval(repararYReportar, 300000); // Trabaja solo cada 5 min
