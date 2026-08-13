const sharp = require('sharp');

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): antes hacía I/O
// real (leía una imagen de una ruta personal hardcodeada) apenas se cargaba
// el archivo. Ahora requerirlo no dispara nada; solo corre bajo invocación
// directa (`node agents/check_image.cjs [ruta]`).
async function verMetadataImagen(imagePath) {
    const metadata = await sharp(imagePath).metadata();
    console.log(`Format: ${metadata.format}`);
    console.log(`Dimensions: ${metadata.width}x${metadata.height}`);
    console.log(`Space: ${metadata.space}`);
    console.log(`Channels: ${metadata.channels}`);
    return metadata;
}

if (require.main === module) {
    const imagePath = process.argv[2] || 'C:/Users/Usuario/.gemini/antigravity/brain/47b84cbd-e7e1-415a-8c6a-e22ba6466ddb/media__1777147317039.png';
    verMetadataImagen(imagePath).catch(err => console.error('Error:', err));
}

module.exports = { verMetadataImagen };
