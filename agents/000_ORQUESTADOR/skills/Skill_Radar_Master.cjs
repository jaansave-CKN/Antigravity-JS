/**
 * RADAR_MASTER_LOGIC V2.0 
 * Optimizado para: Jairo Salinas (Arquitecto Constructor)
 * Función: Control de Semáforo y Refresco Selectivo de Propuestas.
 */

const RadarMaster = {
    // 1. SEMÁFORO DE RIESGO (1-10)
    calcularSemaforo: (snapshot) => {
        let nivelDificultad = 1;
        const texto = snapshot.toLowerCase();

        const criterios = [
            { clave: "póliza de cumplimiento 100%", peso: 3 },
            { clave: "experiencia en el exterior", peso: 2 },
            { clave: "patrimonio neto", peso: 2 },
            { clave: "consorcio", peso: 1 },
            { clave: "visita técnica obligatoria", peso: 1 }
        ];

        criterios.forEach(item => {
            if (texto.includes(item.clave)) nivelDificultad += item.peso;
        });

        // Bonificación por sector estratégico (Baja dificultad)
        if (texto.includes("saneamiento") || texto.includes("modular")) nivelDificultad -= 1;

        return Math.max(1, Math.min(nivelDificultad, 10));
    },

    // 2. SHAKER DE IDEAS 7/3 (REFRESCO SELECTIVO)
    shakerIdeas: (todasLasIdeas, idsBloqueados) => {
        const ideasAncladas = todasLasIdeas.filter(idea => idsBloqueados.includes(idea.id));
        const cuposLibres = 10 - ideasAncladas.length;

        return {
            mantenidas: ideasAncladas,
            pendientes: cuposLibres,
            instruccion_base: "Generar propuestas técnica con enfoque en Infraestructura Modular y Saneamiento Básico."
        };
    }
};

module.exports = RadarMaster;