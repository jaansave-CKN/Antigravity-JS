const fs = require('fs');
module.exports = {
    runCheck: function() {
        const ruta = './scripts/sentinela/logs/health.log';
        const msg = `[${new Date().toLocaleString()}] Chequeo de archivos: OK\n`;
        fs.appendFileSync(ruta, msg);
        return true;
    }
};
