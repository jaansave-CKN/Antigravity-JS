const fs = require('fs');
const path = require('path');

const ENCODING = 'utf8';

const MAPA = {
    'á': '&aacute;', 'é': '&eacute;', 'í': '&iacute;', 'ó': '&oacute;', 'ú': '&uacute;',
    'Á': '&Aacute;', 'É': '&Eacute;', 'Í': '&Iacute;', 'Ó': '&Oacute;', 'Ú': '&Uacute;',
    'ñ': '&ntilde;', 'Ñ': '&Ntilde;'
};

function contieneProblemas(texto) {
    return /[áéíóúñÁÉÍÓÚÑü]/.test(texto);
}

function normalizar(texto) {
    let resultado = '';
    for (let char of texto) {
        resultado += MAPA[char] || char;
    }
    return resultado;
}

function corregirHTML(archivo) {
    try {
        const stat = fs.statSync(archivo);
        if (!stat.isFile() || !archivo.endsWith('.html')) return null;
        
        let contenido = fs.readFileSync(archivo, ENCODING);
        if (!contieneProblemas(contenido)) return null;
        
        contenido = normalizar(contenido);
        fs.writeFileSync(archivo, contenido, ENCODING);
        return true;
    } catch (e) {
        return { error: e.message };
    }
}

function scandir(dir, archivos = []) {
    const items = fs.readdirSync(dir);
    for (let item of items) {
        if (item === 'node_modules' || item === '.git' || item.startsWith('.')) continue;
        const ruta = path.join(dir, item);
        const stat = fs.statSync(ruta);
        if (stat.isDirectory()) scandir(ruta, archivos);
        else if (ruta.endsWith('.html')) archivos.push(ruta);
    }
    return archivos;
}

function corregirTodo(directorio) {
    console.log('Escaneando:', directorio);
    const archivos = scandir(directorio);
    console.log('Archivos encontrados:', archivos.length);
    
    let ok = 0, error = 0;
    for (let archivo of archivos) {
        const res = corregirHTML(archivo);
        if (res === true) {
            console.log('Corregido:', path.basename(archivo));
            ok++;
        } else if (res && res.error) {
            console.error('Error:', archivo, res.error);
            error++;
        }
    }
    console.log('\nRESULTADO:', ok, 'corregidos,', error, 'errores');
    return { ok, error };
}

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills, orden explícita
// del usuario): antes escaneaba y podía REESCRIBIR archivos .html reales
// apenas se cargaba el módulo — sin importar si se invocaba directo o vía
// require() desde otro script. Ahora requerirlo no dispara nada; solo corre
// bajo invocación directa (`node Skill_001_Gestor_Encoding.cjs <check|corregir> [dir]`).
function verificarProblemas(dir = 'public') {
    const archivos = scandir(dir);
    let problematicos = 0;
    for (let archivo of archivos) {
        const contenido = fs.readFileSync(archivo, ENCODING);
        if (contieneProblemas(contenido)) {
            console.log('Problema:', path.basename(archivo));
            problematicos++;
        }
    }
    console.log('\nTotal problematicos:', problematicos);
    return problematicos;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const cmd = args[0];
    const dir = args[1] || 'public';

    console.log('='.repeat(40));
    console.log('GESTOR ENCODING - AUTOCORRECCION');
    console.log('='.repeat(40));

    if (cmd === 'check') {
        verificarProblemas(dir);
    } else if (cmd === 'corregir') {
        corregirTodo(dir);
    } else {
        console.log('\nUso: node Gestor_Encoding.cjs <check|corregir> [directorio]');
        console.log('Ejemplos:');
        console.log('  node Gestor_Encoding.cjs check public');
        console.log('  node Gestor_Encoding.cjs corregir proyectos');
    }
}

module.exports = { verificarProblemas, corregirTodo, corregirHTML, contieneProblemas, scandir };