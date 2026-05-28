import { runSql } from './db.js';

const queries = [
  `INSERT INTO convocatorias (titulo, sector, estado, monto, entidad_id) VALUES ('Construcción de Baterías Sanitarias Rurales - Cantagallo', 'Saneamiento', 'abierta', 150000000, 'KUSANONE')`,
  `INSERT INTO convocatorias (titulo, sector, estado, monto, entidad_id) VALUES ('Optimización de Acueducto Comunitario - San Pablo', 'Infraestructura', 'abierta', 250000000, 'MGA')`,
  `INSERT INTO convocatorias (titulo, sector, estado, monto, entidad_id) VALUES ('Módulos de Educación Rural Sostenible', 'Educación', 'pendiente', 400000000, 'MINEDUCACION')`,
  `INSERT INTO convocatorias (titulo, sector, estado, monto, entidad_id) VALUES ('Fondo de Inversión para Estructuras Híbridas Livianas', 'Construcción', 'abierta', 800000000, 'SGR')`,
  `INSERT INTO convocatorias (titulo, sector, estado, monto, entidad_id) VALUES ('Dotación Tecnológica IoT para Obras', 'Tecnología', 'cerrada', 50000000, 'SENA')`
];

async function seed() {
  console.log('Iniciando vaciado de datos...');
  for (const q of queries) {
    await runSql(q, []); 
  }
  console.log('Seeding completado con éxito. Tanques llenos.');
}

seed();