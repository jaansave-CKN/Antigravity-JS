const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const fs = require("fs");

async function generarBorrador(nombre, tipo, ubicacion, poblacion, presupuesto) {
    const doc = new Document({
        sections: [{
            children: [
                new Paragraph({ text: `PROPUESTA TÉCNICA: ${nombre.toUpperCase()}`, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
                new Paragraph({ text: `UBICACIÓN: ${ubicacion}`, heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: "" }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "NATURALEZA DEL PROYECTO: ", bold: true }),
                        new TextRun(`Estructuración de tipo ${tipo} para beneficio de ${poblacion}.`),
                    ],
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "INVERSIÓN ESTIMADA: ", bold: true }),
                        new TextRun(`$${Number(presupuesto).toLocaleString()} COP (Presupuesto Autónomo).`),
                    ],
                }),
                new Paragraph({ text: "" }),
                new Paragraph({ text: "ESTRATEGIA TÉCNICA ANTIGRAVITY OS:", heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ text: "• Implementación de cimentaciones híbridas y estructuras modulares." }),
                new Paragraph({ text: "• Optimización de circulaciones mediante voladizos sin columnas." }),
            ],
        }],
    });

    const buffer = await Packer.toBuffer(doc);
    const fileName = `./skills/BORRADOR_TECNICO.docx`;
    fs.writeFileSync(fileName, buffer);
    console.log(`\n📄 DOCUMENTO GENERADO: ${fileName}`);
}

const args = process.argv.slice(2);
if(args.length > 0) generarBorrador(args[0], args[1], args[2], args[3], args[4]);
