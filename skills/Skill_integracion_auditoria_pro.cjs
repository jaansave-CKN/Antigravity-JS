const fs = require('fs');

function auditarProyecto(archivoWordGenerado, datosOriginales) {
    console.log("\n🕵️ INICIANDO AUDITORÍA FORENSE DE PROYECTO...");
    
    let alertas = [];

    // Regla 1: Validar si se mencionó el sistema modular
    if (!datosOriginales.toLowerCase().includes("modular")) {
        alertas.push("⚠️ ADVERTENCIA: El documento no enfatiza el sistema Modular Building.");
    }

    // Regla 2: Validar áreas críticas (Cantagallo / San Pablo)
    const zonas = ["Cantagallo", "San Pablo", "Simití", "Bolívar"];
    const zonaDetectada = zonas.some(z => datosOriginales.includes(z));
    if (!zonaDetectada) {
        alertas.push("ℹ️ NOTA: No se detectó ubicación específica en el sur de Bolívar.");
    }

    // Regla 3: Estándar de circulaciones libres
    if (datosOriginales.toLowerCase().includes("columna")) {
        alertas.push("🚨 ALERTA TÉCNICA: Se mencionan columnas. Revisar diseño para asegurar voladizos libres.");
    }

    if (alertas.length === 0) {
        console.log("✅ AUDITORÍA LIMPIA: El proyecto cumple con los estándares del Consultor.");
    } else {
        console.log("📋 HALLAZGOS PARA REVISIÓN MANUAL:");
        alertas.forEach(a => console.log(a));
    }
}

const texto = process.argv[2] || "";
auditarProyecto("borrador.docx", texto);
