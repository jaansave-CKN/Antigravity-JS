/**
 * SKILL: MATRIZ_MAESTRA_SECTORES
 * Jerarquía de 4 categorías con 3 niveles de etiquetado
 * Nivel 1: Categoría Principal
 * Nivel 2: Sector
 * Nivel 3: Subsector
 */

const MatrizSectores = {
    version: "2.0",
    fechaActualizacion: "2026-05-15",

    // Categoría 1: Hábitat y Territorio
    "Hábitat y Territorio": {
        Construcción: ["obra civil", "edificación", "infraestructura", "construcción", "remodelación", "rehabilitación"],
        Vivienda: ["vivienda", "housin", "habitación", "residencial", "asentamientos", "urbanización"],
        Transporte: ["vial", "transporte", "carretera", "puente", "túnel", "aeropuerto", "puerto", "logística"],
        Ordenamiento: ["urbanismo", "ordenamiento", "planificación", "catastro", "spatial", "territorio"]
    },

    // Categoría 2: Soberanía y Vida
    "Soberanía y Vida": {
        Agua: ["agua", "potable", "hidráulica", "riego", "recurso hídrico"],
        Saneamiento: ["saneamiento", "alcantarillado", "residual", "tratamiento", "sanitario"],
        Salud: ["salud", "hospital", "clínica", "médico", "sanitario", "epidemiología"],
        "Medio Ambiente": ["ambiente", "medio ambiente", "ecología", "sostenible", "verde"],
        Riesgos: ["riesgo", "desastre", "gestión riesgo", "contingencia", "emergencia"]
    },

    // Categoría 3: Paz y Sociedad
    "Paz y Sociedad": {
        DDHH: ["derechos humanos", "ddhh", "justicia social", "equidad"],
        Cultura: ["cultura", "patrimonio", "artist", "cultural", "museum"],
        Deporte: ["deporte", "recreación", "athlete", "olímpico"],
        "Justicia": ["justicia", "judicial", "legal", "tribunal", "fiscal"],
        "Ayuda Humanitaria": ["humanitario", "ayuda", "emergencia", "refugio", "asistencia"]
    },

    // Categoría 4: Autonomía Económica
    "Autonomía Económica": {
        "Agro": ["agricultura", "agro", "ganadería", "campo", "agrícola"],
        "Desarrollo Rural": ["rural", "desarrollo rural", "campo", "vereda", "agropecuario"],
        Turismo: ["turismo", "hotel", "recreativo", "travel"],
        Emprendimiento: ["emprendimiento", "pyme", "empresa", "negocio", "startup"]
    },

    // Categoría 5: Futuro y Conocimiento
    "Futuro y Conocimiento": {
        Educación: ["educación", "escuela", "universidad", "formación", "docencia"],
        Ciencia: ["ciencia", "investigación", "research", "laboratorio"],
        Tecnologías: ["tecnología", "tech", "digital", "innovación", "ia", "software"],
        "Energías Renovables": ["energía", "renovable", "solar", "eólica", "green", "sostenible"]
    },

    // Método principal de etiquetado
    etiquetar: (texto) => {
        const t = texto.toLowerCase();
        const etiquetas = { nivel1: null, nivel2: null, nivel3: [], coincided: [] };

        for (const [categoria, sectores] of Object.entries(MatrizSectores)) {
            if (categoria === "version" || categoria === "fechaActualizacion") continue;

            for (const [sector, palabras] of Object.entries(sectores)) {
                for (const palabra of palabras) {
                    if (t.includes(palabra)) {
                        if (!etiquetas.nivel1) etiquetas.nivel1 = categoria;
                        if (!etiquetas.nivel2) etiquetas.nivel2 = sector;
                        etiquetas.nivel3.push(palabra);
                        etiquetas.coincided.push({ categoria, sector, palabra });
                    }
                }
            }
        }

        return {
            tieneEtiquetas: !!etiquetas.nivel1,
            jerarquia: {
                "Nivel 1 - Categoría": etiquetas.nivel1 || "Por Definir",
                "Nivel 2 - Sector": etiquetas.nivel2 || "Por Definir",
                "Nivel 3 - Palabras clave": etiquetas.nivel3.length > 0 ? etiquetas.nivel3 : ["Ninguna"]
            },
            detalle: etiquetas.coincided,
            textoAnalizado: texto.substring(0, 80) + "..."
        };
    },

    // Validar que hallazgo tenga los 3 niveles
    validarHallazgo: (hallazgo) => {
        const resultado = {
            valido: false,
            nivelesCompletos: 0,
            detalles: []
        };

        if (!hallazgo) {
            resultado.detalles.push("Hallazgo inválido");
            return resultado;
        }

        // Etiquetar el texto del hallazgo
        const analisis = MatrizSectores.etiquetar(hallazgo.snapshot || hallazgo.convocatoria || "");
        
        resultado.jerarquia = analisis.jerarquia;

        if (analisis.jerarquia["Nivel 1 - Categoría"] !== "Por Definir") resultado.nivelesCompletos++;
        if (analisis.jerarquia["Nivel 2 - Sector"] !== "Por Definir") resultado.nivelesCompletos++;
        if (analisis.jerarquia["Nivel 3 - Palabras clave"][0] !== "Ninguna") resultado.nivelesCompletos++;

        resultado.valido = resultado.nivelesCompletos >= 2;
        resultado.detalles.push(`Niveles completados: ${resultado.nivelesCompletos}/3`);

        return resultado;
    },

    // Obtener matriz completa
    obtenerMatriz: () => {
        const matriz = {};
        for (const [categoria, sectores] of Object.entries(MatrizSectores)) {
            if (categoria === "version" || categoria === "fechaActualizacion") continue;
            matriz[categoria] = Object.keys(sectores);
        }
        return matriz;
    }
};

module.exports = MatrizSectores;