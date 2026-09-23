/**
 * SecurityMiddleware.js — Blindaje de seguridad institucional
 * GGIE · Radar de Fondos 360
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../utils/logger.js';
import { PostgresRateLimitStore } from './PostgresRateLimitStore.js';

// Resolución de IP segura para IPv4 e IPv6 (usa ipKeyGenerator de express-rate-limit v7+)
//
// FIX (auditoría SRE 2026-08-08, Capa 3 — CRÍTICO): antes se leía
// req.headers['x-forwarded-for'] directamente, un valor 100% controlado por
// el cliente — sin `app.set('trust proxy', ...)` configurado (ver server.js),
// cualquiera podía mandar un XFF distinto en cada request y resetear
// authLimiter/trialLimiter a voluntad (bypass de fuerza bruta y de Modo
// Trial). Ahora se delega en `req.ip` de Express, que solo confía en el XFF
// hasta la cantidad de saltos configurada en trust proxy (1 = balanceador de
// Render) — un XFF falso agregado por el cliente antes de esa cadena real se
// descarta automáticamente por Express.
const getRateLimitKey = (req) => ipKeyGenerator(req.ip || 'unknown');

// ── Rate limiting por tenant para el pipeline financiero (rutas pesadas) ─────
// Se aplica DESPUÉS de authenticateToken en la cadena de middlewares, así
// req.userId (= org_id en este esquema) ya está disponible. El límite general
// de /api (300/15min) es por IP y no protege contra un solo tenant saturando
// el pool de conexiones REST de Supabase con extracciones/cálculos pesados —
// este limiter es más estricto y aísla por org_id, no por red compartida.
export const financialPipelineLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  store: new PostgresRateLimitStore('financialPipeline'),
  keyGenerator: (req) => req.userId || getRateLimitKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'FINANCIAL_PIPELINE_RATE_LIMITED',
      message: 'Límite de operaciones del pipeline financiero excedido (20 cada 15 minutos). Reintenta en unos minutos.',
    });
  },
});

// ── Rate limiting estricto para rutas de autenticación ────────────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  store: new PostgresRateLimitStore('authLimiter'),
  keyGenerator: getRateLimitKey, // <-- Corregido
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AUTH_RATE_LIMITED',
      message: 'ACCESO BLOQUEADO: Límite de intentos excedido. Reintente en 15 minutos.',
    });
  },
});

// ── Rate limiting para Modo Trial ──────────────────────────────────────────
export const trialLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: new PostgresRateLimitStore('trialLimiter'),
  keyGenerator: getRateLimitKey, // <-- Corregido
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'TRIAL_RATE_LIMITED',
      message: 'Límite de sesiones trial alcanzado.',
    });
  },
});

// ── Rate limiting dedicado para los botones ✨ individuales de "Contexto del
// Problema" (2026-08-22) — hasta 7 disparos de IA (6 campos + problemáticas
// de C1) por sesión de llenado del formulario. El aiLimiter global (20/hora)
// es compartido con BYOK/Copiloto/continuar-formulación — agotarlo solo por
// llenar esta sección bloquearía sin necesidad al resto de funciones de IA
// de la app. Mismo store/patrón, ventana más amplia (30/hora) calibrada
// para ~4 llenados completos de formulario por hora, no uso ilimitado.
export const entradaCampoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  store: new PostgresRateLimitStore('entradaCampoLimiter'),
  keyGenerator: (req) => req.userId ? ipKeyGenerator(req.userId) : getRateLimitKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'ENTRADA_CAMPO_RATE_LIMITED',
      message: 'Límite de generación por campo alcanzado (30/hora). Reintenta en unos minutos.',
    });
  },
});

// ── Rate limiting dedicado para la cadena de Formulación Integral
// (2026-09-22, GP_Formulador) — una sola ejecución de este endpoint puede
// hacer hasta 3 llamadas reales a Gemini (Entrada → Árbol → Viabilidad), a
// diferencia del resto de rutas de IA que hacen 1 llamada por request. Bajo
// el aiLimiter compartido (20/hora) eso sería 3 unidades de gasto real de
// cuota contadas como 1 sola unidad visible — asimetría aceptada de forma
// explícita como riesgo por el usuario para el resto de endpoints, pero NO
// para este, que puede agotar la cuota real 3x más rápido de lo que el
// contador compartido refleja. Ventana más angosta (6/hora — suficiente
// para formular varios proyectos por hora sin abrir la puerta a que 1 sola
// cuenta agote las 3 llaves del pool de geminiCircuitBreaker.js en minutos).
export const formulacionIntegralLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  store: new PostgresRateLimitStore('formulacionIntegralLimiter'),
  keyGenerator: (req) => req.userId ? ipKeyGenerator(req.userId) : getRateLimitKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'FORMULACION_INTEGRAL_RATE_LIMITED',
      message: 'Límite de formulación integral alcanzado (6/hora — cada ejecución puede hacer hasta 3 llamadas reales a Gemini). Reintenta en unos minutos.',
    });
  },
});

// ── Rate limiting para endpoints de IA ─────────────────────────────────────
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  store: new PostgresRateLimitStore('aiLimiter'),
  keyGenerator: (req) => req.userId ? ipKeyGenerator(req.userId) : getRateLimitKey(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      code: 'AI_RATE_LIMITED',
      message: 'Límite de consultas de IA alcanzado.',
    });
  },
});

// ── Sanitización ESTRICTA ───────────────────────────────────────────────────
export function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value
    // Primero elimina tag + CONTENIDO de <script>/<style> — quitar solo las
    // etiquetas (como hacía antes el replace de abajo) dejaba el texto
    // interno como string plano (ej. "<script>alert(1)</script>" → "alert(1)"
    // sobrevivía). No es explotable hoy (React escapa todo, no hay
    // dangerouslySetInnerHTML en el proyecto), pero es higiene de datos real.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/--/g, '')
    .replace(/[;]/g, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, 512);
}

export function sanitizeAuthBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const field of ['email', 'correo', 'nombre', 'nombreCompleto']) {
      if (typeof req.body[field] === 'string') req.body[field] = sanitizeInput(req.body[field]);
    }
    if (typeof req.body.password === 'string') req.body.password = req.body.password.slice(0, 128);
    if (typeof req.body.contrasena === 'string') req.body.contrasena = req.body.contrasena.slice(0, 128);
  }
  next();
}

// ── Sanitización con WHITELIST (Se mantiene igual) ─────────────────────────
const ALLOWED_TAGS_WL = new Set(['b','i','p','br','ul','ol','li','strong','em']);

export function sanitizeTechnicalText(value, maxLength = 8000) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<(\w+)([^>]*)>/gi, (_match, tag, _attrs) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS_WL.has(t) ? `<${t}>` : '';
    })
    .replace(/<\/(\w+)>/gi, (_match, tag) => {
      const t = tag.toLowerCase();
      return ALLOWED_TAGS_WL.has(t) ? `</${t}>` : '';
    })
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, maxLength);
}

// Sanitización de campos de URL (ej. link de un anexo) — NO usa
// sanitizeTechnicalText: su regex on\w+\s*= no ancla a inicio de palabra y
// corrompería query strings/paths legítimos (ej. "?ocupacion_id=1",
// "?reunion=abc"). Solo neutraliza esquemas peligrosos como prefijo.
export function sanitizeUrl(value, maxLength = 500) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/^\s*(javascript|data|vbscript)\s*:/gi, '')
    .replace(/\x00/g, '')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeFormuladorBody(req, res, next) {
  try {
    if (typeof req.body?.nombre === 'string') {
      req.body.nombre = sanitizeInput(req.body.nombre);
    }
    if (typeof req.body?.nombreArchivo === 'string') {
      req.body.nombreArchivo = sanitizeInput(req.body.nombreArchivo);
    }
    // FIX (auditoría SRE Red Team 2026-08-10, Capa 3): antes solo cubría 12
    // campos fijos — cualquier campo nuevo de fichaTecnica quedaba sin
    // sanitizar por defecto. Ahora cubre TODAS las claves string presentes,
    // sin necesidad de mantener una lista manual. No es explotable hoy
    // (React escapa todo, sin dangerouslySetInnerHTML en el proyecto —
    // verificado), pero cierra el hueco de higiene de datos real.
    if (req.body?.fichaTecnica && typeof req.body.fichaTecnica === 'object' && !Array.isArray(req.body.fichaTecnica)) {
      for (const field of Object.keys(req.body.fichaTecnica)) {
        if (typeof req.body.fichaTecnica[field] === 'string') {
          req.body.fichaTecnica[field] = sanitizeTechnicalText(req.body.fichaTecnica[field]);
        }
      }
    }
  } catch (e) {
    logger.warn('[SecurityMiddleware] Fallo sanitizando body', { path: req.path, err: e.message });
  }
  next();
}

// ── Slowdown anti-DDoS — retraso progresivo antes de bloquear ─────────────────
// Después de `freeRequests` por ventana, cada request adicional añade `delayMs`
const _slowStore = new Map(); // ip → { count, resetAt }
const SLOW_WINDOW_MS    = 15 * 60 * 1000; // 15 min
const SLOW_FREE         = 100;             // requests gratis por ventana
const SLOW_DELAY_MS     = 500;             // ms añadidos por request extra
const SLOW_MAX_DELAY_MS = 10_000;          // tope: 10 s

export function slowDown(req, res, next) {
  // FIX (auditoría SRE 2026-08-08): mismo bypass de XFF que getRateLimitKey — ver arriba.
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  let entry = _slowStore.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + SLOW_WINDOW_MS };
  } else {
    entry.count++;
  }
  _slowStore.set(ip, entry);

  const excess = entry.count - SLOW_FREE;
  if (excess <= 0) return next();

  const delay = Math.min(excess * SLOW_DELAY_MS, SLOW_MAX_DELAY_MS);
  res.setHeader('X-RateLimit-Delay-Ms', delay);
  setTimeout(next, delay);
}

// Limpieza periódica del store (evita leak de memoria)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _slowStore) {
    if (now > entry.resetAt) _slowStore.delete(ip);
  }
}, SLOW_WINDOW_MS);

// FIX (2026-09-08, "se perdió la información que ya tenía guardada" —
// investigación completa): `sameSite: 'strict'` en la cookie httpOnly
// `auth_token` es la causa real confirmada de por qué las páginas del
// Formulador (Entrada, Anexos, Biblioteca, RACI, etc.) veían datos vacíos
// incluso con la sesión real intacta. Evidencia:
//   1. leerAuthToken() (client/src/lib/authStorage.ts) desde la migración
//      Fase 1 Dual-Mode (2026-09-05) SOLO devuelve 'demo-mode-token' o null
//      — para una sesión real nunca hay JWT legible por JS, así que
//      getAuthHeaders() NUNCA manda Authorization: Bearer. TODA la
//      autenticación de una sesión real depende exclusivamente de esta
//      cookie desde esa fecha.
//   2. Logs reales de producción (PM2 radar-backend, verificados en vivo):
//      86 rechazos "[auth] Rechazo 401 ... sin_cookie_ni_header_valido"
//      contra endpoints de Formulador desde el 2026-09-05, exactamente
//      coincidiendo con la migración de arriba — la cookie no viaja en
//      estas peticiones fetch() aunque la sesión sí sea válida.
//   3. `Strict` retiene la cookie en escenarios de fetch/proxy (Vite dev
//      proxy localhost:5173 → Express :8000) donde `Lax` (el estándar de
//      facto para cookies de sesión de una SPA) no la retiene — Lax sigue
//      bloqueando el vector real que SameSite previene (envío cross-site
//      desde un sitio de terceros), no debilita la protección para esta app.
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000,
  path: '/',
};
