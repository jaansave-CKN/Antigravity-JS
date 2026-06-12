/**
 * radarCache.js — Caché táctico en memoria (TTL 15 min)
 *
 * ÁMBITO: EXCLUSIVAMENTE GET /api/convocatorias (Bloque A — Radar)
 *
 * PROHIBIDO en:
 *   · Cualquier endpoint del Bloque B (Formulador, M3–M12)
 *   · Endpoints con escritura (POST/PUT/DELETE)
 *   · Endpoints de autenticación o suscripciones
 *
 * ESTRATEGIA:
 *   · Clave = hash de la URL completa + query params (varía por filtros)
 *   · TTL   = 900 000 ms (15 minutos)
 *   · Cache-Control header para clientes HTTP
 *   · Invalidación automática por TTL (sin stale-while-revalidate intencional)
 *   · No se cachea si la respuesta tiene error (success: false)
 *
 * Sin dependencias externas (implementación nativa ESM con Map + WeakRef cleanup).
 */

const CACHE_TTL_MS  = 900_000;   // 15 minutos
const MAX_ENTRIES   = 500;       // límite de seguridad anti-OOM

// Estructura: Map<key, { data, timestamp, size }>
const cache = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildKey(req) {
  const url = req.originalUrl || req.url;
  return `radar:${url}`;
}

function isExpired(entry) {
  return Date.now() - entry.timestamp >= CACHE_TTL_MS;
}

function evictExpired() {
  for (const [key, entry] of cache) {
    if (isExpired(entry)) cache.delete(key);
  }
}

function evictOldest() {
  const sorted = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  const toDelete = sorted.slice(0, Math.ceil(MAX_ENTRIES * 0.2));
  for (const [key] of toDelete) cache.delete(key);
}

// ── Middleware principal ──────────────────────────────────────────────────────

export function radarCacheMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();

  const key    = buildKey(req);
  const cached = cache.get(key);

  // Bypass si el cliente pide datos frescos
  const clientCC = req.headers['cache-control'] || '';
  const bypassCache = clientCC.includes('no-cache') || clientCC.includes('no-store');

  // HIT: entrada válida en caché
  if (!bypassCache && cached && !isExpired(cached)) {
    res.setHeader('X-Cache',         'HIT');
    res.setHeader('X-Cache-Age',     String(Math.round((Date.now() - cached.timestamp) / 1000)));
    res.setHeader('Cache-Control',   `public, max-age=${Math.round((CACHE_TTL_MS - (Date.now() - cached.timestamp)) / 1000)}`);
    return res.json(cached.data);
  }

  // MISS: interceptar res.json() para almacenar respuesta
  const originalJson = res.json.bind(res);

  res.json = function (data) {
    // Solo cachear respuestas exitosas con al menos 1 resultado
    const hasData = Array.isArray(data?.data) ? data.data.length > 0 : data?.data != null;
    if (data && data.success !== false && hasData) {
      if (cache.size >= MAX_ENTRIES) {
        evictExpired();
        if (cache.size >= MAX_ENTRIES) evictOldest();
      }

      cache.set(key, { data, timestamp: Date.now() });

      res.setHeader('X-Cache',       'MISS');
      res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_MS / 1000}`);
    }

    return originalJson(data);
  };

  next();
}

// ── Invalidación manual ───────────────────────────────────────────────────────
// Llamar cuando se insertan/actualizan convocatorias para refrescar el caché.

export function invalidateRadarCache() {
  let deleted = 0;
  for (const key of cache.keys()) {
    if (key.startsWith('radar:')) {
      cache.delete(key);
      deleted++;
    }
  }
  console.log(`[radarCache] Caché invalidado: ${deleted} entradas eliminadas.`);
}

// ── Estadísticas ─────────────────────────────────────────────────────────────

export function getCacheStats() {
  let valid = 0, expired = 0;
  for (const entry of cache.values()) {
    isExpired(entry) ? expired++ : valid++;
  }
  return {
    total: cache.size,
    valid,
    expired,
    ttl_seconds: CACHE_TTL_MS / 1000,
    max_entries: MAX_ENTRIES,
  };
}
