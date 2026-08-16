const fs = require('fs');
const path = require('path');

function procesarDocumentoPestana2(rutaDocumento, contextoReferencia = {}) {
    const ext = path.extname(rutaDocumento).toLowerCase();
    const fecha = new Date().toISOString();
    
    const metadata = {
        archivo: path.basename(rutaDocumento),
        fechaProcesamiento: fecha,
        tipo: getTipoDocumento(ext),
        extension: ext,
        estado: 'procesado',
        fuente: 'Pestaña #2 (Soporte)'
    };

    console.log(`\n📄 OCR SOPORTE - Procesando: ${metadata.archivo}`);
    console.log(`📅 Fecha: ${fecha}`);
    console.log(`📁 Tipo: ${metadata.tipo}`);

    return {
        metadata,
        contextoReferencia: Object.assign({}, contextoReferencia, metadata)
    };
}

function getTipoDocumento(ext) {
    const tipos = {
        '.pdf': 'Documento PDF',
        '.doc': 'Word Document',
        '.docx': 'Word Document',
        '.txt': 'Texto plano',
        '.xls': 'Excel',
        '.xlsx': 'Excel',
        '.jpg': 'Imagen',
        '.jpeg': 'Imagen',
        '.png': 'Imagen'
    };
    return tipos[ext] || 'Desconocido';
}

function extraerDatosTecnicos(directorioSoporte) {
    if (!fs.existsSync(directorioSoporte)) {
        console.log(`⚠️ Directorio no encontrado: ${directorioSoporte}`);
        return { error: 'Directorio no existe' };
    }

    const archivos = fs.readdirSync(directorioSoporte).filter(f => 
        ['.pdf', '.doc', '.docx', '.txt'].includes(path.extname(f).toLowerCase())
    );

    const datosExtraidos = [];
    
    archivos.forEach(archivo => {
        const resultado = procesarDocumentoPestana2(path.join(directorioSoporte, archivo));
        datosExtraidos.push(resultado);
    });

    console.log(`\n✅ Se procesaron ${datosExtraidos.length} documentos de soporte.`);
    return datosExtraidos;
}

const ruta = process.argv[2] || './SOPORTE';
const action = process.argv[3] || 'procesar';

if (action === 'procesar') {
    procesarDocumentoPestana2(ruta);
} else if (action === 'extraer') {
    extraerDatosTecnicos(ruta);
}