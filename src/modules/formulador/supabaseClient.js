import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[Supabase] SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados.');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Guardrail RLS — el aislamiento multi-tenant no puede depender solo del WHERE
// dentro de cada función RPC (RLS-por-rol está inactivo hoy, ver auditoría
// 2026-08-07 §3: sbFetch degrada siempre a SERVICE_KEY). Punto único de paso de
// todo rpc() con p_tenant_id: aborta en Node antes de tocar Postgres si el
// tenant es nulo/inválido, en vez de confiar en que cada caller lo valide.
function assertValidTenant(tenantId) {
  if (!tenantId || !UUID_RE.test(tenantId)) {
    throw Object.assign(
      new Error('RLS_GUARD: tenant_id ausente o inválido — petición abortada antes de tocar Postgres.'),
      { status: 400 }
    );
  }
}

// El header Authorization es el que determina el rol/RLS que PostgREST aplica
// en Postgres. Con el JWT del usuario final -> rol "authenticated", RLS activo.
// Sin JWT de usuario -> cae a SERVICE_KEY (bypassa RLS); reservado para tareas
// internas, nunca para operaciones de usuario final.
function buildHeaders(userJwt) {
  return {
    'Content-Type': 'application/json',
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${userJwt || SERVICE_KEY}`,
    'Prefer':        'return=representation',
  };
}

const FETCH_TIMEOUT_MS = 10_000;

async function doFetch(path, options, authHeader) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res  = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Prefer: 'return=representation', ...options.headers, Authorization: authHeader },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}

async function sbFetch(path, options = {}, userJwt) {
  if (userJwt) {
    // Intento con el JWT del usuario final -> rol "authenticated", RLS por rol activo
    // SI el proyecto Supabase tiene Firebase configurado como Third-Party Auth.
    // Verificado en disco (2026-08-06, docs/RADFOR360_ARQUITECTURA_OPTIMIZACION.md §3.6):
    // hoy NO está configurado -> PostgREST rechaza el token de Firebase con
    // 401 PGRST301 ("No suitable key was found to decode the JWT"). Se degrada a
    // SERVICE_KEY para no bloquear el módulo completo; el aislamiento real en ese
    // caso lo sigue dando el filtro `WHERE tenant_id = p_tenant_id` explícito en
    // cada función RPC (confirmado con prueba cruzada de 2 tenants reales), no RLS
    // por rol. Configurar Third-Party Auth en el dashboard de Supabase reactivaría
    // la ruta de RLS-por-rol sin tocar este archivo.
    const attempt = await doFetch(path, options, `Bearer ${userJwt}`);
    if (attempt.ok) return attempt.data;
    if (attempt.status !== 401) {
      throw Object.assign(new Error(attempt.data?.message || attempt.data?.error || 'Supabase error'), { status: attempt.status, data: attempt.data });
    }
    console.warn('[Supabase] JWT de usuario rechazado (401) — degradando a SERVICE_KEY para esta llamada. Ver supabaseClient.js:sbFetch.');
  }

  const fallback = await doFetch(path, options, `Bearer ${SERVICE_KEY}`);
  if (!fallback.ok) {
    throw Object.assign(new Error(fallback.data?.message || fallback.data?.error || 'Supabase error'), { status: fallback.status, data: fallback.data });
  }
  return fallback.data;
}

// SELECT — GET /rest/v1/<table>?<filters>
export async function select(table, query = '', userJwt) {
  return sbFetch(`/${table}${query ? '?' + query : ''}`, {}, userJwt);
}

// SELECT single row
export async function selectOne(table, query = '', userJwt) {
  const rows = await select(table, query + (query ? '&' : '') + 'limit=1', userJwt);
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

// INSERT — POST /rest/v1/<table>
export async function insert(table, body, userJwt) {
  return sbFetch(`/${table}`, { method: 'POST', body: JSON.stringify(body) }, userJwt);
}

// INSERT single → returns first row
export async function insertOne(table, body, userJwt) {
  const rows = await insert(table, body, userJwt);
  return Array.isArray(rows) ? rows[0] : rows;
}

// RPC — POST /rest/v1/rpc/<fn>
export async function rpc(fn, params = {}, userJwt) {
  if ('p_tenant_id' in params) assertValidTenant(params.p_tenant_id);
  return sbFetch(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) }, userJwt);
}

// Fija app.tenant_id vía set_tenant_context() para que las políticas RLS
// (USING tenant_id = current_tenant_id()) dejen de evaluar siempre NULL.
// Alcance real: set_config(...,true) es transaccional — solo garantiza el
// contexto dentro de la MISMA transacción/función (ver insertar_fase1, que
// ya corre atómico). Llamadas REST sueltas posteriores son transacciones
// independientes en PostgREST; esta invocación no persiste entre ellas.
export async function setTenantContext(tenantId, userJwt) {
  return rpc('set_tenant_context', { p_tenant_id: tenantId }, userJwt);
}

export default { select, selectOne, insert, insertOne, rpc, setTenantContext };
