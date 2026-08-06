/**
 * SKILL: VALIDACION_BUSQUEDA
 * Bloquea peticiones de búsqueda hasta que un documento Nivel 1 esté ON
 * Limpia mensaje de error cuando se activa primer documento
 */

const http = require("http");

const ValidacionBusqueda = {
    nombre: "Validación de Búsqueda",
    puerto: 3853,
    estado: "INACTIVO",
    servidor: null,
    
    // Estado de documentos Nivel 1
    documentosNivel1: {},
    
    // Peticiones bloqueadas
    peticionesBloqueadas: [],
    
    // Estado del sistema
    sistemaListo: false,
    errorFetchLimpio: false,
    
    iniciar: () => {
        ValidacionBusqueda.servidor = http.createServer((req, res) => {
            ValidacionBusqueda.manejarSolicitud(req, res);
        });
        
        ValidacionBusqueda.servidor.listen(ValidacionBusqueda.puerto, () => {
            ValidacionBusqueda.estado = "ACTIVO";
            console.log(`\n🔒 VALIDACIÓN DE BÚSQUEDA ACTIVADO`);
            console.log(`   Puerto: ${ValidacionBusqueda.puerto}`);
            console.log(`   Estado inicial: BLOQUEADO (sin documentos Nivel 1 ON)`);
            console.log(`   Error fetch: ${ValidacionBusqueda.errorFetchLimpio ? 'LIMPIADO' : 'PENDIENTE'}`);
        });
        
        return { estado: "VALIDACION_ACTIVA", puerto: ValidacionBusqueda.puerto };
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
        
        // Endpoint de búsqueda - verificar estado primero
        if (url === "/api/v1/busqueda" || url === "/api/v1/search") {
            if (req.method === "POST" || req.method === "GET") {
                ValidacionBusqueda.procesarBusqueda(req, res);
            }
        }
        // Activar documento Nivel 1
        else if (url === "/api/v1/documento-nivel1/activar") {
            if (req.method === "POST") {
                ValidacionBusqueda.activarDocumento(req, res);
            }
        }
        // Estado del sistema
        else if (url === "/api/v1/validacion/estado") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(ValidacionBusqueda.obtenerEstado()));
        }
        // Limpiar error
        else if (url === "/api/v1/validacion/limpiar-error") {
            ValidacionBusqueda.errorFetchLimpio = true;
            console.log(`\n✅ MENSAJE DE ERROR LIMPIADO`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, mensaje: "Error limpiado" }));
        }
        else {
            res.writeHead(404);
            res.end();
        }
    },
    
    procesarBusqueda: (req, res) => {
        // Verificar si hay al menos un documento Nivel 1 en estado ON
        const hayDocumentoON = Object.values(ValidacionBusqueda.documentosNivel1).some(doc => doc.estado === "ON");
        
        if (!hayDocumentoON) {
            console.log(`\n⛔ BÚSQUEDA BLOQUEADA`);
            console.log(`   Razón: No hay documentos Nivel 1 en estado ON`);
            console.log(`   Documentos activos: ${Object.values(ValidacionBusqueda.documentosNivel1).filter(d => d.estado === 'ON').length}`);
            
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                bloqueado: true,
                razon: "DOCUMENTO_NIVEL1_REQUERIDO",
                mensaje: "Active al menos un documento de Nivel 1 (círculo verde) antes de buscar",
                documentosON: Object.values(ValidacionBusqueda.documentosNivel1).filter(d => d.estado === "ON").length,
                errorFetchLimpio: ValidacionBusqueda.errorFetchLimpio
            }));
            return;
        }
        
        console.log(`\n✅ BÚSQUEDA PERMITIDA`);
        console.log(`   Documentos Nivel 1 ON: ${Object.values(ValidacionBusqueda.documentosNivel1).filter(d => d.estado === 'ON').length}`);
        
        // Si estaba bloqueado por error previo, limpiar
        ValidacionBusqueda.errorFetchLimpio = true;
        
        // Continuar con la búsqueda...
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                success: true,
                busquedaPermitida: true,
                mensaje: "Búsqueda ejecutada correctamente"
            }));
        });
    },
    
    activarDocumento: (req, res) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const docId = data.documentoId;
                
                // Registrar documento Nivel 1
                ValidacionBusqueda.documentosNivel1[docId] = {
                    id: docId,
                    nombre: data.nombre || "Documento " + docId,
                    estado: "ON",
                    nivel: 1,
                    timestamp: new Date().toISOString()
                };
                
                // Limpiar error si es el primero en activarse
                if (!ValidacionBusqueda.errorFetchLimpio) {
                    ValidacionBusqueda.errorFetchLimpio = true;
                    console.log(`\n🟢 PRIMER DOCUMENTO NIVEL 1 ACTIVADO`);
                    console.log(`   ID: ${docId}`);
                    console.log(`   ✅ Error "Failed to fetch" LIMPIADO`);
                }
                
                console.log(`\n🔵 DOCUMENTO NIVEL 1 ACTIVADO: ${docId}`);
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    success: true,
                    documento: ValidacionBusqueda.documentosNivel1[docId],
                    sistemaListo: ValidacionBusqueda.sistemaListo(),
                    errorLimpiado: ValidacionBusqueda.errorFetchLimpio
                }));
                
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    },
    
    sistemaListo: () => {
        return Object.values(ValidacionBusqueda.documentosNivel1).some(doc => doc.estado === "ON");
    },
    
    obtenerEstado: () => {
        const docsON = Object.values(ValidacionBusqueda.documentosNivel1).filter(d => d.estado === "ON");
        
        return {
            estado: ValidacionBusqueda.estado,
            sistemaListo: ValidacionBusqueda.sistemaListo(),
            documentosNivel1ON: docsON.length,
            totalDocumentos: Object.keys(ValidacionBusqueda.documentosNivel1).length,
            busquedaBloqueada: !ValidacionBusqueda.sistemaListo(),
            errorFetchLimpio: ValidacionBusqueda.errorFetchLimpio,
            mensaje: ValidacionBusqueda.sistemaListo() 
                ? "Sistema listo - Busquedas permitidas" 
                : "Active un documento Nivel 1 para buscar"
        };
    }
};

module.exports = ValidacionBusqueda;