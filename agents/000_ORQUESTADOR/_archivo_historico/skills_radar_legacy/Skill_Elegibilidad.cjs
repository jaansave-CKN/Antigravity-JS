/**
 * SKILL: ELEGIBILIDAD (Paso B - Caracterización)
 * Receptor de datos: Población y Localización
 * Cruza sectores de Matriz Maestra con grupos poblacionales
 * Genera Llave de Elegibilidad para Radar1_minero
 */

const MatrizSectores = require("./Skill_Matriz_Sectores.cjs");

const GruposPoblacionales = {
    "Población Rural": ["rural", "campo", "vereda", "corregimiento", "área dispersa"],
    "Población Urbana": ["urbana", "ciudad", "municipal", "metropolitana", "街区"],
    "Víctimas Conflicto": ["víctima", "desplazado", "reinsertado", "desmovilizado", "reconciliación"],
    "Comunidades Indígenas": ["indígena", "afro", "raizal", "palenquero", "étnico", "tribal"],
    "Mujeres": ["mujer", "género", "femenino", "cabeza de familia", "violencia género"],
    "Niños Niñas Adolescentes": ["niño", "niña", "adolescente", "menor", "infancia", "juvenil"],
    "Personas con Discapacidad": ["discapacidad", "discapacitado", "capacidad diferente", "accesibilidad"],
    "Adultos Mayores": ["adulto mayor", "tercera edad", "anciano", "geriátrico", "persona mayor"],
    "Población Migrante": ["migrante", "refugiado", "migratorio", "extranjero", "venezolano", "haitiano"],
    "Población Pobreza": ["pobre", "pobreza", "vulnerable", "sisben", "indigente", "extrema pobreza"],
    "Población Carcelaria": ["recluso", "penitenciaría", "cárcel", "prisión", "interno"],
    "Población Juventud": ["joven", "juventud", "millennial", "gen z"]
};

const LocalizacionesColombia = {
    "Nacional": ["colombia", "nacional", "todo el país", "territorio nacional"],
    "Amazonía": ["amazonía", "amazonia", "putumayo", "caquetá", "guainía", "vaupés", "guaviare", "amazónico"],
    "Andina": ["andina", "cundinamarca", "boyacá", "tolima", "huila", "cauca", "nariño", "antioquia", "caldas", "risaralda", "quindío"],
    "Caribe": ["caribe", "atlántico", "bolívar", "cesar", "córdoba", "la guajira", "magdalena", "sucre", "san andrés"],
    "Pacífico": ["pacífico", "chocó", "valle", "cauca", "nariño"],
    "Orinoquía": ["orinoquía", "orinoquia", "meta", " Casanare", "Arauca", "Vichada", "Guainía"],
    "Insular": ["insular", "san andrés", "providencia", "isla", "archipiélago"]
};

const Elegibilidad = {
    nombre: "Elegibilidad - Paso B",
    receptorActivo: false,
    configuracion: {
        poblacion: null,
        localizacion: null
    },
    historiaLlaves: [],

    iniciarReceptor: () => {
        Elegibilidad.receptorActivo = true;
        Elegibilidad.configuracion = { poblacion: null, localizacion: null };
        console.log("🎯 RECEPTOR DE ELEGIBILIDAD ACTIVADO (Paso B)");
        console.log("   Listo para recibir: Población + Localización");
        return { estado: "RECEPTOR_ACTIVO", timestamp: new Date().toISOString() };
    },

    // Establecer grupo poblacional
    establecerPoblacion: (grupoPoblacional) => {
        const grupo = grupoPoblacional.toLowerCase();
        for (const [nombre, keywords] of Object.entries(GruposPoblacionales)) {
            if (keywords.some(k => grupo.includes(k))) {
                Elegibilidad.configuracion.poblacion = nombre;
                console.log(`👥 POBLACIÓN ESTABLECIDA: ${nombre}`);
                return { poblacion: nombre, confirmado: true };
            }
        }
        return { poblacion: null, confirmado: false, mensaje: "Grupo poblacional no reconocido" };
    },

    // Establecer localización
    establecerLocalizacion: (ubicacion) => {
        const ubi = ubicacion.toLowerCase();
        for (const [nombre, keywords] of Object.entries(LocalizacionesColombia)) {
            if (keywords.some(k => ubi.includes(k))) {
                Elegibilidad.configuracion.localizacion = nombre;
                console.log(`📍 LOCALIZACIÓN ESTABLECIDA: ${nombre}`);
                return { localizacion: nombre, confirmado: true };
            }
        }
        return { localizacion: null, confirmado: false, mensaje: "Localización no reconocida" };
    },

    // Generar Llave de Elegibilidad
    generarLlave: (convocatoria) => {
        if (!Elegibilidad.configuracion.poblacion || !Elegibilidad.configuracion.localizacion) {
            return { 
                error: "Configuración incompleta", 
                mensaje: "Debe establecer Población y Localización primero" 
            };
        }

        // Extraer sector de la convocatoria
        const etiquetado = MatrizSectores.etiquetar(convocatoria);
        const categoria = etiquetado.jerarquia["Nivel 1 - Categoría"];
        const sector = etiquetado.jerarquia["Nivel 2 - Sector"];

        // Verificar compatibilidad sector-población
        const compatibilidad = Elegibilidad.verificarCompatibilidad(sector);

        // Generar llave única
        const llave = Elegibilidad.crearLlaveUnica(
            Elegibilidad.configuracion.poblacion,
            Elegibilidad.configuracion.localizacion,
            sector,
            compatibilidad.esCompatible
        );

        const resultado = {
            llaveElegibilidad: llave,
            poblacion: Elegibilidad.configuracion.poblacion,
            localizacion: Elegibilidad.configuracion.localizacion,
            sector: sector,
            categoria: categoria,
            compatible: compatibilidad.esCompatible,
            razon: compatibilidad.razon,
            puedeParticipar: compatibilidad.esCompatible,
            timestamp: new Date().toISOString()
        };

        Elegibilidad.historiaLlaves.push(resultado);
        
        console.log(`\n🔑 LLAVE DE ELEGIBILIDAD GENERADA`);
        console.log(`   ${llave}`);
        console.log(`   📊 Compatibilidad: ${compatibilidad.esCompatible ? '✓ VÁLIDA' : '✗ NO ELEGIBlE'}`);
        console.log(`   📝 Razón: ${compatibilidad.razon}`);

        return resultado;
    },

    crearLlaveUnica: (poblacion, localizacion, sector, compatible) => {
        const timestamp = Date.now().toString(36).toUpperCase();
        const hashPob = poblacion.substring(0, 3).toUpperCase();
        const hashLoc = localizacion.substring(0, 3).toUpperCase();
        const hashSec = (sector || "XXX").substring(0, 3).toUpperCase();
        const flag = compatible ? "A" : "B";
        return `ELG-${hashPob}-${hashLoc}-${hashSec}-${flag}-${timestamp}`;
    },

    verificarCompatibilidad: (sector) => {
        const sectorL = (sector || "").toLowerCase();
        
        // Reglas de compatibilidad específicas
        const reglas = {
            "Agro": ["Población Rural", "Población Pobreza", "Comunidades Indígenas"],
            "Desarrollo Rural": ["Población Rural", "Población Pobreza"],
            "Vivienda": ["Población Pobreza", "Víctimas Conflicto", "Adultos Mayores"],
            "Agua": ["Población Rural", "Población Pobreza"],
            "Saneamiento": ["Población Rural", "Población Pobreza"],
            "Salud": ["Adultos Mayores", "Niños Niñas Adolescentes", "Población Migrante", "Población Pobreza"],
            "Educación": ["Niños Niñas Adolescentes", "Población Juventud", "Adultos Mayores"],
            "Tecnologías": ["Población Juventud", "Población Urbana"],
            "Energías Renovables": ["Población Rural", "Población Urbana"],
            "DDHH": ["Víctimas Conflicto", "Comunidades Indígenas", "Población Migrante"],
            "Ayuda Humanitaria": ["Víctimas Conflicto", "Población Migrante", "Población Pobreza"],
            "Construcción": ["Población Urbana", "Población Rural"],
            "Transporte": ["Población Urbana", "Población Rural"]
        };

        const permitidos = reglas[sectorL] || [];
        const poblacionActual = Elegibilidad.configuracion.poblacion;
        
        const esCompatible = permitidos.length === 0 || permitidos.includes(poblacionActual);
        
        return {
            esCompatible,
            razon: esCompatible 
                ? `Sector "${sector}" compatible con "${poblacionActual}"` 
                : `Sector "${sector}" no está diseñado para "${poblacionActual}"`
        };
    },

    // Obtener configuración actual
    obtenerConfiguracion: () => {
        return { ...Elegibilidad.configuracion };
    },

    // Obtener historia de llaves
    obtenerHistoria: () => {
        return Elegibilidad.historiaLlaves;
    },

    // Resetear configuración
    resetear: () => {
        Elegibilidad.configuracion = { poblacion: null, localizacion: null };
        console.log("🔄 Configuración de elegibilidad reseteada");
        return { estado: "RESETEADO" };
    },

    // Listar grupos poblacionales disponibles
    listarGruposPoblacionales: () => {
        return Object.keys(GruposPoblacionales);
    },

    // Listar localizaciones disponibles
    listarLocalizaciones: () => {
        return Object.keys(LocalizacionesColombia);
    }
};

module.exports = Elegibilidad;