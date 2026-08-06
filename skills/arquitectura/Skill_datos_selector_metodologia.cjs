const fs = require('fs');

function configurarMetodologia(formato, sector, problema) {
    console.log(`\n🧠 CONFIGURANDO LOGICA METODOLOGICA: ${formato.toUpperCase()}`);
    
    let guia = "";

    if (formato.includes("MGA") || formato.includes("Cadena de Valor")) {
        guia = `ESTRATEGIA MGA (Inversión Pública):
- Identificación: Análisis del Problema -> ${problema}
- Preparación: Análisis de Mercado y Localización técnica.
- Evaluación: VPN Social y Tasa Social de Descuento.
- Programación: Indicadores de producto y gestión asociados al sector ${sector}.`;
    } 
    else if (formato.includes("Marco Lógico") || formato.includes("Arbol")) {
        guia = `ESTRATEGIA MARCO LÓGICO:
- Árbol de Problemas: Raíz en ${problema}.
- Árbol de Objetivos: Transformación de causas en medios.
- Matriz de Planificación: Fines, Propósito, Componentes y Actividades.`;
    }

    fs.writeFileSync('METODOLOGIA_PROYECTO.txt', guia);
    console.log("✅ Guía Metodológica generada para el Agente 00.");
}

const args = process.argv.slice(2);
configurarMetodologia(args[0], args[1], args[2]);
