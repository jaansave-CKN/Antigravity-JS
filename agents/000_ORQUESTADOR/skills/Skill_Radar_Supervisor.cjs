/**
 * SKILL: RADAR_SUPERVISOR (Modo Supervisión)
 * Recibe reportes de Radar1 → Calcula semáforo con Radar2 → Registra en Radar_Resultados
 */

const fs = require("fs");
const path = require("path");

const RadarMaster = require("./Skill_Radar_Master.cjs");

const CARPETA_RESULTADOS = path.join(process.cwd(), "Radar_Resultados");

const RadarSupervisor = {
    modoActivo: false,
    modoCooperacionInternacional: false,
    registro: [],

    clasificarSubsector: (texto, sector) => {
        const t = texto.toLowerCase();
        const subsectores = {
            "Gubernamental": ["agua", "saneamiento", "vial", "educación", "salud", "vivienda", "urbanismo"],
            "ONG": ["agua", "sanitario", "educativo", "salud comunitaria", "refugios"],
            "Multilateral": ["infraestructura", "desarrollo rural", "agua potable", "transporte", "energía"],
            "Privado": ["construcción", "obra civil", "industrial", "comercial", "residencial"],
            "Por Definir": ["general"]
        };
        const lista = subsectores[sector] || subsectores["Por Definir"];
        for (const sub of lista) {
            if (t.includes(sub)) return sub.charAt(0).toUpperCase() + sub.slice(1);
        }
        return "General";
    },

    filtrarCooperacionInternacional: (texto) => {
        const t = texto.toLowerCase();
        const incluyeColombia = t.includes("colombia") || t.includes("ejecución en") || t.includes("ejecutar en") || t.includes("implementación en");
        const firmaArquitecturaIng = t.includes("firma") || t.includes("arquitecto") || t.includes("ingeniero") || t.includes("ingeniería") || t.includes("diseño") || t.includes("construcción");
        const infraestructuraRural = t.includes("rural") || t.includes("zona rural") || t.includes("campo") || t.includes("vereda") || t.includes("agro") || t.includes("agua potable") || t.includes("saneamiento") || t.includes("vía rural");
        return {
            cumple: (incluyeColombia || infraestructuraRural) && (firmaArquitecturaIng || infraestructuraRural),
            requiereColombia: incluyeColombia,
            esFirma: firmaArquitecturaIng,
            esInfraRural: infraestructuraRural
        };
    },

    clasificarPublicoObjetivo: (texto) => {
        const t = texto.toLowerCase();
        if (t.includes("alcald") || t.includes("gobernac") || t.includes("municipio") || t.includes("ministerio") || t.includes("gobierno")) {
            return { sector: "Gubernamental", objetivo: "Alcaldías/Gobernaciones" };
        }
        if (t.includes("ong") || t.includes("organización no gubernamental") || t.includes("fundación") || t.includes("sin ánimo de lucro")) {
            return { sector: "ONG", objetivo: "Organizaciones No Gubernamentales" };
        }
        if (t.includes("bid") || t.includes("banco mundial") || t.includes("pnud") || t.includes("fmi") || t.includes("multilateral") || t.includes("bm")) {
            return { sector: "Multilateral", objetivo: "BID/Banco Mundial" };
        }
        if (t.includes("empresa") || t.includes("privado") || t.includes("corporativo") || t.includes("s.a.s") || t.includes("ltda")) {
            return { sector: "Privado", objetivo: "Sector Privado" };
        }
        return { sector: "Por Definir", objetivo: "Sin clasificar" };
    },

    iniciarSupervision: (modoCooperacion = false) => {
        RadarSupervisor.modoActivo = true;
        RadarSupervisor.modoCooperacionInternacional = modoCooperacion;
        console.log("🎯 MODO SUPERVISIÓN RADAR ACTIVADO");
        console.log("   - Radar1: Generando reportes");
        console.log("   - Radar2: Calculando semáforo");
        console.log(`   - Registro: ${CARPETA_RESULTADOS}`);
        if (modoCooperacion) {
            console.log("   - FILTRO: Cooperación Internacional (Colombia + Arquitectura/Ing + Infra Rural)");
        }
        return { estado: "SUPERVISION_ACTIVA", modoCooperacionInternacional: modoCooperacion, timestamp: new Date().toISOString() };
    },

    activarCooperacionInternacional: () => {
        RadarSupervisor.modoCooperacionInternacional = true;
        console.log("🔗 MODO COOPERACIÓN INTERNACIONAL ACTIVADO");
        return { estado: "COOPERACION_ACTIVA" };
    },

    desactivarCooperacionInternacional: () => {
        RadarSupervisor.modoCooperacionInternacional = false;
        console.log("🔗 MODO COOPERACIÓN INTERNACIONAL DESACTIVADO");
        return { estado: "COOPERACION_INACTIVA" };
    },

    listarFiltradosCI: () => {
        return RadarSupervisor.registro.filter(r => r.filtroCooperacion && r.filtroCooperacion.aplica);
    },

    detenerSupervision: () => {
        RadarSupervisor.modoActivo = false;
        return { estado: "SUPERVISION_DETENIDA", hallazgos: RadarSupervisor.registro.length };
    },

    procesarReporteRadar1: (reporteRadar1) => {
        if (!reporteRadar1 || !reporteRadar1.snapshot) {
            return { error: "Reporte de Radar1 inválido" };
        }

        const texto = reporteRadar1.snapshot;

        // Paso 1: Radar2 calcula el semáforo
        const nivelRiesgo = RadarMaster.calcularSemaforo(texto);

        // Paso 2: Clasificar Público Objetivo > Sector > Subsector
        const clasificacion = RadarSupervisor.clasificarPublicoObjetivo(texto);
        const subsector = RadarSupervisor.clasificarSubsector(texto, clasificacion.sector);

        // Paso 3: Filtrar Cooperación Internacional
        const filtroCI = RadarSupervisor.filtrarCooperacionInternacional(texto);

        // Prioridad: Público Objetivo > Sector > Subsector
        const jerarquia = {
            publicOjetivo: clasificacion.objetivo,
            sector: clasificacion.sector,
            subsector: subsector
        };

        // Preparar resultado
        const resultado = {
            id: reporteRadar1.id || Date.now(),
            origen: "Radar1",
            destino: "Radar2",
            snapshot: texto.substring(0, 100) + "...",
            jerarquia: jerarquia,
            filtroCooperacion: {
                aplica: RadarSupervisor.modoCooperacionInternacional ? filtroCI.cumple : true,
                requiereColombia: filtroCI.requiereColombia,
                esFirmaArquitecturaIng: filtroCI.esFirma,
                esInfraRural: filtroCI.esInfraRural
            },
            semaforo: nivelRiesgo,
            nivelTexto: nivelRiesgo <= 3 ? "BAJO" : nivelRiesgo <= 6 ? "MEDIO" : "ALTO",
            timestamp: new Date().toISOString(),
            procesadoPor: "Skill_Radar_Master"
        };

        // Guardar en Radar_Resultados solo si pasa el filtro de Cooperación Internacional
        if (!RadarSupervisor.modoCooperacionInternacional || filtroCI.cumple) {
            const nombreArchivo = `hallazgo_${resultado.id}_${Date.now()}.json`;
            const rutaArchivo = path.join(CARPETA_RESULTADOS, nombreArchivo);
            
            fs.writeFileSync(rutaArchivo, JSON.stringify(resultado, null, 2));
            RadarSupervisor.registro.push(resultado);

            console.log(`✅ Hallazgo registrado: Semáforo ${nivelRiesgo} | Sector=${jerarquia.sector} | Subsector=${jerarquia.subsector}`);
            if (filtroCI.cumple) console.log(`   🔗 Cumple filtros de Cooperación Internacional (Colombia + Arquitectura/Ing + Infra Rural)`);
            console.log(`   📁 Archivo: ${nombreArchivo}`);
        } else {
            console.log(`⚠️ Hallazgo filtrado: No cumple criterios de Cooperación Internacional`);
        }

        return resultado;
    },

    listarHallazgos: () => {
        const archivos = fs.readdirSync(CARPETA_RESULTADOS).filter(f => f.endsWith(".json"));
        return {
            total: archivos.length,
            carpeta: CARPETA_RESULTADOS,
            archivos: archivos.sort().reverse()
        };
    },

    obtenerHallazgo: (id) => {
        const archivos = fs.readdirSync(CARPETA_RESULTADOS).filter(f => f.includes(id));
        if (archivos.length === 0) return null;
        const contenido = fs.readFileSync(path.join(CARPETA_RESULTADOS, archivos[0]), "utf8");
        return JSON.parse(contenido);
    }
};

module.exports = RadarSupervisor;