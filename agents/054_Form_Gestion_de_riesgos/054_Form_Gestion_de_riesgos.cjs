const fs = require('fs');

function analizarRiesgos(sector, ubicacion, contexto) {
    console.log(`\n🛡️ [054] ANALIZANDO RIESGOS PARA: ${sector.toUpperCase()}...`);
    
    let matriz = [
        { riesgo: "Logístico", descripcion: `Dificultad de transporte hacia ${ubicacion}.`, impacto: "Alto", mitigación: "Uso de sistemas modulares livianos para transporte fluvial/rural." },
        { riesgo: "Climático", descripcion: "Retrasos por temporadas de lluvia en la región.", impacto: "Medio", mitigación: "Cronograma de obra ajustado a ciclos climáticos locales." }
    ];

    if (sector.toLowerCase().includes("agrario") || sector.toLowerCase().includes("piscicola")) {
        matriz.push({ riesgo: "Biológico", descripcion: "Plagas o enfermedades en el ciclo productivo.", impacto: "Alto", mitigación: "Protocolos técnicos de monitoreo y asistencia técnica permanente." });
    }

    if (contexto.toLowerCase().includes("madres") || contexto.toLowerCase().includes("social")) {
        matriz.push({ riesgo: "Social", descripcion: "Baja participación comunitaria.", impacto: "Medio", mitigación: "Talleres de socialización y empoderamiento desde la fase 01." });
    }

    const reporte = matriz.map(r => `• ${r.riesgo}: ${r.descripcion}\n  Mitigación: ${r.mitigación}`).join("\n\n");
    
    fs.writeFileSync('MATRIZ_RIESGOS.txt', `MATRIZ DE RIESGOS - ESTRATEGIA ANTIGRAVITY\n\n${reporte}`);
    console.log("✅ Matriz de Riesgos (054) generada con éxito.");
}

const args = process.argv.slice(2);
analizarRiesgos(args[0], args[1], args[2]);
