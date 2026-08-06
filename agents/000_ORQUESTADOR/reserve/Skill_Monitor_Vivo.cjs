const fs = require("fs");
const path = "./logs/actividad_segundo_plano.log";

function registrarPulso() {
    const ahora = new Date().toLocaleString();
    const log = `[${ahora}] - AGENTE 00: Vigilancia activa. Slots controlados. Personal en posición.\n`;
    fs.appendFileSync(path, log);
    console.log("💓 Pulso de Agente 00 registrado con éxito.");
}

// Ejecución inmediata y cada 30 segundos
registrarPulso();
setInterval(registrarPulso, 30000);
