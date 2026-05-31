import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'backend', 'radar.db');
const USE_PG    = !!process.env.DATABASE_URL;

// ── PostgreSQL mode (activado cuando DATABASE_URL existe) ─────────────────────
let pgPool = null;

if (USE_PG) {
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // requerido por Neon / Supabase / Railway
    max: 10,
  });
  console.log('[DB] Modo PostgreSQL activado (DATABASE_URL detectado)');
}

// Convierte placeholders ? → $1, $2… para PostgreSQL
function qmarkToPg(sql, params) {
  if (!sql.includes('?')) return { sql, params };
  let i = 0;
  return { sql: sql.replace(/\?/g, () => `$${++i}`), params };
}

async function pgQuery(sql, params = []) {
  const { sql: q, params: p } = qmarkToPg(sql, params);
  return pgPool.query(q, p);
}

// ── SQLite mode (fallback local con sql.js) ───────────────────────────────────
let sqlJsModule = null;

async function getSqlJs() {
  if (!sqlJsModule) {
    const { default: initSqlJs } = await import('sql.js');
    sqlJsModule = await initSqlJs();
  }
  return sqlJsModule;
}

async function getDb() {
  const SQL = await getSqlJs();
  return fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();
}

// Convierte placeholders $1, $2… → ? para SQLite
function pgToSqlite(sql, params) {
  if (!sql.includes('$')) return { sql, params: [...params] };
  const newParams = [];
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && i + 1 < sql.length && /\d/.test(sql[i + 1])) {
      let num = '';
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) { num += sql[j]; j++; }
      const idx = parseInt(num, 10) - 1;
      newParams.push(idx >= 0 && idx < params.length ? params[idx] : null);
      result += '?';
      i = j - 1;
    } else { result += sql[i]; }
  }
  return { sql: result, params: newParams };
}

// ── API pública (misma interfaz, dos motores) ─────────────────────────────────
export async function getRow(sql, params = []) {
  if (USE_PG) {
    const { rows } = await pgQuery(sql, params);
    return rows[0];
  }
  const db = await getDb();
  try {
    const { sql: converted, params: p } = pgToSqlite(sql, params);
    const stmt = db.prepare(converted);
    try {
      stmt.bind(p);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally { stmt.free(); }
  } finally { db.close(); }
}

export async function getRows(sql, params = []) {
  if (USE_PG) {
    const { rows } = await pgQuery(sql, params);
    return rows;
  }
  const db = await getDb();
  try {
    const { sql: converted, params: p } = pgToSqlite(sql, params);
    const stmt = db.prepare(converted);
    const results = [];
    try {
      stmt.bind(p);
      while (stmt.step()) results.push(stmt.getAsObject());
      return results;
    } finally { stmt.free(); }
  } finally { db.close(); }
}

export async function getCount(sql, params = []) {
  const row = await getRow(sql, params);
  // Acepta alias 'cnt' (estándar en server.js) o 'c' (legado)
  return Number(row?.cnt ?? row?.c ?? 0);
}

export async function runSql(sql, params = []) {
  if (USE_PG) {
    const result = await pgQuery(sql, params);
    return { changes: result.rowCount };
  }
  const db = await getDb();
  try {
    const { sql: converted, params: p } = pgToSqlite(sql, params);
    const stmt = db.prepare(converted);
    try {
      stmt.run(p);
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      return { changes: db.getRowsModified() };
    } finally { stmt.free(); }
  } finally { db.close(); }
}
