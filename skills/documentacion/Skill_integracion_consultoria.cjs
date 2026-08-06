const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const fs = require("fs");
const path = require("path");

async function generarEntrega(datosRaw, nombreConsultor, archivoOriginal) {
    const nombreLimpio = path.basename(archivoOriginal, path.extname(archivoOriginal));
    const carpetaProyecto = `ENTREGA_${nombreLimpio}_${Date.now()}`;
    
    // 1. Crear carpeta de entrega
    if (!fs.existsSync(carpetaProyecto)) fs.mkdirSync(carpetaProyecto);

    // 2. Crear el documento Word
    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({ text: "INFORME DE ESTRUCTURACIÓN TÉCNICA", heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
                new Paragraph({ children: [new TextRun({ text: "CONSULTOR: ", bold: true }), new TextRun(nombreConsultor)] }),
                new Paragraph({ text: `PROYECTO: ${nombreLimpio}` }),
                new Paragraph({ text: `FECHA: ${new Date().toLocaleDateString()}` }),
                new Paragraph({ text: "\n1. RESUMEN TÉCNICO", heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: datosRaw.substring(0, 1500) }),
                new Paragraph({ text: "\n2. RECOMENDACIONES DE ARQUITECTO", heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: "Se recomienda el uso de sistemas modulares y estructuras en voladizo para optimizar el área útil y circulaciones." }),
            ],
        }],
    });

    const buffer = await Packer.toBuffer(doc);
    const wordPath = path.join(carpetaProyecto, `Formulacion_Tecnica_${nombreLimpio}.docx`);
    fs.writeFileSync(wordPath, buffer);

    console.log(`\n✅ CARPETA DE ENTREGA CREADA: ${carpetaProyecto}`);
    console.log(`📄 Archivo Word generado: ${path.basename(wordPath)}`);
}

const datos = process.argv[2] || "Sin datos";
const consultor = process.argv[3] || "Jairo Antonio Salinas Velasco";
const origen = process.argv[4] || "Proyecto_Nuevo";
generarEntrega(datos, consultor, origen);
