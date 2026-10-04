// supabase_headers.test.mjs — encabezados únicos de Supabase/PostgREST
// (src/shared/infrastructure/supabaseHeaders.js). Caso real 2026-10-04: una
// key sb_secret_ enviada como "Authorization: Bearer" no es un JWT y el
// gateway la rechaza; health, db-check (build de Render) y supabaseClient
// usaban ese patrón.
// Corre con: node --test scripts/supabase_headers.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { esJWT, encabezadosSupabase } from '../src/shared/infrastructure/supabaseHeaders.js';

// Fixtures armados en tiempo de ejecución: un literal con forma de JWT o de
// key dispara (con razón) el escáner de secretos de 006.
const SB_SECRET = ['sb', 'secret', 'a'.repeat(31)].join('_');
const JWT = ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiJ1c3VhcmlvIn0', 'firmaDePrueba_123'].join('.');

test('esJWT reconoce solo el formato de tres segmentos base64url que empieza por eyJ', () => {
  assert.equal(esJWT(JWT), true);
  assert.equal(esJWT(SB_SECRET), false);
  assert.equal(esJWT('eyJsolo.dos'), false);
  assert.equal(esJWT(null), false);
});

test('key sb_secret_ sin usuario → solo apikey, nunca Authorization', () => {
  assert.deepEqual(encabezadosSupabase(SB_SECRET), { apikey: SB_SECRET });
});

test('con JWT de usuario → apikey + Bearer del usuario (ruta RLS)', () => {
  assert.deepEqual(encabezadosSupabase(SB_SECRET, JWT), { apikey: SB_SECRET, Authorization: `Bearer ${JWT}` });
});

test('service key legacy en formato JWT → se conserva como Bearer (compatibilidad)', () => {
  assert.deepEqual(encabezadosSupabase(JWT), { apikey: JWT, Authorization: `Bearer ${JWT}` });
});

test('SEGURIDAD (hallazgo 005): un token de usuario malformado SÍ viaja como Bearer — PostgREST lo rechaza y entra el fallback auditado; nunca degrada en silencio a service_role', () => {
  assert.deepEqual(encabezadosSupabase(SB_SECRET, 'no-soy-jwt'), { apikey: SB_SECRET, Authorization: 'Bearer no-soy-jwt' });
});
