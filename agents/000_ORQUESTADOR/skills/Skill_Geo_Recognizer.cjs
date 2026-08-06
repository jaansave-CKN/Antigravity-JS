/**
 * SKILL: GEO_RECOGNIZER
 * Reconocedor de Entidades Geográficas
 * Normaliza: países, regiones, listas mixtas → código país / zona regional
 */

const PaisCodigo = {
    "colombia": { codigo: "CO", zona: "LATAM", tipo: "pais" },
    "brasil": { codigo: "BR", zona: "LATAM", tipo: "pais" },
    "méxico": { codigo: "MX", zona: "LATAM", tipo: "pais" },
    "mexico": { codigo: "MX", zona: "LATAM", tipo: "pais" },
    "perú": { codigo: "PE", zona: "LATAM", tipo: "pais" },
    "peru": { codigo: "PE", zona: "LATAM", tipo: "pais" },
    "chile": { codigo: "CL", zona: "LATAM", tipo: "pais" },
    "argentina": { codigo: "AR", zona: "LATAM", tipo: "pais" },
    "ecuador": { codigo: "EC", zona: "LATAM", tipo: "pais" },
    "bolivia": { codigo: "BO", zona: "LATAM", tipo: "pais" },
    "venezuela": { codigo: "VE", zona: "LATAM", tipo: "pais" },
    "panamá": { codigo: "PA", zona: "LATAM", tipo: "pais" },
    "panama": { codigo: "PA", zona: "LATAM", tipo: "pais" },
    "costa rica": { codigo: "CR", zona: "LATAM", tipo: "pais" },
    "uruguay": { codigo: "UY", zona: "LATAM", tipo: "pais" },
    "paraguay": { codigo: "PY", zona: "LATAM", tipo: "pais" },
    "estados unidos": { codigo: "US", zona: "NORTEAMERICA", tipo: "pais" },
    "eeuu": { codigo: "US", zona: "NORTEAMERICA", tipo: "pais" },
    "canadá": { codigo: "CA", zona: "NORTEAMERICA", tipo: "pais" },
    "canada": { codigo: "CA", zona: "NORTEAMERICA", tipo: "pais" },
    "china": { codigo: "CN", zona: "ASIA", tipo: "pais" },
    "japón": { codigo: "JP", zona: "ASIA", tipo: "pais" },
    "japon": { codigo: "JP", zona: "ASIA", tipo: "pais" },
    "corea": { codigo: "KR", zona: "ASIA", tipo: "pais" },
    "españa": { codigo: "ES", zona: "EUROPA", tipo: "pais" },
    "reino unido": { codigo: "GB", zona: "EUROPA", tipo: "pais" },
    "alemania": { codigo: "DE", zona: "EUROPA", tipo: "pais" },
    "francia": { codigo: "FR", zona: "EUROPA", tipo: "pais" },
    "italia": { codigo: "IT", zona: "EUROPA", tipo: "pais" },
    "emiratos": { codigo: "AE", zona: "MENA", tipo: "pais" },
    "emiratos Árabes": { codigo: "AE", zona: "MENA", tipo: "pais" }
};

const Regiones = {
    "latam": { nombre: "Latinoamérica", codigo: "LATAM", tipo: "region" },
    "latinoamérica": { nombre: "Latinoamérica", codigo: "LATAM", tipo: "region" },
    "sudamérica": { nombre: "Sudamérica", codigo: "LATAM", tipo: "region" },
    "suramérica": { nombre: "Sudamérica", codigo: "LATAM", tipo: "region" },
    "centroamérica": { nombre: "Centroamérica", codigo: "CAM", tipo: "region" },
    "caribe": { nombre: "Caribe", codigo: "CAR", tipo: "region" },
    "europa": { nombre: "Europa", codigo: "EUR", tipo: "region" },
    "unión europea": { nombre: "Unión Europea", codigo: "UE", tipo: "region" },
    "asia": { nombre: "Asia", codigo: "ASI", tipo: "region" },
    "asia-pacífico": { nombre: "Asia-Pacífico", codigo: "APAC", tipo: "region" },
    "norteamérica": { nombre: "Norteamérica", codigo: "NA", tipo: "region" },
    "mena": { nombre: "Medio Oriente y Norte de África", codigo: "MENA", tipo: "region" },
    "africa": { nombre: "África", codigo: "AFR", tipo: "region" },
    "oceanía": { nombre: "Oceanía", codigo: "OCE", tipo: "region" }
};

const GeoRecognizer = {
    nombre: "Reconocedor de Entidades Geográficas",
    ultimoReconocimiento: null,

    reconocer: (entrada) => {
        if (!entrada || typeof entrada !== "string") {
            return { error: "Entrada inválida" };
        }

        const tokens = entrada.split(/[,;|]/).map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
        const resultados = [];
        const metadatos = {
            entradaOriginal: entrada,
            totalItems: tokens.length,
            tipoBusqueda: "mixto",
            timestamp: new Date().toISOString()
        };

        let tienePaises = false;
        let tieneRegiones = false;

        tokens.forEach(token => {
            const busqueda = token.replace(/\s+/g, " ");

            let resultado = null;

            // Buscar en países
            for (const [nombre, datos] of Object.entries(PaisCodigo)) {
                if (busqueda.includes(nombre)) {
                    resultado = {
                        original: token,
                        tipo: "pais",
                        nombre: nombre,
                        codigo: datos.codigo,
                        zona: datos.zona,
                        paraRadar1: "CODIGO_PAIS"
                    };
                    tienePaises = true;
                    break;
                }
            }

            // Buscar en regiones si no encontró país
            if (!resultado) {
                for (const [nombre, datos] of Object.entries(Regiones)) {
                    if (busqueda.includes(nombre)) {
                        resultado = {
                            original: token,
                            tipo: "region",
                            nombre: datos.nombre,
                            codigo: datos.codigo,
                            zona: datos.codigo,
                            paraRadar1: "ZONA_REGIONAL"
                        };
                        tieneRegiones = true;
                        break;
                    }
                }
            }

            // Si no reconoció, marcar como no reconocido
            if (!resultado) {
                resultado = {
                    original: token,
                    tipo: "desconocido",
                    nombre: token,
                    codigo: null,
                    zona: null,
                    paraRadar1: "NO_RECONOCIDO"
                };
            }

            resultados.push(resultado);
        });

        // Determinar tipo de búsqueda
        if (tokens.length === 1 && resultados[0].tipo === "pais") {
            metadatos.tipoBusqueda = "pais_unico";
        } else if (tokens.length === 1 && resultados[0].tipo === "region") {
            metadatos.tipoBusqueda = "region_unica";
        } else if (tienePaises && tieneRegiones) {
            metadatos.tipoBusqueda = "mixto";
        } else if (tienePaises) {
            metadatos.tipoBusqueda = "paises";
        } else if (tieneRegiones) {
            metadatos.tipoBusqueda = "regiones";
        }

        // Preparar instrucción para Radar1_minero
        const instruccionRadar1 = (metadatos.tipoBusqueda === "pais_unico" || metadatos.tipoBusqueda === "paises" || metadatos.tipoBusqueda === "mixto")
            ? "BUSCAR_POR_CODIGO_PAIS"
            : "BUSCAR_POR_ZONA_REGIONAL";

        const respuesta = {
            reconocimientoExitoso: resultados.filter(r => r.tipo !== "desconocido").length > 0,
            items: resultados,
            metadatos: metadatos,
            instruccionRadar1: instruccionRadar1,
            codigosPaises: resultados.filter(r => r.tipo === "pais").map(r => r.codigo),
            zonasRegionales: [...new Set(resultados.filter(r => r.tipo === "region").map(r => r.codigo))]
        };

        GeoRecognizer.ultimoReconocimiento = respuesta;
        
        console.log(`\n🌍 RECONOCIMIENTO GEOGRÁFICO`);
        console.log(`   Entrada: "${entrada}"`);
        console.log(`   Items reconocidos: ${respuesta.reconocimientoExitoso}/${tokens.length}`);
        console.log(`   Tipo búsqueda: ${metadatos.tipoBusqueda.toUpperCase()}`);
        console.log(`   → Para Radar1: ${instruccionRadar1}`);
        if (respuesta.codigosPaises.length > 0) console.log(`   Códigos: ${respuesta.codigosPaises.join(", ")}`);
        if (respuesta.zonasRegionales.length > 0) console.log(`   Zonas: ${respuesta.zonasRegionales.join(", ")}`);

        return respuesta;
    },

    reconocerYEnviarARadar1: (entrada, callbackRadar1) => {
        const resultado = GeoRecognizer.reconocer(entrada);
        
        if (resultado.reconocimientoExitoso && callbackRadar1) {
            console.log(`\n📤 ENVIANDO A RADAR1_MINERO:`);
            callbackRadar1({
                instruccion: resultado.instruccionRadar1,
                codigosPaises: resultado.codigosPaises,
                zonasRegionales: resultado.zonasRegionales,
                raw: resultado
            });
        }
        
        return resultado;
    },

    obtenerUltimo: () => {
        return GeoRecognizer.ultimoReconocimiento;
    }
};

module.exports = GeoRecognizer;