/**
 * Radar 360 — Simulation Server
 * REST /convocatorias  →  full mock dataset
 * WS  /ws/live_radar   →  live updates every 4s
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 8000;
const BROADCAST_MS = 4000;
const NEW_ITEM_EVERY = 5; // broadcast a genuinely new entry every 5 cycles

/* ──────────────────────────────────────────────
   MOCK DATASET — high-fidelity Colombian projects
────────────────────────────────────────────── */
const MOCK = [
  { id: 'DNP-2026-001',   entidad: 'DNP',                         objeto: 'Optimización de infraestructura escolar rural',              region: 'Santander',            presupuesto: 2_400_000_000,  estado: 'Abierto',           fecha_cierre: '2026-07-15', sector: 'Educación' },
  { id: 'MINEDU-2026-011',entidad: 'MinEducación',                 objeto: 'Dotación de equipos tecnológicos para IES',                  region: 'Cantagallo, Bolívar',  presupuesto: 1_800_000_000,  estado: 'En Evaluación',     fecha_cierre: '2026-06-20', sector: 'Educación' },
  { id: 'KUS-2026-003',   entidad: 'Cooperación Int. Kusanone',    objeto: 'Saneamiento básico y agua potable en zonas rurales',         region: 'San Pablo, Bolívar',   presupuesto:   950_000_000,  estado: 'Crítico',           fecha_cierre: '2026-06-10', sector: 'Agua Potable' },
  { id: 'SGR-2026-021',   entidad: 'SGR – Fondo Ciencia',          objeto: 'Investigación en agricultura sostenible bajo condiciones PDET',region: 'Boyacá',             presupuesto: 3_200_000_000,  estado: 'Abierto',           fecha_cierre: '2026-08-01', sector: 'Agropecuario' },
  { id: 'INVIAS-2026-007',entidad: 'INVIAS',                       objeto: 'Pavimentación vía terciaria Km 0–18 corredor Cantagallo',    region: 'Cantagallo, Bolívar',  presupuesto: 5_600_000_000,  estado: 'Próximo a vencer',  fecha_cierre: '2026-06-08', sector: 'Transporte' },
  { id: 'BIRF-2026-044',  entidad: 'Banco Mundial – BIRF',         objeto: 'Fortalecimiento de capacidades institucionales municipales', region: 'Sur de Bolívar',       presupuesto: 7_800_000_000,  estado: 'Abierto',           fecha_cierre: '2026-09-30', sector: 'Gobernanza' },
  { id: 'MINSAL-2026-019',entidad: 'MinSalud',                     objeto: 'Ampliación y dotación de puestos de salud rural',           region: 'Santander',            presupuesto: 1_250_000_000,  estado: 'En Evaluación',     fecha_cierre: '2026-07-01', sector: 'Salud' },
  { id: 'UNCT-2026-008',  entidad: 'PNUD Colombia',                objeto: 'Emprendimiento y reintegración socioeconómica PDET',        region: 'Montes de María',      presupuesto:   680_000_000,  estado: 'Abierto',           fecha_cierre: '2026-08-20', sector: 'Social' },
  { id: 'MVCT-2026-033',  entidad: 'Minvivienda',                  objeto: 'Subsidio mejoramiento de vivienda rural y urbano',          region: 'Cantagallo, Bolívar',  presupuesto: 2_100_000_000,  estado: 'Abierto',           fecha_cierre: '2026-07-28', sector: 'Vivienda' },
  { id: 'COLC-2026-055',  entidad: 'MinCiencias',                  objeto: 'Jóvenes investigadores en territorios ZOMAC',              region: 'Santander',            presupuesto:   420_000_000,  estado: 'Crítico',           fecha_cierre: '2026-06-12', sector: 'Ciencia' },
  { id: 'APC-2026-017',   entidad: 'APC Colombia',                 objeto: 'Cooperación técnica en gestión del riesgo de desastres',    region: 'Nacional',             presupuesto: 1_500_000_000,  estado: 'Abierto',           fecha_cierre: '2026-10-15', sector: 'Gestión Riesgo' },
  { id: 'MSPS-2026-002',  entidad: 'Prosperidad Social',           objeto: 'Transferencias monetarias condicionadas 2026-II',           region: 'Sur de Bolívar',       presupuesto: 4_300_000_000,  estado: 'En Evaluación',     fecha_cierre: '2026-06-30', sector: 'Social' },
];

let catalog = [...MOCK];
let cycleCount = 0;
let syntheticIdx = 1;

const ESTADOS = ['Abierto', 'En Evaluación', 'Crítico', 'Próximo a vencer'];
const ENTIDADES_SIM = ['DNP', 'MinHacienda', 'Cooperación GIZ', 'ADB', 'BID - FOMIN'];
const OBJETOS_SIM = [
  'Rehabilitación de acueducto veredal',
  'Implementación de energía solar fotovoltaica',
  'Construcción de módulos sanitarios escolares',
  'Fortalecimiento cadenas productivas locales',
  'Digitalización de registros civiles municipales',
];
const REGIONES_SIM = ['Santander', 'Cantagallo, Bolívar', 'San Pablo, Bolívar', 'Sur de Bolívar', 'Chocó', 'Putumayo'];

/* ── Helpers ── */
const fmt = (n) => `$${n.toLocaleString('es-CO')}`;

const broadcast = (wss, payload) => {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
};

/* ── HTTP Server ── */
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/convocatorias') {
    res.writeHead(200);
    res.end(JSON.stringify(catalog.map(d => ({ ...d, presupuesto: fmt(d.presupuesto) }))));
    return;
  }
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'Radar 360 Sim — Online', entries: catalog.length }));
    return;
  }
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

/* ── WebSocket Server ── */
const wss = new WebSocketServer({ server, path: '/ws/live_radar' });

wss.on('connection', (ws) => {
  console.log(`[WS] Client connected (total: ${wss.clients.size})`);
  ws.send(JSON.stringify({
    event: 'INITIAL_DATA',
    data: catalog.map(d => ({ ...d, presupuesto: fmt(d.presupuesto) })),
  }));
  ws.on('close', () => console.log(`[WS] Client disconnected (total: ${wss.clients.size})`));
});

/* ── Broadcast loop every 4 seconds ── */
setInterval(() => {
  cycleCount++;

  if (cycleCount % NEW_ITEM_EVERY === 0) {
    /* ── NEW item ── */
    const raw = Math.floor(Math.random() * 900_000_000) + 300_000_000;
    const newItem = {
      id:           `SIM-2026-${String(100 + syntheticIdx++).padStart(3,'0')}`,
      entidad:      ENTIDADES_SIM[Math.floor(Math.random() * ENTIDADES_SIM.length)],
      objeto:       OBJETOS_SIM[Math.floor(Math.random() * OBJETOS_SIM.length)],
      region:       REGIONES_SIM[Math.floor(Math.random() * REGIONES_SIM.length)],
      presupuesto:  fmt(raw),
      estado:       'Abierto',
      fecha_cierre: `2026-${String(7 + Math.floor(Math.random()*3)).padStart(2,'0')}-${String(1 + Math.floor(Math.random()*28)).padStart(2,'0')}`,
      sector:       ['Educación','Salud','Transporte','Social'][Math.floor(Math.random()*4)],
    };
    catalog.unshift(newItem);
    console.log(`[SIM] NEW item: ${newItem.id}`);
    broadcast(wss, { event: 'NEW_FUND_DETECTED', data: newItem });
  } else {
    /* ── STATUS update on random existing item ── */
    const target = catalog[Math.floor(Math.random() * catalog.length)];
    const newEstado = ESTADOS[Math.floor(Math.random() * ESTADOS.length)];
    const updated = { ...target, presupuesto: typeof target.presupuesto === 'number' ? fmt(target.presupuesto) : target.presupuesto, estado: newEstado };
    // patch catalog
    const idx = catalog.findIndex(d => d.id === target.id);
    if (idx >= 0) catalog[idx] = { ...catalog[idx], estado: newEstado };
    console.log(`[SIM] STATUS_UPDATE ${updated.id} → ${newEstado}`);
    broadcast(wss, { event: 'STATUS_UPDATE', data: updated });
  }
}, BROADCAST_MS);

/* ── Start ── */
server.listen(PORT, () => {
  console.log(`\n🚀 Radar 360 Sim Server  →  http://localhost:${PORT}`);
  console.log(`📡 WebSocket Live Feed   →  ws://localhost:${PORT}/ws/live_radar`);
  console.log(`📊 REST Endpoint         →  GET http://localhost:${PORT}/convocatorias`);
  console.log(`⏱  Broadcasting every ${BROADCAST_MS}ms (NEW every ${NEW_ITEM_EVERY} cycles)\n`);
});
