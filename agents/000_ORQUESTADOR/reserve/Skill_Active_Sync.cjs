const fs = require('fs');
console.log("🛰️ ANTIGRAVITY OS: Vigilancia 24/7 Activada.");

fs.watch('./.agents', { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('IDENTITY.md')) {
        console.log('🔄 Sincronizando Agente: ' + filename);
    }
});
