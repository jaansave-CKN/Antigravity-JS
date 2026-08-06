const fs = require('fs');
const path = require('path');

const MAPA_ENTIDADES = {
    'á': '&aacute;', 'é': '&eacute;', 'í': '&iacute;', 'ó': '&oacute;', 'ú': '&uacute;',
    'Á': '&Aacute;', 'É': '&Eacute;', 'Í': '&Iacute;', 'Ó': '&Oacute;', 'Ú': '&Uacute;',
    'ñ': '&ntilde;', 'Ñ': '&Ntilde;',
    'ü': '&uuml;', 'Ü': '&Uuml;'
};

const MAPA_SIN_ACENTO = {
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
    'ñ': 'n', 'Ñ': 'N',
    'ü': 'u', 'Ü': 'U'
};

function aEntidadesHTML(texto) {
    let resultado = '';
    for (let char of texto) {
        resultado += MAPA_ENTIDADES[char] || char;
    }
    return resultado;
}

function sinAcentos(texto) {
    let resultado = '';
    for (let char of texto) {
        resultado += MAPA_SIN_ACENTO[char] || char;
    }
    return resultado;
}

function corregirEncoding(archivo, modo = 'entidades') {
    try {
        let contenido = fs.readFileSync(archivo, 'utf8');
        
        let corregido;
        if (modo === 'entidades') {
            corregido = aEntidadesHTML(contenido);
        } else if (modo === 'sinacento') {
            corregido = sinAcentos(contenido);
        } else {
            return false;
        }
        
        fs.writeFileSync(archivo, corregido, 'utf8');
        return true;
    } catch (e) {
        console.error('Error:', e.message);
        return false;
    }
}

function corregirDirectorio(directorio, extension = '.html', modo = 'entidades') {
    const archivos = [];
    
    function buscar(dir) {
        const items = fs.readdirSync(dir);
        for (let item of items) {
            const ruta = path.join(dir, item);
            const stat = fs.statSync(ruta);
            if (stat.isDirectory() && !item.includes('node_modules') && !item.startsWith('.')) {
                buscar(ruta);
            } else if (ruta.endsWith(extension)) {
                archivos.push(ruta);
            }
        }
    }
    
    buscar(directorio);
    
    let corregidos = 0;
    for (let archivo of archivos) {
        if (corregirEncoding(archivo, modo)) {
            corregidos++;
            console.log('Corregido:', archivo);
        }
    }
    
    return { total: archivos.length, corregidos };
}

const args = process.argv.slice(2);
const archivo = args[0];
const modo = args[1] || 'entidades';

if (archivo) {
    if (fs.statSync(archivo).isDirectory()) {
        const resultado = corregirDirectorio(archivo, '.html', modo);
        console.log(`\nResultado: ${resultado.corregidos}/${resultado.total} archivos corregidos`);
    } else {
        const ok = corregirEncoding(archivo, modo);
        console.log(ok ? 'Archivo corregido' : 'Error al corregir');
    }
} else {
    console.log('Uso: node fix-encoding.js <archivo|directorio> [entidades|sinacento]');
    console.log('Ejemplos:');
    console.log('  node fix-encoding.js archivo.html entidades');
    console.log('  node fix-encoding.js carpeta sinacento');
}