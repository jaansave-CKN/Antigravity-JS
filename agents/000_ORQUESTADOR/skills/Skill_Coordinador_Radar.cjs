/**
 * SKILL: COORDINADOR_RADAR
 * Coordina flujo: Radar1_minero (extracción) → Radar2_Estratega (análisis)
 * Supervisa grouping por sectores: Hábitat, Soberanía, Autonomía
 */

const RadarMaster = require("./Skill_Radar_Master.cjs");
const MatrizSectores = require("./Skill_Matriz_Sectores.cjs");
const TraductorODS = require("./Skill_Traductor_ODS.cjs");

const Sectores = {
    HÁBITAT: ["vivienda", "urbanismo", "espacio público", "agua", "saneamiento", "infraestructura"],
    SOBERANÍA: ["seguridad", "defensa", "fronteras", "energía", "recursos naturales", "minería"],
    AUTONOMÍA: ["tecnología", "investigación", "innovación", "educación", "salud", "soberanía alimentaria"]
};

const PublicoObjetivoMap = {
    "Alcaldías/Gobernaciones": ["HÁBITAT", "SOBERANÍA"],
    "ONG": ["HÁBITAT", "AUTONOMÍA"],
    "BID/Banco Mundial": ["HÁBITAT", "SOBERANÍA", "AUTONOMÍA"],
    "Sector Privado": ["HÁBITAT", "SOBERANÍA"]
};

const PaisesEstrategicos = ["colombia", "brasil", "méxico", "perú", "chile", "argentina", "estados unidos", "china", "españa", " emiratos"];
const PaisesImportantes = ["ecuador", "bolivia", "venezuela", "panamá", "costa rica", "uruguay", "paraguay", "reino unido", "alemania", "francia", "canadá", "japón", "corea"];

const detectarUbicacion = (texto) => {
    const t = texto.toLowerCase();
    for (const pais of PaisesEstrategicos) {
        if (t.includes(pais)) return { pais: pais, tipo: "Estratégico", tag: "ESTRATEGICO" };
    }
    for (const pais of PaisesImportantes) {
        if (t.includes(pais)) return { pais: pais, tipo: "País Importante", tag: "IMPORTANTE" };
    }
    return { pais: null, tipo: "Por Definir", tag: "POR_DEFINIR" };
};

const CoordinatorRadar = {
    nombre: "Coordinador Radar Internacional",
    estado: "INACTIVO",
    colas: {
        Radar1_minero: [],
        Radar2_Estratega: []
    },
sectoresRegistrados: { Hábitat: [], Soberanía: [], Autonomía: [] },
    mapaSectores: { "HÁBITAT": "Hábitat", "SOBERANÍA": "Soberanía", "AUTONOMÍA": "Autonomía" },

    iniciar: (config) => {
        CoordinatorRadar.estado = "ACTIVO";
        console.log("🎯 COORDINADOR RADAR INTERNACIONAL ACTIVADO");
        console.log("   Flujo: Radar1_minero → Radar2_Estratega");
        console.log("   Sectores: Hábitat | Soberanía | Autonomía");
        return { estado: "COORDINADOR_ACTIVO", timestamp: new Date().toISOString() };
    },

    // Radar1_minero: Extrae convocatorias
    recibirDatosMinero: (datos) => {
        if (!datos || !datos.convocatoria) return { error: "Datos inválidos de Radar1_minero" };
        
        const item = {
            id: datos.id || Date.now(),
            convocatoria: datos.convocatoria,
            fuente: datos.fuente || "minero",
            timestamp: new Date().toISOString(),
            procesado: false
        };
        
        CoordinatorRadar.colas.Radar1_minero.push(item);
        console.log(`⬇️ Radar1_minero → Extraído: ${item.convocatoria.substring(0, 50)}...`);
        return { recibido: true, cola: CoordinatorRadar.colas.Radar1_minero.length };
    },

    // Radar2_Estratega: Analiza y agrupa por Público Objetivo
    // Solo procesa si el sector tiene correspondencia ODS
    analizarConRadar2: (id) => {
        const dato = CoordinatorRadar.colas.Radar1_minero.find(d => d.id === id);
        if (!dato) return { error: "Dato no encontrado en cola" };

        const texto = dato.convocatoria.toLowerCase();
        let sectorDetectado = null;
        
        for (const [sector, palabras] of Object.entries(Sectores)) {
            if (palabras.some(p => texto.includes(p))) {
                sectorDetectado = sector;
                break;
            }
        }

        // Paso 0: Verificar correspondencia ODS usando matrizmaestra
        const etiquetado = MatrizSectores.etiquetar(dato.convocatoria);
        const sectorMatriz = etiquetado.jerarquia["Nivel 2 - Sector"] || "General";
        
        const verificacionODS = TraductorODS.procesarSector(sectorMatriz);
        if (!verificacionODS.puedePasarAEstratega) {
            console.log(`⛔ BLOQUEADO: Sector "${sectorMatriz}" sin correspondencia ODS`);
            return { 
                id: dato.id, 
                estado: "BLOQUEADO_SIN_ODS", 
                sector: sectorMatriz,
                mensaje: `Sector "${sectorMatriz}" no tiene correspondencia ODS - No pasa a Radar2_Estratega`
            };
        }

        console.log(`✅ VERIFICADO ODS: Sector "${sectorMatriz}" tiene ${verificacionODS.ods.length} ODS`);

        const sectorKey = sectorDetectado ? CoordinatorRadar.mapaSectores[sectorDetectado] : null;
        const publicObj = CoordinatorRadar.clasificarPublicoObjetivo(dato.convocatoria);
        const ubicacion = detectarUbicacion(dato.convocatoria);
        
        const analisis = {
            id: dato.id,
            convocatoria: dato.convocatoria,
            publicOjetivo: publicObj.objetivo,
            sector: sectorDetectado || "Por Definir",
            ubicacion: {
                pais: ubicacion.pais,
                tipo: ubicacion.tipo,
                tag: ubicacion.tag
            },
            ods: verificacionODS.ods,
            matrizMaestra: MatrizSectores.etiquetar(dato.convocatoria).jerarquia,
            validado: MatrizSectores.validarHallazgo({snapshot: dato.convocatoria}).valido,
            semaforo: RadarMaster.calcularSemaforo(dato.convocatoria),
            timestamp: new Date().toISOString()
        };

        dato.procesado = true;
        CoordinatorRadar.colas.Radar2_Estratega.push(analisis);
        
        if (sectorKey) {
            CoordinatorRadar.sectoresRegistrados[sectorKey].push(analisis);
        }

        const infoMatriz = analisis.matrizMaestra;
        console.log(`📊 Radar2_Estratega → Analizado: ${publicObj.objetivo} | ${infoMatriz["Nivel 1 - Categoría"]} > ${infoMatriz["Nivel 2 - Sector"]}`);
        return analisis;
    },

    clasificarPublicoObjetivo: (texto) => {
        const t = texto.toLowerCase();
        if (t.includes("alcald") || t.includes("gobernac") || t.includes("municipio")) return { sector: "Gubernamental", objetivo: "Alcaldías/Gobernaciones" };
        if (t.includes("ong") || t.includes("fundación")) return { sector: "ONG", objetivo: "Organizaciones No Gubernamentales" };
        if (t.includes("bid") || t.includes("banco mundial") || t.includes("multilateral")) return { sector: "Multilateral", objetivo: "BID/Banco Mundial" };
        if (t.includes("empresa") || t.includes("privado") || t.includes("s.a.s")) return { sector: "Privado", objetivo: "Sector Privado" };
        return { sector: "Por Definir", objetivo: "Sin clasificar" };
    },

    // Agrupar por Público Objetivo
    agruparPorPublicoObjetivo: () => {
        const grupos = {};
        CoordinatorRadar.colas.Radar2_Estratega.forEach(item => {
            const key = item.publicOjetivo;
            if (!grupos[key]) grupos[key] = [];
            grupos[key].push(item);
        });
        return grupos;
    },

    // Reporte de sectores
    reporteSectores: () => {
        return {
            Hábitat: { total: CoordinatorRadar.sectoresRegistrados.Hábitat.length, items: CoordinatorRadar.sectoresRegistrados.Hábitat },
            Soberanía: { total: CoordinatorRadar.sectoresRegistrados.Soberanía.length, items: CoordinatorRadar.sectoresRegistrados.Soberanía },
            Autonomía: { total: CoordinatorRadar.sectoresRegistrados.Autonomía.length, items: CoordinatorRadar.sectoresRegistrados.Autonomía }
        };
    },

    estado: () => {
        return {
            estado: CoordinatorRadar.estado,
            cola_minero: CoordinatorRadar.colas.Radar1_minero.length,
            cola_estratega: CoordinatorRadar.colas.Radar2_Estratega.length,
            sectores: Object.keys(CoordinatorRadar.sectoresRegistrados).map(s => ({ sector: s, total: CoordinatorRadar.sectoresRegistrados[s].length }))
        };
    }
};

module.exports = CoordinatorRadar;