import { captureError } from '../lib/sentry';

// Tipo canónico usado en toda la aplicación (PestañaRadar, mapeo, estado)
export interface GeminiResult {
  titulo: string;
  descripcion_corta: string;
  fuente: string;
  enlace_oficial: string;
  estado?: string;
}

// Alias de compatibilidad — apunta al mismo tipo
export type LightweightResult = GeminiResult;

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Caché semántico — evita relanzar búsquedas idénticas en las últimas 12h ───
// Latencia y costo cero para repeticiones (Map en memoria, vive con la pestaña).
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const searchCache = new Map<string, { timestamp: number; data: GeminiResult[] }>();

function getCached(key: string): GeminiResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: GeminiResult[]): void {
  searchCache.set(key, { timestamp: Date.now(), data });
}

// ── Exponential Backoff — reintentos automáticos ante 429/503 (2s, 4s, 8s) ───
const BACKOFF_DELAYS_MS = [2000, 4000, 8000];

async function withExponentialBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status = e?.message?.match(/^\[(\d+)\]/)?.[1];
      const isRetryable = status === '429' || status === '503';
      if (!isRetryable || attempt === BACKOFF_DELAYS_MS.length) throw e;
      await delay(BACKOFF_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

// Sanitización Extrema con Regex — elimina markdown y extrae el array JSON
function sanitizeJSON(rawText: string): string {
  const stripped = rawText
    .replace(/```(?:json|JSON)?\s*/g, '')
    .replace(/```/g, '')
    .replace(/`/g, '')
    .trim();

  const first = stripped.indexOf('[');
  const last = stripped.lastIndexOf(']');
  if (first === -1 || last === -1 || last < first) {
    return '[]';
  }
  return stripped.substring(first, last + 1);
}

async function callGeminiREST(apiKey: string, model: string, prompt: string): Promise<string> {
  const CRITICAL_RULE =
    'REGLA CRÍTICA: TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN ARRAY JSON VÁLIDO. ' +
    'NO INCLUYAS TEXTO CONVERSACIONAL, NO USES FORMATO MARKDOWN, NO USES TILDES INVERSAS. ' +
    'COMIENZA DIRECTAMENTE CON [ Y TERMINA CON ]. ' +
    'SI INCUMPLES ESTO, EL SISTEMA COLAPSARÁ.';

  const fullPrompt = `${prompt}\n\n${CRITICAL_RULE}`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: fullPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = (await res.text()).substring(0, 200);
    throw new Error(`[${res.status}] ${err}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function barridoMasivoLigero(sector: string, total: number = 50): Promise<GeminiResult[]> {
  const cacheKey = `${sector.toLowerCase().trim()}:${total}`;
  const cached = getCached(cacheKey);
  if (cached) {
    console.log(`[geminiScanner] Caché semántico HIT (${cacheKey}) — latencia/costo cero`);
    return cached;
  }

  const creds = JSON.parse(localStorage.getItem('rf360_credentials_v1') || '{}');
  const apiKey = (creds.googleGeminiToken || '').replace(/^Bearer\s+/i, '').trim();
  if (!apiKey) throw new Error('API Key de Gemini no disponible.');

  const batchSize = 10;
  const batches = Math.ceil(total / batchSize);
  const results: GeminiResult[] = [];

  for (let i = 0; i < batches; i++) {
    const prompt = `Busca ${batchSize} convocatorias de financiamiento actuales para Colombia en el sector "${sector}". Devuelve un array JSON donde cada elemento tenga exactamente estos campos: titulo, descripcion_corta, fuente, enlace_oficial, estado (uno de: "Abierta", "Próxima", "Cerrada").`;

    let raw = '';
    for (const modelo of MODELS) {
      try {
        raw = await withExponentialBackoff(() => callGeminiREST(apiKey, modelo, prompt));
        break;
      } catch (e: any) {
        if (e.message?.includes('429')) continue;
        throw e;
      }
    }

    // Try-Catch Silencioso — la UI nunca se rompe por un error de sintaxis de la IA
    try {
      const sanitized = sanitizeJSON(raw);
      const parsed = JSON.parse(sanitized) as GeminiResult[];
      if (Array.isArray(parsed)) results.push(...parsed);
    } catch (e) {
      console.warn('Error de parseo. Crudo recibido:', raw);
      captureError(e, { stage: 'parseo-respuesta-gemini', sector, raw: raw.slice(0, 500) });
    }

    await delay(2000);
  }

  if (results.length > 0) setCached(cacheKey, results);
  return results;
}
