/**
 * db.js — Capa de acceso a BD (PostgreSQL exclusivo — SQLite eliminado)
 *
 * El fallback SQLite fue removido para prevenir:
 *   1. Errores "no such column" por esquemas desincronizados.
 *   2. Contaminación de contexto RLS multi-tenant por conexiones reutilizadas.
 *
 * Re-exporta desde database.config.js (pool singleton compartido).
 * Requiere: DATABASE_URL en .env apuntando a Supabase / Neon / Railway.
 */

if (!process.env.DATABASE_URL) {
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  [db.js] FATAL: DATABASE_URL no configurada.             ║');
  console.error('║  El servidor requiere PostgreSQL. Agrega DATABASE_URL     ║');
  console.error('║  en .env (ej: postgresql://user:pass@host/db?sslmode=...) ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
}

export {
  pool,
  getRow,
  getRows,
  getCount,
  runSql,
  runTransaction,
  withTenant,
  query,
} from './config/database.config.js';
