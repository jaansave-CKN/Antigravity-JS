const fs = require('fs');
const Tesseract = require('tesseract.js');

// 1. Cargar la configuración de Antigravity
if (!fs.existsSync('ag_vision_config.json')) {
    console.error("Error: No se encuentra ag_vision_config.json");
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync('ag_vision_config.json', 'utf8'));

// 2. Función Maestra de Procesamiento
async function processImage(imagePath) {
    console.log(`\n[ANTIGRAVITY-VISION] Modo: ${config.config.mode}`);
    console.log(`[FILE] Analizando: ${imagePath}...`);
    
    try {
        const result = await Tesseract.recognize(imagePath, 'spa+eng', {
            logger: m => {
                if(m.status === 'recognizing text') {
                    process.stdout.write(`\r[PROGRESO] ${Math.round(m.progress * 100)}%`);
                }
            }
        });

        console.log("\n\n--- TEXTO DETECTADO ---");
        console.log(result.data.text);
        console.log("-----------------------\n");
        
        if (config.config.capabilities.format_output === "markdown_table") {
            console.log("[SISTEMA] Listo para convertir a tabla técnica.");
        }
    } catch (err) {
        console.error("\n[ERROR] Fallo en la visión:", err.message);
    }
}

// 3. Capturar el archivo desde la terminal
const path = process.argv[2];
if (path) { 
    processImage(path); 
} else { 
    console.log("Uso: node vision-engine.js NOMBRE_DE_LA_IMAGEN.png"); 
}
