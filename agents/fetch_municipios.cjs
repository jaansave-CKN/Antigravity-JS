const fs = require('fs');
const https = require('https');

const url = 'https://raw.githubusercontent.com/marcovega/colombia-json/master/colombia.min.json';
const targetDir = 'c:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales';
const targetFile = `${targetDir}\\municipios_colombia.json`;

if (!fs.existsSync(targetDir)){
    fs.mkdirSync(targetDir, { recursive: true });
}

console.log('Descargando datos de municipios...');

https.get(url, (res) => {
    let data = '';
    
    if (res.statusCode !== 200) {
        console.error(`Error de red: ${res.statusCode}`);
        return;
    }
    
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const parsedData = JSON.parse(data);
            fs.writeFileSync(targetFile, JSON.stringify(parsedData, null, 2));
            console.log(`¡Éxito! Se han guardado los municipios en ${targetFile}`);
        } catch (e) {
            console.error('Error procesando el JSON:', e);
        }
    });
}).on('error', (e) => {
    console.error('Error en la petición HTTP:', e);
});
