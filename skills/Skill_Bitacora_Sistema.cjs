const fs = require("fs");
const path = require("path");

const nombre = "Bitácora del Sistema";
const descripcion = "Registra todas las acciones del ORQUESTADOR en bitácora. Usa automaticamente para logging de comandos, errores y eventos del sistema.";
const palabrasClave = ["bitacora", "log", "registro", "historial", "actividad", "logro", "error", "accion"];

const RAIZ = path.join(__dirname, "..");
const CARPETA_LOGS = path.join(RAIZ, "logs");
const ARCHIVO_BITACORA = path.join(CARPETA_LOGS, "bitacora_sistema.json");

function init() {
    if (!fs.existsSync(CARPETA_LOGS)) {
        fs.mkdirSync(CARPETA_LOGS, { recursive: true });
    }
    if (!fs.existsSync(ARCHIVO_BITACORA)) {
        fs.writeFileSync(ARCHIVO_BITACORA, JSON.stringify({ entradas: [], config: { creado: new Date().toISOString(), version: "1.0" } }, null, 2));
    }
    log("Bitacora del Sistema cargada", "ok");
}

function cargarBitacora() {
    try {
        if (fs.existsSync(ARCHIVO_BITACORA)) {
            return JSON.parse(fs.readFileSync(ARCHIVO_BITACORA, "utf8"));
        }
    } catch (e) {}
    return { entradas: [], config: { creado: new Date().toISOString(), version: "1.0" } };
}

function guardarBitacora(data) {
    try {
        fs.writeFileSync(ARCHIVO_BITACORA, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

function generarId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function registrar(tipo, mensaje, datos = {}) {
    const bitacora = cargarBitacora();
    const entrada = {
        id: generarId(),
        timestamp: new Date().toISOString(),
        tipo: tipo,
        mensaje: mensaje,
        datos: datos,
        sesion: process.env.SESION_ID || "default"
    };
    bitacora.entradas.unshift(entrada);
    if (bitacora.entradas.length > 1000) {
        bitacora.entradas = bitacora.entradas.slice(0, 1000);
    }
    guardarBitacora(bitacora);
    console.log("📝 [" + tipo.toUpperCase() + "] " + mensaje);
    return entrada;
}

function log(mensaje, tipo = "info") {
    const iconos = { info: "📝", ok: "✅", warn: "⚠️", error: "❌", proceso: "⚙️" };
    console.log(iconos[tipo] + " " + mensaje);
}

function registrarAccion(accion, detalle, agente = "ORQUESTADOR") {
    return registrar("ACCION", agente + ": " + accion, { detalle: detalle });
}

function registrarError(modulo, error, contexto = {}) {
    return registrar("ERROR", modulo + " - " + error.message, { stack: error.stack, contexto: contexto });
}

function registrarDelegacion(agenteDestino, tarea, resultado = "pendiente") {
    return registrar("DELEGACION", "Delegado a " + agenteDestino, { tarea: tarea, resultado: resultado });
}

function registrarSkill(skillNombre, accion, parametros = {}) {
    return registrar("SKILL", skillNombre + " - " + accion, { parametros: parametros });
}

function obtenerEntradas(filtro = {}, limite = 50) {
    const bitacora = cargarBitacora();
    let entradas = bitacora.entradas;
    if (filtro.tipo) {
        entradas = entradas.filter(e => e.tipo === filtro.tipo);
    }
    if (filtro.buscar) {
        const termino = filtro.buscar.toLowerCase();
        entradas = entradas.filter(e => e.mensaje.toLowerCase().includes(termino));
    }
    return entradas.slice(0, limite);
}

function obtenerEstadisticas() {
    const bitacora = cargarBitacora();
    const stats = {
        total: bitacora.entradas.length,
        porTipo: {},
        ultimaAccion: bitacora.entradas[0] || null,
        fechaCreacion: bitacora.config.creado
    };
    for (const entrada of bitacora.entradas) {
        stats.porTipo[entrada.tipo] = (stats.porTipo[entrada.tipo] || 0) + 1;
    }
    return stats;
}

function limpiar(diasAntiguedad = 30) {
    const bitacora = cargarBitacora();
    const limite = new Date();
    limite.setDate(limite.getDate() - diasAntiguedad);
    const limiteStr = limite.toISOString();
    const antes = bitacora.entradas.length;
    bitacora.entradas = bitacora.entradas.filter(e => e.timestamp >= limiteStr);
    const despues = bitacora.entradas.length;
    guardarBitacora(bitacora);
    const eliminadas = antes - despues;
    log("Limpiadas " + eliminadas + " entradas de mas de " + diasAntiguedad + " dias", "ok");
    return { eliminadas: eliminadas, restantes: despues };
}

function exportar(nombreArchivo = null) {
    const bitacora = cargarBitacora();
    const archivo = nombreArchivo || path.join(CARPETA_LOGS, "bitacora_export_" + Date.now() + ".json");
    fs.writeFileSync(archivo, JSON.stringify(bitacora, null, 2));
    log("Bitacora exportada a: " + archivo, "ok");
    return archivo;
}

module.exports = {
    registrarAccion: registrarAccion,
    registrarError: registrarError,
    registrarDelegacion: registrarDelegacion,
    registrarSkill: registrarSkill,
    obtenerEntradas: obtenerEntradas,
    obtenerEstadisticas: obtenerEstadisticas,
    limpiar: limpiar,
    exportar: exportar,
    registrar: registrar,
    init: init
};

if (require.main === module) {
    init();
    registrarAccion("Test de bitacora", "Inicializacion exitosa");
    console.log("\nEstadisticas:", obtenerEstadisticas());
    console.log("\nUltimas 5 entradas:", obtenerEntradas({}, 5));
}