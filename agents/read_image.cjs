const Tesseract = require('tesseract.js');

const IMAGE_PATH_DEFAULT = 'C:/Users/Usuario/.gemini/antigravity/brain/47b84cbd-e7e1-415a-8c6a-e22ba6466ddb/media__1777147317039.png';

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): antes disparaba
// OCR (proceso pesado, librería nativa) apenas se cargaba el módulo. Ahora
// requerirlo no dispara nada; solo corre bajo invocación directa
// (`node agents/read_image.cjs [ruta]`).
function extraerTexto(imagePath = IMAGE_PATH_DEFAULT) {
    return Tesseract.recognize(imagePath, 'spa', {
        logger: m => console.log(m.status, m.progress),
    }).then(({ data: { text } }) => {
        console.log('--- TEXT EXTRACTED ---');
        console.log(text);
        return text;
    });
}

if (require.main === module) {
    extraerTexto(process.argv[2]).catch(err => console.error('Error extracting text:', err));
}

module.exports = { extraerTexto };
