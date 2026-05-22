import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ScraperConfig {
  url: string;
  portal: string;
  selectors?: {
    list?: string;
    item?: string;
    title?: string;
    description?: string;
    deadline?: string;
    amount?: string;
    link?: string;
  };
  pagination?: {
    selector: string;
    maxPages: number;
  };
  maxRetries?: number;
  timeout?: number;
}

export interface ExtractedConvocatoria {
  titulo: string;
  descripcion: string;
  fuente: string;
  url: string;
  fechaLimite?: string;
  monto?: string;
  entidad?: string;
  sector?: string;
  pais?: string;
  fechaExtraccion: string;
  raw?: Record<string, unknown>;
}

export interface ScraperResult {
  success: boolean;
 data: ExtractedConvocatoria[];
  error?: string;
  portal: string;
  timestamp: string;
  retries: number;
}

const SKILL_PATH = 'C:\\Users\\Usuario\\.agents\\skills\\agent-browser';
const OUTPUT_DIR = join(process.cwd(), 'data', 'scraper-output');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function cleanText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\n\r\t]/g, ' ')
    .trim();
}

function parseAmount(text: string | undefined): { min: number; max: number; currency: string } | null {
  if (!text) return null;
  const usdMatch = text.match(/\$[\d,]+(\.\d{2})?/);
  const eurMatch = text.match(/€[\d,]+/);
  const copMatch = text.match(/\$[\d.]+\s*(COP|pesos)/i);

  let currency = 'USD';
  let amount = 0;

  if (copMatch) {
    currency = 'COP';
    amount = parseFloat(copMatch[0].replace(/[^\d.]/g, ''));
  } else if (eurMatch) {
    currency = 'EUR';
    amount = parseFloat(eurMatch[0].replace(/[€,\s]/g, ''));
  } else if (usdMatch) {
    amount = parseFloat(usdMatch[0].replace(/[$,]/g, ''));
  }

  return { min: amount, max: amount, currency };
}

function extractDate(text: string | undefined): string | null {
  if (!text) return null;
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
    /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        const date = new Date(match[0]);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

function sanitizeData(data: unknown): Record<string, unknown> {
  if (data === null || data === undefined) return {};
  if (typeof data === 'string') return { value: cleanText(data) };
  if (typeof data !== 'object') return { value: String(data) };

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value !== null && value !== undefined) {
      sanitized[key] = typeof value === 'string' ? cleanText(value) : value;
    }
  }
  return sanitized;
}

function parseToJSON(rawOutput: string): ExtractedConvocatoria[] {
  try {
    const data = JSON.parse(rawOutput);
    const items = Array.isArray(data) ? data : data.items || data.result || data.convocatorias || [];

    return items.map((item: Record<string, unknown>) => ({
      titulo: cleanText(item.title?.toString() || item.titulo?.toString() || item.nombre?.toString() || 'Sin título'),
      descripcion: cleanText(item.description?.toString() || item.descripcion?.toString() || item.resumen?.toString() || ''),
      fuente: item.fuente?.toString() || item.source?.toString() || 'Portal web',
      url: item.url?.toString() || item.link?.toString() || item.href?.toString() || '',
      fechaLimite: extractDate(item.deadline?.toString() || item.fecha_limite?.toString() || item.fecha?.toString()),
      monto: item.amount?.toString() || item.monto?.toString() || item.financing?.toString(),
      entidad: item.entidad?.toString() || item.organization?.toString() || item.donante?.toString(),
      sector: item.sector?.toString() || item.categoria?.toString() || item.area?.toString(),
      pais: item.pais?.toString() || item.country?.toString() || 'Colombia',
      fechaExtraccion: new Date().toISOString(),
      raw: sanitizeData(item),
    }));
  } catch {
    return [];
  }
}

async function executeSkillScript(config: ScraperConfig, outputFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = join(OUTPUT_DIR, `scrape-${Date.now()}.json`);
    writeFileSync(scriptPath, JSON.stringify(config, null, 2));

    const skillScript = join(SKILL_PATH, 'scripts', 'scrape.js');
    const useSkill = existsSync(skillScript)
      ? `node "${skillScript}" "${scriptPath}"`
      : `echo "Skill not found, using fallback"`;

    const fallbackCmd = useSkill.includes('Skill not found')
      ? `curl -s "${config.url}" 2>nul || echo "curl not available"`
      : useSkill;

    const child = spawn('cmd.exe', ['/c', fallbackCmd], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Timeout: Scraping exceeded configured limit'));
    }, config.timeout || 120000);

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      if (code === 0 || stdout) {
        writeFileSync(outputFile, stdout);
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Exit code: ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function scrapePortal(config: ScraperConfig): Promise<ScraperResult> {
  const maxRetries = config.maxRetries || 3;
  const portal = config.portal || 'unknown';
  const outputFile = join(OUTPUT_DIR, `${portal}-${Date.now()}.json`);

  let lastError: Error | null = null;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      console.log(`[Scraper] Attempt ${retries + 1}/${maxRetries} for ${config.url}`);

      const rawData = await executeSkillScript(config, outputFile);
      const extractedData = parseToJSON(rawData);

      if (extractedData.length === 0) {
        console.log('[Scraper] No data extracted, attempting fallback parsing');
        continue;
      }

      console.log(`[Scraper] Successfully extracted ${extractedData.length} items`);

      return {
        success: true,
        data: extractedData,
        portal,
        timestamp: new Date().toISOString(),
        retries,
      };
    } catch (error) {
      lastError = error as Error;
      retries++;
      console.error(`[Scraper] Error attempt ${retries}:`, lastError.message);

      if (retries < maxRetries) {
        const waitTime = Math.pow(2, retries) * 1000;
        console.log(`[Scraper] Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  return {
    success: false,
    data: [],
    error: lastError?.message || 'Max retries exceeded',
    portal,
    timestamp: new Date().toISOString(),
    retries,
  };
}

export async function scrapeAndSendToRadar(
  config: ScraperConfig,
  onData?: (data: ExtractedConvocatoria[]) => void
): Promise<ScraperResult> {
  const result = await scrapePortal(config);

  if (result.success && result.data.length > 0) {
    const outputPath = join(OUTPUT_DIR, `radar-${config.portal}-${Date.now()}.json`);
    writeFileSync(outputPath, JSON.stringify(result.data, null, 2));
    console.log(`[Scraper] Data saved to: ${outputPath}`);

    if (onData) {
      onData(result.data);
    }
  }

  return result;
}

export function getScraperOutput(): string[] {
  try {
    const { readdirSync } = require('fs');
    const files = readdirSync(OUTPUT_DIR).filter((f: string) => f.endsWith('.json'));
    return files.map((f: string) => join(OUTPUT_DIR, f));
  } catch {
    return [];
  }
}

export default {
  scrapePortal,
  scrapeAndSendToRadar,
  getScraperOutput,
};