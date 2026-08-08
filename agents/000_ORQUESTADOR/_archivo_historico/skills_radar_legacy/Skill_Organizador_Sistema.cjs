const fs = require("fs");
const path = require("path");

const CARPETAS_SISTEMA = ["agents", "skills", "config", "docs", "scripts", "lib", "src", "public", "dist", "tests", "logs", "proyectos", "node_modules", ".git", ".vscode", ".firebase", ". claude"];
const CARPETA_RAIZ = process.cwd();

const REGLAS = {
    ".cjs": { carpeta: "agents", excepciones: ["skills", "scripts", "tests", "proyectos"] },
    ".json": { carpeta: "config", excepciones: ["proyectos", "node_modules"] },
    ".md": { carpeta: "docs", excepciones: ["proyectos"] },
    ".txt": { carpeta: "docs", excepciones: ["scripts", "proyectos"] },
    ".log": { carpeta: "logs", excepciones: [] },
    ".ps1": { carpeta: "scripts", excepciones: [] },
    ".bat": { carpeta: "scripts", excepciones: [] },
    ".html": { carpeta: "public", excepciones: ["proyectos", "dist"] },
    ".traineddata": { carpeta: "lib", excepciones: [] },
    ".env": { carpeta: "raiz", excepciones: [] },
    ".gitignore": { carpeta: "raiz", excepciones: [] },
    "package.json": { carpeta: "raiz", excepciones: [] },
    "package-lock.json": { carpeta: "raiz", excepciones: [] },
    "vite.config.js": { carpeta: "raiz", excepciones: [] },
    "server.js": { carpeta: "src", excepciones: ["raiz"] },
    "index.html": { carpeta: "public", excepciones: ["raiz"] },
    "README.md": { carpeta: "docs", excepciones: [] },
    "BITACORA.md": { carpeta: "docs", excepciones: [] }
};

function esCarpetaSistema(nombre) {
    return CARPETAS_SISTEMA.includes(nombre.toLowerCase());
}

function obtenerCarpetaCorrecta(nombreArchivo) {
    const ext = path.extname(nombreArchivo).toLowerCase();
    if (REGLAS[ext]) return REGLAS[ext].carpeta;
    if (REGLAS[nombreArchivo]) return REGLAS[nombreArchivo].carpeta;
    return null;
}

function esUbicacionCorrecta(rutaActual, carpetaCorrecta) {
    if (carpetaCorrecta === "raiz") return false;
    const rutaLower = rutaActual.toLowerCase();
    return rutaLower.endsWith(`\\${carpetaCorrecta}`) || rutaLower.endsWith(`/${carpetaCorrecta}`);
}

function estaEnProyecto(ruta) {
    return ruta.toLowerCase().includes("\\proyectos\\") || ruta.toLowerCase().includes("/proyectos/");
}

function organizarArchivo(rutaArchivo) {
    const nombreArchivo = path.basename(rutaArchivo);
    const ext = path.extname(nombreArchivo).toLowerCase();
    const directorioActual = path.dirname(rutaArchivo);
    const enProyecto = estaEnProyecto(directorioActual);
    
    if (enProyecto) return false;
    
    const carpetaCorrecta = obtenerCarpetaCorrecta(nombreArchivo);
    if (!carpetaCorrecta || carpetaCorrecta === "raiz") return false;
    
    if (esUbicacionCorrecta(directorioActual, carpetaCorrecta)) return false;
    
    const rutaDestino = path.join(CARPETA_RAIZ, carpetaCorrecta, nombreArchivo);
    
    if (fs.existsSync(rutaDestino)) {
        console.log(`⚠️ Ya existe: ${nombreArchivo} en ${carpetaCorrecta}/`);
        return false;
    }
    
    try {
        fs.renameSync(rutaArchivo, rutaDestino);
        console.log(`✅ Movido: ${nombreArchivo} → ${carpetaCorrecta}/`);
        registrarAccion("MOVER", nombreArchivo, directorioActual, carpetaCorrecta);
        return true;
    } catch (error) {
        console.error(`❌ Error: ${nombreArchivo} - ${error.message}`);
        return false;
    }
}

function escanearDirectorio(directorio, profundidad = 0) {
    let archivosMovidos = 0;
    const indent = "  ".repeat(profundidad);
    
    if (!fs.existsSync(directorio)) return 0;
    
    try {
        const items = fs.readdirSync(directorio, { withFileTypes: true });
        
        for (const item of items) {
            const rutaCompleta = path.join(directorio, item.name);
            
            if (item.isDirectory()) {
                if (!esCarpetaSistema(item.name)) {
                    if (profundidad === 0) {
                        console.log(`${indent}📁 Escaneando: ${item.name}/`);
                    }
                    archivosMovidos += escanearDirectorio(rutaCompleta, profundidad + 1);
                }
            } else if (item.isFile() && !item.name.startsWith(".")) {
                if (organizarArchivo(rutaCompleta)) {
                    archivosMovidos++;
                }
            }
        }
    } catch (error) {
        console.error(`${indent}❌ Error escaneando ${directorio}: ${error.message}`);
    }
    
    return archivosMovidos;
}

function escanearYOrganizar() {
    console.log("\n" + "=".repeat(50));
    console.log("🧹 ESCANEO DE ORGANIZACIÓN");
    console.log("=".repeat(50));
    
    const inicio = Date.now();
    let totalMovidos = 0;
    
    const itemsRaiz = fs.readdirSync(CARPETA_RAIZ, { withFileTypes: true });
    
    for (const item of itemsRaiz) {
        if (item.isFile() && !item.name.startsWith(".")) {
            if (organizarArchivo(path.join(CARPETA_RAIZ, item.name))) {
                totalMovidos++;
            }
        } else if (item.isDirectory() && !esCarpetaSistema(item.name)) {
            console.log(`\n📁 Escaneando: ${item.name}/`);
            totalMovidos += escanearDirectorio(path.join(CARPETA_RAIZ, item.name), 1);
        }
    }
    
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    
    console.log("\n" + "=".repeat(50));
    console.log(`✅ Total archivos movidos: ${totalMovidos}`);
    console.log(`⏱️ Tiempo: ${duracion}s`);
    console.log("=".repeat(50));
    
    if (totalMovidos > 0) {
        registrarAccion("LIMPIEZA_COMPLETA", "sistema", "varios", `${totalMovidos} archivos`);
    }
    
    return totalMovidos;
}

function registrarAccion(tipo, archivo, origen, destino) {
    const log = `[${new Date().toISOString()}] ${tipo}: ${archivo} | De: ${origen} | A: ${destino}\n`;
    fs.appendFileSync(path.join(CARPETA_RAIZ, "logs", "organizacion.log"), log);
}

function vigilarSegundoPlano() {
    console.log("👁️ Vigilando organización del sistema cada 60 segundos...\n");
    
    setInterval(() => {
        const count = escanearYOrganizar();
        if (count > 0) {
            console.log(`\n🧹 Limpieza automática completada: ${count} archivos organizados\n`);
        }
    }, 60000);
}

module.exports = {
    escanearYOrganizar,
    organizarArchivo,
    vigilarSegundoPlano,
    escanearDirectorio
};

if (require.main === module) {
    escanearYOrganizar();
}