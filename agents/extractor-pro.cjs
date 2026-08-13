const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const excel = require('exceljs');
const mammoth = require('mammoth');
const officeparser = require('officeparser');

async function extractData(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    console.log(`\n[AG-EXTRACTOR] Procesando: ${path.basename(filePath)}...`);

    try {
        switch (ext) {
            case '.pptx':
                officeparser.parseOffice(filePath, (data, err) => {
                    if (err) return console.error(err);
                    console.log("--- CONTENIDO POWERPOINT ---");
                    console.log(data);
                });
                break;
            case '.pdf':
                const pdfData = await pdf(fs.readFileSync(filePath));
                console.log("--- CONTENIDO PDF ---\n", pdfData.text.substring(0, 1000));
                break;
            case '.xlsx':
            case '.xls':
                const workbook = new excel.Workbook();
                await workbook.xlsx.readFile(filePath);
                console.log("--- ESTRUCTURA EXCEL ---");
                workbook.eachSheet(sheet => console.log(`Hoja: ${sheet.name}`));
                break;
            case '.docx':
                const doc = await mammoth.extractRawText({path: filePath});
                console.log("--- CONTENIDO WORD ---\n", doc.value.substring(0, 1000));
                break;
            default:
                console.log("[ERROR] Formato no reconocido por el Gestor de Datos.");
        }
    } catch (err) {
        console.error("[ERROR CRÍTICO]", err.message);
    }
}

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): el guard de
// process.argv ya evitaba ejecución sin argumento, pero no evitaba que un
// require() con args heredados del proceso padre disparara extractData()
// igual. Ahora solo corre bajo invocación directa.
if (require.main === module) {
    const file = process.argv[2];
    if (file) extractData(file);
}

module.exports = { extractData };
