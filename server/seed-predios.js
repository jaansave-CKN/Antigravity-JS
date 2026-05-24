import { getDb } from './db.js';
import { randomUUID as uuid } from 'crypto';

const PREDIOS = [
  { direccion: 'Av. El Dorado #26-20, Bogotá',            area_m2: 2300, valor_catastral: 125_000_000, propietario: 'Empresa Test S.A.', matricula: '001-234567' },
  { direccion: 'Cll 72 #10-34, Bogotá',                    area_m2: 1450, valor_catastral: 310_000_000, propietario: 'Inversora Norte LTDA', matricula: '002-789012' },
  { direccion: 'Cra. 7 #93-25, Bogotá',                    area_m2:  380, valor_catastral: 420_000_000, propietario: 'Bogotá Capital SAS', matricula: '003-345678' },
  { direccion: 'Transv. 24 #98-80, Bogotá',                area_m2: 5400, valor_catastral: 880_000_000, propietario: 'Bogotá Capital SAS', matricula: '004-901234' },
  { direccion: 'Autopista Norte #180-50, Bogotá',           area_m2: 7300, valor_catastral: 920_000_000, propietario: 'Inversora Norte LTDA', matricula: '005-567890' },
  { direccion: 'Av. 19 #119-30, Bogotá',                    area_m2: 4200, valor_catastral: 550_000_000, propietario: 'Empresa Test S.A.', matricula: '006-123456' },
  { direccion: 'Cll 134 #10-44, Bogotá',                    area_m2: 1700, valor_catastral: 280_000_000, propietario: 'Inversora Norte LTDA', matricula: '007-789012' },
  { direccion: 'Cra. 15 #126-10, Bogotá',                   area_m2: 3100, valor_catastral: 470_000_000, propietario: 'Bogotá Capital SAS', matricula: '008-345678' },
  { direccion: 'Av. Suba #123-30, Bogotá',                  area_m2: 2100, valor_catastral: 340_000_000, propietario: 'Empresa Test S.A.', matricula: '009-901234' },
  { direccion: 'Diagonal 92 #18-25, Bogotá',                area_m2:  820, valor_catastral: 210_000_000, propietario: 'Inversora Norte LTDA', matricula: '010-567890' },
  { direccion: 'Av. Calle 26 #85-15, Bogotá',               area_m2: 4600, valor_catastral: 680_000_000, propietario: 'Bogotá Capital SAS', matricula: '011-123456' },
  { direccion: 'Cll 63 #13-40, Bogotá',                      area_m2: 1200, valor_catastral: 250_000_000, propietario: 'Empresa Test S.A.', matricula: '012-789012' },
  { direccion: 'Transv. 47 #10-60, Bogotá',                  area_m2: 2950, valor_catastral: 390_000_000, propietario: 'Inversora Norte LTDA', matricula: '013-345678' },
  { direccion: 'Av. Boyacá #56-75, Bogotá',                  area_m2: 1800, valor_catastral: 290_000_000, propietario: 'Bogotá Capital SAS', matricula: '014-901234' },
  { direccion: 'Cra. 11 #82-80, Bogotá',                     area_m2:  650, valor_catastral: 195_000_000, propietario: 'Empresa Test S.A.', matricula: '015-567890' },
  { direccion: 'Av. Ciudad de Cali #36-20, Bogotá',          area_m2: 7200, valor_catastral: 840_000_000, propietario: 'Inversora Norte LTDA', matricula: '016-123456' },
  { direccion: 'Cll 26 #13-50, Bogotá',                      area_m2:  940, valor_catastral: 305_000_000, propietario: 'Bogotá Capital SAS', matricula: '017-789012' },
  { direccion: 'Av. Tadeo Lozano #10-01, Bogotá',            area_m2: 4100, valor_catastral: 510_000_000, propietario: 'Empresa Test S.A.', matricula: '018-345678' },
  { direccion: 'Transv. 50 #56-33, Bogotá',                  area_m2: 5200, valor_catastral: 710_000_000, propietario: 'Inversora Norte LTDA', matricula: '019-901234' },
  { direccion: 'Av. Caracas #48-70, Bogotá',                 area_m2: 1550, valor_catastral: 265_000_000, propietario: 'Bogotá Capital SAS', matricula: '020-567890' },
];

function coords(i) {
  const baseLat = 4.6480, baseLng = -74.1000, spread = 0.08;
  const seed = (i + 1) * 13.37;
  return [
    +((Math.sin(seed) + Math.cos(seed * 0.7)) * spread + baseLat).toFixed(6),
    +((Math.cos(seed * 1.3) + Math.sin(seed * 0.9)) * spread + baseLng).toFixed(6),
  ];
}

export async function seedPredios() {
  const pool = getDb();
  try {
    const { rows } = await pool.query('SELECT COUNT(*) as c FROM predios');
    const count = parseInt(rows[0]?.c || 0);
    if (count > 0) {
      console.log(`[seedPredios] ${count} registro(s) encontrado(s), seeding omitido.`);
      return;
    }

    console.log('[seedPredios] Insertando 20 predios de prueba...');
    for (let i = 0; i < PREDIOS.length; i++) {
      const [lat, lng] = coords(i);
      await pool.query(
        'INSERT INTO predios (id, lat, lng, direccion, area_m2, valor_catastral, propietario, matricula) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [uuid(), lat, lng, PREDIOS[i].direccion, PREDIOS[i].area_m2, PREDIOS[i].valor_catastral, PREDIOS[i].propietario, PREDIOS[i].matricula]
      );
    }
    console.log(`[seedPredios] ${PREDIOS.length} predios insertados correctamente.`);
  } catch (err) {
    console.error('[seedPredios] Error:', err);
    throw err;
  }
}