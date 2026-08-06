/**
 * SKILL: CONTEXTO_DINAMICO (Endpoint /api/v1/context)
 * Combina: Documento + Metadata Entidad + Notas Personales
 * Marca Prioridad Crítica para restricciones/ventajas competitivas
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const NotasPersonales = require("./Skill_Notas_Personales.cjs");

const InstruccionesCriticas = {
    RESTRICCION: {
        sinonimos: ["restringir", "restricción", "prohibir", "no permitir", "bloquear", "exclusivo", "solo", "únicamente"],
        nivel: "CRITICA",
        tipo: "RESTRICCION"
    },
    VENTAJA: {
        sinonimos: ["ventaja", "exclusivo", "único", "preferente", "prioridad", "优先", "diferencial", "competitivo"],
        nivel: "CRITICA",
        tipo: "VENTAJA_COMPETITIVA"
    },
    CONFIDENCIAL: {
        sinonimos: ["confidencial", "secreto", "privado", "no publicar", "reservado", "interno"],
        nivel: "CRITICA",
        tipo: "CONFIDENCIAL"
    }
};

const ContextoDinamico = {
    nombre: "Contexto Dinámico API",
    puerto: 3848,
    estado: "INACTIVO",
    servidor: null,
    
    contextoActual: {
        documento: null,
        metadataEntidad: null,
        notasPersonales: [],
        reglasNegocio: [],
        prioridad: "NORMAL"
    },
    
    iniciar: () => {
        const server = http.createServer((req, res) => {
            ContextoDinamico.manejarSolicitud(req, res);
        });
        
        server.listen(ContextoDinamico.puerto, () => {
            ContextoDinamico.estado = "ACTIVO";
            ContextoDinamico.servidor = server;
            console.log(`\n🌐 CONTEXTO DINÁMICO API ACTIVADO`);
            console.log(`   Puerto: ${ContextoDinamico.puerto}`);
            console.log(`   Endpoint: http://localhost:${ContextoDinamico.puerto}/api/v1/context`);
        });
        
        return { estado: "API_INICIADA", puerto: ContextoDinamico.puerto };
    },
    
    manejarSolicitud: (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        
        if (req.method === "OPTIONS") {
            res.writeHead(200);
            res.end();
            return;
        }
        
        const url = req.url.split("?")[0];
        
        if (url === "/api/v1/context") {
            if (req.method === "GET") {
                ContextoDinamico.obtenerContexto(res);
            } else if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        ContextoDinamico.actualizarContexto(data, res);
                    } catch(e) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "JSON inválido" }));
                    }
                });
            }
        } else if (url === "/api/v1/context/combinar") {
            ContextoDinamico.combinarYGenerar(res);
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: "Endpoint no encontrado" }));
        }
    },
    
    // Recibir documento (PDF/Link)
    recibirDocumento: (documento) => {
        ContextoDinamico.contextoActual.documento = {
            tipo: documento.tipo || "desconocido",
            url: documento.url || "",
            nombre: documento.nombre || "Sin nombre",
            contenido: documento.contenido || "",
            timestamp: new Date().toISOString()
        };
        console.log(`📄 Documento recibido: ${documento.nombre || 'Sin nombre'}`);
        return ContextoDinamico.contextoActual.documento;
    },
    
    // Recibir metadata de entidad
    recibirMetadataEntidad: (metadata) => {
        ContextoDinamico.contextoActual.metadataEntidad = {
            nombre: metadata.nombre || "",
            nit: metadata.nit || "",
            tipo: metadata.tipo || "",
            sector: metadata.sector || "",
            ubicacion: metadata.ubicacion || "",
            contacto: metadata.contacto || "",
            historial: metadata.historial || [],
            timestamp: new Date().toISOString()
        };
        console.log(`🏢 Metadata entidad: ${metadata.nombre || 'Sin nombre'}`);
        return ContextoDinamico.contextoActual.metadataEntidad;
    },
    
    // Cruzar notas con documento y metadata
    combinarNotas: (notas) => {
        const contexto = ContextoDinamico.contextoActual;
        const cruces = [];
        
        // Cruzar notas con documento
        if (contexto.documento) {
            notas.forEach(nota => {
                const texto = nota.texto || nota;
                const docText = (contexto.documento.nombre + " " + contexto.documento.contenido).toLowerCase();
                
                if (texto.toLowerCase().split(" ").some(p => p.length > 3 && docText.includes(p))) {
                    cruces.push({
                        tipo: "DOCUMENTO",
                        nota: texto.substring(0, 50) + "...",
                        match: "Coincidencia encontrada"
                    });
                }
            });
        }
        
        // Cruzar notas con metadata
        if (contexto.metadataEntidad) {
            notas.forEach(nota => {
                const texto = nota.texto || nota;
                const metaText = (contexto.metadataEntidad.nombre + " " + contexto.metadataEntidad.sector).toLowerCase();
                
                if (texto.toLowerCase().split(" ").some(p => p.length > 3 && metaText.includes(p))) {
                    cruces.push({
                        tipo: "ENTIDAD",
                        nota: texto.substring(0, 50) + "...",
                        match: "Coincidencia encontrada"
                    });
                }
            });
        }
        
        return cruces;
    },
    
    // Detectar prioridad crítica
    detectarPrioridadCritica: (notas) => {
        let tieneCritica = false;
        const hallazgos = [];
        
        notas.forEach(nota => {
            const texto = typeof nota === "string" ? nota : (nota.texto || nota.contenido || JSON.stringify(nota));
            const textoLower = String(texto).toLowerCase();
            
            for (const [tipo, config] of Object.entries(InstruccionesCriticas)) {
                for (const sinonimo of config.sinonimos) {
                    if (textoLower.includes(sinonimo)) {
                        tieneCritica = true;
                        hallazgos.push({
                            tipo: config.tipo,
                            nivel: config.nivel,
                            palabra: sinonimo,
                            nota: texto,
                            timestamp: new Date().toISOString()
                        });
                        break;
                    }
                }
            }
        });
        
        if (tieneCritica) {
            ContextoDinamico.contextoActual.prioridad = "CRITICA";
            console.log(`🚨 PRIORIDAD CRÍTICA DETECTADA: ${hallazgos.length} instrucción(es)`);
        }
        
        return {
            esCritica: tieneCritica,
            hallazgos: hallazgos
        };
    },
    
    // Generar JSON unificado
    generarJSONUnificado: () => {
        const contexto = ContextoDinamico.contextoActual;
        const notas = NotasPersonales.notas; // Notas originales, no reglas
        const prioridad = ContextoDinamico.detectarPrioridadCritica(notas);
        
        return {
            metadata: {
                version: "1.0",
                timestamp: new Date().toISOString(),
                prioridad: prioridad.esCritica ? "CRITICA" : "NORMAL",
                flags: {
                    tieneDocumento: !!contexto.documento,
                    tieneMetadata: !!contexto.metadataEntidad,
                    tieneNotas: notas.length > 0,
                    esCritica: prioridad.esCritica
                }
            },
            documento: contexto.documento,
            metadataEntidad: contexto.metadataEntidad,
            notasPersonales: {
                reglas: notas.map(r => ({
                    tipo: r.tipo,
                    palabraClave: r.palabraClave,
                    comportamiento: r.comportamiento,
                    objeto: r.objeto || null
                })),
                prioridadCritica: prioridad
            },
            contextoCombinado: {
                resumen: contexto.documento ? `Documento: ${contexto.documento.nombre}` : "Sin documento",
                entidad: contexto.metadataEntidad ? contexto.metadataEntidad.nombre : "Sin entidad",
                reglasActivas: notas.length,
                nivelPrioridad: prioridad.esCritica ? "CRÍTICA" : "NORMAL"
            }
        };
    },
    
    obtenerContexto: (res) => {
        const json = ContextoDinamico.generarJSONUnificado();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json, null, 2));
    },
    
    actualizarContexto: (data, res) => {
        const response = { success: true, cambios: [] };
        
        if (data.documento) {
            ContextoDinamico.recibirDocumento(data.documento);
            response.cambios.push("documento");
        }
        
        if (data.metadataEntidad) {
            ContextoDinamico.recibirMetadataEntidad(data.metadataEntidad);
            response.cambios.push("metadataEntidad");
        }
        
        if (data.notas) {
            if (Array.isArray(data.notas)) {
                data.notas.forEach(n => NotasPersonales.agregarNota(n));
            } else {
                NotasPersonales.agregarNota(data.notas);
            }
            response.cambios.push("notasPersonales");
        }
        
        // Verificar prioridad crítica después de actualizar
        const prioridad = ContextoDinamico.detectarPrioridadCritica(
            NotasPersonales.notas.slice(-5)
        );
        
        response.prioridad = prioridad.esCritica ? "CRITICA" : "NORMAL";
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
    },
    
    combinarYGenerar: (res) => {
        const json = ContextoDinamico.generarJSONUnificado();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json, null, 2));
    },
    
    detener: () => {
        if (ContextoDinamico.servidor) {
            ContextoDinamico.servidor.close();
            ContextoDinamico.estado = "INACTIVO";
        }
        return { estado: "DETENIDO" };
    }
};

module.exports = ContextoDinamico;