/**
 * db-check.js — Validación de conexión a Supabase (REST/PostgREST).
 * Ejecutado por Render ANTES de levantar el servidor (buildCommand).
 * Salida 0 = OK. Salida 1 = Fallo → Render aborta el deploy.
 *
 * Nota: la app usa Supabase vía REST (SUPABASE_URL + SUPABASE_SERVICE_KEY,
 * ver src/modules/formulador/supabaseClient.js), no una conexión pg directa.
 * Este check valida lo mismo que /api/health en server.js para que el gate
 * de build no dependa de una variable (DATABASE_URL) que el runtime no usa.
 *
 * No se usa process.exit() a propósito: en Node 25.x en Windows, forzar la
 * salida mientras el dispatcher de fetch/undici aún cierra sockets internos
 * dispara un crash nativo (Assertion failed ... uv_async_t). Se fija
 * process.exitCode y se deja que el event loop drene solo.
 */
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ [DB-CHECK] SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas. Deploy abortado.');
    console.error('   → Agrega ambas en el dashboard de Render (Environment).');
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/formulador_proyectos?limit=0`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: controller.signal,
    });
    // 404 = tabla no existe pero la conexión/API key funcionan; sigue siendo OK.
    if (!res.ok && res.status !== 404) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    console.log('✅ [DB-CHECK] Supabase (REST) conectado exitosamente.');
    console.log(`   → URL     : ${SUPABASE_URL}`);
    console.log(`   → Status  : ${res.status}`);
    process.exitCode = 0;
  } catch (err) {
    console.error('❌ [DB-CHECK] Fallo de conexión a Supabase. Deploy abortado.');
    console.error(`   → Error: ${err.message}`);
    console.error('   → Verifica SUPABASE_URL / SUPABASE_SERVICE_KEY y el estado del proyecto en Supabase.');
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await main();
