const fs = require('fs');
const https = require('https');

const URL_DEFAULT = 'https://raw.githubusercontent.com/marcovega/colombia-json/master/colombia.min.json';
const TARGET_DIR_DEFAULT = 'c:\\2026 AI EGIOC5\\Antigravity JS\\PROYECTOS_ACTIVOS\\Proy_01_Donaciones\\01_Documentos_Originales';

// Confinamiento (2026-08-13, Fase 3 — sandboxing de skills): antes hacía una
// petición HTTPS real a un dominio externo apenas se cargaba el módulo —
// exactamente el "acceso directo a red fuera de supervisión" que la orden
// pide cerrar. Ahora requerirlo no dispara nada; solo corre bajo invocación
// directa (`node agents/fetch_municipios.cjs`).
function descargarMunicipios(url = URL_DEFAULT, targetDir = TARGET_DIR_DEFAULT) {
    const targetFile = `${targetDir}\\municipios_colombia.json`;
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    console.log('Descargando datos de municipios...');
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            if (res.statusCode !== 200) {
                const err = new Error(`Error de red: ${res.statusCode}`);
                console.error(err.message);
                return reject(err);
            }
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    fs.writeFileSync(targetFile, JSON.stringify(parsedData, null, 2));
                    console.log(`¡Éxito! Se han guardado los municipios en ${targetFile}`);
                    resolve(targetFile);
                } catch (e) {
                    console.error('Error procesando el JSON:', e);
                    reject(e);
                }
            });
        }).on('error', (e) => {
            console.error('Error en la petición HTTP:', e);
            reject(e);
        });
    });
}

if (require.main === module) {
    descargarMunicipios().catch(() => { process.exitCode = 1; });
}

module.exports = { descargarMunicipios };
