/**
 * SKILL: UPLOAD_CONTEXTO
 * Endpoint: /api/v1/upload-context
 * Recibe archivos binarios de Central de Alertas
 * Almacena en carpeta temporal de Contexto Activo
 * Notifica Minero cuando archivo pasa isActive: false -> true
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const UploadContexto = {
    nombre: "Upload Contexto Activo",
    puerto: 3851,
    estado: "INACTIVO",
    servidor: null,
    
    config: {
        uploadPath: path.join(process.cwd(), "Radar_Resultados", "contexto_activo"),
        maxSize: 50 * 1024 * 1024, // 50MB
        allowedExtensions: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".png", ".zip"]
    },
    
    archivos: [],
    notificacionesMinero: [],
    
    iniciar: () => {
        // Crear directorio si no existe
        if (!fs.existsSync(UploadContexto.config.uploadPath)) {
            fs.mkdirSync(UploadContexto.config.uploadPath, { recursive: true });
        }
        
        UploadContexto.servidor = http.createServer((req, res) => {
            UploadContexto.manejarSolicitud(req, res);
        });
        
        UploadContexto.servidor.listen(UploadContexto.puerto, () => {
            UploadContexto.estado = "ACTIVO";
            console.log(`\n📁 UPLOAD CONTEXTO ACTIVO`);
            console.log(`   Puerto: ${UploadContexto.puerto}`);
            console.log(`   Endpoint: /api/v1/upload-context`);
            console.log(`   Carpeta: ${UploadContexto.config.uploadPath}`);
        });
        
        return { estado: "UPLOAD_ACTIVO", puerto: UploadContexto.puerto };
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
        
        if (url === "/api/v1/upload-context") {
            if (req.method === "POST") {
                UploadContexto.recibirArchivo(req, res);
            }
        } else if (url === "/api/v1/upload-context") {
            if (req.method === "GET") {
                UploadContexto.listarArchivos(res);
            }
        } else if (url === "/api/v1/upload-context/activar") {
            if (req.method === "POST") {
                UploadContexto.activarArchivo(req, res);
            }
        } else if (url === "/api/v1/upload-context/notificaciones") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ notificaciones: UploadContexto.notificacionesMinero }));
        } else {
            res.writeHead(404);
            res.end();
        }
    },
    
    recibirArchivo: (req, res) => {
        let body = "";
        const buffers = [];
        
        req.on("data", chunk => {
            buffers.push(chunk);
        });
        
        req.on("end", () => {
            try {
                // Extraer headers
                const contentType = req.headers["content-type"] || "";
                const filename = "archivo_" + Date.now();
                
                // Crear archivo
                const filePath = path.join(UploadContexto.config.uploadPath, filename);
                const buffer = Buffer.concat(buffers);
                
                fs.writeFileSync(filePath, buffer);
                
                const archivo = {
                    id: `UPL-${Date.now()}`,
                    nombre: filename,
                    path: filePath,
                    tamano: buffer.length,
                    tipo: contentType,
                    isActive: false,
                    timestamp: new Date().toISOString(),
                    uploadsCount: 1
                };
                
                UploadContexto.archivos.push(archivo);
                
                console.log(`\n📤 ARCHIVO RECIBIDO: ${archivo.id}`);
                console.log(`   Tamaño: ${(archivo.tamano / 1024).toFixed(2)} KB`);
                console.log(`   Estado: isActive = ${archivo.isActive}`);
                
                res.writeHead(201, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    success: true,
                    archivo: archivo,
                    mensaje: "Archivo almacenado en Contexto Activo"
                }));
                
            } catch(e) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    },
    
    // Activar archivo (isActive: false -> true) y notificar Minero
    activarArchivo: (req, res) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                const archivoId = data.archivoId;
                
                const archivo = UploadContexto.archivos.find(a => a.id === archivoId);
                
                if (!archivo) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: "Archivo no encontrado" }));
                    return;
                }
                
                const eraActivo = archivo.isActive;
                archivo.isActive = true;
                archivo.timestampActivacion = new Date().toISOString();
                
                console.log(`\n🔔 ACTIVACIÓN DE ARCHIVO: ${archivo.id}`);
                console.log(`   Era activo: ${eraActivo}`);
                console.log(`   Ahora activo: ${archivo.isActive}`);
                
                // Si pasó de false a true, notificar Minero
                if (!eraActivo && archivo.isActive) {
                    UploadContexto.notificarMinero(archivo);
                }
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    success: true,
                    archivo: archivo,
                    minerNotificado: !eraActivo
                }));
                
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    },
    
    // Notificar Minero cuando archivo se activa
    notificarMinero: (archivo) => {
        const notificacion = {
            id: `NOTIF-${Date.now()}`,
            tipo: "ARCHIVO_ACTIVADO",
            archivo: {
                id: archivo.id,
                nombre: archivo.nombre,
                path: archivo.path
            },
            timestamp: new Date().toISOString(),
            para: "Radar1_minero",
            mensaje: `Archivo "${archivo.nombre}" Activado en Contexto. Listo para procesamiento.`
        };
        
        UploadContexto.notificacionesMinero.push(notificacion);
        
        console.log(`\n📨 NOTIFICACIÓN ENVIADA A RADAR1_MINERO`);
        console.log(`   Archivo: ${archivo.nombre}`);
        console.log(`   Estado: ACTIVADO`);
        
        return notificacion;
    },
    
    listarArchivos: (res) => {
        const lista = UploadContexto.archivos.map(a => ({
            id: a.id,
            nombre: a.nombre,
            tamano: a.tamano,
            isActive: a.isActive,
            timestamp: a.timestamp
        }));
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            total: lista.length,
            archivos: lista
        }));
    },
    
    obtenerNotificaciones: () => {
        return UploadContexto.notificacionesMinero;
    },
    
    estado: () => {
        return {
            estado: UploadContexto.estado,
            puerto: UploadContexto.puerto,
            totalArchivos: UploadContexto.archivos.length,
            activos: UploadContexto.archivos.filter(a => a.isActive).length
        };
    }
};

module.exports = UploadContexto;