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
// MIGRADO a cache.js/Redis 2026-08-15 (PROTOCOLO OMEGA-TITÁN, hallazgo FinOps
// real): esta función ya documentaba desde su creación que debía migrarse "si
// el volumen real lo justifica" — el plan de Render es `free` (render.yaml),
// que hace spin-down por inactividad (confirmado en el propio dashboard del
// usuario) y reinicia el proceso en cada cold-start. quotaCounters (Map en
// memoria) se vaciaba en cada reinicio, así que la cuota de 50/día NO se
// cumplía en la práctica: cualquier usuario podía obtener una cuota nueva
// cada vez que el servicio hiciera cold-start, potencialmente muchas veces
// al día bajo tráfico intermitente. resetAt se preserva explícito en el
// valor cacheado (no se delega al TTL físico de Redis) para no cambiar la
// semántica de "ventana fija desde el primer uso" por una ventana deslizante.
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const quotaKey = (uid) => `quota:${uid}`;

export async function checkQuota(uid, max = 50) {
  const key = quotaKey(uid);
  const now = Date.now();
  let entry = await cacheGet(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + QUOTA_WINDOW_MS };
  }
  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  const ttlSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  await cacheSet(key, entry, ttlSec);
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

// ── Rate limit por ráfaga — ventana corta, distinto de checkQuota (cuota diaria) ──
// Mismo patrón deliberadamente en memoria (Map, sin Redis): una ráfaga solo tiene
// sentido dentro del proceso que la está sirviendo ahora mismo, igual que
// activeQueries. Ventana deslizante simple: descarta timestamps fuera de la ventana
// en cada llamada — barato, sin dependencias nuevas (ver docs/analisis_gaps_v1.md A4).
const BURST_WINDOW_MS = 10_000; // 10 s
const BURST_MAX       = 20;     // 20 requests / 10 s por clave
const burstBuckets = new Map(); // clave (uid o ip) → number[] timestamps

export function checkBurst(key, max = BURST_MAX, windowMs = BURST_WINDOW_MS) {
  const now = Date.now();
  const hits = (burstBuckets.get(key) || []).filter(ts => now - ts < windowMs);
  if (hits.length >= max) {
    burstBuckets.set(key, hits);
    return { allowed: false, retryAfterMs: windowMs - (now - hits[0]) };
  }
  hits.push(now);
  burstBuckets.set(key, hits);
  return { allowed: true, remaining: max - hits.length };
}

// Middleware Express — aplica checkBurst usando uid (si ya pasó auth) o IP como clave.
export function burstLimiter(req, res, next) {
  const key = req.user?.uid || req.ip;
  const result = checkBurst(key);
  if (!result.allowed) {
    return res.status(429).json({
      error: 'Demasiadas solicitudes en poco tiempo, intenta de nuevo en unos segundos.',
      retryAfterMs: result.retryAfterMs,
    });
  }
  next();
}

// ── Ban temporal de IP tras fallos de login repetidos ──────────────────────────
// Deliberadamente async y persistido vía cache.js (Redis si UPSTASH_* está
// configurado; memoria si no) — a diferencia de checkQuota/checkBurst
// (in-memory puro, por-proceso): un contador de fuerza bruta que se resetea
// en cada reinicio del proceso dejaría de proteger justo en el peor momento
// (un deploy no debería regalarle al atacante una ventana nueva de intentos).
// Umbral: 5 fallos en 15 min → ban de 15 min. Se consulta ANTES de intentar
// admin.auth().verifyIdToken() en /api/session/login (server.js) para no
// gastar la llamada a Firebase si la IP ya está baneada; se incrementa en el
// catch de esa misma verificación.
const LOGIN_FAIL_WINDOW_SEC = 15 * 60; // 15 min
const LOGIN_FAIL_MAX        = 5;
const LOGIN_BAN_SEC         = 15 * 60; // 15 min

const loginFailKey = (ip) => `login_fail:${ip}`;
const loginBanKey  = (ip) => `login_ban:${ip}`;

// Consultado por loginBanGuard (abajo) antes de tocar Firebase.
export async function checkLoginBan(ip) {
  const ban = await cacheGet(loginBanKey(ip));
  if (ban?.until && ban.until > Date.now()) {
    return { allowed: false, retryAfterMs: ban.until - Date.now() };
  }
  return { allowed: true };
}

// Llamado desde el catch de verifyIdToken() en /api/session/login cuando el
// token de Firebase es rechazado. Al llegar al umbral banea la IP y resetea
// el contador de fallos (el ban activo ya es la protección vigente).
export async function recordLoginFailure(ip) {
  const key = loginFailKey(ip);
  const entry = (await cacheGet(key)) || { count: 0 };
  entry.count += 1;

  if (entry.count >= LOGIN_FAIL_MAX) {
    const until = Date.now() + LOGIN_BAN_SEC * 1000;
    await cacheSet(loginBanKey(ip), { until }, LOGIN_BAN_SEC);
    await cacheDel(key);
    console.warn(`[Session] IP baneada por fuerza bruta de login: ${ip} (${entry.count} fallos en ${LOGIN_FAIL_WINDOW_SEC / 60} min)`);
    return { banned: true, retryAfterMs: LOGIN_BAN_SEC * 1000 };
  }

  await cacheSet(key, entry, LOGIN_FAIL_WINDOW_SEC);
  return { banned: false, remaining: LOGIN_FAIL_MAX - entry.count };
}

// Middleware Express — aplica ANTES de la ruta /api/session/login, mismo
// shape de respuesta 429 que burstLimiter (ver retryAfterMs arriba).
export async function loginBanGuard(req, res, next) {
  const { allowed, retryAfterMs } = await checkLoginBan(req.ip);
  if (!allowed) {
    return res.status(429).json({
      error: 'Demasiados intentos fallidos de inicio de sesión, intenta de nuevo más tarde.',
      retryAfterMs,
    });
  }
  next();
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
