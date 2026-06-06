/**
 * tokenBlacklist.js — Blacklist de tokens revocados (logout stateful + revocación bulk)
 *
 * DOS MECANISMOS DE REVOCACIÓN:
 *
 *   1. Por-token (logout individual):
 *      revokeToken(token, userId, expiresAt, runSql)
 *      → Hashea el token (SHA-256) y lo almacena en `revoked_tokens`.
 *      → Check en memoria: O(1), sin DB en cada request.
 *
 *   2. Bulk por usuario (Stripe cancellation, admin kick):
 *      revokeUserSession(userId, runSql)
 *      → Actualiza `usuarios.tokens_invalidated_at = NOW()`.
 *      → Cualquier token con `iat < tokens_invalidated_at` es rechazado.
 *      → No requiere conocer qué tokens están activos.
 *
 * CICLO DE VIDA:
 *   1. Arranque  → carga tokens vigentes desde BD → revokedSet (memoria)
 *   2. Logout    → revokeToken() → INSERT en BD + add al Set
 *   3. Stripe    → revokeUserSession() → UPDATE usuarios
 *   4. Request   → isRevoked() O(1) + checkSessionValid() ~1ms BD
 *   5. Cada hora → purgeExpiredTokens() limpia BD + reconstruye Set
 *
 * Sin Redis. Sin dependencias externas.
 */

import crypto from 'crypto';

// ── Set en memoria: fuente primaria O(1) para logout por-token ───────────────
const revokedSet = new Set();

// ── Hash SHA-256 del token raw (nunca almacena el JWT en crudo) ──────────────
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Inicialización: crea tabla + carga tokens vigentes desde BD ──────────────
export async function initBlacklist(runSql, getRows) {
  try {
    await runSql(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_hash   TEXT        PRIMARY KEY,
        user_id      TEXT        NOT NULL,
        revoked_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL
      )
    `);

    // Cargar tokens no expirados en el Set de memoria
    const rows = await getRows(
      `SELECT token_hash FROM revoked_tokens WHERE expires_at > NOW()`,
      []
    );
    rows.forEach(r => revokedSet.add(r.token_hash));

    console.log(`[blacklist] ${revokedSet.size} token(s) vigente(s) cargados desde BD.`);
  } catch (e) {
    console.warn('[blacklist] No se pudo inicializar desde BD — operando solo en memoria:', e.message);
  }
}

// ── Revocar token individual (POST /api/auth/logout) ─────────────────────────
export async function revokeToken(token, userId, expiresAt, runSql) {
  const hash = hashToken(token);

  // Efecto inmediato en memoria
  revokedSet.add(hash);

  // Persistir en BD (tolerante a fallos — el Set ya protege)
  try {
    const expiresISO = new Date(expiresAt * 1000).toISOString();
    await runSql(
      `INSERT INTO revoked_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [hash, userId, expiresISO]
    );
  } catch (e) {
    console.warn('[blacklist] Error persistiendo token revocado (protección en memoria activa):', e.message);
  }
}

// ── Revocar TODAS las sesiones de un usuario (Stripe cancellation / admin kick)
// No requiere conocer los tokens individuales — usa timestamps de emisión.
// Cualquier token con iat < tokens_invalidated_at será rechazado en checkSessionValid().
export async function revokeUserSession(userId, runSql) {
  try {
    await runSql(
      `UPDATE usuarios SET tokens_invalidated_at = NOW() WHERE id = $1`,
      [userId]
    );
    console.log(`[blacklist] Sesiones invalidadas para user: ${userId}`);
  } catch (e) {
    // Intentar con tabla 'users' (nombre canónico inglés)
    try {
      await runSql(
        `UPDATE users SET tokens_invalidated_at = NOW() WHERE id = $1`,
        [userId]
      );
      console.log(`[blacklist] Sesiones invalidadas para user: ${userId} (tabla users)`);
    } catch (e2) {
      console.error('[blacklist] Error en revokeUserSession:', e2.message);
    }
  }
}

// ── Verificar si el token individual está en la blacklist ────────────────────
export function isRevoked(token) {
  return revokedSet.has(hashToken(token));
}

// ── Verificar si la sesión del usuario es válida (mecanismo bulk) ────────────
// Retorna false si tokens_invalidated_at > iat del token (bulk revocation activa).
// Retorna true si la columna no existe o el usuario no se encuentra (fail-open para
// compatibilidad con esquemas legacy que aún no tienen la columna).
export async function checkSessionValid(userId, tokenIat, getRow) {
  if (!userId || !tokenIat) return true;

  // Ignorar tokens de trial (no requieren validación de sesión bulk)
  if (String(userId).startsWith('trial-')) return true;

  try {
    const row = await getRow(
      `SELECT tokens_invalidated_at FROM usuarios WHERE id = $1`,
      [userId]
    );

    if (!row) {
      // Intentar con tabla canonical 'users'
      const row2 = await getRow(
        `SELECT tokens_invalidated_at FROM users WHERE id = $1`,
        [userId]
      );
      if (!row2 || !row2.tokens_invalidated_at) return true;
      const invalidatedAt = new Date(row2.tokens_invalidated_at).getTime() / 1000;
      return tokenIat >= invalidatedAt;
    }

    if (!row.tokens_invalidated_at) return true;
    const invalidatedAt = new Date(row.tokens_invalidated_at).getTime() / 1000;
    return tokenIat >= invalidatedAt;
  } catch (e) {
    // Fail-closed: ante cualquier error de BD rechazamos el token.
    // Evita que un fallo de infraestructura se convierta en bypass de autenticación.
    console.warn('[blacklist] checkSessionValid error (fail-closed — sesión denegada):', e.message);
    return false;
  }
}

// ── Purga periódica (ejecutar cada hora) ─────────────────────────────────────
export async function purgeExpiredTokens(runSql) {
  const before = revokedSet.size;
  try {
    await runSql(
      `DELETE FROM revoked_tokens WHERE expires_at <= NOW()`,
      []
    );
    // Reconstruir Set desde BD limpia
    revokedSet.clear();
    const { getRows } = await import('../config/database.config.js');
    const rows = await getRows(
      `SELECT token_hash FROM revoked_tokens WHERE expires_at > NOW()`,
      []
    );
    rows.forEach(r => revokedSet.add(r.token_hash));
    const purged = before - revokedSet.size;
    if (purged > 0) console.log(`[blacklist] Purga: ${purged} token(s) expirado(s) eliminados.`);
  } catch (e) {
    console.warn('[blacklist] Error en purga periódica:', e.message);
  }
}

export { revokedSet };
