const fs = require('fs');

function formularProyecto(datosRaw) {
    const fecha = new Date().toLocaleDateString();
    
    const entrega = `
==================================================
        ESTRUCTURACIÓN DE PROYECTO TÉCNICO
==================================================
CONSULTOR: Jairo Antonio Salinas Velasco
CÓDIGO DE DOCUMENTO: FORM-2026-${Math.floor(Math.random()*1000)}
FECHA: ${fecha}
--------------------------------------------------

1. DIAGNÓSTICO E IDENTIFICACIÓN
-------------------------------
(Datos extraídos del análisis documental)
${datosRaw.substring(0, 600)}...

2. COMPONENTES TÉCNICOS PROPUESTOS
----------------------------------
> SISTEMA CONSTRUCTIVO: Modular / Híbrido (Propuesta de alta eficiencia)
> MATERIALES BASE: GFRC, Acero Galvanizado, Concreto de alto desempeño.
> DISEÑO: Estructuras de voladizo optimizadas (Sin columnas en circulaciones).

3. PRESUPUESTO ESTIMADO Y VIABILIDAD
------------------------------------
> ANALISIS DE COSTOS: Revisar tablas de dosificación y mercado regional.
> UBICACIÓN ESTRATÉGICA: Identificada en zona de influencia.

4. REQUISITOS PARA FORMULACIÓN FINAL
------------------------------------
* Requiere levantamiento topográfico detallado.
* Definición de presupuesto por ítems (APU).
* Cronograma de ejecución estimado.

==================================================
DOCUMENTO PRELIMINAR PARA CONSULTORÍA TÉCNICA
==================================================
`;
    fs.writeFileSync('PROYECTO_FORMULADO_BORRADOR.txt', entrega);
    console.log(entrega);
}

const input = process.argv.slice(2).join(" ");
formularProyecto(input);
