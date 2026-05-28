import { getDb } from './db.js';

async function checkDatabase() {
  try {
    const db = await getDb();
    // Get list of tables
    const tablesStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table'");
    const tables = [];
    while (tablesStmt.step()) {
      tables.push(tablesStmt.getAsObject().name);
    }
    tablesStmt.free();
    console.log('Tables:', tables);
    
    // Check each table for structure and data
    for (const tableName of tables) {
      console.log(`\n--- Table: ${tableName} ---`);
      const infoStmt = db.prepare(`PRAGMA table_info(${tableName})`);
      const columns = [];
      while (infoStmt.step()) {
        columns.push(infoStmt.getAsObject());
      }
      infoStmt.free();
      console.log('Columns:', columns.map(col => ({name: col.name, type: col.type, notnull: col.notnull, dflt_value: col.dflt_value, pk: col.pk})));
      
      const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      countStmt.step();
      const count = countStmt.getAsObject().cnt;
      countStmt.free();
      console.log('Row count:', count);
      
      if (count > 0 && count < 10) {
        const dataStmt = db.prepare(`SELECT * FROM ${tableName}`);
        const rows = [];
        while (dataStmt.step()) {
          rows.push(dataStmt.getAsObject());
        }
        dataStmt.free();
        console.log('Sample data:', JSON.stringify(rows.slice(0, 3), null, 2));
      } else if (count >= 10) {
        const dataStmt = db.prepare(`SELECT * FROM ${tableName} LIMIT 3`);
        const rows = [];
        while (dataStmt.step()) {
          rows.push(dataStmt.getAsObject());
        }
        dataStmt.free();
        console.log('Sample data (first 3):', JSON.stringify(rows, null, 2));
      }
    }
    
    db.close();
  } catch (error) {
    console.error('Error checking database:', error);
  }
}

checkDatabase();