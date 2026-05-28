import sqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'backend', 'radar.db');

let SQL = null;

async function initSQL() {
  if (!SQL) {
    SQL = await sqlJs();
  }
  return SQL;
}

export async function getDb() {
  const SQL = await initSQL();
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    return new SQL.Database(data);
  } else {
    return new SQL.Database();
  }
}

export async function getRow(sql, params = []) {
  const db = await getDb();
  try {
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
  } finally {
    db.close();
  }
}

export async function getRows(sql, params = []) {
  const db = await getDb();
  try {
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
  } finally {
    db.close();
  }
}

export async function getCount(sql, params = []) {
  const row = await getRow(sql, params);
  return row?.c || 0;
}

export async function runSql(sql, params = []) {
  const db = await getDb();
  try {
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
  } finally {
    db.close();
  }
}

function pgToSqlite(sql, params) {
  // If no $N placeholders, pass params as-is (already uses ? style)
  if (!sql.includes('$')) {
    return { sql, params: [...params] };
  }
  const newParams = [];
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
      newParams.push(idx >= 0 && idx < params.length ? params[idx] : null);
      result += '?';
      i = j - 1;
    } else {
      result += sql[i];
    }
  }
  return { sql: result, params: newParams };
}
