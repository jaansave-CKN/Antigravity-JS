/**
 * markitdownService.js
 * Convierte PDFs / DOCX / XLSX a Markdown vía CLI de MarkItDown (Python),
 * luego extrae campos estructurados de convocatoria con IA vía llmProveedor
 * (soloServidor: pool Gemini del servidor bajo el tope diario del sistema).
 */

import { generarConIA } from './llmProveedor.js';
import { convertBufferToMarkdown } from '../utils/fileConverters.js';

// Extensiones soportadas por MarkItDown
const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|md)(\?[^"'\s]*)?$/i;

export function isPdfOrDoc(url) {
  try { return DOC_EXT_RE.test(new URL(url).pathname); }
  catch { return DOC_EXT_RE.test(url); }
}

/**
 * Descarga una URL de documento y la convierte a Markdown.
 * @param {string} url
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<string>} Markdown resultante
 */
export async function convertUrlToMarkdown(url, timeoutMs = 30_000) {
  const ext = (new URL(url).pathname.match(/\.([a-z]{2,5})(\?|$)/i)?.[1] ?? 'pdf').toLowerCase();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'User-Agent': 'RadarFondos/1.0 PDF-Reader',
      'Accept': 'application/pdf,application/octet-stream,*/*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  return convertBufferToMarkdown(buffer, ext, timeoutMs);
}

// convertBufferToMarkdown se movió a utils/fileConverters.js (2026-09-28):
// es conversión sin IA que usa también el Formulador (EntradaIAService,
// anexos.routes.js) — no debe depender de este archivo del Radar.

// ── Gemini extractor ─────────────────────────────────────────────────────────

const EXTRACT_PROMPT = (md) =>
  `Eres un asistente que extrae información estructurada de convocatorias de financiamiento.
Analiza este documento y responde SOLO con JSON válido (sin markdown fences):
{
  "titulo": "título oficial de la convocatoria (máx 255 chars)",
  "descripcion": "objeto o descripción breve (máx 500 chars)",
  "fecha_limite": "YYYY/MM/DD si se menciona, o cadena vacía",
  "monto_max": número (en la moneda indicada) o 0,
  "moneda": "USD|COP|EUR|GBP o cadena vacía"
}

Documento:
${md.slice(0, 8000)}`;

/**
 * Extrae campos estructurados de Markdown de una convocatoria usando Gemini.
 * Devuelve null si no hay Gemini disponible o si el Markdown es muy corto.
 * @param {string} markdown
 * @returns {Promise<{titulo,descripcion,fecha_limite,monto_max,moneda}|null>}
 */
// 2026-09-28 (directiva "Contención y sincronización de núcleo"): pasa por
// llmProveedor.generarConIA({ soloServidor: true }) — solo pool Gemini del
// servidor, tope DURO diario de tokens del sistema (iaTopeSistema.js) y FinOps
// bajo 'sistema-radar-batch'/'markitdown-extract' (lo registra llmProveedor).
// maxTokens 2048: gemini-3.6-flash razona y esos tokens cuentan contra el
// límite. Un JSON cortado se descarta (permitirTruncado false), sin campos
// inventados. Mismo contrato: NUNCA lanza, retorna null ante cualquier fallo
// (tope, cuota, red, salida inválida) — EntityScraper lo llama en background.
export async function extractConvocatoriaFields(markdown) {
  if (!markdown || markdown.length < 80) return null;

  try {
    const r = await generarConIA({
      userId: 'sistema-radar-batch', agente: 'markitdown-extract', soloServidor: true, maxTokens: 2048,
      messages: [{ role: 'user', content: EXTRACT_PROMPT(markdown) }],
      validar: (texto) => {
        const match = texto.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Respuesta sin JSON');
        const parsed = JSON.parse(match[0]);
        return {
          titulo:       String(parsed.titulo       ?? '').slice(0, 255),
          descripcion:  String(parsed.descripcion  ?? '').slice(0, 500),
          fecha_limite: String(parsed.fecha_limite ?? '').slice(0, 20),
          monto_max:    Number(parsed.monto_max    ?? 0) || 0,
          moneda:       String(parsed.moneda       ?? '').slice(0, 10),
        };
      },
    });
    return r.valor;
  } catch {
    return null;
  }
}
