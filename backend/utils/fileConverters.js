/**
 * fileConverters.js — conversión de archivos a Markdown vía CLI de
 * MarkItDown (Python). Utilidad NEUTRAL, sin IA: no pertenece ni al módulo
 * A (Radar) ni al B (Formulador), la usan ambos.
 *
 * Origen (2026-09-28): convertBufferToMarkdown vivía en
 * services/markitdownService.js (módulo A, Radar), y EntradaIAService.js
 * (módulo B, Formulador) la importaba desde ahí — un cruce directo B→A
 * (el Formulador dependía de un archivo del Radar). Se movió aquí sin
 * cambio de comportamiento. No era el único cruce: anexos.routes.js (B)
 * importa embeddingsService.js, que architect reclasificó como NEUTRAL
 * (dictamen 2026-09-28, Fase 4).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink } from 'fs/promises';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * Convierte un archivo ya en memoria (buffer subido por el usuario, ej.
 * multer memoryStorage, o descargado por el Radar) a Markdown. Usado por
 * anexos.routes.js para extraer texto de PDFs/DOCX/XLSX subidos y alimentar
 * el embedding semántico (ver embeddingsService.js), por EntradaIAService.js
 * y por markitdownService.convertUrlToMarkdown tras descargar la URL.
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
      maxBuffer: 5 * 1024 * 1024, // 5 MB
    });
    return stdout.trim();
  } finally {
    unlink(tmpFile).catch(() => {});
  }
}
