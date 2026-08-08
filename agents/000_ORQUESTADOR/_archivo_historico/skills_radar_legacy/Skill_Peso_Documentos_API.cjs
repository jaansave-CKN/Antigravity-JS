/**
 * SKILL: PESO_DOCUMENTOS_API
 * Endpoint HTTP para actualizar weights desde la web
 */

const http = require("http");
const PesoDocumentos = require("./Skill_Peso_Documentos.cjs");

const PesoAPI = {
    nombre: "Peso Documentos API",
    puerto: 3852,
    estado: "INACTIVO",
    servidor: null,
    
    iniciar: () => {
        PesoDocumentos.cargarBaseDatos();
        
        PesoAPI.servidor = http.createServer((req, res) => {
            PesoAPI.manejarSolicitud(req, res);
        });
        
        PesoAPI.servidor.listen(PesoAPI.puerto, () => {
            PesoAPI.estado = "ACTIVO";
            console.log(`\n⚖️ PESO DOCUMENTOS API ACTIVADO`);
            console.log(`   Puerto: ${PesoAPI.puerto}`);
            console.log(`   Endpoint: /api/v1/peso-documentos`);
        });
        
        return { estado: "API_ACTIVA", puerto: PesoAPI.puerto };
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
        
        if (url === "/api/v1/peso-documentos") {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        const result = PesoDocumentos.actualizarOrden(data.filas);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify(result));
                    } catch(e) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            } else if (req.method === "GET") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    documentos: PesoDocumentos.obtenerTodos(),
                    prioridadAbsoluta: PesoDocumentos.obtenerPrioridadAbsoluta()
                }));
            }
        } else if (url === "/api/v1/peso-documentos/override") {
            if (req.method === "GET") {
                const criterios = PesoDocumentos.aplicarOverrideMinero({});
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(criterios));
            }
        } else if (url === "/api/v1/peso-documentos/reset") {
            PesoDocumentos.resetearWeights();
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));
        } else {
            res.writeHead(404);
            res.end();
        }
    }
};

module.exports = PesoAPI;