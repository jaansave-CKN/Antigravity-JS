// occGuard.js — Concurrencia Optimista (Fase 4.1) + Shadow Ledger (Fase 4.2)
// Migración A de ADR-0001 (docs/ADR/ADR-0001-auth-rls-worm-occ.md).
// Lógica de aplicación pura: la inmutabilidad real vive en los triggers de
// 007_worm_occ_shadow_ledger.sql. El enforcement real de OCC vive en la
// RPC guardar_modulo10 (008_occ_atomic_guardar_modulo10.sql) — lock+check+
// escritura en una sola transacción. Corregido en auditoría 008_AUDITOR_DE_
// CODIGO (2026-08-11): la versión anterior comparaba el hash en una llamada
// RPC separada de la escritura (obtener_ultimo_hash + guardar_modulo10),
// dos transacciones distintas sin lock entre ellas — dos requests
// concurrentes podían pasar el check y escribir ambas (TOCTOU real). Las
// funciones de este archivo que leen el hash sin escribir quedan como
// utilidades advisory (ej. un GET de UI que avisa "esto cambió" antes de
// que el usuario edite) — nunca como el mecanismo que bloquea la escritura.

import crypto from 'crypto';
import sb from './supabaseClient.js';

// Hash estable: mismo payload, mismo hash sin importar el orden de las claves
// (igual criterio que stableStringify() en src/orchestrator-engine.js, pero
// SHA-256 en vez de FNV-1a — el esquema exige sha256/sha3-256, ver
// pvh_hash_length en la migración).
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function computeHash(payload) {
  const str = stableStringify(payload);
  return {
    hash: crypto.createHash('sha256').update(str).digest('hex'),
    sizeBytes: Buffer.byteLength(str, 'utf8'),
  };
}

// Solo para escrituras que NO pasan por guardar_modulo10 (ej. futuros
// endpoints que aún no tengan su propia RPC atómica). No usar como
// enforcement de OCC — ver nota de cabecera.
export async function registrarVersionHash({ tenantId, proyectoId, payload, status, triggeredBy, userId, userJwt }) {
  const { hash, sizeBytes } = computeHash(payload);
  return sb.rpc('registrar_version_hash', {
    p_tenant_id: tenantId,
    p_proyecto_id: proyectoId,
    p_hash_value: hash,
    p_project_status: status,
    p_triggered_by: triggeredBy,
    p_payload_size_bytes: sizeBytes,
    p_created_by_user: userId ?? null,
  }, userJwt);
}

// Advisory únicamente (ver cabecera del archivo) — por ejemplo, para que la UI
// avise "esto cambió desde que lo cargaste" antes de que el usuario edite.
// NO usar como gate de escritura: no hay lock entre esta lectura y una
// escritura posterior en 2 llamadas separadas.
export async function obtenerUltimoHash({ tenantId, proyectoId, userJwt }) {
  return sb.rpc('obtener_ultimo_hash', { p_tenant_id: tenantId, p_proyecto_id: proyectoId }, userJwt);
}

// Best-effort: una falla al registrar una violación no debe tumbar la respuesta
// de error que el endpoint ya iba a devolver (mismo patrón que aiTokenLogger.js
// en Proy_03_RadarFondos — fire-and-forget, nunca rompe la respuesta al usuario).
export async function registrarViolacionSeguridad({ tenantId, ip, jwtSub, endpoint, tipo, detalle, payload, userJwt }) {
  try {
    await sb.rpc('registrar_violacion_seguridad', {
      p_endpoint: endpoint,
      p_violation_type: tipo,
      p_tenant_id: tenantId ?? null,
      p_ip: ip ?? null,
      p_jwt_sub: jwtSub ?? null,
      p_detalle: detalle ?? null,
      p_payload_snapshot: payload ?? {},
    }, userJwt);
  } catch (err) {
    console.error('[occGuard] registrarViolacionSeguridad falló (no bloquea la respuesta):', err.message);
  }
}

export default { computeHash, registrarVersionHash, obtenerUltimoHash, registrarViolacionSeguridad };
