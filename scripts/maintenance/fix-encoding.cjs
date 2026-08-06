const fs = require('fs');
const path = 'C:\\2026 AI EGIOC5\\Antigravity JS\\public\\index.html';

let content = fs.readFileSync(path, 'utf8');

content = content
    .replace(/\u00C3\u00A1/g, 'á')
    .replace(/\u00C3\u00A9/g, 'é')
    .replace(/\u00C3\u00AD/g, 'í')
    .replace(/\u00C3\u00B3/g, 'ó')
    .replace(/\u00C3\u00BA/g, 'ú')
    .replace(/\u00C3\u00B1/g, 'ñ')
    .replace(/\u00C3\u00A0/g, 'Á')
    .replace(/\u00C3\u00A9/g, 'É')
    .replace(/\u00C3\u00B3/g, 'Ó')
    .replace(/\u00C3\u00A9/g, 'É')
    .replace(/\u00C3\u201A/g, 'â€"')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ')
    .replace(/Ã /g, 'Á')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã“/g, 'Ó')
    .replace(/Ã€/g, 'À')
    .replace(/Ã¨/g, 'è')
    .replace(/Ã¬/g, 'ì')
    .replace(/Ã²/g, 'ò')
    .replace(/Ã¹/g, 'ù')
    .replace(/â€"/g, '–')
    .replace(/â€"/g, '—')
    .replace(/Â/g, '')
    .replace(/Ã„Â/g, 'Á')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã" /g, 'Ó')
    .replace(/Ãœ/g, 'Ü')
    .replace(/Ã¤/g, 'ä')
    .replace(/Ã«/g, 'ë')
    .replace(/Ã¯/g, 'ï')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ã¿/g, 'ÿ')
    .replace(/â€" /g, '"')
    .replace(/â€œ/g, '"')
    .replace(/â€\œ/g, '"')
    .replace(/â€\s/g, "'")
    .replace(/Ã‚/g, 'Á');

fs.writeFileSync(path, content, 'utf8');
console.log('Encoding fix applied');