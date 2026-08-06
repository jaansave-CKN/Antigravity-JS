const fs = require('fs');

const MIS_ESTANDARES = {
    ubicacion_foco: ["Cantagallo", "San Pablo", "Bolívar", "Santander"],
    tecnologia: ["Modular", "GFRC", "Híbrido", "Acero Galvanizado"],
    restricciones_arquitectonicas: ["columna en pasillo", "soporte vertical en corredor"]
};

function validarAnalisis(texto) {
    console.log("\n🔍 EVALUACIÓN TÉCNICA ANTIGRAVITY...");
    
    // Validar ubicación de interés (Bolívar o Santander)
    const ubicacionDetectada = MIS_ESTANDARES.ubicacion_foco.filter(loc => texto.includes(loc));
    if (ubicacionDetectada.length > 0) {
        console.log(`✅ PRIORIDAD ALTA: Proyecto en zona estratégica (${ubicacionDetectada.join(", ")}).`);
    }

    // Validar compatibilidad modular
    if (texto.toLowerCase().includes("modular")) {
        console.log("💎 OPORTUNIDAD: El documento es compatible con sistemas MODULAR BUILDING.");
    }

    // Alerta de diseño (Voladizos libres de columnas)
    if (MIS_ESTANDARES.restricciones_arquitectonicas.some(r => texto.toLowerCase().includes(r))) {
        console.log("⚠️ ALERTA DE DISEÑO: Se detectaron elementos que obstruyen circulaciones. Revisar voladizos.");
    }
}

const textoParaAnalizar = process.argv.slice(2).join(" ");
validarAnalisis(textoParaAnalizar);
