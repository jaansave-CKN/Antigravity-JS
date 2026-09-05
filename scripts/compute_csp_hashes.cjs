// Calcula los hashes SHA-256 (formato CSP 'sha256-...') de cada bloque
// <script> inline (sin src) en las páginas HTML estáticas de public/, que
// server.js sirve tal cual desde dist/ (ver copyStaticPlugin en
// vite.config.js — copia byte a byte, sin build step para estas páginas).
//
// Uso: al editar el contenido de un <script> inline en cualquiera de estos
// archivos, correr `node scripts/compute_csp_hashes.cjs` y actualizar la
// lista SCRIPT_HASHES en server.js con la salida — si no, el CSP bloquea el
// script silenciosamente en el navegador (el botón/listener deja de
// responder, sin error visible salvo en la consola de devtools).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

const scriptTagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const allHashes = new Set();

for (const file of files) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.log(`--- ${file}: NO EXISTE ---`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  let m;
  let count = 0;
  console.log(`=== ${file} ===`);
  while ((m = scriptTagRe.exec(html)) !== null) {
    const attrs = m[1];
    const content = m[2];
    const hasSrc = /\bsrc\s*=/.test(attrs);
    if (hasSrc) continue; // externo, no necesita hash
    if (!content.trim()) continue; // bloque vacío
    count++;
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('base64');
    allHashes.add(hash);
    console.log(`  [inline #${count}] len=${content.length} sha256-${hash}`);
    console.log(`    primeras 80 chars: ${JSON.stringify(content.slice(0, 80))}`);
  }
  if (count === 0) console.log('  (sin bloques inline sin src)');
}

console.log('\n=== UNION DE TODOS LOS HASHES (para script-src-elem) ===');
for (const h of allHashes) console.log(`'sha256-${h}',`);
