/**
 * production.config.js — Validación centralizada de entorno y flags de servicio
 *
 * Fuente única de verdad para saber qué servicios están activos.
 * Exporta booleanos listos para usar en cualquier módulo:
 *
 *   import { cfg } from '../config/production.config.js';
 *   if (cfg.useSupabase) { ... }
 *
 * Nunca imprime ni retorna valores de variables sensibles.
 * Solo reporta su PRESENCIA (true/false) y emite warnings accionables.
 */

// ── Lectura de variables (lectura única al cargar el módulo) ─────────────────
const env = {
  DATABASE_URL:      process.env.DATABASE_URL,
  JWT_SECRET:        process.env.JWT_SECRET,
  SUPABASE_URL:      process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  GOOGLE_CLIENT_ID:  process.env.GOOGLE_CLIENT_ID,
  GOOGLE_API_KEY:    process.env.GOOGLE_API_KEY,
  RESEND_API_KEY:    process.env.RESEND_API_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
  INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
  NODE_ENV:          process.env.NODE_ENV || 'development',
  PORT:              process.env.PORT || '8000',
};

// ── Flags de servicio — derivados sin exponer valores ────────────────────────
export const cfg = Object.freeze({
  // Entorno
  isProd:          env.NODE_ENV === 'production',
  isDev:           env.NODE_ENV !== 'production',
  port:            parseInt(env.PORT, 10),

  // Base de datos
  usePostgres:     !!env.DATABASE_URL,
  // SQLite activo cuando DATABASE_URL no está definida (solo desarrollo)
  useSQLite:       !env.DATABASE_URL,

  // Autenticación — switch transparente Supabase ↔ JWT local
  useSupabase:     !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
  hasSupabaseAdmin: !!env.SUPABASE_SERVICE_KEY,
  hasJwtSecret:    !!env.JWT_SECRET,

  // Servicios externos
  hasGoogleOAuth:  !!env.GOOGLE_CLIENT_ID,
  hasGoogleAI:     !!env.GOOGLE_API_KEY,
  hasResend:       !!env.RESEND_API_KEY,
  hasStripe:       !!env.STRIPE_SECRET_KEY,
  hasInngest:      !!(env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY),
});

// ── Validación de arranque — warnings accionables por módulo ─────────────────
export function validateEnv() {
  const issues  = [];
  const missing = [];

  // Bloqueos críticos en producción
  if (cfg.isProd) {
    if (!cfg.usePostgres)   issues.push('DATABASE_URL: PostgreSQL requerido en producción. Configure en Render/Railway.');
    if (!cfg.hasJwtSecret)  issues.push('JWT_SECRET: obligatorio. Generar con: openssl rand -hex 32');
  }

  // Advertencias de servicios opcionales
  if (!cfg.useSupabase)     missing.push('SUPABASE_URL + SUPABASE_ANON_KEY → Auth local activo (OK para dev)');
  if (!cfg.hasSupabaseAdmin)missing.push('SUPABASE_SERVICE_KEY → Jobs Inngest usarán pg Pool directo (OK)');
  if (!cfg.hasGoogleAI)     missing.push('GOOGLE_API_KEY → IA desactivada (árbol objetivos, match score, traducción EN)');
  if (!cfg.hasResend)       missing.push('RESEND_API_KEY → Emails transaccionales desactivados');
  if (!cfg.hasStripe)       missing.push('STRIPE_SECRET_KEY → Pagos desactivados');
  if (!cfg.hasInngest)      missing.push('INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY → Jobs en background desactivados');

  if (issues.length > 0) {
    console.error('\n[config] ✗ ERRORES CRÍTICOS DE CONFIGURACIÓN:');
    issues.forEach(i => console.error(`  ✗ ${i}`));
    if (cfg.isProd) process.exit(1);
  }

  if (missing.length > 0) {
    console.warn('\n[config] Servicios opcionales no configurados (la app sigue operativa):');
    missing.forEach(m => console.warn(`  ⚠ ${m}`));
  }

  return { valid: issues.length === 0, issues, missing };
}

// ── Tabla de resumen para logs de arranque ────────────────────────────────────
export function printStartupSummary() {
  const DB   = cfg.usePostgres  ? '✅ PostgreSQL'       : '⚠️  SQLite (dev)';
  const AUTH = cfg.useSupabase  ? '✅ Supabase Auth'    : '⚠️  JWT local (dev)';
  const AI   = cfg.hasGoogleAI  ? '✅ Gemini AI'        : '❌ Sin IA';
  const MAIL = cfg.hasResend    ? '✅ Resend emails'    : '❌ Sin emails';
  const PAY  = cfg.hasStripe    ? '✅ Stripe pagos'     : '❌ Sin pagos';
  const JOBS = cfg.hasInngest   ? '✅ Inngest jobs'     : '❌ Sin jobs async';

  console.log(`
╔══════════════════════════════════════════════════════╗
║  RadarFondos 360 — Estado de Servicios               ║
╠══════════════════════════════════════════════════════╣
║  Entorno : ${(cfg.isProd ? 'PRODUCCIÓN' : 'Desarrollo  ').padEnd(43)}║
║  DB      : ${DB.padEnd(43)}║
║  Auth    : ${AUTH.padEnd(43)}║
║  IA      : ${AI.padEnd(43)}║
║  Emails  : ${MAIL.padEnd(43)}║
║  Pagos   : ${PAY.padEnd(43)}║
║  Jobs    : ${JOBS.padEnd(43)}║
╚══════════════════════════════════════════════════════╝`);
}

export default cfg;
