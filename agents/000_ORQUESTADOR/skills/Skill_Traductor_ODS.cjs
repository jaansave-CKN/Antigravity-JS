/**
 * SKILL: TRADUCTOR_ODS
 * Verifica correspondencia entre sectores de Matriz Maestra y Objetivos de Desarrollo Sostenible
 * Solo permite pasar a Radar2_Estratega si tiene al menos un ODS válido
 */

const ODS_MAP = {
    // Hábitat y Territorio
    "Construcción": [
        { ods: 9, nombre: "Industria, innovación e infraestructura", desc: "Infraestructura resiliente" },
        { ods: 11, nombre: "Ciudades y comunidades sostenibles", desc: "Ciudades inclusivas" }
    ],
    "Vivienda": [
        { ods: 1, nombre: "Fin de la pobreza", desc: "Vivienda digna" },
        { ods: 11, nombre: "Ciudades y comunidades sostenibles", desc: "Asentamientos humanos" }
    ],
    "Transporte": [
        { ods: 9, nombre: "Industria, innovación e infraestructura", desc: "Transporte sostenible" },
        { ods: 11, nombre: "Ciudades y comunidades sostenibles", desc: "Movilidad urbana" }
    ],
    "Ordenamiento": [
        { ods: 11, nombre: "Ciudades y comunidades sostenibles", desc: "Planificación urbana" },
        { ods: 15, nombre: "Vida de ecosistemas terrestres", desc: "Uso del suelo" }
    ],

    // Soberanía y Vida
    "Agua": [
        { ods: 6, nombre: "Agua limpia y saneamiento", desc: "Gestión hídrica" },
        { ods: 2, nombre: "Hambre cero", desc: "Agricultura sostenible" }
    ],
    "Saneamiento": [
        { ods: 6, nombre: "Agua limpia y saneamiento", desc: "Saneamiento básico" },
        { ods: 3, nombre: "Salud y bienestar", desc: "Higiene" }
    ],
    "Salud": [
        { ods: 3, nombre: "Salud y bienestar", desc: "Sistema de salud" },
        { ods: 6, nombre: "Agua limpia y saneamiento", desc: "Agua segura" }
    ],
    "Medio Ambiente": [
        { ods: 13, nombre: "Acción por el clima", desc: "Cambio climático" },
        { ods: 15, nombre: "Vida de ecosistemas terrestres", desc: "Biodiversidad" },
        { ods: 14, nombre: "Vida submarina", desc: "Océanos" }
    ],
    "Riesgos": [
        { ods: 13, nombre: "Acción por el clima", desc: "Gestión de desastres" },
        { ods: 11, nombre: "Ciudades y comunidades sostenibles", desc: "Resiliencia" }
    ],

    // Paz y Sociedad
    "DDHH": [
        { ods: 16, nombre: "Paz, justicia e instituciones sólidas", desc: "Derechos humanos" },
        { ods: 10, nombre: "Reducción de las desigualdades", desc: "Equidad" }
    ],
    "Cultura": [
        { ods: 4, nombre: "Educación de calidad", desc: "Cultura y educación" },
        { ods: 11, nombre: "Ciudades y comunidades sostenibles", desc: "Patrimonio" }
    ],
    "Deporte": [
        { ods: 3, nombre: "Salud y bienestar", desc: "Bienestar físico" },
        { ods: 5, nombre: "Igualdad de género", desc: "Deporte inclusivo" }
    ],
    "Justicia": [
        { ods: 16, nombre: "Paz, justicia e instituciones sólidas", desc: "Sistema judicial" },
        { ods: 10, nombre: "Reducción de las desigualdades", desc: "Acceso a justicia" }
    ],
    "Ayuda Humanitaria": [
        { ods: 1, nombre: "Fin de la pobreza", desc: "Asistencia" },
        { ods: 2, nombre: "Hambre cero", desc: "Seguridad alimentaria" },
        { ods: 17, nombre: "Alianzas para lograr los objetivos", desc: "Cooperación" }
    ],

    // Autonomía Económica
    "Agro": [
        { ods: 2, nombre: "Hambre cero", desc: "Agricultura sostenible" },
        { ods: 12, nombre: "Producción y consumo responsables", desc: "Cadena de valor" }
    ],
    "Desarrollo Rural": [
        { ods: 1, nombre: "Fin de la pobreza", desc: "Pobreza rural" },
        { ods: 2, nombre: "Hambre cero", desc: "Desarrollo agrícola" },
        { ods: 8, nombre: "Trabajo decente y crecimiento económico", desc: "Empleo rural" }
    ],
    "Turismo": [
        { ods: 8, nombre: "Trabajo decente y crecimiento económico", desc: "Turismo sostenible" },
        { ods: 12, nombre: "Producción y consumo responsables", desc: "Turismo responsable" }
    ],
    "Emprendimiento": [
        { ods: 8, nombre: "Trabajo decente y crecimiento económico", desc: "PYMES" },
        { ods: 9, nombre: "Industria, innovación e infraestructura", desc: "Innovación" },
        { ods: 17, nombre: "Alianzas para lograr los objetivos", desc: "Alianzas" }
    ],

    // Futuro y Conocimiento
    "Educación": [
        { ods: 4, nombre: "Educación de calidad", desc: "Educación inclusiva" },
        { ods: 8, nombre: "Trabajo decable y crecimiento económico", desc: "Formación" }
    ],
    "Ciencia": [
        { ods: 9, nombre: "Industria, innovación e infraestructura", desc: "I+D" },
        { ods: 17, nombre: "Alianzas para lograr los objetivos", desc: "Investigación" }
    ],
    "Tecnologías": [
        { ods: 9, nombre: "Industria, innovación e infraestructura", desc: "Tecnología" },
        { ods: 17, nombre: "Alianzas para lograr los objetivos", desc: "Digitalización" }
    ],
    "Energías Renovables": [
        { ods: 7, nombre: "Energía asequible y no contaminante", desc: "Energía limpia" },
        { ods: 13, nombre: "Acción por el clima", desc: "Energía verde" }
    ]
};

const TraductorODS = {
    nombre: "Traductor ODS",
    version: "1.0",

    // Obtener ODS para un sector
    obtenerODS: (sector) => {
        return ODS_MAP[sector] || [];
    },

    // Verificar si tiene correspondencia ODS
    verificarCorrespondencia: (sector) => {
        const ods = ODS_MAP[sector];
        const tieneODS = ods && ods.length > 0;
        
        return {
            tieneCorrespondencia: tieneODS,
            sector: sector,
            odsEncontrados: tieneODS ? ods : [],
            mensaje: tieneODS 
                ? `✅ Sector "${sector}" tiene ${ods.length} correspondencia(s) ODS`
                : `⚠️ Sector "${sector}" SIN correspondencia ODS - NO pasar a Estratega`
        };
    },

    // Verificar y agregar ODS al resultado
    procesarSector: (sector) => {
        const verificacion = TraductorODS.verificarCorrespondencia(sector);
        
        return {
            puedePasarAEstratega: verificacion.tieneCorrespondencia,
            ods: verificacion.odsEncontrados.map(o => ({ 
                numero: o.ods, 
                nombre: o.nombre, 
                descripcion: o.desc 
            })),
            verificacion: verificacion
        };
    },

    // Obtener todos los ODS disponibles
    listarODS: () => {
        const listaODS = {};
        for (const [sector, odsList] of Object.entries(ODS_MAP)) {
            odsList.forEach(o => {
                if (!listaODS[o.ods]) {
                    listaODS[o.ods] = { nombre: o.nombre, sectores: [] };
                }
                if (!listaODS[o.ods].sectores.includes(sector)) {
                    listaODS[o.ods].sectores.push(sector);
                }
            });
        }
        return listaODS;
    },

    // Obtener info de un ODS específico
    infoODS: (numero) => {
        const resultados = [];
        for (const [sector, odsList] of Object.entries(ODS_MAP)) {
            const encontrado = odsList.find(o => o.ods === numero);
            if (encontrado) {
                resultados.push({ sector, ...encontrado });
            }
        }
        return resultados;
    }
};

module.exports = TraductorODS;