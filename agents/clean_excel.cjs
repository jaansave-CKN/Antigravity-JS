const fs = require('fs');

const RUTA_DEFAULT = 'C:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales\\municipios.json';

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): antes
// SOBRESCRIBÍA un archivo real (municipios.json, fuera del árbol de git)
// apenas se cargaba el módulo — requerirlo desde cualquier otro script
// mutaba datos reales sin ninguna confirmación. Ahora solo corre bajo
// invocación directa (`node agents/clean_excel.cjs [ruta]`).
function limpiarJSON(rutaJSON = RUTA_DEFAULT) {
    const data = require(rutaJSON);
    const cleaned = data.map(row => {
        const newRow = {};
        for (const key in row) {
            if (!key.startsWith('__EMPTY') && row[key] !== "") {
                newRow[key] = row[key];
            } else if (key.startsWith('__EMPTY') && row[key] && row[key] !== "") {
                newRow[key] = row[key];
            }
        }
        return newRow;
    });
    const validRecords = cleaned.filter(r => Object.keys(r).length > 0);
    console.log(`Registros totales: ${cleaned.length}`);
    console.log("Muestra de los primeros 5 registros válidos:");
    console.log(JSON.stringify(validRecords.slice(0, 5), null, 2));
    fs.writeFileSync(rutaJSON, JSON.stringify(validRecords, null, 2));
    console.log(`Archivo limpiado guardado exitosamente. Ahora tiene ${validRecords.length} registros válidos.`);
    return validRecords;
}

if (require.main === module) {
    limpiarJSON(process.argv[2] || RUTA_DEFAULT);
}

module.exports = { limpiarJSON };
