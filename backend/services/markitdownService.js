/**
 * markitdownService.js
 * Convierte PDFs / DOCX / XLSX a Markdown vía CLI de MarkItDown (Python),
 * luego extrae campos estructurados de convocatoria con Gemini.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

const execFileAsync = promisify(execFile);

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
  const tmpFile = join(tmpdir(), `radar_mid_${crypto.randomUUID()}.${ext}`);

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'RadarFondos/1.0 PDF-Reader',
        'Accept': 'application/pdf,application/octet-stream,*/*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(tmpFile, buffer);

    const { stdout } = await execFileAsync('python', ['-m', 'markitdown', tmpFile], {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024, // 5 MB
    });

    return stdout.trim();
  } finally {
    unlink(tmpFile).catch(() => {});
  }
}

/**
 * Convierte un archivo ya en memoria (buffer subido por el usuario, ej.
 * multer memoryStorage) a Markdown — mismo motor que convertUrlToMarkdown,
 * sin el paso de descarga. Usado por anexos.routes.js para extraer texto de
 * PDFs/DOCX/XLSX subidos y alimentar el embedding semántico (ver
 * embeddingsService.js) — se reusa este servicio en vez de instalar un
 * segundo motor de extracción de texto.
 * @param {Buffer} buffer
 * @param {string} ext — extensión sin punto (pdf, docx, xlsx, ...)
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<string>} Markdown resultante
 */
export async function convertBufferToMarkdown(buffer, ext, timeoutMs = 30_000) {
  const tmpFile = join(tmpdir(), `radar_mid_${crypto.randomUUID()}.${ext}`);
  try {
    await writeFile(tmpFile, buffer);
    const { stdout } = await execFileAsync('python', ['-m', 'markitdown', tmpFile], {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout.trim();
  } finally {
    unlink(tmpFile).catch(() => {});
  }
}

// ── Gemini extractor ─────────────────────────────────────────────────────────

let _genAI = null;
function getGenAI() {
  if (_genAI) return _genAI;
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY_FALLBACK || process.env.GEMINI_API_KEY;
  if (!key) return null;
  _genAI = new GoogleGenerativeAI(key);
  return _genAI;
}

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
export async function extractConvocatoriaFields(markdown) {
  if (!markdown || markdown.length < 80) return null;
  const genAI = getGenAI();
  if (!genAI) return null;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
    const result = await model.generateContent(EXTRACT_PROMPT(markdown));
    const text = result.response.text().trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      titulo:       String(parsed.titulo       ?? '').slice(0, 255),
      descripcion:  String(parsed.descripcion  ?? '').slice(0, 500),
      fecha_limite: String(parsed.fecha_limite ?? '').slice(0, 20),
      monto_max:    Number(parsed.monto_max    ?? 0) || 0,
      moneda:       String(parsed.moneda       ?? '').slice(0, 10),
    };
  } catch {
    return null;
  }
}
