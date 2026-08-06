const fs = require('fs');
const path = require('path');

console.log('🔍 INICIANDO DIAGNÓSTICO DE ANTIGRAVITY OS...');
console.log('Director: Jairo Antonio Salinas Velasco | Asfáltica S.A.S.\n');

const archivosCriticos = [
    '000_Orquestador.cjs',
    'skills/Skill_Sync_MCP.cjs',
    'skills/IDENTITY.md'
];

let errores = 0;

archivosCriticos.forEach(relPath => {
    const fullPath = path.join(__dirname, relPath);
    if (fs.existsSync(fullPath)) {
        console.log(`✅ LOCALIZADO: ${relPath}`);
    } else {
        console.log(`❌ FALTA:      ${relPath}`);
        errores++;
    }
});

console.log('\n----------------------------------------');
if (errores === 0) {
    console.log('🚀 SISTEMA LISTO PARA ENLAZAR MCP');
} else {
    console.log(`⚠️ SE ENCONTRARON ${errores} AUSENCIAS`);
}
console.log('----------------------------------------');