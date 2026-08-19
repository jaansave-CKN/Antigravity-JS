/**
 * svgEmbed.js — incrustado vectorial real de gráficos/diagramas SVG dentro
 * de un documento pdfkit.
 *
 * Mandato "Motor de Diagramación ISO 9000" (2026-08-17): los reportes PDF
 * de RadFor-360 (backend/services/pdfGenerator.js — Módulo 9 Certificado, y
 * exportGenerator.js — MGA/BID/OXI) se construyen con pdfkit puro
 * (doc.rect/doc.text con coordenadas absolutas), NO con HTML→PDF vía
 * Puppeteer — pdfkit no interpreta SVG nativamente. svg-to-pdfkit traduce
 * el SVG a las primitivas vectoriales propias de pdfkit (paths, rects,
 * texto) en vez de rasterizarlo, así que el gráfico se mantiene nítido a
 * cualquier nivel de zoom — decisión explícita del usuario sobre la
 * alternativa más simple (rasterizar a PNG en el cliente).
 *
 * Origen del SVG: el frontend renderiza el gráfico/diagrama real (Recharts
 * vía <GraficoFinanciero>, Mermaid vía <DiagramaMermaid>) y extrae el
 * <svg>.outerHTML del DOM ya renderizado — este módulo NO renderiza nada
 * por su cuenta ni intenta correr Recharts/Mermaid en Node (ninguno de los
 * dos tiene un modo de renderizado server-side confiable sin un DOM real).
 */
import SVGtoPDF from 'svg-to-pdfkit';

/**
 * Incrusta un string SVG dentro de un documento pdfkit en la posición dada.
 * @param {import('pdfkit')} doc - documento pdfkit activo (ya con .pipe() o buffer en curso)
 * @param {string} svgString - markup SVG completo (outerHTML de un <svg>)
 * @param {number} x
 * @param {number} y
 * @param {{ width?: number, height?: number, preserveAspectRatio?: string }} [opciones]
 */
export function embedSvgInPdf(doc, svgString, x, y, opciones = {}) {
  if (!svgString || typeof svgString !== 'string' || !svgString.trim().startsWith('<svg')) {
    throw new Error('embedSvgInPdf: se esperaba un string <svg>...</svg> válido');
  }
  SVGtoPDF(doc, svgString, x, y, {
    width: opciones.width,
    height: opciones.height,
    preserveAspectRatio: opciones.preserveAspectRatio ?? 'xMidYMid meet',
    // FIX: silencia warnings de elementos SVG no soportados por la librería
    // (p. ej. <foreignObject>, poco común en Recharts/Mermaid) sin que
    // interrumpan la generación del PDF completo — un elemento no crítico
    // no debe tumbar todo el reporte certificado.
    warningCallback: () => {},
  });
}
