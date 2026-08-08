/**
 * SKILL: PROPAGACION_ESTADOS_API
 * Endpoint HTTP para procesar árbol de contexto
 */

const http = require("http");
const Propagacion = require("./Skill_Propagacion_Estados.cjs");

const PropagacionAPI = {
    nombre: "Propagación Estados API",
    puerto: 3854,
    estado: "INACTIVO",
    servidor: null,
    
    iniciar: () => {
        Propagacion.cargarBaseDatos();
        
        PropagacionAPI.servidor = http.createServer((req, res) => {
            PropagacionAPI.manejarSolicitud(req, res);
        });
        
        PropagacionAPI.servidor.listen(PropagacionAPI.puerto, () => {
            PropagacionAPI.estado = "ACTIVO";
            console.log(`\n🌲 PROPAGACIÓN ESTADOS API ACTIVADO`);
            console.log(`   Puerto: ${PropagacionAPI.puerto}`);
        });
        
        return { estado: "API_ACTIVA", puerto: PropagacionAPI.puerto };
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
        
        if (url === "/api/v1/arbol/procesar") {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        const resultado = Propagacion.procesarArbol(data.nodos);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify(resultado));
                    } catch(e) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
            }
        } else if (url === "/api/v1/arbol/activar") {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    const data = JSON.parse(body);
                    const resultado = Propagacion.propagarEstado(data.nodoId, true);
                    res.writeHead(200);
                    res.end(JSON.stringify(resultado));
                });
            }
        } else if (url === "/api/v1/arbol/estado") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(Propagacion.estado()));
        } else if (url === "/api/v1/arbol/activos") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ nodos: Propagacion.obtenerNodosActivos() }));
        } else {
            res.writeHead(404);
            res.end();
        }
    }
};

module.exports = PropagacionAPI;