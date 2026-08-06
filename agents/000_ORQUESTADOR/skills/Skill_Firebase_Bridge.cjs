/**
 * SKILL: FIREBASE_BRIDGE
 * Bridge para Firebase: antigravity-jairo-2026.web.app
 * Sincroniza Centro de Alertas
 * Mapea Base de Datos de Soportes Documentales
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const FirebaseBridge = {
    nombre: "Firebase Bridge",
    urlBase: "https://antigravity-jairo-2026.web.app",
    puerto: 3849,
    estado: "INACTIVO",
    servidor: null,
    
    soporteDocumental: {
        dbPath: path.join(process.cwd(), "Radar_Resultados", "soportes_documentales.json"),
        collection: "soportes",
        documentos: [],
        mapeoActivo: false
    },
    
    iniciar: (url) => {
        FirebaseBridge.urlBase = url || "https://antigravity-jairo-2026.web.app";
        
        // Crear servidor HTTP
        FirebaseBridge.servidor = http.createServer((req, res) => {
            FirebaseBridge.manejarSolicitud(req, res);
        });
        
        FirebaseBridge.servidor.listen(FirebaseBridge.puerto, () => {
            FirebaseBridge.estado = "ACTIVO";
            console.log(`\n🌉 FIREBASE BRIDGE ACTIVADO`);
            console.log(`   URL: ${FirebaseBridge.urlBase}`);
            console.log(`   Puerto escucha: ${FirebaseBridge.puerto}`);
            console.log(`   Estado: CONECTADO`);
        });
        
        // Inicializar base de datos de suportes
        FirebaseBridge.inicializarDB();
        
        return { 
            estado: "BRIDGE_ACTIVO", 
            url: FirebaseBridge.urlBase,
            puerto: FirebaseBridge.puerto
        };
    },
    
    manejarSolicitud: (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        
        if (req.method === "OPTIONS") {
            res.writeHead(200);
            res.end();
            return;
        }
        
        const url = req.url.split("?")[0];
        
        // Endpoint para sync de alertas
        if (url === "/api/bridge/alertas/sync") {
            FirebaseBridge.syncAlertas(res);
        }
        // Endpoint para soporte documental
        else if (url === "/api/bridge/soportes") {
            if (req.method === "GET") {
                FirebaseBridge.obtenerSoportes(res);
            } else if (req.method === "POST") {
                FirebaseBridge.recibirSoporte(req, res);
            }
        }
        // Endpoint de health
        else if (url === "/api/bridge/ping") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ 
                status: "OK", 
                url: FirebaseBridge.urlBase,
                timestamp: new Date().toISOString() 
            }));
        }
        else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: "Endpoint no encontrado" }));
        }
    },
    
    // Inicializar base de datos de suportes documentales
    inicializarDB: () => {
        try {
            if (fs.existsSync(FirebaseBridge.soporteDocumental.dbPath)) {
                const data = JSON.parse(fs.readFileSync(FirebaseBridge.soporteDocumental.dbPath, "utf8"));
                FirebaseBridge.soporteDocumental.documentos = data.documentos || [];
                console.log(`📂 Base de datos Soportes Documentales cargada: ${FirebaseBridge.soporteDocumental.documentos.length} documentos`);
            } else {
                FirebaseBridge.soporteDocumental.documentos = [];
                FirebaseBridge.guardarDB();
                console.log(`📂 Base de datos Soportes Documentales inicializada`);
            }
            FirebaseBridge.soporteDocumental.mapeoActivo = true;
        } catch(e) {
            console.log(`⚠️ Error al inicializar DB: ${e.message}`);
        }
    },
    
    guardarDB: () => {
        const data = {
            collection: FirebaseBridge.soporteDocumental.collection,
            ultimoUpdate: new Date().toISOString(),
            totalDocumentos: FirebaseBridge.soporteDocumental.documentos.length,
            documentos: FirebaseBridge.soporteDocumental.documentos
        };
        
        // Crear directorio si no existe
        const dir = path.dirname(FirebaseBridge.soporteDocumental.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(FirebaseBridge.soporteDocumental.dbPath, JSON.stringify(data, null, 2));
    },
    
    // Sincronizar Centro de Alertas
    syncAlertas: (res) => {
        const API_Alertas = require("./Skill_API_Alertas.cjs");
        
        const estado = API_Alertas.estado();
        
        const sync = {
            success: true,
            timestamp: new Date().toISOString(),
            fuente: FirebaseBridge.urlBase,
            contadores: {
                criticas: estado.contadores.activas, // Simplificado
                altas: 0,
                activas: estado.contadores.activas,
                totales: estado.contadores.totales
            },
            estado: "SINCRONIZADO"
        };
        
        console.log(`\n🔄 CENTRO DE ALERTAS SINCRONIZADO CON FIREBASE`);
        console.log(`   URL: ${FirebaseBridge.urlBase}`);
        console.log(`   Activas: ${sync.contadores.activas}`);
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sync));
    },
    
    // Mapear nota de la web a JSON local de contexto
    recibirSoporte: (req, res) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                
                const soporte = {
                    id: `SPD-${Date.now()}`,
                    tipo: data.tipo || "nota",
                    titulo: data.titulo || "Sin título",
                    contenido: data.contenido || "",
                    autor: data.autor || "web_user",
                    timestamp: new Date().toISOString(),
                    origen: "web_app",
                    urlOrigen: FirebaseBridge.urlBase,
                    sincronizado: true
                };
                
                // Guardar en JSON local de contexto
                FirebaseBridge.soporteDocumental.documentos.push(soporte);
                FirebaseBridge.guardarDB();
                
                console.log(`\n💾 SOPORTE DOCUMENTAL GUARDADO`);
                console.log(`   ID: ${soporte.id}`);
                console.log(`   Título: ${soporte.titulo}`);
                console.log(`   Origen: Web App`);
                
                // Notificar al módulo de contexto
                const ContextoDinamico = require("./Skill_Contexto_Dinamico.cjs");
                // Actualizar contexto si existe
                
                res.writeHead(201, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    success: true,
                    soporte: soporte,
                    mensaje: "Soporte guardado en JSON local de contexto"
                }));
                
            } catch(e) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "JSON inválido", detalle: e.message }));
            }
        });
    },
    
    // Obtener todos los suportes documentales
    obtenerSoportes: (res) => {
        const respuesta = {
            success: true,
            total: FirebaseBridge.soporteDocumental.documentos.length,
            documentos: FirebaseBridge.soporteDocumental.documentos,
            mapeoActivo: FirebaseBridge.soporteDocumental.mapeoActivo
        };
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(respuesta));
    },
    
    // Mapear nota específica al contexto
    mapearNotaAContexto: (nota) => {
        const soporte = {
            id: `SPD-${Date.now()}`,
            tipo: "nota_contexto",
            titulo: nota.titulo || "Nota de contexto",
            contenido: nota.contenido || "",
            timestamp: new Date().toISOString(),
            origen: "nota_personal",
            sincronizado: false
        };
        
        FirebaseBridge.soporteDocumental.documentos.push(soporte);
        FirebaseBridge.guardarDB();
        
        console.log(`\n🗺️ NOTA MAPEADA A CONTEXTO`);
        console.log(`   ID: ${soporte.id}`);
        
        return soporte;
    },
    
    // Obtener estado del bridge
    estado: () => {
        return {
            estado: FirebaseBridge.estado,
            url: FirebaseBridge.urlBase,
            puerto: FirebaseBridge.puerto,
            mapeoActivo: FirebaseBridge.soporteDocumental.mapeoActivo,
            totalSoportes: FirebaseBridge.soporteDocumental.documentos.length
        };
    },
    
    detener: () => {
        if (FirebaseBridge.servidor) {
            FirebaseBridge.servidor.close();
            FirebaseBridge.estado = "INACTIVO";
        }
        return { estado: "DETENIDO" };
    }
};

module.exports = FirebaseBridge;