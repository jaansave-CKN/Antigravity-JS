import express    from 'express';
import cors       from 'cors';
import path       from 'path';
import http       from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath }   from 'url';
import fs          from 'fs';
import dotenv      from 'dotenv';
import Anthropic   from '@anthropic-ai/sdk';

// ── Módulos internos Antigravity OS ───────────────────────────────────────────
import { BrevoEmailAdapter }         from './src/modules/communications/infrastructure/BrevoEmailAdapter.js';
import { SendEmailUseCase }          from './src/modules/communications/application/SendEmailUseCase.js';
import { createCommunicationRouter } from './src/modules/communications/infrastructure/CommunicationRouter.js';
import { createGitHubRouter }        from './skills/ingenieria/GitHubRouter.js';
import { createFormuladorRouter }    from './src/modules/formulador/FormuladorRouter.js';
import { AuditLogger }               from './src/shared/infrastructure/AuditLogger.js';
import { cacheInfo, cacheGet, cacheSet } from './src/shared/infrastructure/cache.js';
import { issueToken, verifyToken, revokeSession, sessionStats, checkQuota, burstLimiter } from './src/shared/infrastructure/session-manager.js';
import './src/shared/infrastructure/FirebaseAdmin.js';
import { verifyFirebaseAuth }        from './src/shared/infrastructure/FirebaseAuthMiddleware.js';
import { validateBody, schemas }     from './src/shared/infrastructure/validation.js';
import { m1Router, runM1Pipeline }   from './src/modules/radar/m1Pipeline.js';
import './scripts/generar_reporte.cjs'; // regenera public/estado_antigravity.json con inventario real de agents/ al arrancar + cada 10 min

dotenv.config();

// ── Configuración central ─────────────────────────────────────────────────────
// Agnosticismo de modelo: un solo punto de verdad vía env var — al salir una
// versión superior de Claude, se escala cambiando PRIMARY_AI_MODEL en .env/Render,
// sin tocar código. Fallback = el modelo verificado en producción hoy (2026-08-07).
const CLAUDE_MODEL = process.env.PRIMARY_AI_MODEL || 'claude-sonnet-4-6';
const PORT         = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DIST_DIR   = path.join(__dirname, 'dist');

// ── Cliente Anthropic (singleton) ─────────────────────────────────────────────
let _anthropic = null;
function getAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY no configurada.');
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ── Datos iniciales convocatorias (en-memoria, reemplazar con DB cuando esté lista) ──
const CONVOCATORIAS_SEED = [
  { id:'C001', entidad:'SGR - Regalías',           objeto:'Infraestructura vial rural',            monto:'COP 2.500M', sector:'Transporte',      region:'Nacional',   status:'Abierta',  fechaCierre:'2026-09-30' },
  { id:'C002', entidad:'MinVivienda',               objeto:'Acueductos y alcantarillado PDET',      monto:'COP 1.800M', sector:'Agua Potable',    region:'PDET',       status:'Abierta',  fechaCierre:'2026-08-15' },
  { id:'C003', entidad:'Minciencias',               objeto:'I+D+i Agropecuario',                    monto:'COP 900M',   sector:'Agropecuario',    region:'Nacional',   status:'Próxima',  fechaCierre:'2026-10-01' },
  { id:'C004', entidad:'MinTIC',                    objeto:'Conectividad rural - Zonas Digitales',  monto:'COP 500M',   sector:'Tecnología',      region:'Rural',      status:'Abierta',  fechaCierre:'2026-07-31' },
  { id:'C005', entidad:'INVIAS',                    objeto:'Rehabilitación puentes vehiculares',    monto:'COP 3.200M', sector:'Transporte',      region:'Nacional',   status:'Abierta',  fechaCierre:'2026-11-30' },
  { id:'C006', entidad:'BID - Colombia',            objeto:'Desarrollo urbano sostenible',          monto:'USD 15M',    sector:'Vivienda',        region:'Ciudades',   status:'Próxima',  fechaCierre:'2026-12-01' },
  { id:'C007', entidad:'USAID',                     objeto:'Desarrollo alternativo ZOMAC',          monto:'USD 8M',     sector:'Desarrollo',      region:'ZOMAC',      status:'Abierta',  fechaCierre:'2026-09-15' },
  { id:'C008', entidad:'SGP - Educación',           objeto:'Mejoramiento infraestructura escolar',  monto:'COP 1.200M', sector:'Educación',       region:'Municipal',  status:'Abierta',  fechaCierre:'2026-08-31' },
];

// Estado en memoria del radar (mutable por WS)
let radarData = [...CONVOCATORIAS_SEED];

// ── Express App ───────────────────────────────────────────────────────────────
const app        = express();
const httpServer = http.createServer(app);

// ── 1. MIDDLEWARES ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5000,http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origen no permitido (${origin})`));
  },
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json());

// Perímetro de autenticación — se evalúa ANTES de cualquier handler /api/*.
// Whitelist explícita de rutas públicas; todo lo demás bajo /api/ exige Firebase token.
const PUBLIC_API_PREFIXES = ['/api/health', '/api/convocatorias', '/api/session'];
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const isPublic = PUBLIC_API_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (isPublic) return next();
  return verifyFirebaseAuth(req, res, next);
});

// Rate limit por ráfaga — corre después del gate de auth (req.user ya está poblado si
// aplica) sobre todo /api/*, autenticado o público. Distinto de checkQuota (cuota diaria
// de IA): esto protege contra ráfagas cortas en cualquier endpoint, no solo los de IA.
app.use('/api', burstLimiter);

// ── 2. ENDPOINTS /api/* (ANTES de archivos estáticos) ─────────────────────────

// Convocatorias REST — reemplaza el endpoint de FastAPI en producción
app.get('/api/convocatorias', (_req, res) => {
  console.log('[GET] /api/convocatorias → total:', radarData.length);
  res.json(radarData);
});

// IA Central — Claude proxy (formato OpenAI-compatible)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, max_tokens = 4096 } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Se requiere messages[] con al menos un elemento.' });
    }
    const quota = checkQuota(req.user?.uid ?? 'anonymous');
    if (!quota.allowed) {
      return res.status(429).json({ error: 'Cuota diaria de consultas a IA agotada.', resetAt: quota.resetAt });
    }
    const client       = getAnthropic();
    const systemMsg    = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const response     = await client.messages.create({
      model: CLAUDE_MODEL, max_tokens,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: chatMessages,
    });
    const reply = response.content[0]?.text ?? '';
    AuditLogger.log('CLAUDE_CHAT_SUCCESS', { model: CLAUDE_MODEL, tokens: response.usage?.input_tokens });
    res.json({
      choices: [{ message: { role: 'assistant', content: reply }, finish_reason: response.stop_reason }],
      usage:   response.usage,
      model:   CLAUDE_MODEL,
    });
  } catch (err) {
    AuditLogger.log('CLAUDE_CHAT_ERROR', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// MCP Infrastructure
app.get('/api/mcp', async (_req, res) => {
  try {
    const userProfile  = process.env.USERPROFILE || 'C:\\Users\\Usuario';
    const appData      = process.env.APPDATA || path.join(userProfile, 'AppData', 'Roaming');
    const pathsToTry   = [
      process.env.MCP_CONFIG_PATH,
      path.join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json'),
      path.join(userProfile, '.claude', 'antigravity', 'mcp_config.json'),
      path.join(__dirname, 'config', 'mcp_config.json'),
    ].filter(Boolean);
    let mergedConfig   = { mcpServers: {} };
    const sources      = [];
    const scanResults  = await Promise.all(pathsToTry.map(async p => {
      try {
        if (!fs.existsSync(p)) return null;
        const config = JSON.parse((await fs.promises.readFile(p, 'utf8')).replace(/^﻿/, ''));
        return { path: p, servers: config.mcpServers || {} };
      } catch { return null; }
    }));
    scanResults.forEach(r => {
      if (!r?.servers) return;
      for (const [name, details] of Object.entries(r.servers)) mergedConfig.mcpServers[name] = { ...details, _source: r.path };
      sources.push(path.basename(r.path));
    });
    if (Object.keys(mergedConfig.mcpServers).length === 0) return res.status(404).json({ error: 'No MCP nodes found' });
    res.json({ ...mergedConfig, loadedFrom: sources.join(' + ') });
  } catch { res.status(500).json({ error: 'Critical MCP load failure' }); }
});

// M1 Pipeline — protegido por el gate universal /api/* (ver línea ~65)
app.use('/api/radar', m1Router);

// =============================================================================
// SESSION MANAGER — JWT propio (complementa Firebase Auth)
// =============================================================================

// POST /api/session/login — intercambia Firebase ID token por JWT propio
app.post('/api/session/login', validateBody(schemas.sessionLogin), async (req, res) => {
  try {
    const { firebaseToken } = req.body;
    const admin   = (await import('./src/shared/infrastructure/FirebaseAdmin.js')).default;
    const decoded = await admin.auth().verifyIdToken(firebaseToken);
    const session = await issueToken(decoded.uid, decoded.role || 'user', { email: decoded.email });
    AuditLogger.log('SESSION_LOGIN', { uid: decoded.uid });
    res.json({ ...session, uid: decoded.uid, email: decoded.email });
  } catch (err) {
    res.status(401).json({ error: 'Firebase token inválido', detail: err.message });
  }
});

// POST /api/session/verify — verifica JWT propio
app.post('/api/session/verify', validateBody(schemas.sessionVerify), async (req, res) => {
  try {
    const { token } = req.body;
    const payload = await verifyToken(token);
    res.json({ valid: true, payload });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.message });
  }
});

// DELETE /api/session/:sessionId — revocar sesión (requiere ser el dueño o admin)
app.delete('/api/session/:sessionId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de sesión requerido para revocar' });
  }
  let requester;
  try {
    requester = await verifyToken(authHeader.split('Bearer ')[1]);
  } catch (err) {
    return res.status(401).json({ error: 'Token de sesión inválido o expirado', detail: err.message });
  }
  const result = await revokeSession(req.params.sessionId, requester);
  if (!result.revoked) {
    const status = result.reason === 'NOT_FOUND' ? 404 : 403;
    return res.status(status).json({ revoked: false, reason: result.reason, sessionId: req.params.sessionId });
  }
  res.json({ revoked: true, sessionId: req.params.sessionId });
});

// Ping real a Claude, cacheado — GET /api/health es público (sin auth, ver
// PUBLIC_API_PREFIXES) y es el healthCheckPath de Render (render.yaml), así que
// se sondea constantemente. Sin caché, cada sondeo gastaría saldo real de la
// cuenta de Anthropic solo por monitoreo. Antes este check solo confirmaba que
// ANTHROPIC_API_KEY existiera como variable, nunca que la API respondiera — así
// fue como el saldo agotado (2026-08-07) pasó "healthy" durante horas sin que
// nada lo detectara (ver docs/INFORME_RECONCILIACION_CIERRE_2026-08-07.md §1).
const HEALTH_PING_TTL_SEC = 120;
const HEALTH_PING_KEY     = 'health:claude_ping';

async function pingClaude() {
  const cached = await cacheGet(HEALTH_PING_KEY);
  if (cached) return cached;

  let result;
  if (!process.env.ANTHROPIC_API_KEY) {
    result = { ok: false, label: '⚠️  ANTHROPIC_API_KEY ausente' };
  } else {
    try {
      await getAnthropic().messages.create({
        model: CLAUDE_MODEL, max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      result = { ok: true, label: '✅ operativo (ping real)' };
    } catch (err) {
      const sinSaldo = err?.status === 400 && /credit balance/i.test(err?.message || '');
      result = { ok: false, label: sinSaldo ? '🔴 saldo de cuenta agotado' : `🔴 fallo real: ${err.message}` };
      console.error('[Health] Ping real a Claude falló:', err.message);
    }
  }
  await cacheSet(HEALTH_PING_KEY, result, HEALTH_PING_TTL_SEC);
  return result;
}

// GET /api/health — health check completo del sistema
app.get('/api/health', async (_req, res) => {
  const tavilyOk  = !!process.env.TAVILY_API_KEY;
  const jwtOk     = !!process.env.JWT_SECRET;
  const sbUrl     = process.env.SUPABASE_URL;
  const sbKey     = process.env.SUPABASE_SERVICE_KEY;

  let dbPing = false;
  if (sbUrl && sbKey) {
    try {
      const r = await fetch(`${sbUrl}/rest/v1/formulador_proyectos?limit=0`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      });
      dbPing = r.ok || r.status === 404; // 404 = tabla no existe pero la conexión funciona
    } catch { dbPing = false; }
  }

  const claudePing = await pingClaude();
  const status     = claudePing.ok && tavilyOk && dbPing ? 'healthy' : 'degradado';
  // 503 solo cuando el ping real (no solo la config) falló — señal fuerte de que
  // el motor pago está genuinamente roto, no solo que falte una pieza opcional.
  const httpStatus = status === 'healthy' ? 200 : (claudePing.ok ? 206 : 503);

  res.status(httpStatus).json({
    status,
    timestamp:   new Date().toISOString(),
    services: {
      claude:      claudePing.label,
      tavily:      tavilyOk ? '✅ configurado' : '⚠️  TAVILY_API_KEY ausente',
      supabase:    dbPing   ? '✅ Supabase OK' : (sbUrl ? '⚠️  ping falló' : '⚠️  SUPABASE_URL ausente'),
      jwt:         jwtOk    ? '✅ configurado' : '⚠️  JWT_SECRET ausente',
    },
    cache:    cacheInfo(),
    sessions: sessionStats(),
  });
});

// ── Rutas protegidas (el gate universal de la línea ~65 ya exige Firebase token aquí) ──
const emailAdapter     = new BrevoEmailAdapter(process.env.BREVO_API_KEY, process.env.BREVO_SENDER_EMAIL);
const sendEmailUseCase = new SendEmailUseCase(emailAdapter);
app.use('/api',            createCommunicationRouter(sendEmailUseCase));
app.use('/api/github',     createGitHubRouter());
app.use('/api/formulador', createFormuladorRouter());

app.post('/api/execute', validateBody(schemas.execute), (req, res) => {
  const { user, action } = req.body;
  AuditLogger.log('FORMAL_ORDER', { user, action });
  res.json({ status: 'SUCCESS' });
});

// ── 3. ARCHIVOS ESTÁTICOS (build de Vite) ────────────────────────────────────
app.use(express.static(DIST_DIR));

// ── 4. SPA CATCH-ALL — React Router (DEBE ir al final) ───────────────────────
app.get('*', (_req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // En desarrollo local sin build, informar al usuario
    res.status(404).send('Frontend no compilado. Ejecuta: npm run build');
  }
});

// ── WebSocket Server — Radar Live (reemplaza FastAPI en producción) ───────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws/live_radar' });

function broadcastRadar(event, data) {
  const payload = JSON.stringify({ event, data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', (ws) => {
  console.log('[WS] Cliente conectado. Total:', wss.clients.size);
  // Enviar snapshot inicial
  ws.send(JSON.stringify({ event: 'INITIAL_DATA', data: radarData }));
  ws.on('close', () => console.log('[WS] Cliente desconectado. Total:', wss.clients.size));
  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

// ── Feed "Live" real — cron único de baja frecuencia para todo el sistema ──────
// Oleada 2, Grupo Elite (2026-08-06). Reemplaza el setInterval simulado anterior
// (cicla el seed con estado aleatorio, marcado _simulado:true) por una llamada
// real a m1Pipeline.js (Claude+Tavily), compartida entre todos los clientes
// conectados — un pipeline sirve a N usuarios, no uno por conexión. Reutiliza el
// cache dual de 24h ya existente en m1Pipeline.js: si el cron corre más seguido
// que la vigencia del cache, la 2ª corrida es gratis (cache HIT), no una llamada
// nueva a Claude/Tavily. Cadencia configurable — sin tráfico real que justifique
// algo distinto de un setInterval simple (ver docs/RADFOR360_ARQUITECTURA_OPTIMIZACION.md §2).
const RADAR_CRON_HOURS = Number(process.env.RADAR_CRON_HOURS) || 6;
const RADAR_CRON_QUERY = 'oportunidades y convocatorias de inversión pública vigentes en Colombia';

function slugId(entidad, titulo) {
  return `${entidad}-${titulo}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

async function refreshRadarLive() {
  if (wss.clients.size === 0) {
    console.log('[Radar Cron] Sin clientes conectados — se omite esta corrida (cero costo).');
    return;
  }
  try {
    console.log('[Radar Cron] Ejecutando m1Pipeline compartido...');
    const { oportunidades, fromCache } = await runM1Pipeline({ query: RADAR_CRON_QUERY, filters: {} });
    console.log(`[Radar Cron] ${oportunidades.length} oportunidades (${fromCache ? 'cache' : 'IA en vivo'})`);

    for (const op of oportunidades) {
      const id = slugId(op.entidad || 'entidad', op.titulo || 'oportunidad');
      const item = {
        id, entidad: op.entidad || 'Por confirmar', objeto: op.titulo || 'Por confirmar',
        monto: op.monto || 'Por confirmar', sector: op.sector || 'Multisectorial',
        region: op.cobertura || 'Nacional', status: 'Abierta', fechaCierre: op.fechaCierre || 'Por confirmar',
        _ts: Date.now(),
      };
      const idx = radarData.findIndex(r => r.id === id);
      const isNew = idx < 0;
      if (isNew) radarData.unshift(item); else radarData[idx] = item;
      broadcastRadar(isNew ? 'NEW_FUND_DETECTED' : 'STATUS_UPDATE', item);
    }
  } catch (err) {
    console.error('[Radar Cron] Falló la corrida:', err.message);
  }
}

setInterval(refreshRadarLive, RADAR_CRON_HOURS * 60 * 60 * 1000);

// ── Arranque ──────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  const claudeOk = !!process.env.ANTHROPIC_API_KEY;
  const dbOk     = !!process.env.DATABASE_URL;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Antigravity OS — Backend Express v9.0');
  console.log('  Motor de IA: Claude / Anthropic (soberanía total)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Puerto      : http://localhost:${PORT}`);
  console.log(`  Modelo      : ${CLAUDE_MODEL}`);
  console.log(`  Claude API  : ${claudeOk ? '✅ Configurada' : '⚠️  ANTHROPIC_API_KEY ausente'}`);
  console.log(`  Database    : ${dbOk     ? '✅ Definida'    : '⚠️  Sin credenciales PostgreSQL'}`);
  console.log(`  Firebase    : ✅ Inicializado`);
  console.log(`  WebSocket   : ✅ ws://localhost:${PORT}/ws/live_radar`);
  console.log(`  Static      : ${fs.existsSync(DIST_DIR) ? '✅ dist/ encontrado' : '⚠️  dist/ ausente — ejecuta npm run build'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
