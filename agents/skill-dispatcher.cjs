const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const registry = JSON.parse(fs.readFileSync('./skills/ag_skills_registry.json', 'utf8'));
const LOG_FILE = 'antigravity_system_log.md';

function dispatch(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let skillId = (['.pdf', '.docx', '.xlsx', '.xls', '.pptx'].includes(ext)) ? 'doc_intelligence' : 
                  (['.jpg', '.jpeg', '.png'].includes(ext)) ? 'vision_engine' : '';

    const skill = registry.available_skills.find(s => s.id === skillId);

    if (skill) {
        console.log(`[ANTIGRAVITY] Procesando ${path.basename(filePath)}...`);
        exec(`node ${skill.path} "${filePath}"`, (error, stdout) => {
            if (error) return;
            
            // Generar entrada para la bitácora
            const entry = `\n## [${new Date().toLocaleString()}] Análisis de Archivo\n` +
                          `- **Archivo:** ${path.basename(filePath)}\n` +
                          `- **Skill:** ${skill.id}\n` +
                          `- **Resultado:**\n\`\`\`\n${stdout}\n\`\`\`\n` +
                          `---`;
            
            fs.appendFileSync(LOG_FILE, entry);
            console.log(stdout);
            console.log(`[LOG] Resultado guardado en ${LOG_FILE}`);
        });
    }
}

const file = process.argv[2];
if (file) dispatch(file);
