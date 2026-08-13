#!/usr/bin/env node
// generar_pdf_arquitectura.cjs — regenera docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.pdf
// desde el .md equivalente, vía markdown→HTML propio (sin dependencia nueva,
// para no tocar package.json/package-lock.json) → Edge headless --print-to-pdf.
//
// Nace de un hallazgo de auditoría (2026-08-13): el mandato de
// 007_DOCUMENTADOR_AS_BUILD promete "regenerar el PDF correspondiente" cada
// vez que se agrega una sección al documento maestro, pero nunca existió un
// script reutilizable para hacerlo — el PDF quedó desactualizado silenciosamente.
//
// Uso: node scripts/generar_pdf_arquitectura.cjs [ruta.md] [ruta.pdf]
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dirRoot = path.join(__dirname, '..');
const mdPath = process.argv[2] || path.join(dirRoot, 'docs', 'ARQUITECTURA_AGENTICA_ANTIGRAVITY.md');
const pdfPath = process.argv[3] || mdPath.replace(/\.md$/, '.pdf');
const htmlPath = pdfPath.replace(/\.pdf$/, '.tmp.html');

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Aplica formato inline (bold/italic/code/links) sin tocar el contenido ya
// dentro de un <code> de bloque (se procesa línea por línea fuera de fences).
function inline(md) {
  let s = escapeHtml(md);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  let inCodeFence = false;
  let codeBuf = [];
  let inTable = false;
  let tableRows = [];
  let listBuf = [];
  let listType = null; // 'ul' | 'ol'

  function flushList() {
    if (listBuf.length) {
      out.push(`<${listType}>` + listBuf.map(li => `<li>${inline(li)}</li>`).join('') + `</${listType}>`);
      listBuf = [];
      listType = null;
    }
  }

  function flushTable() {
    if (!tableRows.length) return;
    const [header, , ...body] = tableRows; // fila 1 = header, fila 2 = separador (---), resto = filas
    const headCells = header.split('|').map(c => c.trim()).filter(Boolean);
    let html = '<table><thead><tr>' + headCells.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
    for (const row of body) {
      const cells = row.split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
      html += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
    }
    html += '</tbody></table>';
    out.push(html);
    tableRows = [];
    inTable = false;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      if (!inCodeFence) { inCodeFence = true; codeBuf = []; }
      else { inCodeFence = false; out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`); }
      i++; continue;
    }
    if (inCodeFence) { codeBuf.push(line); i++; continue; }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      inTable = true; tableRows.push(line.trim()); i++; continue;
    }
    if (inTable && !/^\s*\|.*\|\s*$/.test(line)) { flushTable(); }

    if (/^---+\s*$/.test(line) && line.trim() !== '---') { out.push('<hr>'); i++; continue; }
    if (line.trim() === '---') { out.push('<hr>'); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol) {
      if (listType && listType !== 'ol') flushList();
      listType = 'ol'; listBuf.push(ol[1]); i++; continue;
    }
    if (ul) {
      if (listType && listType !== 'ul') flushList();
      listType = 'ul'; listBuf.push(ul[1]); i++; continue;
    }
    if (listType) flushList();

    if (line.trim() === '') { i++; continue; }

    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  flushList();
  flushTable();
  return out.join('\n');
}

const md = fs.readFileSync(mdPath, 'utf8');
const bodyHtml = markdownToHtml(md);
const titulo = path.basename(mdPath, '.md');

const htmlDoc = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #1a1a1a; max-width: 100%; padding: 0 8px; }
  h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 6px; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 17px; margin-top: 22px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  h3 { font-size: 14px; margin-top: 16px; }
  code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; font-family: 'Consolas', monospace; font-size: 11px; }
  pre { background: #f6f6f6; border: 1px solid #ddd; border-radius: 4px; padding: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  a { color: #0645ad; }
  hr { border: none; border-top: 1px solid #ccc; margin: 14px 0; }
  ul, ol { margin: 6px 0; padding-left: 22px; }
</style></head><body>
${bodyHtml}
</body></html>`;

fs.writeFileSync(htmlPath, htmlDoc, 'utf8');

const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!fs.existsSync(EDGE_PATH)) {
  console.error(`[generar_pdf_arquitectura] Edge no encontrado en ${EDGE_PATH}. Define EDGE_PATH si está en otra ruta. HTML generado en ${htmlPath}, PDF no generado.`);
  process.exit(1);
}

try {
  execFileSync(EDGE_PATH, [
    '--headless=new',
    '--disable-gpu',
    `--print-to-pdf=${pdfPath}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    `file:///${htmlPath.replace(/\\/g, '/')}`,
  ], { timeout: 60000 });
} catch (e) {
  console.error('[generar_pdf_arquitectura] Edge headless falló:', e.message);
  process.exit(1);
} finally {
  fs.unlinkSync(htmlPath);
}

if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
  console.error('[generar_pdf_arquitectura] El PDF no se generó o quedó vacío.');
  process.exit(1);
}
console.log(`[generar_pdf_arquitectura] OK — ${pdfPath} (${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB)`);
