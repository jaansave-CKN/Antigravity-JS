import type { Part } from '@google/generative-ai';

export type SupportedFileType = 'pdf' | 'xlsx' | 'csv' | 'jpg' | 'png' | 'docx';

const PROJECT_SCOPE = 'Proy_03_RadarFondos';
const PROJECT_ID = 'PROY_03_RADARFONDOS';
const PROJECT_SCOPE_VALIDATION = true;

export { PROJECT_SCOPE, PROJECT_ID };

function validateProjectScope(filePath: string): boolean {
  if (!PROJECT_SCOPE_VALIDATION) return true;
  if (!filePath.includes(PROJECT_SCOPE)) {
    console.error(`[FileReader] SECURITY: File path "${filePath}" rejected - does not contain "${PROJECT_SCOPE}" scope`);
    return false;
  }
  return true;
}

function getProjectScope(): string {
  return PROJECT_SCOPE;
}

function getProjectId(): string {
  return PROJECT_ID;
}

export interface FileProcessResult {
  success: boolean;
  data?: unknown;
  error?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

export interface MultimodalContent {
  type: 'text' | 'image' | 'spreadsheet';
  data: string | unknown[];
  mimeType: string;
  label?: string;
}

const ALLOWED_EXTENSIONS: Record<SupportedFileType, string[]> = {
  pdf: ['application/pdf'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
  csv: ['text/csv', 'application/csv'],
  jpg: ['image/jpeg'],
  png: ['image/png'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getFileExtension(fileName: string): SupportedFileType | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (!ext) return null;
  
  const typeMap: Record<string, SupportedFileType> = {
    pdf: 'pdf',
    xlsx: 'xlsx',
    xls: 'xlsx',
    csv: 'csv',
    jpg: 'jpg',
    jpeg: 'jpg',
    png: 'png',
    docx: 'docx',
  };
  
  return typeMap[ext] || null;
}

function validateFile(file: File, sourcePath?: string): { valid: boolean; error?: string } {
  if (sourcePath && !validateProjectScope(sourcePath)) {
    return { valid: false, error: `Archivo fuera del scope del proyecto (${PROJECT_SCOPE})` };
  }

  const ext = getFileExtension(file.name);
  
  if (!ext) {
    return { valid: false, error: `Extensión de archivo no permitida: ${file.name}` };
  }
  
  const allowedMimes = ALLOWED_EXTENSIONS[ext];
  if (!allowedMimes.includes(file.type) && file.type !== '') {
    return { valid: false, error: `Tipo MIME no permitido: ${file.type}` };
  }
  
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `Archivo demasiado grande: ${(file.size / 1024 / 1024).toFixed(2)}MB (max 10MB)` };
  }
  
  return { valid: true };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function parsePDF(buffer: ArrayBuffer): Promise<string> {
  const textLines: string[] = [];
  
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    
    const loadingTask = pdfjs.getDocument({ data: buffer });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => {
          if (typeof item === 'object' && item !== null && 'str' in item) {
            return (item as { str: string }).str;
          }
          return '';
        })
        .join(' ');
      textLines.push(pageText);
    }
    
    await loadingTask.destroy();
    
    return textLines.join('\n\n--- Página ---\n\n');
  } catch (error) {
    throw new Error(`Error al parsear PDF: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}

async function parseSpreadsheet(buffer: ArrayBuffer): Promise<unknown[]> {
  try {
    const XLSX = await import('xlsx').then(m => m.default);
    const workbook = XLSX.read(buffer, { type: 'array' });
    
    const sheets: Record<string, unknown[]> = {};
    
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      sheets[sheetName] = jsonData;
    });
    
    const firstSheet = workbook.SheetNames[0];
    return sheets[firstSheet] || [];
  } catch (error) {
    throw new Error(`Error al parsear hoja de cálculo: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}

async function parseCSV(buffer: ArrayBuffer): Promise<unknown[]> {
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(buffer);
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }
  
  return rows;
}

export async function processFile(file: File, sourcePath?: string): Promise<FileProcessResult> {
  if (sourcePath && !validateProjectScope(sourcePath)) {
    return { success: false, error: `Archivo fuera del scope del proyecto (${PROJECT_SCOPE})` };
  }

  const validation = validateFile(file, sourcePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const extension = getFileExtension(file.name);
  const buffer = await file.arrayBuffer();
  
  try {
    switch (extension) {
      case 'pdf': {
        const text = await parsePDF(buffer);
        return {
          success: true,
          data: text,
          mimeType: 'application/pdf',
          fileName: file.name,
          fileSize: file.size,
        };
      }
      
      case 'xlsx': {
        const jsonData = await parseSpreadsheet(buffer);
        return {
          success: true,
          data: jsonData,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          fileName: file.name,
          fileSize: file.size,
        };
      }
      
      case 'csv': {
        const jsonData = await parseCSV(buffer);
        return {
          success: true,
          data: jsonData,
          mimeType: 'text/csv',
          fileName: file.name,
          fileSize: file.size,
        };
      }
      
      case 'jpg':
      case 'png': {
        const base64 = arrayBufferToBase64(buffer);
        const mimeType = extension === 'jpg' ? 'image/jpeg' : 'image/png';
        return {
          success: true,
          data: base64,
          mimeType,
          fileName: file.name,
          fileSize: file.size,
        };
      }
      
      case 'docx': {
        return {
          success: false,
          error: 'DOCX no implementado aún. Convertir a PDF o usar texto.',
        };
      }
      
      default:
        return { success: false, error: 'Tipo de archivo no soportado' };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al procesar archivo',
    };
  }
}

export function prepareImageForGemini(base64Data: string, mimeType: string): Part {
  return {
    inlineData: {
      data: base64Data,
      mimeType,
    },
  };
}

export function prepareTextForGemini(text: string, label?: string): Part {
  return {
    text: label ? `${label}:\n${text}` : text,
  };
}

export function prepareSpreadsheetForGemini(data: unknown[]): Part {
  const formatted = JSON.stringify(data, null, 2);
  return {
    text: `Datos de hoja de cálculo (formato JSON):\n${formatted}`,
  };
}

export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 200);
}

export function createMultimodalPayload(
  files: FileProcessResult[],
  userPrompt: string,
  projectId = 'PROY_03_RADARFONDOS'
): { parts: Part[]; context: string; metadata: { projectId: string; timestamp: string } } {
  const parts: Part[] = [];
  const contextParts: string[] = [];
  
  files.forEach((file, index) => {
    if (!file.success || !file.data) return;
    
    const label = `Documento ${index + 1}: ${file.fileName} [${projectId}]`;
    
    if (file.mimeType?.startsWith('image/')) {
      parts.push(prepareImageForGemini(file.data as string, file.mimeType));
      contextParts.push(`[Imagen ${index + 1}: ${file.fileName}]`);
    } else if (file.mimeType?.includes('spreadsheet') || file.mimeType === 'text/csv') {
      parts.push(prepareSpreadsheetForGemini(file.data as unknown[]));
      contextParts.push(`[Hoja de cálculo ${index + 1}: ${file.fileName}]`);
    } else {
      parts.push(prepareTextForGemini(file.data as string, label));
      contextParts.push(`[Documento ${index + 1}: ${file.fileName}]`);
    }
  });
  
  parts.push({ text: `\n\n[PROJECT_SCOPE: ${projectId}]\n\nPregunta del usuario: ${userPrompt}` });
  
  return {
    parts,
    context: `Archivos adjuntos (${projectId}): ${contextParts.join(', ')}`,
    metadata: {
      projectId,
      timestamp: new Date().toISOString(),
    },
  };
}