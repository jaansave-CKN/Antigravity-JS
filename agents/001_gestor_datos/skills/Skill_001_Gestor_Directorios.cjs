const fs = require('fs');
const path = require('path');

function crearEstructura(nombreProyecto, tipo) {
    const fecha = new Date().toISOString().split('T')[0];
    const nombreLimpio = nombreProyecto.replace(/[^a-z0-9]/gi, '_').toUpperCase();
    const rutaRaiz = `./PROYECTOS_FORMULADOS/${nombreLimpio}_${fecha}`;

    const subcarpetas = [
        '01_PRESUPUESTO_EXPERTO', 
        '02_MEMORIAS_TECNICAS',
        '03_PLANOS_Y_RENDERS',
        '04_LEGAL_Y_SOPORTES'
    ];

    if (!fs.existsSync('./PROYECTOS_FORMULADOS')) fs.mkdirSync('./PROYECTOS_FORMULADOS');
    if (!fs.existsSync(rutaRaiz)) {
        fs.mkdirSync(rutaRaiz);
        subcarpetas.forEach(sub => fs.mkdirSync(path.join(rutaRaiz, sub)));
        
        // Crear un archivo de texto con el resumen de la ficha técnica
        const resumen = `PROYECTO: ${nombreProyecto}\nTIPO: ${tipo}\nFECHA: ${fecha}\nESTADO: En Formulación`;
        fs.writeFileSync(path.join(rutaRaiz, 'RESUMEN_EJECUTIVO.txt'), resumen);
        
        console.log(`\n📂 ESTRUCTURA CREADA EN: ${rutaRaiz}`);
    } else {
        console.log("\n⚠️ La carpeta ya existe.");
    }
}

const nombre = process.argv[2] || "Nuevo_Proyecto";
const tipo = process.argv[3] || "General";
crearEstructura(nombre, tipo);
