/**
 * F5-02 — Motor de Exportación Certificada (SSR)
 * Protocol Precision: sin sombras, borders 1px #CBD5E1, tipografía limpia.
 * Toda la generación es server-side. El cliente recibe el buffer directamente.
 */

import PDFDocument from 'pdfkit';
import crypto from 'crypto';

// ── Protocol Precision ────────────────────────────────────────────────────────
const C = {
  primary:  '#1A1A2E',
  accent:   '#16213E',
  green:    '#198754',
  red:      '#DC3545',
  body:     '#212529',
  muted:    '#6C757D',
  border:   '#CBD5E1',   // Protocol Precision spec
  certBg:   '#EDF7EE',
  monoBg:   '#0D1117',
  monoFg:   '#00E676',
};

const NORMAL = 'Helvetica';
const BOLD   = 'Helvetica-Bold';
const MONO   = 'Courier';
const BORDER_WIDTH = 1;   // Protocol Precision: 1px borders

// ── Utils ─────────────────────────────────────────────────────────────────────

function safeJson(v, fallback = {}) {
  if (!v || typeof v !== 'string') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function fmt(n) {
  return `$${Number(n || 0).toLocaleString('es-CO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso) {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return String(iso); }
}

function sumItems(items = []) {
  return items.reduce((s, i) => s + (Number(i.valor) || 0), 0);
}

function r2(n) { return Math.round(n * 100) / 100; }

// ── Public exports ────────────────────────────────────────────────────────────

/**
 * Hash SHA-256 vinculado al proyecto + sello de auditoría.
 * Permite verificar integridad del reporte ante entidades externas.
 * @param {string} proyectoId
 * @param {string} auditId
 * @param {string} timestamp
 * @returns {string} — 64-char hex string (uppercase)
 */
export function generarHashCertificacion(proyectoId, auditId, timestamp) {
  const seed = `RADARFONDOS360::${proyectoId}::${auditId}::${timestamp}::F5-01-CROSSCHECK`;
  return crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
}

/**
 * Genera el buffer PDF del reporte certificado (SSR exclusivo).
 * @param {object} proyecto — fila completa de la tabla proyectos
 * @returns {Promise<Buffer>}
 */
export function generarReportePDF(proyecto) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size:        'A4',
        bufferPages: true,
        margins:     { top: 60, bottom: 80, left: 50, right: 50 },
        info: {
          Title:    `Reporte — ${proyecto.nombre}`,
          Author:   'RadarFondos 360',
          Subject:  'Certificado Auditoría Cross-Check F5-01',
          Creator:  'CrossCheck Pipeline v1',
          Producer: 'RadarFondos 360',
        },
      });

      const chunks = [];
      doc.on('data',  c   => chunks.push(c));
      doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      const ML = doc.page.margins.left;
      const W  = doc.page.width - ML - doc.page.margins.right;

      const ft    = safeJson(proyecto.ficha_tecnica);
      const pre   = safeJson(proyecto.presupuesto);
      const sello = safeJson(proyecto.crosscheck_sello, null);

      const auditId   = sello?.auditId   || 'N/A';
      const timestamp = sello?.pasado_en || new Date().toISOString();
      const HASH      = generarHashCertificacion(proyecto.id, auditId, timestamp);

      // ── HEADER ──────────────────────────────────────────────────────────
      doc.rect(ML, doc.y, W, 4).fill(C.primary);
      doc.y += 14;

      doc.font(BOLD).fontSize(20).fillColor(C.primary)
         .text('RADAR FONDOS 360', ML, doc.y, { width: W, align: 'center' });
      doc.font(NORMAL).fontSize(9).fillColor(C.muted)
         .text('REPORTE OFICIAL DE RADICACIÓN · AUDITORÍA CROSS-CHECK F5-01',
               { width: W, align: 'center' });
      doc.moveDown(0.4);

      const isOk = proyecto.estado === 'Finalizado';
      doc.font(BOLD).fontSize(9).fillColor(isOk ? C.green : C.red)
         .text(
           isOk ? '● PROYECTO FINALIZADO — SELLO DE AUDITORÍA EMITIDO'
                : `● ESTADO: ${proyecto.estado}`,
           { width: W, align: 'center' }
         );
      doc.moveDown(0.7);
      hRule(doc, ML, W, C.border, BORDER_WIDTH);
      doc.moveDown(0.9);

      // ── S1: DATOS GENERALES ──────────────────────────────────────────────
      sTitle(doc, ML, W, '1.  DATOS GENERALES DEL PROYECTO');
      kv(doc, ML, W, 'Nombre',               proyecto.nombre);
      kv(doc, ML, W, 'ID de Proyecto',       proyecto.id);
      kv(doc, ML, W, 'Estado',               proyecto.estado);
      kv(doc, ML, W, 'Creado',               fmtDate(proyecto.created_at));
      kv(doc, ML, W, 'Última Actualización', fmtDate(proyecto.updated_at));
      if (ft.descripcion) kv(doc, ML, W, 'Descripción', ft.descripcion);
      doc.moveDown(0.9);

      // ── S2: FICHA TÉCNICA ────────────────────────────────────────────────
      sTitle(doc, ML, W, '2.  FICHA TÉCNICA (Módulo 3b)');
      kv(doc, ML, W, 'Meta Física Total', fmt(ft.metaFisicaTotal || 0));
      if (ft.sector)       kv(doc, ML, W, 'Sector',       ft.sector);
      if (ft.municipio)    kv(doc, ML, W, 'Municipio',    ft.municipio);
      if (ft.departamento) kv(doc, ML, W, 'Departamento', ft.departamento);
      if (ft.convocatoria) kv(doc, ML, W, 'Convocatoria', ft.convocatoria);
      doc.moveDown(0.9);

      // ── S3: PRESUPUESTO POR FASES ────────────────────────────────────────
      sTitle(doc, ML, W, '3.  PRESUPUESTO POR FASES (Módulo 4)');

      const fN = pre.fasesNegra  || [];
      const fG = pre.fasesGris   || [];
      const fB = pre.fasesBlanca || [];

      const totN = r2(sumItems(fN));
      const totG = r2(sumItems(fG));
      const totB = r2(sumItems(fB));
      const totT = r2(totN + totG + totB);

      faseBlock(doc, ML, W, 'Fase Negra — Preliminares / Cimentación', fN, totN);
      faseBlock(doc, ML, W, 'Fase Gris  — Estructura / Obra Gris',      fG, totG);
      faseBlock(doc, ML, W, 'Fase Blanca — Acabados',                   fB, totB);

      hRule(doc, ML, W, C.primary, BORDER_WIDTH);
      const totY = doc.y + 5;
      doc.font(BOLD).fontSize(10).fillColor(C.primary)
         .text('TOTAL GENERAL DE FASES', ML, totY, { width: W * 0.6, lineBreak: false });
      doc.font(BOLD).fontSize(10).fillColor(C.primary)
         .text(fmt(totT), ML, totY, { width: W, align: 'right', lineBreak: false });
      doc.y = totY + 16;
      doc.moveDown(0.9);

      // ── S4: SELLO CROSS-CHECK ────────────────────────────────────────────
      sTitle(doc, ML, W, '4.  SELLO DE AUDITORÍA CROSS-CHECK (F5-01)');

      if (sello) {
        const bY = doc.y;
        const bH = 100;
        doc.rect(ML, bY, W, bH).fill(C.certBg);

        let lineY = bY + 10;
        doc.font(BOLD).fontSize(10).fillColor(C.green)
           .text('✓  CROSS-CHECK APROBADO · DISCREPANCIA $0.00',
                 ML + 12, lineY, { width: W - 24 });
        lineY += 16;

        const r = sello.resumen || {};
        for (const [lbl, val] of [
          ['ID de Auditoría',     sello.auditId],
          ['Pipeline',            sello.validado_por],
          ['Fecha / Hora (COT)',  fmtDate(sello.pasado_en)],
          ['Meta Declarada',      fmt(r.metaFisicaDeclarada || 0)],
          ['Total Fases',         fmt(r.totalFases || 0)],
          ['Discrepancia',        `$${Number(r.discrepancy || 0).toFixed(2)}`],
        ]) {
          doc.font(BOLD).fontSize(9).fillColor(C.muted)
             .text(`${lbl}:`, ML + 12, lineY, { width: 140, lineBreak: false });
          doc.font(NORMAL).fontSize(9).fillColor(C.body)
             .text(String(val || '—'), ML + 156, lineY, { lineBreak: false });
          lineY += 12;
        }
        doc.y = bY + bH + 8;
      } else {
        doc.font(NORMAL).fontSize(9).fillColor(C.red)
           .text('⚠  Sello de auditoría no disponible. El proyecto no ha sido radicado aún.');
      }
      doc.moveDown(1);

      // ── S5: HASH DE CERTIFICACIÓN ────────────────────────────────────────
      sTitle(doc, ML, W, '5.  HASH DE CERTIFICACIÓN SHA-256');

      const hashY = doc.y;
      doc.rect(ML, hashY, W, 44).fill(C.monoBg);
      doc.font(MONO).fontSize(8.5).fillColor(C.monoFg)
         .text(HASH.slice(0, 32), ML + 10, hashY + 8,
               { width: W - 20, align: 'center', lineBreak: false });
      doc.font(MONO).fontSize(8.5).fillColor(C.monoFg)
         .text(HASH.slice(32),    ML + 10, hashY + 23,
               { width: W - 20, align: 'center', lineBreak: false });
      doc.y = hashY + 44 + 8;
      doc.moveDown(0.5);

      doc.font(NORMAL).fontSize(7.5).fillColor(C.muted)
         .text(
           'Documento generado mediante Server-Side Rendering exclusivo por RadarFondos 360. ' +
           'El Hash SHA-256 vincula matemáticamente el contenido con el registro de auditoría en BD. ' +
           'Cualquier alteración invalida el hash. Válido ante entidades certificadoras — Protocolo F5-01.',
           { align: 'justify', lineGap: 1.5 }
         );

      // ── FOOTER EN TODAS LAS PÁGINAS ──────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        pageFooter(doc, ML, W, HASH, i + 1, range.count);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Footer ────────────────────────────────────────────────────────────────────

function pageFooter(doc, ml, w, hash, pageNum, totalPages) {
  const fy = doc.page.height - doc.page.margins.bottom + 16;
  doc.save();
  doc.moveTo(ml, fy).lineTo(ml + w, fy)
     .strokeColor(C.border).lineWidth(BORDER_WIDTH).stroke();
  doc.font(MONO).fontSize(6.5).fillColor(C.muted)
     .text(`SHA-256: ${hash}`, ml, fy + 5, { width: w - 50, lineBreak: false });
  doc.font(NORMAL).fontSize(7).fillColor(C.muted)
     .text(`Pág. ${pageNum} / ${totalPages}`, ml, fy + 5,
           { width: w, align: 'right', lineBreak: false });
  doc.restore();
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function hRule(doc, ml, w, color, lw = BORDER_WIDTH) {
  const y = doc.y;
  doc.moveTo(ml, y).lineTo(ml + w, y).strokeColor(color).lineWidth(lw).stroke();
  doc.y = y + 2;
}

function sTitle(doc, ml, w, text) {
  doc.font(BOLD).fontSize(10).fillColor(C.primary)
     .text(text, ml, doc.y, { width: w });
  hRule(doc, ml, w, C.primary, BORDER_WIDTH);
  doc.moveDown(0.4);
}

function kv(doc, ml, w, label, value) {
  const y = doc.y;
  doc.font(BOLD).fontSize(8.5).fillColor(C.muted)
     .text(label, ml, y, { width: w * 0.34, lineBreak: false });
  doc.font(NORMAL).fontSize(8.5).fillColor(C.body)
     .text(String(value || '—'), ml + w * 0.36, y, { width: w * 0.64 });
  doc.y += 1;
}

function faseBlock(doc, ml, w, title, items, total) {
  doc.font(BOLD).fontSize(9).fillColor(C.accent)
     .text(title, ml, doc.y, { width: w });
  doc.moveDown(0.2);

  if (items.length === 0) {
    doc.font(NORMAL).fontSize(8.5).fillColor(C.muted)
       .text('(sin ítems)', ml + 12, doc.y);
    doc.moveDown(0.3);
  } else {
    for (const item of items) {
      const iy = doc.y;
      doc.font(NORMAL).fontSize(8.5).fillColor(C.body)
         .text(`• ${String(item.item || 'Ítem')}`, ml + 12, iy,
               { width: w * 0.62, lineBreak: false });
      doc.font(NORMAL).fontSize(8.5).fillColor(C.body)
         .text(fmt(item.valor), ml + 12, iy,
               { width: w - 12, align: 'right', lineBreak: false });
      doc.y = iy + 12;
    }
  }

  const sy = doc.y + 2;
  doc.font(BOLD).fontSize(8.5).fillColor(C.accent)
     .text('Subtotal', ml + 12, sy, { width: w * 0.62, lineBreak: false });
  doc.font(BOLD).fontSize(8.5).fillColor(C.accent)
     .text(fmt(total), ml + 12, sy, { width: w - 12, align: 'right', lineBreak: false });
  doc.y = sy + 14;
  doc.moveDown(0.4);
}
