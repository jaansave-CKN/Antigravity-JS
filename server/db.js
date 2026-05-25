import sqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'radar.db');

let db = null;

function pgToSqlite(sql, params) {
  const newParams = [];
  let paramIdx = 0;
  let result = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '$' && i + 1 < sql.length && /\d/.test(sql[i + 1])) {
      let num = '';
      let j = i + 1;
      while (j < sql.length && /\d/.test(sql[j])) {
        num += sql[j];
        j++;
      }
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < params.length) {
        newParams.push(params[idx]);
      } else {
        newParams.push(null);
      }
      result += '?';
      i = j - 1;
    } else {
      result += sql[i];
    }
  }
  return { sql: result, params: newParams };
}

export async function initSQL() {
   if (db) return db;
   try {
     const SQL = await sqlJs();
     if (fs.existsSync(DB_PATH)) {
       const data = fs.readFileSync(DB_PATH);
       db = new SQL.Database(data);
     } else {
       db = new SQL.Database();
     }
     return db;
   } catch (error) {
     throw error;
   }
 }

export function getDb() {
  return db;
}

export async function getRow(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  const { sql: converted, params: newParams } = pgToSqlite(sql, params);
  const stmt = db.prepare(converted);
  try {
    stmt.bind(newParams);
    if (stmt.step()) {
      return stmt.getAsObject();
    }
    return undefined;
  } finally {
    stmt.free();
  }
}

export async function getRows(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  const { sql: converted, params: newParams } = pgToSqlite(sql, params);
  const stmt = db.prepare(converted);
  const results = [];
  try {
    stmt.bind(newParams);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    return results;
  } finally {
    stmt.free();
  }
}

export async function getCount(sql, params = []) {
  const row = await getRow(sql, params);
  return row?.c || 0;
}

export async function runSql(sql, params = []) {
  if (!db) throw new Error('DB not initialized');
  const { sql: converted, params: newParams } = pgToSqlite(sql, params);
  const stmt = db.prepare(converted);
  try {
    stmt.run(newParams);
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    return { changes: db.getRowsModified() };
  } finally {
    stmt.free();
  }
}