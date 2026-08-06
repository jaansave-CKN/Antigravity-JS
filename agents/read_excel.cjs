const xlsx = require('xlsx');
const fs = require('fs');

const excelPath = 'C:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales\\municipios.xlsx';
const jsonPath = 'C:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales\\municipios.json';

try {
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Parse sheet to JSON
    const data = xlsx.utils.sheet_to_json(sheet, { defval: "" });
    
    // Save to JSON file
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    
    console.log(`¡Éxito! El archivo Excel ha sido procesado. Contiene ${data.length} registros.`);
    
    // Muestra una muestra de los primeros 2 registros para ver las columnas
    if (data.length > 0) {
        console.log("Muestra de los datos (primeros 2 registros):");
        console.log(JSON.stringify(data.slice(0, 2), null, 2));
    }
} catch (error) {
    console.error("Error al leer el archivo Excel:", error);
}
