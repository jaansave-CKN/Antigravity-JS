/**
 * supabase.config.js — Clientes Supabase (anon + admin/service)
 *
 * Variables requeridas:
 *   SUPABASE_URL          — https://<proyecto>.supabase.co
 *   SUPABASE_ANON_KEY     — clave pública (safe for frontend)
 *   SUPABASE_SERVICE_KEY  — clave de servicio (backend only, nunca exponer)
 *
 * Uso:
 *   import { supabaseAnon, supabaseAdmin } from '../config/supabase.config.js';
 *
 *   // Validar token de usuario
 *   const { data: { user } } = await supabaseAnon.auth.getUser(bearerToken);
 *
 *   // Operaciones admin (bypass RLS)
 *   await supabaseAdmin.from('users').select('*');
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY   = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

// Cliente administrador — usa service_role key, bypassa RLS (backend only)
export const supabaseAdmin = (isConfigured && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export { isConfigured as supabaseConfigured };
export default supabaseAnon;
