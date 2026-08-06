# Stitch Downloader - Script de respaldo
# Guarda datos de Stitch para uso offline

const STITCH_PROJECT_ID = "10249799146991044094";
const OUTPUT_DIR = "./bitacora/stitch-data/";

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function saveScreenData(screenId, data, filename) {
    const dir = path.join(__dirname, '..', OUTPUT_DIR);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`✅ Guardado: ${filepath}`);
    return filepath;
}

// Guardar datos del proyecto
const projectData = {
    projectId: STITCH_PROJECT_ID,
    screenId: "de3d87db2fbf4e6eb0d30e7a7405699b",
    savedAt: new Date().toISOString(),
    note: "Necesita Stitch_get_screen para obtener HTML completo"
};

saveScreenData(null, projectData, "project-info.json");

console.log("\n📋 Para descargar screens de Stitch:");
console.log("1. Abre Stitch UI");
console.log("2. Ve al proyecto:", STITCH_PROJECT_ID);
console.log("3. Exporta cada screen como HTML");
console.log("4. Guarda en:", OUTPUT_DIR);