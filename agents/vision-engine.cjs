const fs = require('fs');
const Tesseract = require('tesseract.js');

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): antes leía
// ag_vision_config.json y podía matar el proceso PADRE con process.exit(1)
// apenas se cargaba el módulo, si ese archivo no existía en el cwd de quien
// lo requiriera — el peor tipo de efecto secundario de un require(). Ahora
// requerirlo no dispara nada; solo corre bajo invocación directa
// (`node agents/vision-engine.cjs <imagen>`).
function cargarConfig() {
    if (!fs.existsSync('ag_vision_config.json')) {
        throw new Error('No se encuentra ag_vision_config.json');
    }
    return JSON.parse(fs.readFileSync('ag_vision_config.json', 'utf8'));
}

async function processImage(imagePath, config) {
    console.log(`\n[ANTIGRAVITY-VISION] Modo: ${config.config.mode}`);
    console.log(`[FILE] Analizando: ${imagePath}...`);
    try {
        const result = await Tesseract.recognize(imagePath, 'spa+eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    process.stdout.write(`\r[PROGRESO] ${Math.round(m.progress * 100)}%`);
                }
            },
        });
        console.log("\n\n--- TEXTO DETECTADO ---");
        console.log(result.data.text);
        console.log("-----------------------\n");
        if (config.config.capabilities.format_output === "markdown_table") {
            console.log("[SISTEMA] Listo para convertir a tabla técnica.");
        }
        return result.data.text;
    } catch (err) {
        console.error("\n[ERROR] Fallo en la visión:", err.message);
        throw err;
    }
}

if (require.main === module) {
    const imagePath = process.argv[2];
    if (imagePath) {
        try {
            processImage(imagePath, cargarConfig()).catch(() => { process.exitCode = 1; });
        } catch (err) {
            console.error("Error:", err.message);
            process.exitCode = 1;
        }
    } else {
        console.log("Uso: node vision-engine.js NOMBRE_DE_LA_IMAGEN.png");
    }
}

module.exports = { processImage, cargarConfig };
