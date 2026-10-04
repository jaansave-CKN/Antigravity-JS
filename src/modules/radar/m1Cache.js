// =============================================================================
// M1 CACHE CONTRACT — clave, resultado y política de caché únicas para
// /api/radar/search, /api/radar/stream y el Radar Cron (server.js).
//
// Hallazgo 2 de docs/RADFOR360_RELACION_AGENTES_SKILLS_2026-09-28.pdf:
// /search normalizaba la clave (trim+lowercase) y /stream usaba la query cruda
// y nunca escribía en caché — la misma búsqueda pagaba Claude+Tavily dos veces
// y el streaming jamás reutilizaba nada. Este módulo es la única fuente de la
// clave y de la forma del resultado: ningún endpoint arma la suya.
//
// Sin dependencias de red ni de SDK: solo cacheKey() de cache.js.
// =============================================================================

import { cacheKey } from '../../shared/infrastructure/cache.js';

// Versión del formato de clave. Subirla invalida de forma limpia las entradas
// viejas (expiran solas por TTL de 24 h) sin tocar Redis a mano.
export const M1_CACHE_VERSION = 2;

// Filtros que realmente cambian el resultado (applyFilters). Cualquier otra
// propiedad enviada por el cliente se descarta de la clave: evita que un
// atacante infle la caché en memoria con claves únicas por request.
const FILTROS_CON_EFECTO = ['cobertura', 'sector'];

// NFKC + trim + espacios colapsados + minúsculas: "Vivienda  rural", " vivienda
// rural" y la variante con acento compuesto (NFD) caen en la misma clave.
export function normalizarTexto(valor) {
  return String(valor ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const normalizarQuery = normalizarTexto;

// '' y 'all' significan "sin filtro" en applyFilters → se omiten de la clave
// para que {sector:'all'}, {sector:''} y {} compartan resultado. Claves en
// orden fijo: JSON.stringify depende del orden de inserción.
export function normalizarFiltros(filters) {
  const fuente = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
  const salida = {};
  for (const campo of FILTROS_CON_EFECTO) {
    const valor = normalizarTexto(fuente[campo]);
    if (valor && valor !== 'all') salida[campo] = valor;
  }
  return salida;
}

export function m1CacheKey(query, filters) {
  return cacheKey({ v: M1_CACHE_VERSION, query: normalizarQuery(query), filters: normalizarFiltros(filters) });
}

// El modelo a veces envuelve el JSON en ```json … ```; cualquier otra cosa no
// parseable es un resultado vacío (nunca una excepción hacia el endpoint).
export function safeParseJSON(raw) {
  try {
    return JSON.parse(
      String(raw ?? '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    );
  } catch {
    return { oportunidades: [] };
  }
}

export function applyFilters(opportunities, filters) {
  const f = normalizarFiltros(filters);
  let rows = Array.isArray(opportunities) ? [...opportunities] : [];
  if (f.cobertura) {
    rows = rows.filter(op => {
      const cob = normalizarTexto(op?.cobertura);
      return cob.includes(f.cobertura) || cob.includes('nacional');
    });
  }
  if (f.sector) {
    rows = rows.filter(op => {
      const sec = normalizarTexto(op?.sector);
      return sec.includes(f.sector) || sec.includes('multisectorial');
    });
  }
  return rows;
}

// Forma única del resultado M1 — la misma que devuelve /search, la que guarda
// la caché y la que /stream emite en su evento "result" o "cache_hit".
export function construirResultado({ query, filters, raw, model, startMs, key }) {
  const parsed = safeParseJSON(raw);
  const all = Array.isArray(parsed?.oportunidades) ? parsed.oportunidades : [];
  const filtered = applyFilters(all, filters);
  return {
    query,
    filters: filters || {},
    total: filtered.length,
    rawTotal: all.length,
    oportunidades: filtered,
    meta: {
      engine: 'Claude + Tavily Search API',
      model,
      durationMs: Date.now() - startMs,
      cacheKey: key,
    },
    fromCache: false,
  };
}

// Solo se cachea un resultado con al menos una oportunidad real del modelo.
// Un parse fallido (rawTotal 0) se cacheaba 24 h y envenenaba la búsqueda para
// TODOS los usuarios hasta el vencimiento — un fallo transitorio no debe
// convertirse en un resultado "válido" compartido.
export function esCacheable(resultado) {
  return Boolean(resultado && Number.isInteger(resultado.rawTotal) && resultado.rawTotal > 0);
}
