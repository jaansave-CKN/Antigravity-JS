/**
 * exportGenerator.js — Fase 5: Exportación a estructura MGA / BID / OXI
 *
 * Genera documentos PDF reales usando los datos ya capturados por el
 * Formulador (ficha_tecnica, árbol de objetivos, indicadores, teoría de
 * cambio, presupuesto, logística) organizados según la estructura pública
 * de cada metodología:
 *
 *   - MGA (DNP Colombia): 4 módulos — Identificación, Preparación,
 *     Evaluación Ex-ante, Programación.
 *   - BID: matriz de marco lógico 4×4 (Fin/Propósito/Componentes/
 *     Actividades × Resumen/Indicadores/Medios de verificación/Supuestos).
 *   - OXI (Obras por Impuestos, ART/DNP): exige MGA + capa adicional de
 *     viabilidad y desglose de costos (interventoría/pólizas/impuestos).
 *
 * IMPORTANTE — alcance honesto: no se tuvo acceso a las plantillas oficiales
 * exactas (PDF/Excel del DNP/ART) en este entorno. Estos documentos siguen
 * la estructura pública verificada de cada metodología con datos reales del
 * proyecto, pero NO son el formulario oficial descargado 1:1 — cada PDF lo
 * indica explícitamente en el pie de página.
 */
import PDFDocument from 'pdfkit';

const C = {
  primary: '#0037b0', accent: '#1d4ed8', body: '#191c1e', muted: '#6C757D',
  border: '#CBD5E1', warnBg: '#FEF3C7', warnText: '#92400E',
};
const NORMAL = 'Helvetica';
const BOLD   = 'Helvetica-Bold';
const BORDER_WIDTH = 1;

function safeJson(v, fallback = {}) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}
function fmt(n) {
  return `$${Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function sumItems(items = []) { return items.reduce((s, i) => s + (Number(i.valor) || 0), 0); }

function hRule(doc, ml, w, color = C.border) {
  const y = doc.y;
  doc.moveTo(ml, y).lineTo(ml + w, y).strokeColor(color).lineWidth(BORDER_WIDTH).stroke();
  doc.y = y + 2;
}
function sTitle(doc, ml, w, text) {
  doc.font(BOLD).fontSize(11).fillColor(C.primary).text(text, ml, doc.y, { width: w });
  hRule(doc, ml, w, C.primary);
  doc.moveDown(0.4);
}
function kv(doc, ml, w, label, value) {
  const y = doc.y;
  doc.font(BOLD).fontSize(8.5).fillColor(C.muted).text(label, ml, y, { width: w * 0.32, lineBreak: false });
  doc.font(NORMAL).fontSize(8.5).fillColor(C.body).text(String(value ?? '') || 'Sin definir', ml + w * 0.34, y, { width: w * 0.66 });
  doc.y += 2;
}
function bullets(doc, ml, w, items, empty = '(sin datos registrados)') {
  if (!items || items.length === 0) {
    doc.font(NORMAL).fontSize(8.5).fillColor(C.muted).text(empty, ml + 10, doc.y);
    doc.moveDown(0.3);
    return;
  }
  for (const it of items) {
    doc.font(NORMAL).fontSize(8.5).fillColor(C.body).text(`•  ${it}`, ml + 10, doc.y, { width: w - 10 });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.3);
}
function disclaimer(doc, ml, w, metodologia) {
  const y = doc.y + 6;
  doc.rect(ml, y, w, 34).fill(C.warnBg);
  doc.font(NORMAL).fontSize(7.2).fillColor(C.warnText).text(
    `Documento generado según la estructura pública de ${metodologia} con los datos reales del proyecto. ` +
    'No sustituye el formulario/plantilla oficial vigente — verifícalo contra la fuente oficial antes de radicar.',
    ml + 8, y + 6, { width: w - 16 }
  );
  doc.y = y + 40;
}
function pageFooter(doc, ml, w, pageNum, totalPages, titulo) {
  const fy = doc.page.height - doc.page.margins.bottom + 14;
  doc.save();
  doc.moveTo(ml, fy).lineTo(ml + w, fy).strokeColor(C.border).lineWidth(BORDER_WIDTH).stroke();
  doc.font(NORMAL).fontSize(7).fillColor(C.muted).text(titulo, ml, fy + 5, { width: w * 0.7, lineBreak: false });
  doc.font(NORMAL).fontSize(7).fillColor(C.muted).text(`Pág. ${pageNum} / ${totalPages}`, ml, fy + 5, { width: w, align: 'right', lineBreak: false });
  doc.restore();
}

function newDoc(proyecto, subtitle) {
  const doc = new PDFDocument({
    size: 'A4', bufferPages: true, margins: { top: 60, bottom: 60, left: 50, right: 50 },
    info: { Title: `${subtitle} — ${proyecto.nombre}`, Author: 'RadarFondos 360', Producer: 'RadarFondos 360' },
  });
  const ML = doc.page.margins.left;
  const W = doc.page.width - ML - doc.page.margins.right;
  doc.rect(ML, doc.y, W, 4).fill(C.primary);
  doc.y += 14;
  doc.font(BOLD).fontSize(18).fillColor(C.primary).text('RADAR FONDOS 360', ML, doc.y, { width: W, align: 'center' });
  doc.font(NORMAL).fontSize(9).fillColor(C.muted).text(subtitle, { width: W, align: 'center' });
  doc.moveDown(0.3);
  doc.font(BOLD).fontSize(10).fillColor(C.body).text(proyecto.nombre, { width: W, align: 'center' });
  doc.moveDown(0.6);
  hRule(doc, ML, W, C.primary);
  doc.moveDown(0.7);
  return { doc, ML, W };
}

function finalize(doc, ML, W, titulo) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      pageFooter(doc, ML, W, i + 1, range.count, titulo);
    }
    doc.end();
  });
}

// ── MGA ───────────────────────────────────────────────────────────────────────
export async function generarMGA(proyecto, arbol, indicadores, tdc, logistica) {
  const ft = safeJson(proyecto.ficha_tecnica);
  const pre = safeJson(proyecto.presupuesto);
  const { doc, ML, W } = newDoc(proyecto, 'ESTRUCTURA MGA (Metodología General Ajustada — DNP Colombia)');

  const central = arbol.find(n => n.tipo === 'CENTRAL');
  const especificos = arbol.filter(n => n.tipo === 'ESPECIFICO');
  const resultados = arbol.filter(n => n.tipo === 'RESULTADO');
  const actividades = arbol.filter(n => n.tipo === 'ACTIVIDAD');

  sTitle(doc, ML, W, 'MÓDULO 1 · IDENTIFICACIÓN');
  kv(doc, ML, W, 'Problema / Diagnóstico', ft.contexto_narrativo?.A_diagnostico || ft.descripcion || '');
  kv(doc, ML, W, 'Objetivo Central', central?.texto || '');
  doc.font(BOLD).fontSize(9).fillColor(C.accent).text('Objetivos Específicos', ML, doc.y);
  doc.moveDown(0.2);
  bullets(doc, ML, W, especificos.map(n => n.texto));

  sTitle(doc, ML, W, 'MÓDULO 2 · PREPARACIÓN');
  doc.font(BOLD).fontSize(9).fillColor(C.accent).text('Resultados esperados', ML, doc.y);
  doc.moveDown(0.2);
  bullets(doc, ML, W, resultados.map(n => n.texto));
  doc.font(BOLD).fontSize(9).fillColor(C.accent).text('Actividades', ML, doc.y);
  doc.moveDown(0.2);
  bullets(doc, ML, W, actividades.map(n => n.texto));
  doc.font(BOLD).fontSize(9).fillColor(C.accent).text('Indicadores', ML, doc.y);
  doc.moveDown(0.2);
  bullets(doc, ML, W, indicadores.map(i => `${i.nombre} (${i.tipo}) — LB ${i.linea_base} → Meta ${i.meta_total} ${i.unidad_medida}${i.fuente_verificacion ? ` · Fuente: ${i.fuente_verificacion}` : ''}`));
  if (logistica) {
    kv(doc, ML, W, 'Ubicación', [logistica.municipio, logistica.departamento].filter(Boolean).join(', '));
    kv(doc, ML, W, 'Duración estimada', logistica.duracion_meses ? `${logistica.duracion_meses} meses` : '');
  }

  sTitle(doc, ML, W, 'MÓDULO 3 · EVALUACIÓN EX-ANTE');
  const fN = pre.fasesNegra || [], fG = pre.fasesGris || [], fB = pre.fasesBlanca || [];
  const total = sumItems(fN) + sumItems(fG) + sumItems(fB);
  kv(doc, ML, W, 'Presupuesto Fase Negra', fmt(sumItems(fN)));
  kv(doc, ML, W, 'Presupuesto Fase Gris', fmt(sumItems(fG)));
  kv(doc, ML, W, 'Presupuesto Fase Blanca', fmt(sumItems(fB)));
  kv(doc, ML, W, 'Presupuesto Total', fmt(total));
  kv(doc, ML, W, 'Meta Física Total', String(ft.metaFisicaTotal || 'Sin definir'));

  sTitle(doc, ML, W, 'MÓDULO 4 · PROGRAMACIÓN');
  kv(doc, ML, W, 'Entidad Proponente', logistica?.proponente_nombre || '');
  kv(doc, ML, W, 'Tipo de Entidad', logistica?.tipo_entidad || '');
  if (tdc?.impacto_largo_plazo) kv(doc, ML, W, 'Impacto de Largo Plazo (TdC)', tdc.impacto_largo_plazo);

  disclaimer(doc, ML, W, 'la Metodología General Ajustada (MGA) del DNP');
  return finalize(doc, ML, W, `MGA — ${proyecto.nombre}`);
}

// ── BID (marco lógico 4×4) ──────────────────────────────────────────────────
export async function generarBID(proyecto, arbol, indicadores) {
  const { doc, ML, W } = newDoc(proyecto, 'MATRIZ DE MARCO LÓGICO (BID)');

  const NIVELES = [
    { tipo: 'CENTRAL',    label: 'FIN' },
    { tipo: 'ESPECIFICO', label: 'PROPÓSITO' },
    { tipo: 'RESULTADO',  label: 'COMPONENTES' },
    { tipo: 'ACTIVIDAD',  label: 'ACTIVIDADES' },
  ];
  const colW = [W * 0.14, W * 0.36, W * 0.22, W * 0.28];

  // Encabezado de tabla
  const headY = doc.y;
  doc.rect(ML, headY, W, 18).fill(C.primary);
  doc.font(BOLD).fontSize(8).fillColor('#fff');
  let x = ML;
  for (const [i, h] of ['NIVEL', 'RESUMEN NARRATIVO', 'INDICADORES', 'SUPUESTOS/RIESGOS'].entries()) {
    doc.text(h, x + 4, headY + 5, { width: colW[i] - 8, lineBreak: false });
    x += colW[i];
  }
  doc.y = headY + 20;

  for (const nivel of NIVELES) {
    const nodos = arbol.filter(n => n.tipo === nivel.tipo);
    if (nodos.length === 0) continue;
    const rowY = doc.y;
    let cx = ML;
    doc.font(BOLD).fontSize(8).fillColor(C.accent).text(nivel.label, cx + 4, rowY, { width: colW[0] - 8 });
    cx += colW[0];
    doc.font(NORMAL).fontSize(8).fillColor(C.body).text(nodos.map(n => n.texto).join('\n'), cx + 4, rowY, { width: colW[1] - 8 });
    cx += colW[1];
    const indsTexto = nivel.tipo === 'RESULTADO' || nivel.tipo === 'CENTRAL'
      ? indicadores.map(i => `${i.nombre}: ${i.meta_total} ${i.unidad_medida}`).join('\n') || '—'
      : '—';
    doc.font(NORMAL).fontSize(7.5).fillColor(C.body).text(indsTexto, cx + 4, rowY, { width: colW[2] - 8 });
    cx += colW[2];
    doc.font(NORMAL).fontSize(7.5).fillColor(C.body).text(nodos.map(n => n.supuestos || '(sin registrar)').join('\n'), cx + 4, rowY, { width: colW[3] - 8 });
    doc.y = Math.max(doc.y, rowY + 20);
    hRule(doc, ML, W);
    doc.moveDown(0.2);
  }

  if (arbol.length === 0) {
    doc.font(NORMAL).fontSize(9).fillColor(C.muted).text('No hay árbol de objetivos generado para este proyecto — visita "Árbol de Objetivos" en el Formulador primero.', ML, doc.y, { width: W });
  }

  disclaimer(doc, ML, W, 'la matriz de marco lógico del BID');
  return finalize(doc, ML, W, `BID — ${proyecto.nombre}`);
}

// ── OXI (Obras por Impuestos — MGA + viabilidad + costos) ───────────────────
const REQUISITOS_ANEXO1 = [
  'Predio(s) saneado(s) jurídicamente',
  'Ficha técnica / estudio de preinversión diligenciado (MGA)',
  'Relación de cantidades de obra y presupuesto a precios de mercado',
  'Costos de interventoría incluidos',
  'Pólizas y garantías previstas',
  'Impuestos y gastos asociados estimados',
  'Estudios y diseños técnicos disponibles',
];

export async function generarOXI(proyecto, arbol, indicadores, tdc, logistica) {
  // OXI exige la MGA como base — el resumen MGA se genera aparte vía
  // GET /api/proyectos/:id/exportar/mga; este documento cubre la capa
  // adicional específica de OXI (viabilidad + costos) más un resumen breve.
  const ft = safeJson(proyecto.ficha_tecnica);
  const pre = safeJson(proyecto.presupuesto);
  const { doc, ML, W } = newDoc(proyecto, 'ESTRUCTURA OXI (Obras por Impuestos — ART/DNP)');

  doc.font(NORMAL).fontSize(8.5).fillColor(C.muted).text(
    'OXI exige diligenciar la Metodología General Ajustada (MGA) más una capa adicional de viabilidad ' +
    'y desglose de costos (Manual Operativo Obras por Impuestos, ART). El resumen MGA fue generado por ' +
    'separado; este documento cubre la capa adicional específica de OXI.',
    ML, doc.y, { width: W }
  );
  doc.moveDown(0.8);

  sTitle(doc, ML, W, 'RESUMEN MGA DEL PROYECTO');
  const central = arbol.find(n => n.tipo === 'CENTRAL');
  kv(doc, ML, W, 'Objetivo Central', central?.texto || '');
  kv(doc, ML, W, 'Meta Física Total', String(ft.metaFisicaTotal || 'Sin definir'));

  sTitle(doc, ML, W, 'ANEXO 1 · REQUISITOS DE VIABILIDAD (checklist)');
  doc.font(NORMAL).fontSize(8).fillColor(C.muted).text('Marca manualmente cada ítem antes de radicar — este sistema no verifica su cumplimiento real.', ML, doc.y, { width: W });
  doc.moveDown(0.3);
  bullets(doc, ML, W, REQUISITOS_ANEXO1.map(r => `☐  ${r}`));

  sTitle(doc, ML, W, 'ESTRUCTURA DE COSTOS (precios de mercado)');
  const fN = pre.fasesNegra || [], fG = pre.fasesGris || [], fB = pre.fasesBlanca || [];
  const totalObra = sumItems(fN) + sumItems(fG) + sumItems(fB);
  kv(doc, ML, W, 'Costo directo de obra (fases negra+gris+blanca)', fmt(totalObra));
  kv(doc, ML, W, 'Interventoría (estimar aparte)', 'Pendiente de definir');
  kv(doc, ML, W, 'Pólizas y garantías (estimar aparte)', 'Pendiente de definir');
  kv(doc, ML, W, 'Impuestos y gastos asociados (estimar aparte)', 'Pendiente de definir');

  disclaimer(doc, ML, W, 'Obras por Impuestos (ART/DNP)');
  return finalize(doc, ML, W, `OXI — ${proyecto.nombre}`);
}
