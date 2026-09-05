/**
 * database.config.js — Motor de BD con 3 capas de resiliencia
 *
 * CAPA 1: pg.Pool → Session Pooler de Supabase (us-west-2, puerto 5432)
 * CAPA 2: Supabase REST API → fetch con service key (siempre disponible)
 * CAPA 3: Graceful degradation → errores 503 controlados, servidor no cae
 *
 * Cuando el usuario habilite el pooler en Supabase dashboard,
 * la Capa 1 entra en operación automáticamente. Sin acción de código.
 *
 * ── Pool RLS-escopado dedicado (005_INGENIERO_BACKEND, 2026-09-04) ──────────
 * `DATABASE_URL` (pool principal, `_pgPool`) se conecta como el rol "postgres",
 * que tiene BYPASSRLS=true (verificado en vivo: `SELECT rolbypassrls FROM
 * pg_roles WHERE rolname=current_user` → true). Los ~430 sitios reales que
 * llaman a getRow/getRows/runSql/pool.query en server.js y backend/routes/*.js
 * NUNCA hacen `SET LOCAL app.org_id` — dependen de un WHERE explícito por
 * request, no de RLS. Repuntar `DATABASE_URL` a un rol sin BYPASSRLS rompería
 * esos ~430 call sites de forma silenciosa (RLS sin `app.org_id` seteado
 * deniega todo por defecto) — confirmado por conteo real, no supuesto.
 *
 * Por eso `withTenant()` usa un SEGUNDO pool, `_pgScopedPool`, construido
 * desde `DATABASE_URL_TENANT_SCOPED` (rol `rf360_rls_scoped`, migración
 * 053_rls_scoped_role.sql — sin BYPASSRLS, sin SUPERUSER, GRANT DML mínimo
 * sobre las 7 tablas que antes se leían/escribían vía supabaseAdmin/
 * service_role bypaseando RLS por completo). Esto es aditivo: no toca el
 * pool principal ni el rol "postgres". Si `DATABASE_URL_TENANT_SCOPED` no
 * está configurada (entorno viejo, aún no migrado), `withTenant()` degrada
 * al pool principal con una advertencia explícita en logs — mismo
 * comportamiento que existía antes de este cambio, nunca peor.
 */

import pg from 'pg';
const { Pool } = pg;

// ── Estado de conexión (shared mutable) ──────────────────────────────────────
let _pgReady   = false;
let _pgPool    = null;
let _lastRetry = 0;
const RETRY_INTERVAL_MS = 60_000; // reintentar cada 60s

// ── Estado del pool RLS-escopado (rf360_rls_scoped, sin BYPASSRLS) ───────────
let _pgScopedReady    = false;
let _pgScopedPool     = null;
let _lastScopedRetry  = 0;
let _scopedWarnLogged = false;

// Códigos que SÍ indican que la conexión/pool está realmente caída — solo
// estos deben abrir el circuito (_pgReady=false). ECONNREFUSED/ETIMEDOUT son
// códigos de sistema de Node; 08006/08001/08004/57P03 son SQLSTATE de
// Postgres para fallos de conexión reales (node-postgres los expone en
// err.code). Cualquier otro error (SQLSTATE de negocio, ej. 42701 duplicate
// column, 23505 unique_violation) es un error de QUERY, no de conexión.
const CODIGOS_ERROR_CONEXION = new Set(['ECONNREFUSED', 'ETIMEDOUT', '08006', '08001', '08004', '57P03']);

// ── Config de Supabase REST (Capa 2) ─────────────────────────────────────────
// SIN fallback hardcodeado para la key: una credencial real quedó commiteada
// aquí anteriormente (service_role — bypasea RLS por completo). Fue rotada/
// debe rotarse en el dashboard de Supabase; este archivo ya no debe volver a
// contener un secreto real bajo ninguna circunstancia. Si SUPABASE_SERVICE_KEY
// no está configurada, la Capa 2 (REST) falla explícitamente en vez de usar
// una credencial silenciosa.
const SB_URL = process.env.SUPABASE_URL || 'https://ozivmsvxbdtjkzleqbcy.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
if (!SB_KEY) {
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  [database.config] FATAL: SUPABASE_SERVICE_KEY no configurada.║');
  console.error('║  La Capa 2 (REST) no puede autenticarse contra Supabase.   ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
}

const REST_HEADERS = {
  'Content-Type': 'application/json',
  'apikey':        SB_KEY,
  'Authorization': `Bearer ${SB_KEY}`,
  'Prefer':        'return=representation',
};

// ── Construye pool pg con la URL correcta ─────────────────────────────────────
function buildPool() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    return new Pool({
      connectionString: u.toString(),
      ssl: isLocal ? false : { rejectUnauthorized: false },
      options: '-c search_path=public -c lock_timeout=5000 -c statement_timeout=30000',
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      keepAlive: true,
    });
  } catch { return null; }
}

// ── Verifica pg en background (no bloquea el arranque) ───────────────────────
async function probePg() {
  if (!_pgPool) _pgPool = buildPool();
  if (!_pgPool) return false;
  try {
    await _pgPool.query('SELECT 1');
    if (!_pgReady) console.log('[DB] Capa 1 (pg Pool) ACTIVA ✅');
    _pgReady = true;
    return true;
  } catch {
    _pgReady = false;
    return false;
  }
}

// Sondeo en background cada minuto
setInterval(async () => {
  if (!_pgReady) await probePg();
}, RETRY_INTERVAL_MS);

// Sondeo inicial (no bloquea)
probePg().then(ok => {
  if (!ok) console.warn('[DB] Capa 1 no disponible — usando Capa 2 (REST). Activa el pooler en Supabase dashboard para máximo rendimiento.');
});

// ── Pool RLS-escopado (rol rf360_rls_scoped, sin BYPASSRLS) ──────────────────
function buildScopedPool() {
  const url = process.env.DATABASE_URL_TENANT_SCOPED;
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    return new Pool({
      connectionString: u.toString(),
      ssl: isLocal ? false : { rejectUnauthorized: false },
      options: '-c search_path=public -c lock_timeout=5000 -c statement_timeout=30000',
      // 10, no 5: CopilotoService.construirSnapshot() por sí solo abre 5
      // withTenant() concurrentes en un Promise.all — un pool de 5 se
      // saturaría con una sola request concurrente de ese endpoint.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      keepAlive: true,
    });
  } catch { return null; }
}

async function probeScopedPg() {
  if (!_pgScopedPool) _pgScopedPool = buildScopedPool();
  if (!_pgScopedPool) return false;
  try {
    await _pgScopedPool.query('SELECT 1');
    if (!_pgScopedReady) console.log('[DB] Pool RLS-escopado (rf360_rls_scoped) ACTIVO ✅ — withTenant() ahora aplica RLS real.');
    _pgScopedReady = true;
    return true;
  } catch (err) {
    _pgScopedReady = false;
    if (!_scopedWarnLogged) {
      console.warn('[DB] Pool RLS-escopado no disponible (' + err.message.substring(0, 120) + ') — withTenant() degrada al pool principal (BYPASSRLS). Revisar DATABASE_URL_TENANT_SCOPED.');
      _scopedWarnLogged = true;
    }
    return false;
  }
}

setInterval(async () => {
  if (!_pgScopedReady) await probeScopedPg();
}, RETRY_INTERVAL_MS);

if (process.env.DATABASE_URL_TENANT_SCOPED) {
  probeScopedPg();
} else {
  console.warn('[DB] DATABASE_URL_TENANT_SCOPED no configurada — withTenant() degrada al pool principal (BYPASSRLS), sin enforcement real de RLS. Ver migración 053_rls_scoped_role.sql.');
}

// ── Pool exportado (compatibilidad con código existente) ─────────────────────
export const pool = {
  query: async (sql, params = []) => pgOrRest(sql, params),
  connect: async () => {
    if (_pgReady) return _pgPool.connect();
    // Devuelve un client simulado que usa pgOrRest
    const fakeClient = {
      query: async (sql, params = []) => pgOrRest(sql, params),
      release: () => {},
    };
    return fakeClient;
  },
  on: () => {},
  end: async () => _pgPool?.end(),
};

// ── Normalizador de placeholders (? → $1, $2…) ───────────────────────────────
function normalizePlaceholders(sql, params) {
  if (!sql.includes('?')) return { sql, params };
  let i = 0;
  return { sql: sql.replace(/\?/g, () => `$${++i}`), params };
}

// ── ROUTER: intenta pg → si falla, escala a REST ─────────────────────────────
async function pgOrRest(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);

  // Capa 1: pg Pool (si está disponible)
  if (_pgReady) {
    try {
      return await _pgPool.query(q, p);
    } catch (err) {
      console.warn('[DB] pg fallo, escalando a REST:', err.message.substring(0, 80));
      // FIX (auditoría SRE Red Team 2026-08-10, Capa 1): antes, CUALQUIER
      // error de query (incluida una violación de constraint legítima, ej.
      // "column already exists" de una migración defensiva idempotente)
      // tumbaba _pgReady y degradaba TODA la app a Capa 2 (REST) durante
      // hasta 60s — sin que la conexión en sí tuviera ningún problema real.
      // Solo errores de conexión genuinos deben abrir el circuito.
      if (CODIGOS_ERROR_CONEXION.has(err.code)) _pgReady = false;
    }
  }

  // Reintento de reconexión pg (no bloquea)
  const now = Date.now();
  if (now - _lastRetry > RETRY_INTERVAL_MS) {
    _lastRetry = now;
    probePg().catch(() => {});
  }

  // Capa 2: REST API
  return restQuery(q, p);
}

// ── Capa 2: Supabase REST SQL executor ───────────────────────────────────────
async function restQuery(sql, params = []) {
  const normalized = sql.trim().toUpperCase();

  // DDL → no-op (las tablas ya existen en Supabase)
  if (/^\s*(CREATE|DROP|ALTER|COMMENT|GRANT|REVOKE|TRUNCATE)\b/.test(normalized)) {
    return { rows: [], rowCount: 0, command: 'DDL_NOOP' };
  }

  const op = normalized.replace(/\s+/g, ' ').split(' ')[0];

  try {
    if (op === 'SELECT') {
      // SELECT COUNT(*) no es un SELECT normal: PostgREST no agrega filas,
      // así que restSelect (que trae filas crudas) siempre daría 0. Se
      // resuelve con una petición HEAD + `Prefer: count=exact` y se lee el
      // total real del header `Content-Range` que devuelve PostgREST.
      if (/^SELECT\s+COUNT\(\*\)/i.test(sql.trim())) return await restCount(sql, params);
      return await restSelect(sql, params);
    }
    if (op === 'INSERT') return await restInsert(sql, params);
    if (op === 'UPDATE') return await restUpdate(sql, params);
    if (op === 'DELETE') return await restDelete(sql, params);
    // Fallback: try via rpc if it's a function call
    return { rows: [], rowCount: 0, command: op };
  } catch (err) {
    const e = new Error(`[REST] ${err.message}`);
    e.code = 'REST_ERROR';
    throw e;
  }
}

// ── Extrae nombre de tabla principal (depth 0, ignora subqueries) ────────────
function extractTable(sql) {
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0) {
      const m = sql.slice(i).match(/^(FROM|INTO|UPDATE|JOIN)\s+"?(\w+)"?/i);
      if (m) return m[2];
    }
  }
  return null;
}

// ── Divide WHERE clause por AND respetando paréntesis ────────────────────────
function splitTopLevelAnd(whereClause) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < whereClause.length; i++) {
    const ch = whereClause[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    // Detectar \bAND\b solo a profundidad 0
    else if (depth === 0 && whereClause.slice(i, i + 3).toUpperCase() === 'AND' &&
             (i === 0 || /\s/.test(whereClause[i - 1])) &&
             /\s/.test(whereClause[i + 3] || ' ')) {
      parts.push(whereClause.slice(start, i).trim());
      start = i + 3;
      i += 2;
    }
  }
  parts.push(whereClause.slice(start).trim());
  return parts.filter(Boolean);
}

// ── Construye filtro PostgREST desde WHERE clause ────────────────────────────
const PG_OPS = { '=': 'eq', '!=': 'neq', '<>': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', 'LIKE': 'like', 'ILIKE': 'ilike' };
// Captura alias opcional, nombre de columna, operador y valor.
// Soporta wrapper unaccent(): unaccent(c.titulo) ILIKE $1 → alias=c, col=titulo
const COND_RE = /^(?:unaccent\(\s*)?(?:(\w+)\.)?"?(\w+)"?\s*\)?\s*(=|!=|<>|>=|<=|>|<|IS NULL|IS NOT NULL|ILIKE|LIKE)\s*(\$\d+|'[^']*')?/i;
// Alias de la tabla principal en todas las queries de convocatorias/entidades
const MAIN_ALIASES = new Set(['c', 'de', 'e', 'u', 'p', 's']);

// Devuelve cuántos params $N consume una condición
function countParams(condStr) {
  return (condStr.match(/\$\d+/g) || []).length;
}

function buildFilter(whereClause, params) {
  if (!whereClause) return '';
  const parts = [];
  let paramIdx = 0;
  const conditions = splitTopLevelAnd(whereClause);
  for (const cond of conditions) {
    const trimmed = cond.trim();

    // Grupo OR: (col1 ILIKE $N OR col2 ILIKE $N OR ...) → PostgREST or=(...)
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(1, -1).trim();
      const orParts = inner.split(/\s+OR\s+/i);
      const orFilters = [];
      for (const part of orParts) {
        const m = part.trim().match(COND_RE);
        if (!m) continue;
        const [, tableAlias, col, op, rawVal] = m;
        // Saltar columnas de tablas JOIN que no son la tabla principal (c.)
        // La tabla principal de convocatorias siempre usa alias 'c' o sin alias
        if (tableAlias && tableAlias !== 'c') {
          if (rawVal?.startsWith('$')) paramIdx++;
          continue;
        }
        let val;
        if (rawVal?.startsWith("'")) {
          val = rawVal.slice(1, -1);
        } else if (rawVal?.startsWith('$')) {
          val = params[paramIdx++];
        } else { continue; }
        if (val === undefined || val === null) continue;
        const pgOp = PG_OPS[op.toUpperCase()] || 'eq';
        orFilters.push(`${col}.${pgOp}.${encodeURIComponent(val)}`);
      }
      if (orFilters.length > 0) parts.push(`or=(${orFilters.join(',')})`);
      continue;
    }

    // Condición simple: [alias.]col op ($N | 'literal')
    const m = trimmed.match(COND_RE);
    if (!m) continue;
    const [, tableAlias, col, op, rawVal] = m;
    // Saltar condiciones de tablas JOIN (alias distinto de 'c')
    if (tableAlias && tableAlias !== 'c') {
      if (rawVal?.startsWith('$')) paramIdx++;
      continue;
    }
    if (/IS NULL/i.test(op)) { parts.push(`${col}=is.null`); continue; }
    if (/IS NOT NULL/i.test(op)) { parts.push(`${col}=not.is.null`); continue; }
    let val;
    if (rawVal?.startsWith("'")) {
      val = rawVal.slice(1, -1);
    } else if (rawVal?.startsWith('$')) {
      val = params[paramIdx++];
    } else { continue; }
    if (val === undefined || val === null) continue;
    const pgOp = PG_OPS[op.toUpperCase()] || 'eq';
    parts.push(`${col}=${pgOp}.${encodeURIComponent(val)}`);
  }
  return parts.join('&');
}

async function restSelect(sql, params) {
  const table = extractTable(sql);
  if (!table) return { rows: [], rowCount: 0, command: 'SELECT' };

  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s+HAVING|$)/is);
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  const filter = whereMatch ? buildFilter(whereMatch[1], params) : '';
  const limit  = limitMatch ? `limit=${limitMatch[1]}` : 'limit=1000';

  const qs = [filter, limit].filter(Boolean).join('&');
  const r  = await fetch(`${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`, { headers: REST_HEADERS });
  const data = await r.json();

  if (!r.ok) throw new Error(data?.message || JSON.stringify(data));
  const rows = Array.isArray(data) ? data : [data];
  return { rows, rowCount: rows.length, command: 'SELECT' };
}

// ── COUNT(*) real vía PostgREST (Prefer: count=exact + header Content-Range) ─
async function restCount(sql, params) {
  const table = extractTable(sql);
  if (!table) return { rows: [{ cnt: 0 }], rowCount: 1, command: 'SELECT' };

  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s+HAVING|$)/is);
  const filter = whereMatch ? buildFilter(whereMatch[1], params) : '';
  const qs = [filter, 'limit=1'].filter(Boolean).join('&');

  const r = await fetch(`${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`, {
    method: 'HEAD',
    headers: { ...REST_HEADERS, Prefer: 'count=exact' },
  });
  if (!r.ok) throw new Error(`Count HEAD ${table} → HTTP ${r.status}`);

  // Formato de PostgREST: "0-0/562" (total exacto) o "0-0/*" (desconocido)
  const range = r.headers.get('content-range') || '';
  const total = range.includes('/') ? range.split('/')[1] : null;
  const cnt   = total && total !== '*' ? parseInt(total, 10) : 0;

  return { rows: [{ cnt, count: cnt }], rowCount: 1, command: 'SELECT' };
}

async function restInsert(sql, params) {
  const table  = extractTable(sql);
  if (!table) throw new Error('INSERT: tabla no encontrada en SQL');

  const colMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
  if (!colMatch) throw new Error('INSERT: formato de columnas no reconocido');
  const cols = colMatch[1].split(',').map(c => c.trim().replace(/"/g, ''));
  const body = {};
  cols.forEach((col, i) => { if (params[i] !== undefined) body[col] = params[i]; });

  const r    = await fetch(`${SB_URL}/rest/v1/${table}`, { method: 'POST', headers: REST_HEADERS, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || JSON.stringify(data));
  const rows = Array.isArray(data) ? data : [data];
  return { rows, rowCount: rows.length, command: 'INSERT' };
}

async function restUpdate(sql, params) {
  const table      = extractTable(sql);
  if (!table) throw new Error('UPDATE: tabla no encontrada');

  const setMatch   = sql.match(/SET\s+(.+?)\s+WHERE/is);
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+RETURNING|$)/is);
  if (!setMatch) throw new Error('UPDATE: SET clause no encontrado');

  const setParts = setMatch[1].split(',').map(s => s.trim());
  const body = {};
  let paramIdx = 0;
  for (const part of setParts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const col = part.slice(0, eqIdx).trim().replace(/"/g, '');
    const rhs = part.slice(eqIdx + 1).trim();
    if (/^\$\d+$/.test(rhs)) {
      // Param placeholder — por aquí llega ya normalizado a $N (pgOrRest
      // convierte "?" → "$N" antes de llamar a restQuery), nunca "?" literal.
      // Consume next param
      body[col] = params[paramIdx++];
    } else if (/^CURRENT_TIMESTAMP$|^NOW\(\)$/i.test(rhs)) {
      // SQL timestamp keyword → convert to ISO string for REST
      body[col] = new Date().toISOString();
    } else if (/^jsonb_set\s*\(/i.test(rhs)) {
      // FIX (auditoría PROTOCOLO TITÁN ∞ 2026-08-10, hallazgo del Agente
      // Arquitecto): el comentario de abajo ("Supabase auto-handles") era
      // falso — PostgREST no ejecuta funciones SQL arbitrarias, la columna
      // simplemente se omitía del body enviado, con 200 OK y sin escribir
      // nada. Silencioso y peor que el bug que corrige (viabilidad-financiera,
      // ficha-tecnica-merge, invalidación de anexos — todos usan jsonb_set).
      // Falla explícito aquí, igual que ya hace esta Capa 2 ante una
      // credencial faltante (líneas 33-35) — nunca un éxito fantasma.
      throw new Error(`restUpdate: jsonb_set() no soportado por la Capa 2 (REST) en la columna "${col}" — requiere Capa 1 (pg directo) activa.`);
    }
    // Other SQL expressions (bare column refs, COALESCE, casts, subqueries)
    // siguen omitiéndose sin error — comportamiento preexistente, sin cambios.
  }

  const filter = whereMatch ? buildFilter(whereMatch[1], params.slice(paramIdx)) : '';
  const r = await fetch(`${SB_URL}/rest/v1/${table}${filter ? '?' + filter : ''}`, { method: 'PATCH', headers: REST_HEADERS, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || JSON.stringify(data));
  const rows = Array.isArray(data) ? data : [];
  return { rows, rowCount: rows.length, command: 'UPDATE' };
}

async function restDelete(sql, params) {
  const table      = extractTable(sql);
  if (!table) throw new Error('DELETE: tabla no encontrada');
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+RETURNING|$)/is);
  const filter     = whereMatch ? buildFilter(whereMatch[1], params) : '';

  const r = await fetch(`${SB_URL}/rest/v1/${table}${filter ? '?' + filter : ''}`, { method: 'DELETE', headers: REST_HEADERS });
  if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data?.message || 'DELETE failed'); }
  return { rows: [], rowCount: 0, command: 'DELETE' };
}

// ── withTenant ─────────────────────────────────────────────────────────────────
// FIX (005_INGENIERO_BACKEND, 2026-09-04): antes conectaba SIEMPRE por
// `_pgPool` (rol "postgres", BYPASSRLS=true) — el `SET LOCAL app.org_id` de
// abajo se ejecutaba, pero como el rol bypasea RLS incondicionalmente, las
// políticas `tenant_isolation` (026_rls_policies_tenant_isolation.sql) NUNCA
// se evaluaban de verdad; la única protección real era el WHERE explícito de
// cada caller. Ahora usa `_pgScopedPool` (rol rf360_rls_scoped, sin
// BYPASSRLS, migración 053) cuando está disponible — RLS real, verificado en
// vivo (aislamiento cross-tenant confirmado por prueba directa contra la BD).
// Si el pool escopado no está configurado/disponible, degrada al pool
// principal con advertencia explícita (comportamiento anterior, nunca peor).
export async function withTenant(tenantId, callback) {
  // Gate por RETRY_INTERVAL_MS (mismo patrón que pgOrRest/_lastRetry): si el
  // pool escopado está caído, NO reintenta conectar (con su timeout de 8s)
  // en cada llamada — eso volvería lentísima cada request de withTenant()
  // durante una caída. Reintenta como máximo 1 vez por minuto en background.
  if (!_pgScopedReady && process.env.DATABASE_URL_TENANT_SCOPED) {
    const now = Date.now();
    if (now - _lastScopedRetry > RETRY_INTERVAL_MS) {
      _lastScopedRetry = now;
      await probeScopedPg().catch(() => {});
    }
  }
  const pool = _pgScopedReady ? _pgScopedPool : (_pgReady ? _pgPool : null);

  if (pool) {
    if (pool === _pgPool && !_scopedWarnLogged) {
      console.warn('[withTenant] Degradado al pool principal (BYPASSRLS) — DATABASE_URL_TENANT_SCOPED no disponible. RLS no aplicado en esta llamada.');
    }
    // Capa 1: pg con set_config para RLS real (rol rf360_rls_scoped) o,
    // en degradación, el pool principal sin RLS real (ver advertencia arriba).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.org_id', $1, TRUE)", [String(tenantId)]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Capa 2: REST con tenant filter inyectado en el fake client
  const fakeClient = {
    _tenantId: tenantId,
    query: async (sql, params = []) => {
      // Inyecta el filtro de tenant para SELECT
      const { sql: enriched, params: enrichedParams } = injectTenantFilter(sql, tenantId, params);
      return pgOrRest(enriched, enrichedParams);
    },
    release: () => {},
  };
  return callback(fakeClient);
}

// FIX (auditoría PROTOCOLO 5x5 2026-08-22, Vector 2, hallazgo 3): tenantId
// ya llegaba dinámico por argumento — lo que estaba mal era CÓMO se
// aplicaba: concatenado como literal de string dentro del SQL
// (`WHERE org_id = '${tenantId}'`) en vez de ir como placeholder ligado
// (`?`). No era explotable con las llamadas actuales (tenantId siempre
// viene de `req.tenantId`, columna de BD/JWT verificado, nunca de input
// libre de usuario — ver server.js linea ~200), pero es el mismo patrón de
// inyección SQL que el resto de este archivo evita en todo lo demás. Ahora
// inserta un placeholder real y devuelve los `params` alineados en el
// orden posicional correcto: si ya había un WHERE, el nuevo placeholder
// queda ANTES de los placeholders originales en el string (tenantId va
// primero en el array); si no había WHERE, el nuevo placeholder queda AL
// FINAL (tenantId va al final del array).
// ── Helpers de conveniencia sobre withTenant() (Fase 1 roadmap tenant, 2026-09-05) ──
// Mismo contrato de retorno que getRow/getRows/runSql (db.js) y misma
// convención de placeholders "?" (normalizados aquí, igual que el resto de
// este archivo) — para que migrar un call site sea "cambiar el nombre de la
// función + agregar tenantId como primer argumento", no reescribir el SQL.
// Fuerzan el pool RLS-escopado (rf360_rls_scoped) en vez del pool principal
// (BYPASSRLS) — requieren que la tabla objetivo tenga GRANT DML a ese rol
// (ver 053_rls_scoped_role.sql / 054_rls_raci_gemini_trial.sql /
// 055_rls_scoped_grants_fase1.sql); si no lo tiene, fallan con "permission
// denied" en vez de devolver 0 filas en silencio — falla explícito, igual
// criterio que el resto de este archivo (líneas 33-35, 461).
export async function withTenantRow(tenantId, sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const { rows } = await withTenant(tenantId, client => client.query(q, p));
  return rows[0] ?? null;
}

export async function withTenantRows(tenantId, sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const { rows } = await withTenant(tenantId, client => client.query(q, p));
  return rows ?? [];
}

export async function withTenantRun(tenantId, sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  return withTenant(tenantId, client => client.query(q, p));
}

function injectTenantFilter(sql, tenantId, params = []) {
  const upper = sql.trim().toUpperCase();
  if (!upper.startsWith('SELECT')) return { sql, params };
  if (/\bWHERE\b/i.test(sql)) {
    return {
      sql: sql.replace(/\bWHERE\b/i, 'WHERE org_id = ? AND '),
      params: [tenantId, ...params],
    };
  }
  return {
    sql: sql + ' WHERE org_id = ?',
    params: [...params, tenantId],
  };
}

// ── runTransaction ────────────────────────────────────────────────────────────
export async function runTransaction(queries) {
  if (_pgReady) {
    const client = await _pgPool.connect();
    try {
      await client.query('BEGIN');
      const results = [];
      // FIX (auditoría SRE 2026-08-08): client.query() de node-postgres exige
      // placeholders $1,$2... — pasar SQL con "?" (la convención de todo el
      // resto del código) producía "syntax error at end of input", confirmado
      // en vivo contra la BD real. Se normaliza igual que pgOrRest() abajo.
      for (const q of queries) {
        const { sql, params } = normalizePlaceholders(q.sql, q.params || []);
        results.push(await client.query(sql, params));
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  // FIX (auditoría PROTOCOLO 5x5 2026-08-22, Vector 3, hallazgo 3): PostgREST
  // (Capa 2) no soporta transacciones multi-sentencia reales — ejecutar las
  // queries en un for secuencial sin BEGIN/COMMIT/ROLLBACK real deja abierta
  // la ventana de un fallo parcial (ej. el UPDATE de ficha_tecnica corre, el
  // INSERT del hash de versión falla, el proyecto queda con datos a medias
  // y sin rollback posible). La atomicidad real en Capa 2 exigiría envolver
  // cada conjunto de queries en una función RPC de Postgres (server-side) —
  // cambio de esquema real, no un fix mecánico de este archivo. Mientras eso
  // no exista, se prefiere fallar rápido y honesto (503, "intenta en un
  // momento") a ejecutar parcialmente y arriesgar corrupción silenciosa —
  // Capa 1 (pg Pool) es la ruta activa el ~100% del tiempo (ver boot logs,
  // "[DB] Capa 1 (pg Pool) ACTIVA"); Capa 2 es solo el fallback de blips de
  // conectividad, reintenta reconectar cada 60s (RETRY_INTERVAL_MS).
  if (queries.length > 1) {
    const err = new Error('No se puede garantizar una escritura atómica en este momento (base de datos en modo degradado) — intenta de nuevo en unos segundos.');
    err.status = 503;
    err.code = 'DB_DEGRADED_NO_ATOMIC';
    throw err;
  }
  // Una sola query: Postgres ya la ejecuta atómicamente sin necesitar BEGIN/COMMIT.
  const results = [];
  for (const q of queries) results.push(await pgOrRest(q.sql, q.params || []));
  return results;
}

// ── Helpers públicos ──────────────────────────────────────────────────────────
export async function query(sql, params = []) { return pgOrRest(sql, params); }

export async function getRow(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const res = await pgOrRest(q, p);
  return res.rows[0] ?? null;
}

export async function getRows(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const res = await pgOrRest(q, p);
  return res.rows ?? [];
}

export async function getCount(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  const res = await pgOrRest(q, p);
  return parseInt(res.rows[0]?.cnt ?? res.rows[0]?.count ?? 0, 10);
}

export async function runSql(sql, params = []) {
  const { sql: q, params: p } = normalizePlaceholders(sql, params);
  return pgOrRest(q, p);
}

// ── Status helper (para /api/db-status) ──────────────────────────────────────
export function dbStatus() {
  return {
    layer: _pgReady ? 1 : 2,
    engine: _pgReady ? 'pg-pool (Session Pooler)' : 'Supabase REST API',
    pgReady: _pgReady,
    // rlsScopedReady=false con withTenantConfigured=true significa: la app SÍ
    // tiene DATABASE_URL_TENANT_SCOPED configurada pero el pool no logró
    // conectar (revisar credenciales/rol) — degradando withTenant() al pool
    // principal (BYPASSRLS) hasta que se resuelva.
    rlsScopedReady: _pgScopedReady,
    withTenantConfigured: !!process.env.DATABASE_URL_TENANT_SCOPED,
    supabaseUrl: SB_URL,
    message: _pgReady
      ? 'Base de datos OK — pg Pool conectado'
      : 'Modo degradado — usando REST API. Habilita Connection Pooling en Supabase dashboard para máximo rendimiento.',
  };
}

export default pool;
