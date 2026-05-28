import { runSql } from './db.js';

async function testInsert() {
  try {
    const result = await runSql(`
      INSERT INTO convocatorias (titulo)
      VALUES (?)
    `, [
      'Test Convocatoria'
    ]);
    console.log('Insert result:', result);
  } catch (error) {
    console.error('Insert error:', error);
  }
}

testInsert();