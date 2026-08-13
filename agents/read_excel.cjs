const xlsx = require('xlsx');
const fs = require('fs');

const EXCEL_PATH_DEFAULT = 'C:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales\\municipios.xlsx';
const JSON_PATH_DEFAULT = 'C:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales\\municipios.json';

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): antes leía y
// sobrescribía archivos reales apenas se cargaba el módulo. Ahora requerirlo
// no dispara nada; solo corre bajo invocación directa
// (`node agents/read_excel.cjs [excel] [json]`).
function excelAJson(excelPath = EXCEL_PATH_DEFAULT, jsonPath = JSON_PATH_DEFAULT) {
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    console.log(`¡Éxito! El archivo Excel ha sido procesado. Contiene ${data.length} registros.`);
    if (data.length > 0) {
        console.log("Muestra de los datos (primeros 2 registros):");
        console.log(JSON.stringify(data.slice(0, 2), null, 2));
    }
    return data;
}

if (require.main === module) {
    try {
        excelAJson(process.argv[2], process.argv[3]);
    } catch (error) {
        console.error("Error al leer el archivo Excel:", error);
        process.exitCode = 1;
    }
}

module.exports = { excelAJson };
