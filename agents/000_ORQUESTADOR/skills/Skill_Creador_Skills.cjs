const fs = require("fs");
const path = require("path");

const nombre = "Creador de Skills y Agentes";
const descripcion = "Crea nuevos skills y agentes con estructura completa. Usa cuando el usuario pide crear un skill, crear un agente, o desarrollar una nueva funcionalidad.";
const palabrasClave = ["crear", "skill", "agente", "nuevo", "desarrollar", "generar", "construir"];

const RAIZ = path.join(__dirname, "..", "..", "..");
const CARPETA_SKILLS_RAIZ = path.join(RAIZ, "agents", "000_ORQUESTADOR", "skills");
const CARPETA_AGENTS = path.join(RAIZ, "agents");

function log(mensaje, tipo = "info") {
    const iconos = { info: "📝", ok: "✅", warn: "⚠️", error: "❌", proceso: "⚙️" };
    console.log(iconos[tipo] + " " + mensaje);
}

function sanitizarNombre(nombre) {
    return nombre
        .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s_-]/g, "")
        .replace(/\s+/g, "_")
        .trim();
}

function capitalizarPalabras(texto) {
    return texto.replace(/\b\w/g, l => l.toUpperCase());
}

function generarTemplateSkill(datos) {
    const instrucciones = datos.instrucciones || "## Descripcion\n" + datos.descripcion + "\n\n## Uso\n1. [Paso 1]\n2. [Paso 2]\n3. [Paso 3]\n\n## Ejemplos\n// Ejemplo 1\n\n## Notas\n- " + (datos.notas || "Agregar notas relevantes aqui");
    return "---\nname: " + datos.nombre.replace(/\s+/g, "-").toLowerCase() + "\ndescription: " + datos.descripcion + "\n---\n\n# " + datos.nombre + "\n\n" + instrucciones;
}

function generarTemplateAgente(datos) {
    return "# Agente " + (datos.numero || "??") + " -- " + datos.nombre + "\n\n## Rol\n" + (datos.rol || "Especialista en " + datos.especialidad) + "\n\n## Especializacion\n- " + (datos.especialidad || "Area de especializacion del agente") + "\n- " + (datos.especialidad2 || "Area secundaria") + "\n\n## Responsabilidades\n1. " + (datos.resp1 || "Responsable de...") + "\n2. " + (datos.resp2 || "Gestiona...") + "\n3. " + (datos.resp3 || "Ejecuta...") + "\n\n## Reglas\n1. Mantener contexto entre interacciones\n2. Documentar acciones importantes\n3. Reportar errores al ORQUESTADOR\n\n## Skills disponibles\n- Carpeta: `skills/` (vacia, agregar segun necesidad)\n\n## Comandos utiles\n- `ayuda` -- Mostrar esta informacion\n- `estado` -- Verificar estado del agente";
}

function crearEstructura(datos) {
    const tipo = datos.tipo;
    
    if (!["skill", "agente"].includes(tipo)) {
        return { error: "Tipo '" + tipo + "' no reconocido. Usa 'skill' o 'agente'." };
    }

    const nombreLimpio = sanitizarNombre(datos.nombre);
    let carpetaDestino;

    if (tipo === "skill") {
        carpetaDestino = path.join(CARPETA_SKILLS_RAIZ, (datos.prefijo || "Skill") + "_" + nombreLimpio);
    } else {
        carpetaDestino = path.join(CARPETA_AGENTS, (datos.prefijo || "XXX") + "_" + nombreLimpio);
    }

    log("Creando " + tipo + ": " + datos.nombre, "proceso");
    log("Ubicacion: " + carpetaDestino, "info");

    if (fs.existsSync(carpetaDestino)) {
        return { error: "Ya existe: " + carpetaDestino };
    }

    try {
        fs.mkdirSync(carpetaDestino, { recursive: true });
        log("Carpeta creada: " + nombreLimpio, "ok");

        if (tipo === "skill") {
            const skillsDir = path.join(carpetaDestino, "skills");
            fs.mkdirSync(skillsDir, { recursive: true });
            
            const template = generarTemplateSkill(datos);
            const archivoSkill = path.join(skillsDir, "SKILL.md");
            fs.writeFileSync(archivoSkill, template, "utf8");
            log("SKILL.md generado", "ok");
        } else {
            const template = generarTemplateAgente(datos);
            const archivoIdentity = path.join(carpetaDestino, "IDENTITY.md");
            fs.writeFileSync(archivoIdentity, template, "utf8");
            log("IDENTITY.md generado", "ok");
            
            const skillsDir = path.join(carpetaDestino, "skills");
            fs.mkdirSync(skillsDir, { recursive: true });
            log("Carpeta skills/ creada", "ok");
        }

        const resultado = {
            exito: true,
            tipo: tipo,
            nombre: datos.nombre,
            ruta: carpetaDestino,
            archivos: tipo === "skill" 
                ? [nombreLimpio + "/skills/SKILL.md"]
                : [nombreLimpio + "/IDENTITY.md", nombreLimpio + "/skills/"]
        };

        log("✅ " + capitalizarPalabras(tipo) + " '" + datos.nombre + "' creado exitosamente!", "ok");
        return resultado;

    } catch (error) {
        return { error: "Error al crear: " + error.message };
    }
}

function listarSkillsExistentes() {
    try {
        const archivos = fs.readdirSync(CARPETA_SKILLS_RAIZ)
            .filter(f => f.endsWith(".cjs") && f !== "Skill_Creador_Skills.cjs");
        return archivos.map(f => f.replace(".cjs", ""));
    } catch (e) {
        return [];
    }
}

function listarAgentesExistentes() {
    try {
        const carpetas = fs.readdirSync(CARPETA_AGENTS, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);
        return carpetas;
    } catch (e) {
        return [];
    }
}

function mostrarAyuda() {
    return "\n╔══════════════════════════════════════════════════════════════╗\n║           SKILL CREADOR - AYUDA                              ║\n╠══════════════════════════════════════════════════════════════╣\n║  CREAR SKILL:                                                ║\n║    crearSkill({                                              ║\n║      nombre: \"Nombre del Skill\",                             ║\n║      descripcion: \"Que hace este skill\",                     ║\n║      prefijo: \"003\",                                         ║\n║      instrucciones: \"Pasos del skill...\"                     ║\n║    })                                                         ║\n╠══════════════════════════════════════════════════════════════╣\n║  CREAR AGENTE:                                               ║\n║    crearAgente({                                              ║\n║      nombre: \"Nombre del Agente\",                            ║\n║      numero: \"05\",                                           ║\n║      prefijo: \"005\",                                         ║\n║      especialidad: \"Area de expertise\",                      ║\n║      rol: \"Descripcion del rol\",                             ║\n║      resp1: \"Responsabilidad 1\",                             ║\n║      resp2: \"Responsabilidad 2\",                             ║\n║      resp3: \"Responsabilidad 3\"                              ║\n║    })                                                         ║\n╠══════════════════════════════════════════════════════════════╣\n║  OTRAS FUNCIONES:                                            ║\n║    listarSkills() -> Skills existentes                       ║\n║    listarAgentes() -> Agentes existentes                      ║\n║    verPlantilla(tipo) -> Ver template antes de crear          ║\n╚══════════════════════════════════════════════════════════════╝\n";
}

function verPlantilla(tipo) {
    if (!["skill", "agente"].includes(tipo)) {
        return { error: "Tipo '" + tipo + "' no reconocido. Opciones: skill, agente" };
    }
    
    const datosEjemplo = tipo === "skill" 
        ? { nombre: "Ejemplo Skill", descripcion: "Un skill de ejemplo", instrucciones: "Paso 1...", notas: "Nota importante" }
        : { nombre: "Ejemplo Agente", numero: "99", rol: "Agente de ejemplo", especialidad: "Testing", resp1: "Testear", resp2: "Verificar", resp3: "Reportar" };
    
    return {
        tipo: tipo,
        estructura: tipo === "skill" ? ["skills/SKILL.md"] : ["IDENTITY.md", "skills/"],
        preview: tipo === "skill" ? generarTemplateSkill(datosEjemplo) : generarTemplateAgente(datosEjemplo)
    };
}

function ejecutar(datos) {
    if (!datos || !datos.nombre) {
        return { error: "Falta el parametro 'nombre'. Ejemplo: crear({ nombre: 'Mi Skill' })" };
    }

    if (!datos.tipo || !["skill", "agente"].includes(datos.tipo)) {
        return { error: "Falta o es invalido el parametro 'tipo'. Usa: { tipo: 'skill' } o { tipo: 'agente' }" };
    }

    return crearEstructura(datos);
}

function init() {
    log("Skill Creador cargado", "ok");
}

module.exports = {
    crearSkill: function(datos) { return ejecutar(Object.assign({}, datos, { tipo: "skill" })); },
    crearAgente: function(datos) { return ejecutar(Object.assign({}, datos, { tipo: "agente" })); },
    crear: ejecutar,
    listarSkills: listarSkillsExistentes,
    listarAgentes: listarAgentesExistentes,
    verPlantilla: verPlantilla,
    ayuda: mostrarAyuda,
    init: init
};

if (require.main === module) {
    log("SKILL CREADOR DE SKILLS/AGENTES", "info");
    console.log(mostrarAyuda());
    log("\nEjecutando test: crear skill de ejemplo", "proceso");
    console.log(module.exports.crearSkill({
        nombre: "Test Skill",
        descripcion: "Skill de prueba",
        prefijo: "Test"
    }));
}