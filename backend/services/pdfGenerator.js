/**
 * F5-02 — Motor de Exportación Certificada (SSR)
 * Protocol Precision: sin sombras, borders 1px #CBD5E1, tipografía limpia.
 * Toda la generación es server-side. El cliente recibe el buffer directamente.
 */

import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import { embedSvgInPdf } from './svgEmbed.js';

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

// Mismos ids/labels que CONTEXTO_LABELS en FichaTecnicaPage.tsx (a su vez
// calcados de CONTEXTO_CAMPOS en EntradaPage.tsx) — Campo C se maneja aparte
// arriba porque es un objeto estructurado, no un string plano.
const CONTEXTO_LABELS = {
  situacion_actual: 'A. Situación Actual sin Proyecto',
  linea_base: 'B. Indicador de Línea Base Cuantificable',
  justificacion: 'D. Justificación de Prioridad',
  sociocultural: 'E. Análisis Sociocultural para la Pertinencia',
  problema_urgente: 'F. ¿Qué Problema Percibe como Más Urgente?',
  incertidumbre: 'G. Condición Crítica de Incertidumbre Logística',
};

// ── Utils ─────────────────────────────────────────────────────────────────────

function safeJson(v, fallback = {}) {
  // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10 — migración ficha_tecnica a
  // JSONB nativo): antes descartaba en silencio cualquier valor que no fuera
  // string — un objeto ya parseado (lo que devuelve el driver pg para una
  // columna JSONB real) caía directo al fallback {}, vaciando la ficha
  // técnica en los PDFs exportados (MGA/BID/OXI) sin ningún error visible.
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
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
 * @param {Array<{svg: string, titulo?: string}>} [graficos] — gráficos/diagramas
 *   ya renderizados en el navegador (Recharts vía <GraficoFinanciero>, Mermaid
 *   vía <DiagramaMermaid>) — se recibe el <svg>.outerHTML real, este generador
 *   NO renderiza nada por su cuenta (ver backend/services/svgEmbed.js). Opcional
 *   — si se omite, el reporte se genera exactamente igual que antes.
 * @param {{dialectico?: object, tramos?: object[], anexos?: object[]}} [modulos]
 *   — Motor Dialéctico (motor_dialectico), tramos de Logística
 *   (logistica_tramos) y Anexos (project_anexos) — consultados aparte por el
 *   caller (reporte.routes.js) porque viven en tablas propias, no dentro de
 *   proyecto.ficha_tecnica.
 * @returns {Promise<Buffer>}
 */
export function generarReportePDF(proyecto, graficos = [], modulos = {}) {
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
      // FIX (2026-08-23, "que se vea como un proyecto formulado"): ft.sector/
      // .municipio/.convocatoria/.descripcion (esquema plano viejo) ya no
      // existen — todo Entrada vive anidado en ft.entrada_completa desde la
      // migración a JSONB nativo. Confirmado en vivo: sin este cambio esos
      // campos salían SIEMPRE vacíos en el PDF, sin importar qué tuviera el
      // proyecto realmente cargado.
      const entrada = ft.entrada_completa || {};
      const contexto = entrada.contexto || {};
      const contextoMeta = entrada.contextoMeta || {};
      const dialectico = modulos.dialectico || {};
      const tramos = modulos.tramos || [];
      const anexos = modulos.anexos || [];
      const raciResumen = modulos.raciResumen || null;

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
           isOk ? 'PROYECTO FINALIZADO — SELLO DE AUDITORÍA EMITIDO'
                : `ESTADO: ${proyecto.estado}`,
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
      doc.moveDown(0.9);

      // ── S2: ENTRADA (Módulo 1) ───────────────────────────────────────────
      checkPageBreak(doc, 140);
      sTitle(doc, ML, W, '2.  ENTRADA (Módulo 1)');
      kv(doc, ML, W, 'Municipio',              entrada.municipio || '—');
      kv(doc, ML, W, 'Vereda',                 entrada.vereda || '—');
      kv(doc, ML, W, 'Cobertura Geográfica',   entrada.coberturaGeografica || '—');
      kv(doc, ML, W, 'Número de Beneficiarios',entrada.numeroBeneficiarios || '—');
      kv(doc, ML, W, 'Tipo de Proyecto',       entrada.enfoque || '—');
      kv(doc, ML, W, 'Fuente de Financiación', entrada.tipoConvocatoria || '—');
      kv(doc, ML, W, 'Nivel del Proyecto',     entrada.nivelProyecto || '—');
      kv(doc, ML, W, 'Formato del Financiador',entrada.formatoFinanciador || '—');
      kv(doc, ML, W, 'Metodologías',           (entrada.metodologias || []).join(', ') || '—');
      kv(doc, ML, W, 'Sectores',               (entrada.sectores || []).join(', ') || '—');
      doc.moveDown(0.9);

      // ── S3: CONTEXTO DEL PROBLEMA (Sección 11 de Entrada) ────────────────
      // Mismos ids de campo que EntradaPage.tsx/CONTEXTO_CAMPOS — el usuario
      // confirmó explícitamente (2026-08-23) que ficha_tecnica.contexto_narrativo
      // (ContextoPage/"/contexto") es un módulo viejo sin uso; el Contexto del
      // Problema real vive en entrada_completa.contexto/.contextoMeta.
      checkPageBreak(doc, 100);
      sTitle(doc, ML, W, '3.  CONTEXTO DEL PROBLEMA');
      const problematicaSel = (contextoMeta.problematicas || []).find(p => p.problema === contextoMeta.problemaSeleccionado);
      kv(doc, ML, W, 'C. Problemática (Meta Esperada)', contextoMeta.problemaSeleccionado || '—');
      kv(doc, ML, W, 'C. Déficit Asociado', problematicaSel?.deficit_valor != null ? `${problematicaSel.deficit_valor} ${problematicaSel.deficit_unidad || ''}`.trim() : '—');
      kv(doc, ML, W, 'C. Beneficiarios', contextoMeta.beneficiarios || '—');
      kv(doc, ML, W, 'C. Tipo de Formulación', contextoMeta.tipoFormulacion || '—');
      doc.moveDown(0.5);
      for (const [id, label] of Object.entries(CONTEXTO_LABELS)) {
        checkPageBreak(doc, 60);
        kvStacked(doc, ML, W, label, contexto[id]);
      }
      doc.moveDown(0.5);

      // ── S4: MOTOR DIALÉCTICO (Módulo 4) ──────────────────────────────────
      checkPageBreak(doc, 100);
      sTitle(doc, ML, W, '4.  MOTOR DIALÉCTICO');
      kv(doc, ML, W, 'Interlocutor',  dialectico.interlocutor || '—');
      kv(doc, ML, W, 'Tono',          dialectico.tono || '—');
      kv(doc, ML, W, 'Enfoque',       dialectico.enfoque || '—');
      kv(doc, ML, W, 'Humanización',  dialectico.humanizacion || '—');
      doc.moveDown(0.9);

      // MANDATO (2026-08-24, "mismo orden en que se encuentran las
      // ventanas"): reordenado para calzar con TopNavBar.tsx (Entrada ·
      // Dialéctica · Anexos · Biblioteca · Logística · Matriz RACI · ...) —
      // Anexos antes que Logística.
      // ── S5: ANEXOS ────────────────────────────────────────────────────────
      checkPageBreak(doc, 100);
      sTitle(doc, ML, W, '5.  ANEXOS — SOPORTES DOCUMENTALES');
      const anexosValidos = anexos.filter(a => a.descripcion && (a.nombre_archivo || a.link));
      if (anexosValidos.length === 0) {
        doc.font(NORMAL).fontSize(8.5).fillColor(C.muted).text('Sin soportes cargados.', ML, doc.y, { width: W });
        doc.moveDown(0.4);
      } else {
        for (const a of anexosValidos) {
          checkPageBreak(doc, 20);
          doc.font(NORMAL).fontSize(8.5).fillColor(C.body)
             .text(`• ${a.descripcion}  —  ${a.nombre_archivo || a.link}`, ML, doc.y, { width: W });
          doc.moveDown(0.2);
        }
      }
      doc.moveDown(0.7);

      // ── S6: LOGÍSTICA (Módulo de tramos) ─────────────────────────────────
      checkPageBreak(doc, 100);
      sTitle(doc, ML, W, '6.  LOGÍSTICA — TRAMOS DE EJECUCIÓN');
      const tramosValidos = tramos.filter(t => t.origen && t.destino && t.duracion);
      if (tramosValidos.length === 0) {
        doc.font(NORMAL).fontSize(8.5).fillColor(C.muted).text('Sin tramos registrados.', ML, doc.y, { width: W });
        doc.moveDown(0.4);
      } else {
        for (const t of tramosValidos) {
          checkPageBreak(doc, 20);
          doc.font(NORMAL).fontSize(8.5).fillColor(C.body)
             .text(`• ${t.origen} — ${t.destino}  ·  ${t.duracion}${t.medio ? `  ·  ${t.medio}` : ''}`, ML, doc.y, { width: W });
          doc.moveDown(0.2);
        }
      }
      doc.moveDown(0.7);

      // ── S7: MATRIZ RACI ────────────────────────────────────────────────────
      // MANDATO (2026-08-24, "para que también al generar PDF, aparezca") —
      // resumen de validación, misma función que GET /raci/resumen (ver nota
      // junto a la extracción de raciResumen arriba).
      checkPageBreak(doc, 120);
      sTitle(doc, ML, W, '7.  MATRIZ RACI');
      if (!raciResumen || raciResumen.totalTareas === 0 || raciResumen.totalRoles === 0) {
        doc.font(NORMAL).fontSize(8.5).fillColor(C.muted).text('Sin tareas/roles registrados en la Matriz RACI.', ML, doc.y, { width: W });
        doc.moveDown(0.4);
      } else {
        kv(doc, ML, W, 'Tareas registradas', String(raciResumen.totalTareas));
        kv(doc, ML, W, 'Roles registrados', String(raciResumen.totalRoles));
        kv(doc, ML, W, 'Completitud de la matriz', `${raciResumen.porcentajeCompletitud}% (${raciResumen.totalAsignaciones} de ${raciResumen.celdasPosibles} celdas)`);
        doc.moveDown(0.4);
        const listaORinguna = (titulo, items) => {
          checkPageBreak(doc, 30);
          doc.font(BOLD).fontSize(8.5).fillColor(items.length ? C.red : C.green).text(`${titulo} (${items.length})`, ML, doc.y, { width: W });
          doc.moveDown(0.15);
          if (items.length === 0) {
            doc.font(NORMAL).fontSize(8.5).fillColor(C.muted).text('Ninguna.', ML, doc.y, { width: W });
          } else {
            for (const it of items) {
              checkPageBreak(doc, 16);
              doc.font(NORMAL).fontSize(8.5).fillColor(C.body).text(`• ${it.nombre}`, ML, doc.y, { width: W });
            }
          }
          doc.moveDown(0.4);
        };
        listaORinguna('Tareas sin Aprobador (A)', raciResumen.tareasSinA);
        listaORinguna('Tareas con más de un Aprobador (A)', raciResumen.tareasConMultiplesA);
        listaORinguna('Tareas sin Responsable (R)', raciResumen.tareasSinR);
        listaORinguna('Roles sin ninguna asignación', raciResumen.rolesSinAsignacion);
      }
      doc.moveDown(0.5);

      // ── S8: PRESUPUESTO POR FASES (Módulo 4) ──────────────────────────────
      checkPageBreak(doc, 100);
      sTitle(doc, ML, W, '8.  PRESUPUESTO POR FASES');

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

      // ── S9: SELLO CROSS-CHECK ────────────────────────────────────────────
      checkPageBreak(doc, 120);
      sTitle(doc, ML, W, '9.  SELLO DE AUDITORÍA CROSS-CHECK (F5-01)');

      if (sello) {
        const bY = doc.y;
        const bH = 100;
        doc.rect(ML, bY, W, bH).fill(C.certBg);

        let lineY = bY + 10;
        doc.font(BOLD).fontSize(10).fillColor(C.green)
           .text('CROSS-CHECK APROBADO · DISCREPANCIA $0.00',
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
           .text('Sello de auditoría no disponible. El proyecto no ha sido radicado aún.');
      }
      doc.moveDown(1);

      // ── S4.5: GRÁFICOS Y DIAGRAMAS (opcional — Motor de Diagramación
      // ISO 9000, 2026-08-17) — página aparte para no perturbar el layout
      // ya calibrado de las secciones 1-5. Cada gráfico ya viene renderizado
      // en SVG real desde el navegador (GraficoFinanciero/DiagramaMermaid);
      // aquí solo se incrusta como vector, sin rasterizar (ver svgEmbed.js).
      // Si un SVG puntual falla al incrustarse, se omite ESE gráfico con un
      // aviso — nunca se aborta el reporte certificado completo por eso.
      if (graficos.length > 0) {
        doc.addPage();
        sTitle(doc, ML, W, 'ANEXO — GRÁFICOS Y DIAGRAMAS DEL PROYECTO');
        for (const g of graficos) {
          if (doc.y > doc.page.height - doc.page.margins.bottom - 220) doc.addPage();
          if (g.titulo) {
            doc.font(BOLD).fontSize(9).fillColor(C.body).text(g.titulo, ML, doc.y, { width: W });
            doc.moveDown(0.3);
          }
          const alto = 200;
          try {
            embedSvgInPdf(doc, g.svg, ML, doc.y, { width: W, height: alto });
          } catch (err) {
            doc.font(NORMAL).fontSize(8).fillColor(C.red)
               .text(`[No se pudo incrustar este gráfico: ${err.message}]`, ML, doc.y, { width: W });
          }
          doc.y += alto + 16;
        }
      }

      // ── S10: HASH DE CERTIFICACIÓN ───────────────────────────────────────
      checkPageBreak(doc, 100);
      sTitle(doc, ML, W, '10.  HASH DE CERTIFICACIÓN SHA-256');

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

// Variante apilada (etiqueta arriba, valor abajo a todo el ancho) para
// campos de texto largo (Contexto del Problema, A. Situación Actual, etc.)
// — kv() de dos columnas queda demasiado angosto (64% de W) para un párrafo
// completo; aquí el valor usa el ancho completo de la sección.
function kvStacked(doc, ml, w, label, value) {
  doc.font(BOLD).fontSize(8.5).fillColor(C.muted)
     .text(label, ml, doc.y, { width: w });
  doc.moveDown(0.15);
  const vacio = !value || value === 'ND (No Disponible en la investigación)';
  doc.font(NORMAL).fontSize(8.5).fillColor(vacio ? C.muted : C.body)
     .text(vacio ? (value || '— Sin definir —') : value, ml, doc.y, { width: w, lineGap: 1.5 });
  doc.moveDown(0.5);
}

// Salto de página proactivo si no queda suficiente espacio vertical para el
// próximo bloque — mismo criterio ya usado para los gráficos (línea ~237 de
// la versión anterior), extendido a todas las secciones nuevas para que un
// título de sección o un párrafo largo de Contexto nunca quede cortado a la
// mitad entre dos páginas.
function checkPageBreak(doc, neededHeight) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - neededHeight) doc.addPage();
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
