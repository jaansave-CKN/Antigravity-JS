const fs = require('fs');

function generarMemoriaJustificativa(presupuestoReal) {
    console.log("\n📄 GENERANDO MEMORIA TÉCNICA DE CANTIDADES...");
    
    const memoria = `
==================================================
        MEMORIA JUSTIFICATIVA DE CANTIDADES
==================================================
PROYECTO: Formulación Técnica Modular
FORMULADOR: Jairo Antonio Salinas Velasco

JUSTIFICACIÓN DE ACTIVIDADES:
Las actividades descritas en el presupuesto adjunto corresponden a un modelo de construcción industrializada. 
Se priorizan los ítems de ensamble seco y estructuras metálicas galvanizadas para garantizar la durabilidad en zonas como Bolívar y Santander.

ANÁLISIS DE CANTIDADES:
Las cantidades han sido calculadas bajo el estándar de optimización de desperdicio cero, propio del sistema MODULART.
Cada ítem refleja la realidad operativa de campo según la experiencia del formulador.

==================================================
`;
    fs.writeFileSync('MEMORIA_TECNICA.txt', memoria);
    console.log("✅ Memoria generada. Lista para adjuntar al proyecto.");
}

// Guarda 2026-10-12 (directiva PMUI, R6): importar este módulo escribía
// MEMORIA_TECNICA.txt en el cwd; ahora solo corre invocado con node.
if (require.main === module) {
    const pInput = process.argv[2] || "Presupuesto Real";
    try {
        generarMemoriaJustificativa(pInput);
    } catch (e) {
        console.error(`🛑 Skill_002_Generador_Anexos falló: ${e.message}`);
        process.exitCode = 1;
    }
}

module.exports = { generarMemoriaJustificativa };
