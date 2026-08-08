const fs = require('fs');
const path = require('path');

const config = {
    owner: "Jairo Antonio Salinas Velasco",
    company: "Asfáltica S.A.S.",
    mcp_enabled: true,
    root_path: path.join(__dirname, '..', '..')
};

function checkIntegrity() {
    const required = ['architecture-gate.cjs'];
    required.forEach(file => {
        const p = path.join(config.root_path, 'agents', file);
        if (!fs.existsSync(p)) console.log(`⚠️ Falta: ${file}`);
    });
}

module.exports = { config, checkIntegrity };