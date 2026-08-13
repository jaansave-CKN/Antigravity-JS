const fs = require('fs');
const path = require('path');

// Confinamiento (2026-08-13, orden explícita del usuario, "Fase 3 —
// sandboxing de skills"): antes ejecutaba al cargarse, sin importar si se
// invocaba directo o vía require() desde otro script. Ahora solo corre bajo
// `node agents/000_VERIFICADOR.cjs` directo; requerirlo como librería no
// dispara ningún efecto secundario.
function verificarArchivosCriticos() {
    const archivosCriticos = [
        'architecture-gate.cjs',
        'skills/Skill_Sync_MCP.cjs',
        'skills/IDENTITY.md'
    ];
    let errores = 0;
    console.log('🔍 INICIANDO DIAGNÓSTICO DE ANTIGRAVITY OS...');
    console.log('Director: Jairo Antonio Salinas Velasco | Asfáltica S.A.S.\n');
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
    return errores;
}

if (require.main === module) {
    verificarArchivosCriticos();
}

module.exports = { verificarArchivosCriticos };