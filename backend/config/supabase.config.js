/**
 * supabase.config.js — Clientes Supabase (anon + admin/service + storage)
 *
 * Variables requeridas:
 *   SUPABASE_URL          — https://<proyecto>.supabase.co
 *   SUPABASE_ANON_KEY     — clave pública (safe for frontend)
 *   SUPABASE_SERVICE_KEY  — clave de servicio (backend only, nunca exponer)
 *   SUPABASE_STORAGE_KEY  — opcional, ver nota FIX 2026-08-17 abajo
 *
 * Uso:
 *   import { supabaseAnon, supabaseAdmin, supabaseStorage } from '../config/supabase.config.js';
 *
 *   // Validar token de usuario
 *   const { data: { user } } = await supabaseAnon.auth.getUser(bearerToken);
 *
 *   // Operaciones admin sobre la base de datos (bypass RLS) — PostgREST
 *   await supabaseAdmin.from('users').select('*');
 *
 *   // Operaciones de Storage (subir/borrar/firmar archivos)
 *   await supabaseStorage.storage.from('bucket').upload(...);
 *
 * FIX 2026-08-17 (regresión real detectada y corregida en la misma sesión):
 * un primer intento de arreglo hizo que supabaseAdmin usara
 * SUPABASE_STORAGE_KEY (legacy JWT) por error, asumiendo sin verificar que
 * "supabaseAdmin se usa solo para Storage" — FALSO: aiTokenLogger.js,
 * AuditorForenseService.js, CopilotoService.js, EstresadoFinancieroService.js,
 * ExtractorService.js, ValorExponencialService.js y proyectos.routes.js
 * también lo usan para PostgREST normal (.from('tabla')...), que este
 * proyecto de Supabase RECHAZA con claves legacy ("Legacy API keys are
 * disabled") — rompió el historial del Co-Piloto en vivo. SUPABASE_SERVICE_KEY
 * (formato nuevo sb_secret_...) es la única que sirve para PostgREST aquí;
 * Storage es la única superficie que necesita la legacy — de ahí el cliente
 * `supabaseStorage` separado, usado EXCLUSIVAMENTE por
 * anexos.routes.js/biblioteca.routes.js.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_STORAGE_KEY = process.env.SUPABASE_STORAGE_KEY || process.env.SUPABASE_SERVICE_KEY;

const isConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isConfigured) {
  console.warn('[supabase.config] SUPABASE_URL / SUPABASE_ANON_KEY no configuradas — auth Supabase desactivada');
}

// Cliente público — usa clave anon, respeta RLS
export const supabaseAnon = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Cliente administrador — usa service_role key, bypassa RLS (backend only,
// PostgREST/base de datos — NO Storage, ver supabaseStorage más abajo)
export const supabaseAdmin = (isConfigured && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Cliente dedicado a Storage — ver nota FIX 2026-08-17 arriba. Úsalo SOLO
// para .storage.* (subir/borrar/firmar archivos), nunca para .from('tabla').
export const supabaseStorage = (isConfigured && SUPABASE_STORAGE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_STORAGE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export { isConfigured as supabaseConfigured };
export default supabaseAnon;
