/**
 * SKILL: PROTOCOLO_FUENTE_UNICA (Radar1_minero)
 * Extrae datos clave con cita textual del documento original
 * Si no encuentra el dato = "Dato Pendiente"
 * No asume ni infiere información
 */

const ExtraerDatos = {
    nombre: "Protocolo Fuente Única",
    version: "1.0",
    patrones: {
        presupuesto: [
            { regex: /(?:presupuesto|valor|monto|recursos|costo|inversi[oón])[\s:]*(?:aproximado|oficial|m[aá]ximo|mínimo)?[\s:]*\$?\s*[\d.,]+(?:\s*(?:mil|millones|million|MM))?/i, tipo: "presupuesto", extraer: 0 },
            { regex: /COP\s*[\d.,]+(?:\s*(?:mil|millones|million|MM))?/i, tipo: "presupuesto", extraer: 0 },
            { regex: /USD\s*[\d.,]+(?:\s*(?:mil|millones|million|MM))?/i, tipo: "presupuesto", extraer: 0 },
            { regex: /(?:hasta|entre|entre\s*el)\s*\$?[\d.,]+/i, tipo: "presupuesto", extraer: 0 }
        ],
        fechaCierre: [
            { regex: /cierre[\s:]*(?:el\s*)?(\d{1,2})[\sde]+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[\sde]?(\d{4})?/i, tipo: "fecha_cierre", extraer: 0 },
            { regex: /fecha[\sde]*cierre[\s:]*(?:el\s*)?(\d{1,2})[\sde]+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[\sde]?(\d{4})?/i, tipo: "fecha_cierre", extraer: 0 },
            { regex: /vence[\s:]*(?:el\s*)?(\d{1,2})[\/\-]([\d]{1,2})[\/\-](\d{2,4})/i, tipo: "fecha_cierre", extraer: 0 },
            { regex: /(\d{1,2})[\sde]+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[\sde]?(\d{4})?/i, tipo: "fecha_cierre", extraer: 0 }
        ],
        linkAplicacion: [
            { regex: /https?:\/\/[^\s<>"]+/i, tipo: "link", extraer: 0 },
            { regex: /www\.[\w\-\.]+\.(gov|org|com|net|edu)\.co[^\s<>"]*/i, tipo: "link", extraer: 0 },
            { regex: /portal[\sde]*[^\s]+(?=\.|,|$)/i, tipo: "link", extraer: 0 }
        ],
        entidad: [
            { regex: /^(?:Entidad|Organismo|Instituci[oón])[\s:]*(.+?)(?=\.|,|$)/im, tipo: "entidad", extraer: 1 },
            { regex: /(?:convocada|licitada|publicada)\s+por\s+(.+?)(?=\.|,|$)/i, tipo: "entidad", extraer: 1 },
            { regex: /Alcald[iá]a|de\s+([A-Z][a-z]+)/i, tipo: "entidad", extraer: 0 }
        ]
    },

    extraerCampo: (texto, tipo) => {
        const patrones = ExtraerDatos.patrones[tipo] || [];
        
        for (const patron of patrones) {
            const match = texto.match(patron.regex);
            if (match) {
                return {
                    encontrado: true,
                    valor: match[0],
                    citaOriginal: match[0],
                    tipo: patron.tipo,
                    confianza: "ALTA"
                };
            }
        }
        
        return {
            encontrado: false,
            valor: "Dato Pendiente",
            citaOriginal: null,
            tipo: tipo,
            confianza: "NINGUNA"
        };
    },

    extraerDatosCompletos: (documento) => {
        const texto = documento.texto || documento.convocatoria || documento;
        
        const resultado = {
            metadata: {
                documentoOriginal: documento.fuente || documento.id || "Sin fuente",
                fechaExtraccion: new Date().toISOString(),
                protocolo: "FUENTE_UNICA_V1"
            },
            datos: {}
        };

        // Extraer cada campo con cita literal
        resultado.datos.presupuesto = ExtraerDatos.extraerCampo(texto, "presupuesto");
        resultado.datos.fechaCierre = ExtraerDatos.extraerCampo(texto, "fechaCierre");
        resultado.datos.linkAplicacion = ExtraerDatos.extraerCampo(texto, "linkAplicacion");
        resultado.datos.entidad = ExtraerDatos.extraerCampo(texto, "entidad");

        // Calcular completitud
        const encontrados = Object.values(resultado.datos).filter(d => d.encontrado).length;
        const total = Object.keys(resultado.datos).length;
        resultado.completitud = {
            encontrado: encontrados,
            total: total,
            porcentaje: Math.round((encontrados / total) * 100)
        };

        return resultado;
    },

    generarReporte: (documento) => {
        const extraccion = ExtraerDatos.extraerDatosCompletos(documento);
        
        console.log("\n" + "=".repeat(50));
        console.log("📄 EXTRACCIÓN - PROTOCOLO FUENTE ÚNICA");
        console.log("=".repeat(50));
        console.log(`Documento: ${extraccion.metadata.documentoOriginal}`);
        
        console.log("\n📊 DATOS EXTRAÍDOS:");
        
        Object.entries(extraccion.datos).forEach(([key, dato]) => {
            const icono = dato.encontrado ? "✓" : "⏳";
            const color = dato.encontrado ? "📌 CITA:" : "⚠️";
            console.log(`\n${icono} ${key.toUpperCase()}:`);
            if (dato.encontrado) {
                console.log(`   ${color} "${dato.citaOriginal}"`);
                console.log(`   Confianza: ${dato.confianza}`);
            } else {
                console.log(`   ⚠️ ${dato.valor}`);
            }
        });
        
        console.log(`\n📈 Completitud: ${extraccion.completitud.encontrados}/${extraccion.completitud.total} (${extraccion.completitud.porcentaje}%)`);
        console.log("=".repeat(50));

        return extraccion;
    },

    // Validar que todos los datos tengan cita o estén pendientes
    validarExtraccion: (resultado) => {
        const validacion = {
            tieneCitas: true,
            tienePendientes: false,
            listaPendientes: []
        };

        Object.entries(resultado.datos).forEach(([key, dato]) => {
            if (!dato.encontrado) {
                validacion.tienePendientes = true;
                validacion.listaPendientes.push(key);
            }
            if (!dato.citaOriginal && dato.encontrado) {
                validacion.tieneCitas = false;
            }
        });

        return validacion;
    }
};

module.exports = ExtraerDatos;