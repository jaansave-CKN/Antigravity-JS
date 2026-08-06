const fs = require('fs');
const path = require('path');

function inicializarSkill(nombre, descripcion) {
    const template = `/**
 * Skill: ${nombre}
 * Descripción: ${descripcion}
 * Fecha: ${new Date().toISOString().split('T')[0]}
 */

function ejecutar${nombre.replace(/Skill_?\d*/g, '').replace(/_/g, '')}(contexto = {}) {
    console.log(\`🔧 Ejecutando ${nombre}...\`);
    
    return {
        status: 'ok',
        skill: '${nombre}',
        timestamp: new Date().toISOString(),
        resultado: contexto
    };
}

module.exports = { ejecutar: ejecutar${nombre.replace(/Skill_?\d*/g, '').replace(/_/g, '')} };
`;
    return template;
}

const args = process.argv.slice(2);
const accion = args[0] || 'list';

const skillsPendientes = [
    { skill: 'Skill_050_Formulador_Proyecto', desc: 'Formulación de proyectos' },
    { skill: 'Skill_051_Lluvia_Ideas', desc: 'Lluvia de ideas - brainstorming' },
    { skill: 'Skill_054_Gestion_Riesgos', desc: 'Gestión de riesgos' },
    { skill: 'Skill_056_Evaluador', desc: 'Evaluación de propuestas' },
    { skill: 'Skill_057_Interventor', desc: 'Interventoría de obras' }
];

if (accion === 'list') {
    console.log('\n📋 Skills pendientes por crear:');
    skillsPendientes.forEach((s, i) => console.log(\`  \${i+1}. \${s.skill}\`));
} else if (accion === 'create') {
    skillsPendientes.forEach(s => {
        const contenido = inicializarSkill(s.skill, s.desc);
        const ruta = path.join('./agents', args[1] || '050_Formulador_proy', 'skills', s.skill + '.cjs');
        if (!fs.existsSync(ruta)) {
            fs.writeFileSync(ruta, contenido);
            console.log(\`✅ Creado: \${ruta}\`);
        }
    });
}