const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');

// Importaciones con extensión correcta .cjs
const health = require('./modules/healthCheck.cjs'); 
const connectivity = require('./modules/connectionManager.cjs');

const CONFIG = {
    SERVER_URL: 'http://localhost:3000',
    CHECK_INTERVAL: 30000, 
    LOG_PATH: './scripts/sentinela/logs/sentinela.log'
};

console.log("🛡️ [SENTINELA] Agente activo. Sistema en vigilancia proactiva.");

function registrar(msg) {
    const log = `[${new Date().toLocaleString()}] ${msg}\n`;
    if (!fs.existsSync('./scripts/sentinela/logs')) fs.mkdirSync('./scripts/sentinela/logs', {recursive: true});
    fs.appendFileSync(CONFIG.LOG_PATH, log);
    console.log(msg);
}

function monitorear() {
    http.get(CONFIG.SERVER_URL, (res) => {
        if (res.statusCode !== 200) restaurar(`Error Status: ${res.statusCode}`);
    }).on('error', (err) => restaurar(`Servidor Caído: ${err.message}`));

    try {
        health.runCheck();
        connectivity.check();
    } catch (e) {
        registrar(`⚠️ Error en diagnóstico: ${e.message}`);
    }
}

function restaurar(motivo) {
    registrar(`🚨 FALLO: ${motivo}`);
    exec('node server.js', (error) => {
        if (error) registrar(`❌ No se pudo reiniciar: ${error.message}`);
        else registrar("✅ Sistema recuperado automáticamente.");
    });
}

setInterval(monitorear, CONFIG.CHECK_INTERVAL);
