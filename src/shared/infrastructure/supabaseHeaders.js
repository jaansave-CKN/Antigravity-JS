// supabaseHeaders.js — encabezados únicos para PostgREST/Supabase.
//
// 2026-10-04 (health local en 401): las keys nuevas de Supabase
// (sb_secret_… / sb_publishable_…) NO son JWT y van solo en "apikey"; el
// gateway rechaza un "Authorization: Bearer" que no sea un JWT. Antes los tres
// consumidores (health, db-check del build de Render y supabaseClient) enviaban
// la service key también como Bearer: con una key sb_secret_ todo respondía 401
// y el build de Render abortaba en db-check.
//
// Reglas:
//  - Token de usuario presente → SIEMPRE va como Bearer, aunque esté
//    malformado: PostgREST lo rechaza (401) y supabaseClient entra a su
//    fallback auditado. Descartarlo en silencio dejaría la petición solo con
//    la service key (rol service_role, salta RLS) sin rastro — hallazgo del
//    subgate 005, 2026-10-04.
//  - Sin token de usuario → la service key va como Bearer solo si es un JWT
//    legacy; una sb_secret_ va únicamente en "apikey".

const FORMATO_JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function esJWT(token) {
  return typeof token === 'string' && FORMATO_JWT.test(token.trim());
}

export function encabezadosSupabase(apiKey, userJwt = null) {
  const bearer = userJwt ? userJwt : (esJWT(apiKey) ? apiKey : null);
  return {
    apikey: apiKey,
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}
