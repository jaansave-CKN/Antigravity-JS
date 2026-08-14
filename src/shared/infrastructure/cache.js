/**
 * Cache abstraction — 24h TTL
 * Primario: Upstash Redis REST API (sin dependencias, solo fetch)
 * Fallback:  Map en memoria si las env vars de Redis no están configuradas
 */
import crypto from 'crypto';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CACHE_TTL_SEC = 86_400; // 24 h
const FETCH_TIMEOUT_MS = 8_000;

// ── In-memory fallback ─────────────────────────────────────────────────────────
export const memCache = new Map();

function memGet(key) {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_SEC * 1000) { memCache.delete(key); return null; }
  return entry.data;
}
function memSet(key, data) {
  memCache.set(key, { data, ts: Date.now() });
}

// ── Upstash Redis REST helpers ────────────────────────────────────────────────
async function redisGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res    = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const { result } = await res.json();
    return result ? JSON.parse(result) : null;
  } catch (err) {
    console.warn('[Cache] Redis GET falló, usando memoria:', err.message);
    return null;
  }
}

async function redisSet(key, value, ttlSec = CACHE_TTL_SEC) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    // BUG REAL DE PRODUCCIÓN corregido 2026-08-13 (PROTOCOLO TITÁN, hallazgo
    // crítico #1): doble JSON.stringify() aquí vs. un solo JSON.parse() en
    // redisGet() — toda lectura devolvía el STRING serializado en vez del
    // objeto original. Rompía en silencio checkLoginBan/recordLoginFailure
    // (el ban de fuerza bruta de login nunca se aplicaba, confirmado con 6
    // intentos reales) y el caché de 24h de runM1Pipeline (cada consulta
    // repetida pagaba Claude+Tavily de nuevo en vez de servirse del caché).
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}?ex=${ttlSec}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(value),
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[Cache] Redis SET falló:', err.message);
  }
}

async function redisDel(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(key)}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[Cache] Redis DEL falló:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function cacheKey(data) {
  return `radar:${crypto.createHash('md5').update(JSON.stringify(data)).digest('hex')}`;
}

export async function cacheGet(key) {
  const remote = await redisGet(key);
  if (remote) return remote;
  return memGet(key);
}

export async function cacheSet(key, data, ttlSec = CACHE_TTL_SEC) {
  memSet(key, data);
  await redisSet(key, data, ttlSec);
}

export async function cacheDel(key) {
  memCache.delete(key);
  await redisDel(key);
}

export function clearMemCache() {
  const n = memCache.size;
  memCache.clear();
  return n;
}

export const cacheInfo = () => ({
  backend:     UPSTASH_URL ? 'Upstash Redis' : 'In-Memory',
  memEntries:  memCache.size,
  ttl_h:       24,
  redisReady:  !!(UPSTASH_URL && UPSTASH_TOKEN),
});
