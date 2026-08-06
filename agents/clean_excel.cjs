const fs = require('fs');
const path = 'C:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales\\municipios.json';
const data = require(path);

// Clean up keys that start with __EMPTY
const cleaned = data.map(row => {
    const newRow = {};
    for (const key in row) {
        if (!key.startsWith('__EMPTY') && row[key] !== "") {
            newRow[key] = row[key];
        } else if (key.startsWith('__EMPTY') && row[key] && row[key] !== "") {
            newRow[key] = row[key]; // Keep if it has data
        }
    }
    return newRow;
});

console.log(`Registros totales: ${cleaned.length}`);
console.log("Muestra de los primeros 5 registros válidos:");
const validRecords = cleaned.filter(r => Object.keys(r).length > 0);
console.log(JSON.stringify(validRecords.slice(0, 5), null, 2));

// Sobrescribir el archivo JSON con los datos limpios
fs.writeFileSync(path, JSON.stringify(validRecords, null, 2));
console.log(`Archivo limpiado guardado exitosamente. Ahora tiene ${validRecords.length} registros válidos.`);
