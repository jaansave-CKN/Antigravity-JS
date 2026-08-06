/**
 * SKILL: PARAMETROS_MANDATORIOS
 * Detecta anexos activos, extrae restricciones técnicas
 * Envía parámetros mandatorios a Minero y Estratega
 */

const NotasPersonales = require("./Skill_Notas_Personales.cjs");

const ParametrosMandatorios = {
    nombre: "Parámetros Mandatorios",
    anexosDetectados: [],
    parametrosEnviados: [],
    
    detectarAnexoActivo: (anexo) => {
        const nuevoAnexo = {
            id: `ANX-${Date.now()}`,
            nombre: anexo.nombre || "Sin nombre",
            contenido: anexo.contenido || "",
            tipo: anexo.tipo || "desconocido",
            detectadoEn: new Date().toISOString(),
            activo: true
        };
        
        ParametrosMandatorios.anexosDetectados.push(nuevoAnexo);
        console.log(`\n📎 ANEXO ACTIVO DETECTADO: ${nuevoAnexo.nombre}`);
        
        return nuevoAnexo;
    },
    
    // Extraer restricciones técnicas de notas
    extraerRestricciones: (notas) => {
        const restricciones = [];
        
        notas.forEach(nota => {
            const texto = typeof nota === "string" ? nota : (nota.texto || "");
            const textoLower = texto.toLowerCase();
            
            // Buscar patrones de restricción técnica
            const patrones = [
                { patron: /energ[ií]a\s+solar/i, tipo: "ENERGIA_SOLAR", desc: "Requiere energía solar" },
                { patron: /energ[ií]a\s+(renovable|alternativa)/i, tipo: "ENERGIA_ALTERNATIVA", desc: "Requiere energía renovable/alternativa" },
                { patron: /no\s+hay\s+red\s+(el[é]ctrica|eléctrica)|sin\s+red\s+(el[é]ctrica|eléctrica)/i, tipo: "SIN_RED_ELECTRICA", desc: "Sin conexión a red eléctrica" },
                { patron: /sin\s+(acceso\s+)?electricidad/i, tipo: "SIN_ELECTRICIDAD", desc: "Sin acceso a electricidad" },
                { patron: /agua\s+potable/i, tipo: "AGUA_POTABLE", desc: "Requiere agua potable" },
                { patron: /zona\s+(rural|remota)/i, tipo: "ZONA_RURAL", desc: "Zona rural/remota" },
                { patron: /altura\s+(mayor|>\s*\d+)/i, tipo: "ALTURA", desc: "Requiere trabajo en altura" },
                { patron: /materiales?\s+(locales?|regionales?)/i, tipo: "MATERIALES_LOCALES", desc: "Debe usar materiales locales" },
                { patron: /no\s+(importar|exterior|extranjero)/i, tipo: "RESTRICCION_IMPORTACION", desc: "Restricción de importación" },
                { patron: /certificaci[oón]\s+(iso|local)/i, tipo: "CERTIFICACION", desc: "Requiere certificación específica" },
                { patron: /plazo\s+(corto|reducido|urgente)/i, tipo: "PLAZO_CORTO", desc: "Plazo reducido" }
            ];
            
            patrones.forEach(p => {
                if (p.patron.test(texto)) {
                    restricciones.push({
                        tipo: p.tipo,
                        descripcion: p.desc,
                        origen: texto.substring(0, 80),
                        mandatorio: true,
                        timestamp: new Date().toISOString()
                    });
                }
            });
        });
        
        return restricciones;
    },
    
    // Generar parámetros mandatorios
    generarParametros: (restricciones) => {
        const parametros = {
            id: `PM-${Date.now()}`,
            timestamp: new Date().toISOString(),
            cantidadRestricciones: restricciones.length,
            parametros: restricciones.map(r => ({
                codigo: r.tipo,
                descripcion: r.descripcion,
                valor: "REQUERIDO",
                origen: r.origen,
                obligatoria: true,
                prioridad: "ALTA"
            })),
            Instrucciones: restricciones.map(r => `CUMPLIR: ${r.descripcion}`)
        };
        
        console.log(`\n⚙️ PARÁMETROS MANDATORIOS GENERADOS: ${restricciones.length}`);
        restricciones.forEach(r => {
            console.log(`   • ${r.tipo}: ${r.descripcion}`);
        });
        
        return parametros;
    },
    
    // Enviar a Minero y Estratega
    enviarAMineroYEstratega: (parametros) => {
        const envio = {
            destino: ["Radar1_minero", "Radar2_Estratega"],
            parametros: parametros,
            timestamp: new Date().toISOString(),
            confirmacion: []
        };
        
        // Simular envío a Minero
        console.log(`\n📤 ENVIANDO A RADAR1_MINERO...`);
        console.log(`   📋 Parámetros: ${parametros.cantidadRestricciones} restricción(es)`);
        parametros.parametros.forEach(p => {
            console.log(`   • [MINERO] ${p.codigo}: ${p.descripcion}`);
        });
        envio.confirmacion.push({ receptor: "Radar1_minero", status: "ENVIADO" });
        
        // Simular envío a Estratega
        console.log(`\n📤 ENVIANDO A RADAR2_ESTRATEGA...`);
        parametros.parametros.forEach(p => {
            console.log(`   • [ESTRATEGA] ${p.codigo}: ${p.descripcion}`);
        });
        envio.confirmacion.push({ receptor: "Radar2_Estratega", status: "ENVIADO" });
        
        ParametrosMandatorios.parametrosEnviados.push(envio);
        
        console.log(`\n✅ ENVÍO COMPLETADO A AMBOS AGENTES`);
        
        return envio;
    },
    
    // Proceso completo: detectar, extraer, enviar
    procesoCompleto: (anexo, notas) => {
        console.log("\n" + "=".repeat(50));
        console.log("🔍 DETECCIÓN DE ANEXO + EXTRACCIÓN DE RESTRICCIONES");
        console.log("=".repeat(50));
        
        // 1. Detectar anexo activo
        const anexoDetectado = ParametrosMandatorios.detectarAnexoActivo(anexo);
        
        // 2. Extraer restricciones de notas
        console.log("\n📝 EXTRAENDO RESTRICCIONES TÉCNICAS...");
        const restricciones = ParametrosMandatorios.extraerRestricciones(notas);
        
        if (restricciones.length === 0) {
            console.log("   ⚠️ No se encontraron restricciones técnicas");
            return { error: "Sin restricciones detectadas" };
        }
        
        // 3. Generar parámetros
        const parametros = ParametrosMandatorios.generarParametros(restricciones);
        
        // 4. Enviar a Minero y Estratega
        const envio = ParametrosMandatorios.enviarAMineroYEstratega(parametros);
        
        return {
            anexo: anexoDetectado,
            restricciones: restricciones,
            parametros: parametros,
            envio: envio
        };
    },
    
    // Obtener historial de parámetros enviados
    obtenerHistorial: () => {
        return ParametrosMandatorios.parametrosEnviados;
    }
};

module.exports = ParametrosMandatorios;