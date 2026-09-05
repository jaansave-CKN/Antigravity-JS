// =============================================================================
// M1 PIPELINE — Tavily Search + Claude Tool Use | Antigravity OS v9.0
// Claude orquesta búsquedas en tiempo real via Tavily como herramienta nativa.
// Cache dual: Upstash Redis (primario) + Map en memoria (fallback).
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import express   from 'express';
import { cacheKey, cacheGet, cacheSet, clearMemCache, cacheInfo } from '../../shared/infrastructure/cache.js';
import { initSSE, acquireQuery, releaseQuery, checkQuota } from '../../shared/infrastructure/session-manager.js';
import { trackGeneration } from '../../shared/infrastructure/LangfuseMonitoring.js';
import ExtraerDatos from '../../../skills/seguridad/Skill_Protocolo_Fuente_Unica.cjs';

// Mismo criterio que server.js: modelo inyectado por env var, no hardcodeado —
// ver PRIMARY_AI_MODEL en .env.
const CLAUDE_MODEL = process.env.PRIMARY_AI_MODEL || 'claude-sonnet-4-6';

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no configurada.');
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

// =============================================================================
// TOOL DEFINITION — Tavily Search (formato nativo Anthropic)
// =============================================================================
const TAVILY_TOOL = {
  name: 'tavily_search',
  description:
    'Busca información actualizada en tiempo real sobre convocatorias, fondos de inversión pública, ' +
    'programas de financiación y oportunidades del SGR, DNP, MinTIC, INVIAS, Minciencias, MinVivienda, ' +
    'MADR, cooperación internacional (BID, Banco Mundial, USAID, UE) y OxI en Colombia. ' +
    'Usa esta herramienta para encontrar información vigente (2024-2026) con URLs y fechas reales.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type:        'string',
        description: 'Query de búsqueda específico (en español, términos técnicos colombianos)',
      },
      max_results: {
        type:        'integer',
        description: 'Número de resultados web a recuperar (1-8). Default: 5.',
      },
    },
    required: ['query'],
  },
};

// =============================================================================
// TAVILY REST CALL — sin dependencias npm
// =============================================================================
async function tavilySearch(query, maxResults = 5) {
  if (!process.env.TAVILY_API_KEY) throw new Error('TAVILY_API_KEY no configurada en .env');

  const res = await fetch('https://api.tavily.com/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(10_000),
    body: JSON.stringify({
      api_key:         process.env.TAVILY_API_KEY,
      query,
      max_results:     Math.min(Math.max(maxResults, 1), 8),
      include_answer:  true,
      search_depth:    'advanced',
      include_domains: [
        'sgr.gov.co','dnp.gov.co','minciencias.gov.co','mintic.gov.co',
        'invias.gov.co','minvivienda.gov.co','minagricultura.gov.co',
        'cancilleria.gov.co','sni.gov.co','secop.gov.co','gov.co',
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// Ejecuta los bloques tool_use que Claude solicita
async function executeToolCalls(toolUseBlocks) {
  return Promise.all(
    toolUseBlocks.map(async (block) => {
      if (block.type !== 'tool_use') return null;
      try {
        const data = await tavilySearch(block.input.query, block.input.max_results ?? 5);
        console.log(`[M1] Tavily OK → "${block.input.query}" (${data.results?.length ?? 0} resultados)`);

        // Protocolo Fuente Única — extrae presupuesto/fecha-cierre/link/entidad con
        // cita textual obligatoria sobre el contenido crudo de Tavily, antes de que
        // Claude lo sintetice. Anti-alucinación: nunca infiere, marca "Dato Pendiente".
        const resultsConCitas = (data.results || []).map(r => ({
          ...r,
          extraccion_verificada: ExtraerDatos.extraerDatosCompletos({
            texto: `${r.title || ''} ${r.content || ''}`,
            fuente: r.url,
          }),
        }));
        const dataConCitas = { ...data, results: resultsConCitas };

        return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(dataConCitas) };
      } catch (err) {
        console.warn(`[M1] Tavily falló → "${block.input.query}":`, err.message);
        return { type: 'tool_result', tool_use_id: block.id, content: `{"error":"${err.message}"}`, is_error: true };
      }
    })
  );
}

// =============================================================================
// SYSTEM PROMPT — M1 Agent
// =============================================================================
const SYSTEM_RADAR =
  'Eres el Agente de Inteligencia M1 del sistema Radar Formulador 360 en Antigravity OS. ' +
  'Tu misión es identificar convocatorias y fondos vigentes de inversión pública en Colombia. ' +
  'PROCESO OBLIGATORIO: Siempre usa tavily_search al menos UNA VEZ con términos específicos antes de responder. ' +
  'Puedes hacer hasta 3 búsquedas para obtener datos completos y actualizados. ' +
  'FORMATO DE RESPUESTA: ÚNICAMENTE JSON válido. Sin markdown. Sin texto adicional. ' +
  'Estructura exacta: { "oportunidades": [ { ' +
  '"titulo": string, "entidad": string, "monto": string, "sector": string, ' +
  '"cobertura": string, "fechaCierre": string, "requisitos": string, ' +
  '"normativa": string, "url": string, ' +
  '"viabilidadMGA": "Alta"|"Media"|"Baja", "prioridad": number (0-100), "alertas": string ' +
  '} ] }. ' +
  'Entre 5 y 10 oportunidades reales. Todos los campos obligatorios. "Por confirmar" si no hay dato.';

// =============================================================================
// CLAUDE AGENTIC LOOP — Tool Use con hasta 3 iteraciones de búsqueda
// =============================================================================
async function runClaudeWithTavily(query, filters = {}, userId) {
  const client  = getClient();
  const traceId = crypto.randomUUID(); // agrupa las hasta-3 generations del loop bajo un mismo trace en Langfuse

  const userContent =
    `Busca convocatorias y fondos VIGENTES en Colombia para el proyecto: "${query}". ` +
    (filters.sector   ? `Sector requerido: ${filters.sector}. `   : '') +
    (filters.cobertura ? `Cobertura geográfica: ${filters.cobertura}. ` : '') +
    'Usa tavily_search para obtener URLs y datos reales actualizados.';

  const messages = [{ role: 'user', content: userContent }];
  let response;
  let iterations = 0;

  do {
    const t0 = Date.now();
    response = await client.messages.create({
      model:      CLAUDE_MODEL,
      max_tokens: 4096,
      system:     SYSTEM_RADAR,
      tools:      [TAVILY_TOOL],
      messages,
    });
    trackGeneration({
      traceId, name: 'm1-pipeline-search', userId, model: CLAUDE_MODEL,
      input: messages, output: response.content, usage: response.usage,
      latencyMs: Date.now() - t0, metadata: { iteration: iterations, stopReason: response.stop_reason },
    });

    if (response.stop_reason !== 'tool_use') break;

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults   = (await executeToolCalls(toolUseBlocks)).filter(Boolean);

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user',      content: toolResults });
    iterations++;

  } while (iterations < 3);

  const textBlock = response?.content?.find(b => b.type === 'text');
  console.log(`[M1] Tavily loop completado | iteraciones: ${iterations}`);
  return textBlock?.text ?? '{"oportunidades":[]}';
}

// =============================================================================
// FILTERS
// =============================================================================
function safeParseJSON(raw) {
  try {
    return JSON.parse(
      raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    );
  } catch { return { oportunidades: [] }; }
}

function applyFilters(opportunities, filters) {
  let rows = Array.isArray(opportunities) ? [...opportunities] : [];
  if (filters.cobertura && filters.cobertura !== 'all') {
    const geo = filters.cobertura.toLowerCase();
    rows = rows.filter(op =>
      (op.cobertura || '').toLowerCase().includes(geo) ||
      (op.cobertura || '').toLowerCase().includes('nacional')
    );
  }
  if (filters.sector && filters.sector !== 'all') {
    const sec = filters.sector.toLowerCase();
    rows = rows.filter(op =>
      (op.sector || '').toLowerCase().includes(sec) ||
      (op.sector || '').toLowerCase().includes('multisectorial')
    );
  }
  return rows;
}

// =============================================================================
// PIPELINE PRINCIPAL — con cache dual 24h
// =============================================================================
export async function runM1Pipeline({ query, filters = {}, bypassCache = false, userId }) {
  if (!query?.trim()) throw new Error('Se requiere query string.');

  // Cache key normalizada (trim+lowercase) para que "Vivienda rural" y "vivienda rural "
  // compartan el mismo hit en vez de pagar dos pipelines por la misma búsqueda semántica.
  const key = cacheKey({ query: query.trim().toLowerCase(), filters });

  if (!bypassCache) {
    const cached = await cacheGet(key);
    if (cached) {
      console.log('[M1] Cache HIT →', query);
      return { ...cached, fromCache: true };
    }
  }

  const startMs = Date.now();
  console.log(`[M1] MISS — Iniciando Tavily+Claude | "${query}"`);

  const raw      = await runClaudeWithTavily(query, filters, userId);
  const parsed   = safeParseJSON(raw);
  const all      = parsed.oportunidades || [];
  const filtered = applyFilters(all, filters);

  console.log(`[M1] ✅ ${all.length} total | ${filtered.length} filtradas | ${Date.now() - startMs}ms`);

  const result = {
    query, filters,
    total:         filtered.length,
    rawTotal:      all.length,
    oportunidades: filtered,
    meta: {
      engine:     'Claude + Tavily Search API',
      model:      CLAUDE_MODEL,
      durationMs: Date.now() - startMs,
      cacheKey:   key,
    },
    fromCache: false,
  };

  await cacheSet(key, result);
  return result;
}

// =============================================================================
// EXPRESS ROUTER — /api/radar
// =============================================================================
const router = express.Router();

// Status
router.get('/status', (_req, res) => {
  const claudeReady = !!process.env.ANTHROPIC_API_KEY;
  const tavilyReady = !!process.env.TAVILY_API_KEY;
  res.json({
    pipeline:    'M1 — Tavily + Claude Tool Use v9.0',
    status:      claudeReady && tavilyReady ? 'online' : 'degradado',
    engine:      'Claude + Tavily Search API',
    model:       CLAUDE_MODEL,
    claudeReady,
    tavilyReady,
    cache:       cacheInfo(),
  });
});

// Búsqueda estándar (REST, con cache)
router.post('/search', async (req, res) => {
  try {
    const { query, filters, bypassCache } = req.body;
    if (!query) return res.status(400).json({ error: 'Campo "query" requerido.' });
    const quota = await checkQuota(req.user?.uid ?? 'anonymous');
    if (!quota.allowed) return res.status(429).json({ error: 'Cuota diaria de búsquedas agotada.', resetAt: quota.resetAt });
    const result = await runM1Pipeline({ query, filters: filters || {}, bypassCache, userId: req.user?.uid });
    res.json(result);
  } catch (err) {
    console.error('[M1 Router /search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Búsqueda con Streaming SSE — envía deltas a medida que Claude procesa
router.post('/stream', async (req, res) => {
  const sse = initSSE(res);
  const { query, filters = {} } = req.body;

  if (!query) return sse.error('Campo "query" requerido.');

  const uid     = req.user?.uid ?? 'anonymous';
  const queryId = `${uid}:${query}`;

  const quota = await checkQuota(uid);
  if (!quota.allowed) return sse.error('Cuota diaria de búsquedas agotada.');

  if (!acquireQuery(uid, queryId)) {
    return sse.error('Ya tienes una consulta en curso con ese mismo query.');
  }

  try {
    // Verificar cache primero
    const key    = cacheKey({ query, filters });
    const cached = await cacheGet(key);
    if (cached) {
      sse.send({ event: 'cache_hit', data: cached });
      return sse.done();
    }

    const client = getClient();
    const userContent =
      `Busca convocatorias vigentes en Colombia: "${query}". ` +
      (filters.sector ? `Sector: ${filters.sector}. ` : '') +
      'Usa tavily_search con al menos 2 búsquedas específicas.';

    sse.send({ event: 'start', message: 'Iniciando búsqueda Tavily + Claude...' });

    const messages = [{ role: 'user', content: userContent }];
    let iterations = 0;

    // Agentic loop con streaming en el paso final
    while (iterations < 3) {
      const t0 = Date.now();
      const response = await client.messages.create({
        model: CLAUDE_MODEL, max_tokens: 4096,
        system: SYSTEM_RADAR, tools: [TAVILY_TOOL], messages,
      });
      trackGeneration({
        traceId: queryId, name: 'm1-pipeline-stream', userId: uid, model: CLAUDE_MODEL,
        input: messages, output: response.content, usage: response.usage,
        latencyMs: Date.now() - t0, metadata: { iteration: iterations, stopReason: response.stop_reason },
      });

      if (response.stop_reason !== 'tool_use') {
        // Claude terminó — hacer streaming del texto final
        const finalText = response.content.find(b => b.type === 'text')?.text ?? '';

        // Emular streaming por fragmentos (dividir en chunks de ~80 chars)
        const CHUNK = 80;
        for (let i = 0; i < finalText.length; i += CHUNK) {
          sse.send({ event: 'delta', text: finalText.slice(i, i + CHUNK) });
        }
        break;
      }

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      sse.send({ event: 'tool_call', queries: toolUseBlocks.map(b => b.input?.query) });

      const toolResults = (await executeToolCalls(toolUseBlocks)).filter(Boolean);
      sse.send({ event: 'search_done', count: toolResults.length });

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user',      content: toolResults });
      iterations++;
    }

    sse.send({ event: 'done' });
    sse.done();

  } catch (err) {
    console.error('[M1 /stream]', err.message);
    sse.error(err.message);
  } finally {
    releaseQuery(uid, queryId);
  }
});

// Invalidar caché — solo admin (hallazgo PROTOCOLO TITÁN 2026-08-12, Capa 2:
// cualquier usuario autenticado podía vaciar el caché compartido de TODOS los
// usuarios repetidamente, amplificando el costo real de Claude+Tavily).
router.delete('/cache', (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Requiere rol admin.' });
  }
  const cleared = clearMemCache();
  res.json({ cleared, message: `${cleared} entradas eliminadas. Redis expira por TTL (24h).` });
});

export { router as m1Router };
