const fs = require("fs");
const path = require("path");

const CARPETA_SKILLS = path.join(__dirname);

const habilidades = {};

const METADATOS_PREDEFINIDOS = {
    Skill_Organizador_Sistema: {
        nombre: "Organizador del Sistema",
        descripcion: "Escanea y reorganiza archivos en sus carpetas correctas según reglas predefinidas",
        palabrasClave: ["organizar", "limpiar", "ordenar", "estructura", "archivos", "desorden"]
    },
    Skill_Monitor_Vivo: {
        nombre: "Monitor en Vivo",
        descripcion: "Registra actividad del agente cada 30 segundos en log",
        palabrasClave: ["monitor", "vigilar", "pulso", "actividad", "logs", "status"]
    },
    Skill_Gestion_Dinamica: {
        nombre: "Gestión Dinámica",
        descripcion: "Monitoreo del sistema cada 60 segundos",
        palabrasClave: ["dinamico", "monitorear", "sistema", "slots", "estado"]
    },
    Skill_Active_Sync: {
        nombre: "Sync Activo",
        descripcion: "Detecta cambios en agentes y sincroniza automáticamente",
        palabrasClave: ["sync", "sincronizar", "cambios", "agentes", "actualizar"]
    },
    Skill_Radar_Master: {
        nombre: "Radar Master",
        descripcion: "Control de Semáforo de Riesgo (1-10) y Refresco Selectivo de Propuestas (Shaker 7/3)",
        palabrasClave: ["radar", "semáforo", "riesgo", "shaker", "ideas", "propuestas", "dificultad", "refresco"]
    },
    Skill_Radar_Supervisor: {
        nombre: "Radar Supervisor",
        descripcion: "Modo Supervisión: Recibe reportes de Radar1, calcula semáforo con Radar2, registra hallazgos",
        palabrasClave: ["supervisión", "radar1", "radar2", "hallazgo", "registro", "procesar"]
    },
    Skill_Coordinador_Radar: {
        nombre: "Coordinador Radar",
        descripcion: "Coordina flujo Radar1_minero → Radar2_Estratega. Agrupa sectores Hábitat/Soberanía/Autonomía por Público Objetivo",
        palabrasClave: ["coordinador", "radar1", "radar2", "minero", "estratega", "hábitat", "soberanía", "autonomía"]
    },
    Skill_UI_Geography_Link: {
        nombre: "UI Geography Link",
        descripcion: "Vincula UI_SEARCH_GEOGRAPHY con campo de texto menú central-izquierdo. Envía señal de interrupción a Radar1_minero",
        palabrasClave: ["ui", "geography", "busqueda", "interrupcion", "radar1", "menú", "filtro"]
    },
    Skill_Geo_Recognizer: {
        nombre: "Geo Recognizer",
        descripcion: "Reconoce países, regiones (LATAM, Europa) y listas mixtas. Normaliza entrada para Radar1_minero",
        palabrasClave: ["geo", "reconocimiento", "país", "region", "codigo", "zona", "latam", "europa"]
    },
    Skill_Matriz_Sectores: {
        nombre: "Matriz Maestra de Sectores",
        descripcion: "Jerarquía: Hábitat y Territorio | Soberanía y Vida | Paz y Sociedad | Autonomía Económica | Futuro y Conocimiento",
        palabrasClave: ["matriz", "sectores", "hábitat", "soberanía", "paz", "autonomía", "futuro", "jerarquía"]
    },
    Skill_Traductor_ODS: {
        nombre: "Traductor ODS",
        descripcion: "Verifica correspondencia ODS para cada sector. Bloquea hallazgos sin ODS antes de pasar a Radar2_Estratega",
        palabrasClave: ["ods", "sostenible", "desarrollo", "correspondencia", "bloqueo", "verificar"]
    },
    Skill_Elegibilidad: {
        nombre: "Elegibilidad (Paso B)",
        descripcion: "Receptor Población + Localización. Cruza sectores con grupos poblacionales. Genera Llave de Elegibilidad",
        palabrasClave: ["elegibilidad", "población", "localización", "cruce", "llave", "caracterización", "compatible"]
    },
    Skill_Protocolo_Fuente_Unica: {
        nombre: "Protocolo Fuente Única",
        descripcion: "Extrae Presupuesto, Fecha Cierre, Link Aplicación con cita textual. Si no encuentra = Dato Pendiente",
        palabrasClave: ["fuente única", "cita textual", "presupuesto", "fecha cierre", "link", "pendiente", "extraer"]
    },
    Skill_API_Alertas: {
        nombre: "API Local de Alertas",
        descripcion: "Endpoint /alertas. Alimenta Centro de Alertas. Contadores Activas y Últimas 24h. Handshake con Radar 360",
        palabrasClave: ["api", "alertas", "endpoint", "contador", "handshake", "radar360", "activo"]
    },
    Skill_Notas_Personales: {
        nombre: "Notas Personales",
        descripcion: "Cruza notas del usuario con anexos. Convierte instrucciones (priorizar/ignorar/ajustar) en Reglas de Negocio",
        palabrasClave: ["notas", "anexos", "reglas", "negocio", "priorizar", "ignorar", "cruzar", "instrucción"]
    },
    Skill_Contexto_Dinamico: {
        nombre: "Contexto Dinámico API",
        descripcion: "Endpoint /api/v1/context. Combina Documento + Metadata Entidad + Notas. Marca Prioridad Crítica",
        palabrasClave: ["contexto", "api", "context", "documento", "metadata", "prioridad crítica", "json", "unificado"]
    },
    Skill_Parametros_Mandatorios: {
        nombre: "Parámetros Mandatorios",
        descripcion: "Detecta anexos activos, extrae restricciones técnicas, envía parámetros a Minero y Estratega",
        palabrasClave: ["parámetro", "mandatorio", "restricción", "minero", "estratega", "anexo", "técnica"]
    },
    Skill_Firebase_Handshake: {
        nombre: "Firebase Handshake",
        descripcion: "Conecta con Web App Firebase. Limpia Failed Fetch. Sincroniza contadores del Centro de Alertas",
        palabrasClave: ["firebase", "handshake", "conectar", "failed fetch", "inicialización", "sincronizar", "alertas"]
    },
    Skill_Firebase_Bridge: {
        nombre: "Firebase Bridge",
        descripcion: "Bridge para antigravity-jairo-2026.web.app. Sincroniza Centro de Alertas. Mapea Soportes Documentales a JSON local",
        palabrasClave: ["bridge", "firebase", "soportes", "documentales", "mapeo", "json", "contexto", "web app"]
    },
    Skill_Bridge_Produccion: {
        nombre: "Bridge de Producción",
        descripcion: "Enlace con antigravity-jairo-2026.web.app. Limpia error UI. Receptor Soportes Documentales. Sync notas en ms",
        palabrasClave: ["producción", "bridge", "conexión", "error ui", "soportes", "sync", "tiempo real", "milisegundos"]
    },
    Skill_Upload_Contexto: {
        nombre: "Upload Contexto",
        descripcion: "Endpoint /api/v1/upload-context. Recibe archivos binarios. Almacena en Contexto Activo. Notifica Minero al activar",
        palabrasClave: ["upload", "archivo", "binario", "contexto", "minero", "notificar", "activar", "isActive"]
    },
    Skill_Vinculo_Validacion: {
        nombre: "Vínculo de Validación",
        descripcion: "Procesa mapa identación Stitch. Crea vínculos padre-hijo. Minero valida sin contradicción. Jerarquía Nacional-Departamental-Municipal",
        palabrasClave: ["vínculo", "validación", "indentación", "stitch", "jerarquía", "nacional", "departamental", "municipal", "contradicción"]
    },
    Skill_Peso_Documentos: {
        nombre: "Peso de Documentos",
        descripcion: "Actualiza weight según reorder de filas. Posición #1 tiene prioridad absoluta sobre criterios del Minero",
        palabrasClave: ["peso", "weight", "prioridad", "reordenar", "filas", "documento", "minero", "override"]
    },
    Skill_Validacion_Busqueda: {
        nombre: "Validación de Búsqueda",
        descripcion: "Bloquea búsqueda hasta documento Nivel 1 ON. Limpia error Failed to fetch cuando se activa",
        palabrasClave: ["bloqueo", "búsqueda", "nivel1", "on", "error fetch", "circular verde", "validar"]
    },
    Skill_Propagacion_Estados: {
        nombre: "Propagación de Estados",
        descripcion: "Propaga isActive del Padre (Nivel 1) a hijos. Si Padre false → grupo ignorado en escaneo",
        palabrasClave: ["propagar", "estado", "isActive", "padre", "hijo", "árbol", "contexto", "escaneo", "ignorar"]
    }
};

function extraerMetadatos(nombreArchivo, contenido) {
    const nombre = nombreArchivo.replace(".cjs", "");
    const metadata = METADATOS_PREDEFINIDOS[nombre];
    
    if (metadata) return metadata;
    
    const matchNombre = contenido.match(/nombre[:\s]+["']([^"']+)["']/i);
    const matchDesc = contenido.match(/(descripcion|descripci[oó]n|description)[:\s]+["']([^"']+)["']/i);
    const matchPalabras = contenido.match(/(palabrasClave|keywords|palabras_clave)[:\s]*=\s*\[([^\]]+)\]/i);
    const matchTags = contenido.match(/@tags?\s+([^\n]+)/i);
    
    const palabrasExtraidas = matchPalabras 
        ? matchPalabras[2].split(/[,;]/).map(p => p.trim().replace(/["']/g, ""))
        : matchTags 
            ? matchTags[1].split(/[,;]/).map(p => p.trim().toLowerCase())
            : nombre.split(/[_-]/).map(p => p.toLowerCase());
    
    return {
        nombre: matchNombre ? matchNombre[1] : nombre.replace(/_/g, " "),
        descripcion: matchDesc ? matchDesc[2] : `Skill: ${nombre}`,
        palabrasClave: palabrasExtraidas
    };
}

function cargarSkills() {
    console.log("\n" + "=".repeat(50));
    console.log("🧠 CARGANDO SKILLS DEL ORQUESTADOR...");
    console.log("=".repeat(50));
    
    Object.keys(habilidades).forEach(k => delete habilidades[k]);
    
    const archivos = fs.readdirSync(CARPETA_SKILLS)
        .filter(f => f.endsWith(".cjs") && f !== "Skill_Loader.cjs");
    
    for (const archivo of archivos) {
        const rutaCompleta = path.join(CARPETA_SKILLS, archivo);
        const contenido = fs.readFileSync(rutaCompleta, "utf8");
        const metadata = extraerMetadatos(archivo, contenido);
        
        try {
            const modulo = require(rutaCompleta);
            
            habilidades[archivo.replace(".cjs", "")] = {
                nombre: metadata.nombre,
                descripcion: metadata.descripcion,
                palabrasClave: metadata.palabrasClave,
                modulo: modulo,
                archivo: archivo,
                ruta: rutaCompleta,
                cargado: true,
                cargadoEl: new Date().toISOString()
            };
            
            console.log(`✅ ${metadata.nombre} (${archivo})`);
            
            if (modulo.init) {
                try { modulo.init(); } catch(e) {}
            }
            
        } catch (error) {
            console.log(`⚠️ ${archivo}: Error al cargar - ${error.message}`);
        }
    }
    
    console.log(`\n📊 Total: ${Object.keys(habilidades).length} skills cargados`);
    console.log("=".repeat(50) + "\n");
    
    return Object.keys(habilidades).length;
}

function buscarSkillPorPalabraClave(consulta) {
    const consultaLower = consulta.toLowerCase();
    const palabras = consultaLower.split(/\s+/);
    
    for (const [nombre, skill] of Object.entries(habilidades)) {
        for (const palabra of palabras) {
            if (skill.palabrasClave.some(pk => pk.includes(palabra) || palabra.includes(pk))) {
                return { nombre, skill, coincidencia: palabra };
            }
        }
    }
    return null;
}

function ejecutarSkill(nombre, ...args) {
    const skill = habilidades[nombre];
    if (!skill) {
        return { error: `Skill '${nombre}' no encontrado` };
    }
    
    try {
        if (skill.modulo && typeof skill.modulo.ejecutar === "function") {
            return skill.modulo.ejecutar(...args);
        }
        return { 
            info: `Skill '${skill.nombre}' cargado pero no tiene función 'ejecutar'. Scripts activos detectados:`,
            scripts: Object.entries(habilidades).map(([n, s]) => s.nombre)
        };
    } catch (error) {
        return { error: error.message };
    }
}

function listarSkills() {
    return Object.entries(habilidades).map(([nombre, skill]) => ({
        nombre: skill.nombre,
        archivo: skill.archivo,
        descripcion: skill.descripcion,
        palabrasClave: skill.palabrasClave
    }));
}

function sugerenciaSkill(consulta) {
    const resultado = buscarSkillPorPalabraClave(consulta);
    if (resultado) {
        return `🔧 Skill sugerido: **${resultado.skill.nombre}** (${resultado.skill.archivo})\n   ${resultado.skill.descripcion}\n   Para ejecutar: /ejecutar ${resultado.nombre}`;
    }
    return null;
}

cargarSkills();

module.exports = {
    habilidades,
    ejecutarSkill,
    listarSkills,
    buscarSkillPorPalabraClave,
    sugerenciaSkill,
    recargarSkills: cargarSkills
};