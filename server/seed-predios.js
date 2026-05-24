import { getDb } from './db.js';
import crypto from 'crypto';

// Predios de prueba con coordenadas reales de Bogotá y surrounding municipalities
const PREDIOS = [
  { direccion: 'Av. El Dorado #26-20, Bogotá', area_m2: 2300, valor_catastral: 125_000_000, propietario: 'Empresa Test S.A.', matricula: '001-234567' },
  { direccion: 'Cll 72 #10-34, Bogotá', area_m2: 1450, valor_catastral: 310_000_000, propietario: 'Inversora Norte LTDA', matricula: '002-789012' },
  { direccion: 'Cra. 7 #93-25, Bogotá', area_m2: 380, valor_catastral: 420_000_000, propietario: 'Bogotá Capital SAS', matricula: '003-345678' },
  { direccion: 'Transv. 24 #98-80, Bogotá', area_m2: 5400, valor_catastral: 880_000_000, propietario: 'Bogotá Capital SAS', matricula: '004-901234' },
  { direccion: 'Autopista Norte #180-50, Bogotá', area_m2: 7300, valor_catastral: 920_000_000, propietario: 'Inversora Norte LTDA', matricula: '005-567890' },
  { direccion: 'Av. 19 #119-30, Bogotá', area_m2: 4200, valor_catastral: 550_000_000, propietario: 'Empresa Test S.A.', matricula: '006-123456' },
  { direccion: 'Cll 134 #10-44, Bogotá', area_m2: 1700, valor_catastral: 280_000_000, propietario: 'Inversora Norte LTDA', matricula: '007-789012' },
  { direccion: 'Cra. 15 #126-10, Bogotá', area_m2: 3100, valor_catastral: 470_000_000, propietario: 'Bogotá Capital SAS', matricula: '008-345678' },
  { direccion: 'Av. Suba #123-30, Bogotá', area_m2: 2100, valor_catastral: 340_000_000, propietario: 'Empresa Test S.A.', matricula: '009-901234' },
  { direccion: 'Diagonal 92 #18-25, Bogotá', area_m2: 820, valor_catastral: 210_000_000, propietario: 'Inversora Norte LTDA', matricula: '010-567890' },
  { direccion: '