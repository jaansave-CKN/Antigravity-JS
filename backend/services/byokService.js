/**
 * byokService.js — Bring Your Own Key: gestión de llaves de Gemini
 * configuradas por cada usuario (migración 045), independiente del pool
 * compartido del servidor (geminiCircuitBreaker.js, que sigue calibrado
 * solo a la cuota del servidor — no se mezcla con llaves de usuario, por
 * decisión explícita de `architect`).
 *
 * Modelo de negocio: el usuario exento (usuarios.byok_exento = true) sigue
 * usando la llave compartida del servidor sin ningún cambio. Cualquier
 * otro usuario debe configurar al menos 1 llave propia (hasta 3, slots
 * 1/2/3) para poder usar las 7 acciones interactivas de IA — si no tiene
 * ninguna válida, el middleware de gate.js corta con 428 antes de llegar
 * aquí.
 *
 * REGLA DE ORO (2026-08-22, decisión explícita tras revisión de architect):
 * si el pool personal del usuario se agota (todas sus llaves con error de
 * cuota), NUNCA se degrada a datos heurísticos/mock — eso sería la misma
 * alucinación ya rechazada 8 veces para el pool del servidor, ahora detrás
 * de una llave de usuario. Se lanza UserKeyPoolExhaustedError, visible,
 * honesto, igual que GeminiPoolExhaustedError del pool del servidor.
 */
import crypto from 'crypto';
import { encryptKey, decryptKey, maskKey } from '../pipeline/CryptoHelper.js';
import { isQuotaError } from './geminiCircuitBreaker.js';
import { logger } from '../utils/logger.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export class UserKeyPoolExhaustedError extends Error {
  constructor(message = 'Tu llave de Gemini configurada se quedó sin cuota — actualízala en el Panel de Control o espera a que se restablezca.') {
    super(message);
    this.name = 'UserKeyPoolExhaustedError';
    this.status = 429;
    this.code = 'USER_KEY_EXHAUSTED';
  }
}

class LlaveInvalidaError extends Error {
  constructor(message = 'La llave de Gemini no es válida — verifica que la copiaste completa desde Google AI Studio.') {
    super(message);
    this.status = 422;
    this.code = 'INVALID_GEMINI_KEY';
  }
}

/** true si el usuario está exento de BYOK (usa la llave del servidor sin restricción). */
export async function esExento(userId, { getRow }) {
  const row = await getRow('SELECT byok_exento FROM usuarios WHERE id = ?', [userId]);
  return !!row?.byok_exento;
}

/**
 * Resuelve las llaves propias del usuario, ya desencriptadas, ordenadas por
 * key_slot. Vacío si no tiene ninguna válida configurada — el caller
 * decide qué hacer (el middleware ya corta antes con 428, esto es defensa
 * en profundidad si algo llama esta función sin pasar por el middleware).
 */
async function resolverLlavesUsuario(userId, { getRows }) {
  const enc = process.env.ENCRYPTION_KEY;
  if (!enc) return [];
  const filas = await getRows(
    'SELECT key_slot, encrypted_key FROM user_gemini_keys WHERE user_id = ? AND is_valid = TRUE ORDER BY key_slot ASC',
    [userId]
  );
  const llaves = [];
  for (const f of filas) {
    try {
      llaves.push(decryptKey(f.encrypted_key, enc));
    } catch (e) {
      logger.warn?.('[BYOK] No se pudo desencriptar una llave de usuario (se omite)', { userId, keySlot: f.key_slot, err: e.message });
    }
  }
  return llaves;
}

/**
 * Primitivo de rotación entre las llaves PROPIAS de un usuario — espejo
 * liviano de withKeyRotation() del pool del servidor, pero sin estado
 * persistido ni circuit breaker propio (el pool personal es de máximo 3
 * llaves, de uso esporádico — no justifica la misma infraestructura que el
 * pool compartido de todos los usuarios). Rota solo ante error de cuota;
 * cualquier otro error se propaga de inmediato. Pool agotado →
 * UserKeyPoolExhaustedError, nunca un fallback fabricado.
 */
export async function withUserKeyRotation(llaves, attemptFn) {
  if (!llaves.length) throw new UserKeyPoolExhaustedError('No tienes ninguna llave de Gemini configurada — agrégala en el Panel de Control.');
  for (const key of llaves) {
    try {
      return await attemptFn(key);
    } catch (err) {
      if (isQuotaError(err)) continue; // prueba la siguiente llave propia
      throw err; // error real (llave inválida, red, etc.) — no tiene sentido rotar
    }
  }
  throw new UserKeyPoolExhaustedError();
}

/**
 * Ejecuta la resolución completa para una de las 7 acciones gateadas:
 * exento → { exento: true } (el caller sigue con withKeyRotation del pool
 * del servidor, comportamiento intacto); no exento → { exento: false,
 * llaves: [...] } para usar con withUserKeyRotation.
 */
export async function resolverContextoBYOK(userId, { getRow, getRows }) {
  const exento = await esExento(userId, { getRow });
  // FIX (2026-08-24, "ModalBYOK" — válvula de escape para exentos): antes,
  // un exento nunca resolvía sus propias llaves (siempre []) porque nunca
  // las necesitaba. Ahora sí se resuelven siempre — byokGate.js decide con
  // ellas si el pool del servidor está agotado y el usuario ya guardó una
  // llave propia voluntariamente, para usarla como escape en vez de esperar.
  // Un exento SIN llave propia guardada sigue exactamente igual que antes.
  const llaves = await resolverLlavesUsuario(userId, { getRows });
  return { exento, llaves };
}

// Pre-flight: un intento real mínimo contra Gemini antes de guardar/aceptar
// una llave — nunca se persiste una llave sin haberla probado primero.
async function probarLlave(rawKey) {
  let upstream;
  try {
    upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.6-flash',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new LlaveInvalidaError(`No se pudo contactar a Gemini con esa llave: ${e.message}`);
  }
  if (upstream.status === 401 || upstream.status === 403) throw new LlaveInvalidaError();
  if (upstream.status === 429) return; // llave válida, solo sin cuota en este instante — se acepta igual
  if (!upstream.ok) {
    const cuerpo = await upstream.text().catch(() => '');
    throw new LlaveInvalidaError(`Gemini rechazó la llave (HTTP ${upstream.status}): ${cuerpo.slice(0, 200)}`);
  }
}

/**
 * Guarda (o reemplaza) la llave de un slot (1/2/3) del usuario — SIEMPRE
 * tras un pre-flight real. Registra el resultado en tenant_audit_logs
 * (éxito o fallo) con IP, pedido explícito del usuario para trazabilidad.
 * Nunca devuelve ni loguea la llave en claro.
 */
export async function guardarLlaveUsuario(userId, keySlot, rawKey, label, ip, { runSql, getRow }) {
  const enc = process.env.ENCRYPTION_KEY;
  if (!enc) { const e = new Error('ENCRYPTION_KEY no configurada — no se pueden guardar credenciales de usuario.'); e.status = 503; throw e; }
  if (![1, 2, 3].includes(Number(keySlot))) { const e = new Error('key_slot debe ser 1, 2 o 3.'); e.status = 400; throw e; }
  if (!rawKey?.trim()) { const e = new Error('La llave no puede estar vacía.'); e.status = 400; throw e; }

  const registrarAuditoria = (resultado, detalle) =>
    runSql(
      'INSERT INTO tenant_audit_logs (id, user_id, ip, accion, resultado, detalle) VALUES (?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), userId, ip || null, 'guardar_llave_gemini', resultado, detalle || null]
    ).catch(e => console.warn('[BYOK] No se pudo registrar auditoría (se omite, no bloqueante):', e.message));

  try {
    await probarLlave(rawKey.trim());
  } catch (err) {
    await registrarAuditoria('rechazada', err.message);
    throw err;
  }

  const encrypted = encryptKey(rawKey.trim(), enc);
  const existente = await getRow('SELECT id FROM user_gemini_keys WHERE user_id = ? AND key_slot = ?', [userId, keySlot]);
  if (existente) {
    await runSql(
      'UPDATE user_gemini_keys SET encrypted_key = ?, label = ?, is_valid = TRUE, last_validated_at = ?, updated_at = ? WHERE id = ?',
      [encrypted, label || '', new Date().toISOString(), new Date().toISOString(), existente.id]
    );
  } else {
    await runSql(
      'INSERT INTO user_gemini_keys (id, user_id, key_slot, encrypted_key, label, is_valid, last_validated_at) VALUES (?, ?, ?, ?, ?, TRUE, ?)',
      [crypto.randomUUID(), userId, keySlot, encrypted, label || '', new Date().toISOString()]
    );
  }
  await registrarAuditoria('aceptada', `slot ${keySlot}`);
  return { keySlot, label: label || '', masked: maskKey(rawKey.trim()) };
}

/** Lista las llaves del usuario — SOLO datos enmascarados, nunca la llave en claro. */
export async function listarLlavesUsuario(userId, { getRows }) {
  const enc = process.env.ENCRYPTION_KEY;
  const filas = await getRows(
    'SELECT key_slot, encrypted_key, label, is_valid, last_validated_at FROM user_gemini_keys WHERE user_id = ? ORDER BY key_slot ASC',
    [userId]
  );
  return filas.map(f => {
    let masked = '****';
    if (enc) { try { masked = maskKey(decryptKey(f.encrypted_key, enc)); } catch { /* llave ilegible — se muestra genérico, no se rompe el listado */ } }
    return { key_slot: f.key_slot, label: f.label, masked, is_valid: !!f.is_valid, last_validated_at: f.last_validated_at };
  });
}

export async function eliminarLlaveUsuario(userId, keySlot, { runSql }) {
  await runSql('DELETE FROM user_gemini_keys WHERE user_id = ? AND key_slot = ?', [userId, keySlot]);
}
