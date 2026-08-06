const fs = require('fs');
const p = 'C:/2026 AI EGIOC5/Antigravity JS/public/index.html';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/Ã„Ârea/g, 'Área').replace(/Ã¡rea/g, 'área');
const lines = c.split('\n');
lines[322] = '                <h3 class="font-headline-md text-headline-md text-slate-900 text-base">Área temática específica o sector</h3>';
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('Fixed line 323');