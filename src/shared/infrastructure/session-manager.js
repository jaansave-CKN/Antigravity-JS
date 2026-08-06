import crypto       from 'crypto';
import jwt           from 'jsonwebtoken';
import { cacheGet, cacheSet, cacheDel, cacheInfo } from './cache.js';

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES     = '24h';
const JWT_EXPIRES_SEC = 24 * 60 * 60;

// Sesiones activas (uid → metadata): persistidas vía cache.js (Upstash Redis si
// UPSTASH_REDIS_REST_URL/TOKEN están configuradas; Map en memoria si no) — un
// reinicio del proceso ya no invalida las sesiones existentes cuando Redis está
// disponible, porque dejan de vivir solo en un Map local.
const sessionKey = (sessionId) => `session:${sessionId}`;

// ── Consultas en curso (anti-flood / estado de streaming) ─────────────────────
// Deliberadamente en memoria y por-proceso: una consulta "en vuelo" solo tiene
// sentido dentro del proceso que la está sirviendo; si el proceso reinicia, la
// consulta en curso murió con él, así que no hay nada que persistir aquí.
const activeQueries  = new Map(); // uid → Set<queryId>

// ── JWT ───────────────────────────────────────────────────────────────────────
export async function issueToken(uid, role = 'user', metadata = {}) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET no configurado en .env');
  const sessionId = crypto.randomUUID();
  const payload   = { uid, role, sessionId, ...metadata };
  const token     = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  await cacheSet(sessionKey(sessionId), { uid, role, createdAt: Date.now(), lastSeen: Date.now() }, JWT_EXPIRES_SEC);
  console.log(`[Session] Token emitido: uid=${uid} role=${role} sessionId=${sessionId}`);
  return { token, sessionId, expiresIn: JWT_EXPIRES };
}

export async function verifyToken(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET no configurado en .env');
  const decoded = jwt.verify(token, JWT_SECRET); // lanza si inválido / expirado
  const session = await cacheGet(sessionKey(decoded.sessionId));
  if (session) await cacheSet(sessionKey(decoded.sessionId), { ...session, lastSeen: Date.now() }, JWT_EXPIRES_SEC);
  return decoded;
}

// requester: { uid, role } — decodificado del propio JWT de sesión del llamante.
// Solo el dueño de la sesión o un role==='admin' puede revocarla.
export async function revokeSession(sessionId, requester) {
  const session = await cacheGet(sessionKey(sessionId));
  if (!session) return { revoked: false, reason: 'NOT_FOUND' };

  const isOwner = requester?.uid === session.uid;
  const isAdmin = requester?.role === 'admin';
  if (!isOwner && !isAdmin) {
    console.warn(`[Session] Revocación DENEGADA: ${sessionId} | solicitante=${requester?.uid ?? 'anónimo'} no es dueño ni admin`);
    return { revoked: false, reason: 'FORBIDDEN' };
  }

  await cacheDel(sessionKey(sessionId));
  console.log(`[Session] Revocada: ${sessionId} | por=${requester.uid} (${isAdmin ? 'admin' : 'dueño'})`);
  return { revoked: true };
}

// ── Middleware Express — verifica JWT propio (alternativo a Firebase) ──────────
export async function jwtMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = await verifyToken(header.split('Bearer ')[1]);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado', detail: err.message });
  }
}

// ── Cuota diaria por uid — guard barato contra gasto ilimitado en APIs de pago ──
// Deliberadamente en memoria (igual que activeQueries): un contador aproximado que
// se resetea si el proceso reinicia es aceptable para este propósito (evitar abuso,
// no facturación exacta). Si el volumen real lo justifica, migrar a cache.js/Redis
// sin tocar las llamadas — es la única función que conoce el detalle de almacenamiento.
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const quotaCounters = new Map(); // uid → { count, resetAt }

export function checkQuota(uid, max = 50) {
  const now = Date.now();
  let entry = quotaCounters.get(uid);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + QUOTA_WINDOW_MS };
    quotaCounters.set(uid, entry);
  }
  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

// ── Guard de consultas pesadas — evita que el frontend lance duplicados ─────────
// Nota: ya no depende de si existe alguna sesión activa en el proceso (ese chequeo
// era incorrecto — rechazaba usuarios válidos si el Map local estaba vacío, p.ej.
// justo después de un reinicio). La autenticación real ya ocurrió en el middleware
// antes de llegar aquí; esta función solo deduplica consultas en vuelo por uid.
export function acquireQuery(uid, queryId) {
  if (!activeQueries.has(uid)) activeQueries.set(uid, new Set());
  const queries = activeQueries.get(uid);
  if (queries.has(queryId)) return false; // duplicado en vuelo
  queries.add(queryId);
  return true;
}

export function releaseQuery(uid, queryId) {
  activeQueries.get(uid)?.delete(queryId);
}

// ── SSE helper — gestiona cabeceras y keep-alive ──────────────────────────────
export function initSSE(res) {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Ping cada 25 s para mantener la conexión viva en Render/proxies
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25_000);

  res.on('close', () => clearInterval(ping));

  return {
    send: (data)  => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); },
    done: ()      => { if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); } },
    error:(msg)   => { if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ event:'error', message: msg })}\n\n`); res.end(); } },
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
// El conteo exacto de sesiones activas ya no vive en un Map local (ver arriba);
// obtenerlo desde Upstash requeriría un SCAN sobre todas las keys `session:*`,
// costoso para un simple health check. Se reporta el backend real de persistencia
// (Redis vs. memoria) en su lugar — sessionStats().backend indica si las sesiones
// sobreviven a un reinicio del proceso o no.
export function sessionStats() {
  const { backend, redisReady } = cacheInfo();
  return {
    backend,
    sessionsSurvivenReinicio: redisReady,
    activeQueries: [...activeQueries.values()].reduce((s, q) => s + q.size, 0),
  };
}

// Nota: ya no hace falta un purgado manual periódico — las sesiones expiran solas
// por TTL (24h, igual que el JWT) tanto en Upstash (`ex=` en el SET) como en el
// fallback en memoria (cache.js evita entradas vencidas al leerlas, ver memGet()).
