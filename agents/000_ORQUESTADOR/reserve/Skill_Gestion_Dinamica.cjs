const fs = require("fs");
console.log("🛰️ ANTIGRAVITY OS: Cuartel General Operativo.");
function vigilar() {
    const log = `[${new Date().toLocaleString()}] - AGENTE 00: Slots monitoreados. Sistema Frío.\n`;
    fs.appendFileSync("./logs/actividad_segundo_plano.log", log);
}
vigilar();
setInterval(vigilar, 60000);
