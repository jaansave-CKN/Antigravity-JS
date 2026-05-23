import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _SQL = null;

const DB_PATH = path.join(__dirname, '..', 'backend', 'radar.db');

export async function initSQL() {
  if (!_SQL) _SQL = await initSqlJs({ locateFile: f => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f) });
  return _SQL;
}

export function getDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let db;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new _SQL.Database(buf);
  } else {
    db = new _SQL.Database();
  }
  return db;
}

export function saveDb(db) {
  const data = db.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function closeDb(db) {
  if (db) { saveDb(db); db.close(); }
}

export function getRow(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  try {
    if (stmt.step()) {
      const cols = stmt.getColumnNames();
      const vals = stmt.get();
      const row = {};
      for (let i = 0; i < cols.length; i++) {
        const v = vals[i];
        row[cols[i]] = v instanceof Uint8Array ? v : v;
      }
      return row;
    }
    return undefined;
  } finally { stmt.free(); }
}

export function getRows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  try {
    const rows = [];
    const cols = stmt.getColumnNames();
    while (stmt.step()) {
      const vals = stmt.get();
      const row = {};
      for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
      rows.push(row);
    }
    return rows;
  } finally { stmt.free(); }
}

export function getCount(db, sql, params = []) {
  const row = getRow(db, sql, params);
  if (!row) return 0;
  const vals = Object.values(row);
  return typeof vals[0] === 'number' ? vals[0] : parseInt(vals[0]) || 0;
}

export function runSql(db, sql, params = []) {
  db.run(sql, params);
}

export { DB_PATH };
