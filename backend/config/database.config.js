/**
 * database.config.js — PostgreSQL Pool singleton con RLS helper
 *
 * Expone:
 * pool       — pg.Pool configurado para la nube (SSL, timeouts)
 * withTenant()   — ejecuta un bloque dentro de una transacción explícita
 * runTransaction() — ejecuta N queries atómicamente con BEGIN/COMMIT/ROLLBACK
 * query()      — shorthand para pool.query() (queries de sistema/admin)
 * getRow/getRows/getCount/runSql — API compatible con db.js
 */

import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('[db.config] FATAL: DATABASE_URL no definida.');
  console.error('[db.config] Configura DATABASE_URL en .env');
}

// pg-connection-string v2.7+ trata sslmode=require como verify-full, lo que
// sobreescribe rejectUnauthorized:false del Pool. Se elimina el parámetro del
// URL y se delega el control SSL exclusivamente al objeto ssl del Pool.
function buildConnectionString(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url.replace(/([?&])sslmode=[^&]*/g, '$1').replace(/[?&]$/, '');
  }
}

const isLocalhost = process.env.DATABASE_URL?.match(/localhost|127\.0\.0\.1/);

export const pool = new Pool({
  connectionString: buildConnectionString(process.env.DATABASE_URL),
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  // Fuerza schema public en Supabase + lock_timeout global para evitar bloqueos
  // en migraciones ALTER TABLE cuando la sesión anterior fue terminada abruptamente
  options: '-c search_path=public -c lock_timeout=5000 -c statement_timeout=15000',

  // Pool sizing: max 20 para no saturar Supabase en tier base
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000, // Aumentado ligeramente para evitar timeouts en arranque
  keepAlive: true,
});

pool.on('error', (err) => {
  console.error('[db.config] Pool error inesperado:', err.message);
});

// ── withTenant ────────────────────────────────────────────────────────────────
export async function withTenant(tenantId, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.org_id', $1, TRUE)",
      [String(tenantId)]
    );
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    throw err;
  } finally {
    client.release();
  }
}

// ── runTransaction ────────────────────────────────────────────────────────────
export async function runTransaction(queries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const q of queries) {
      results.push(await client.query(q.sql, q.params || []));
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    throw err;
  } finally {
    client.release();
  }
}

// ── query: sin contexto de tenant (admin/system) ─────────────────────────────
export async function query(sql, params = []) {
  return pool.query(sql, params);
}

// ── Helpers — API compatible con db.js ───────────────────────────────────────

export async function getRow(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const res = await pool.query(q, p);
  return res.rows[0] || null;
}

export async function getRows(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const res = await pool.query(q, p);
  return res.rows;
}

export async function getCount(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const res = await pool.query(q, p);
  return parseInt(res.rows[0]?.cnt ?? res.rows[0]?.count ?? 0, 10);
}

export async function runSql(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  return pool.query(q, p);
}

// ── Convierte ? → $1, $2… para compatibilidad con consultas legacy ────────────
function normalizePlaceholders(sql, params) {
  if (!sql.includes('?')) return { sql, params };
  let i = 0;
  return {
    sql: sql.replace(/\?/g, () => `$${++i}`),
    params,
  };
}

export default pool;
