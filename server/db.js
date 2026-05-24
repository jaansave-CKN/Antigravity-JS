import pg from 'pg';

const { Pool } = pg;

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !connectionString.startsWith('postgres')) {
      throw new Error('DATABASE_URL environment variable is missing or not a PostgreSQL URL. Configure it in Render dashboard.');
    }
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

export async function initSQL() {
  getPool();
  return getPool();
}

export function getDb() {
  return getPool();
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function getRow(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows[0];
}

export async function getRows(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getCount(sql, params = []) {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return parseInt(result.rows[0]?.c || 0);
}

export async function runSql(sql, params = []) {
  const pool = getPool();
  return await pool.query(sql, params);
}

export { pool };