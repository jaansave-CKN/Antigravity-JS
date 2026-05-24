import { Pool } from 'pg';

let _pool = null;

const _rawUrl = (process.env.DATABASE_URL || '').trim();

if (!_rawUrl) {
  console.error('[DB] FATAL: DATABASE_URL environment variable is required for PostgreSQL');
  process.exit(1);
}

export async function initSQL() {
  if (!_pool) {
    _pool = new Pool({
      connectionString: _rawUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
    console.log('[DB] PostgreSQL pool initialized');
  }
  return _pool;
}

export function getDb() {
  return _pool;
}

export async function getRow(sql, params = []) {
  const { rows } = await _pool.query(sql, params);
  return rows[0] || undefined;
}

export async function getRows(sql, params = []) {
  const { rows } = await _pool.query(sql, params);
  return rows;
}

export async function getCount(sql, params = []) {
  const { rows } = await _pool.query(sql, params);
  return parseInt(rows[0]?.c || 0);
}

export async function runSql(sql, params = []) {
  return _pool.query(sql, params);
}