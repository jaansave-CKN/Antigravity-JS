const fs = require('fs');
const p = 'C:/2026 AI EGIOC5/Antigravity JS/public/index.html';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/Ã„Ârea/g, 'Área').replace(/Ã¡rea/g, 'área');
fs.writeFileSync(p, c, 'utf8');
console.log('Done');