/**
 * PostgresRateLimitStore.js — Store de express-rate-limit respaldado en
 * Postgres (tabla rate_limit_counters, migración 027), como alternativa
 * a Redis cuando se escale pm2 a más de 1 instancia.
 *
 * Cableado 2026-08-08 (Operación Blindaje Final, hallazgo 4 de la radiografía
 * 360): activado en authLimiter/trialLimiter/aiLimiter/financialPipelineLimiter
 * (SecurityMiddleware.js) — estos 4 limiters son de bajo volumen y de
 * seguridad crítica (fuerza bruta, abuso de IA, pipeline financiero); ahí
 * el beneficio de persistir el contador entre reinicios/instancias supera
 * el costo de una consulta extra por request. El limiter global de /api
 * (300/15min, definido inline en server.js) se deja en MemoryStore a
 * propósito — es alto volumen y no fue nombrado en el hallazgo 4.
 *
 * Verificado contra la BD real de este entorno (SELECT to_regclass(...))
 * que la tabla `rate_limit_counters` NO existía todavía pese a que la
 * migración 027 vive en el repo desde hace tiempo — las migraciones de este
 * proyecto se aplican a mano (`psql -f ...`), nunca automáticamente al
 * arrancar. Por eso `ensureTable()` la crea de forma perezosa e idempotente
 * (mismo patrón ya usado en tokenBlacklist.js/initBlacklist y en
 * stripe.webhook.js/_ensureStripeEventsTable) — sin esto, activar el store
 * habría roto login/trial/IA en cualquier entorno donde 027 no se hubiera
 * corrido manualmente.
 *
 * Implementa la interfaz Store real de express-rate-limit v7
 * (init/increment/decrement/resetKey).
 *
 * IMPORTANTE (lección aprendida esta sesión): nunca uses ON CONFLICT en
 * las queries de este store — bajo el fallback REST de database.config.js
 * (Capa 2) esa cláusula se ignora en silencio. Por eso el patrón aquí es
 * SELECT → decide UPDATE o INSERT, ambos con placeholders reales, igual
 * que el resto del código ya corregido en esta sesión.
 */
import { getRow, runSql } from '../config/database.config.js';

let _tableReady = null;
function ensureTable() {
  if (!_tableReady) {
    _tableReady = runSql(`
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        id         TEXT PRIMARY KEY,
        count      INTEGER NOT NULL DEFAULT 1,
        reset_at   TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch((e) => {
      console.warn('[PostgresRateLimitStore] No se pudo crear rate_limit_counters:', e.message);
      _tableReady = null; // reintentar en la próxima llamada
    });
  }
  return _tableReady;
}

export class PostgresRateLimitStore {
  constructor(prefix = 'rl') {
    this.prefix = prefix;
    this.windowMs = 60_000; // sobreescrito por init()
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  _key(key) {
    return `${this.prefix}:${key}`;
  }

  async increment(key) {
    await ensureTable();
    const id = this._key(key);
    const now = Date.now();
    const existing = await getRow(
      'SELECT count, reset_at FROM rate_limit_counters WHERE id = ?',
      [id]
    );

    const ventanaVencida = !existing || new Date(existing.reset_at).getTime() <= now;

    if (ventanaVencida) {
      const resetAt = new Date(now + this.windowMs).toISOString();
      if (existing) {
        await runSql('UPDATE rate_limit_counters SET count = ?, reset_at = ? WHERE id = ?', [1, resetAt, id]);
      } else {
        await runSql('INSERT INTO rate_limit_counters (id, count, reset_at) VALUES (?, ?, ?)', [id, 1, resetAt]);
      }
      return { totalHits: 1, resetTime: new Date(resetAt) };
    }

    const totalHits = existing.count + 1;
    await runSql('UPDATE rate_limit_counters SET count = ? WHERE id = ?', [totalHits, id]);
    return { totalHits, resetTime: new Date(existing.reset_at) };
  }

  async decrement(key) {
    await ensureTable();
    const id = this._key(key);
    const existing = await getRow('SELECT count FROM rate_limit_counters WHERE id = ?', [id]);
    if (!existing) return;
    const nuevo = Math.max(0, existing.count - 1);
    await runSql('UPDATE rate_limit_counters SET count = ? WHERE id = ?', [nuevo, id]);
  }

  async resetKey(key) {
    await runSql('DELETE FROM rate_limit_counters WHERE id = ?', [this._key(key)]);
  }
}

/**
 * Uso el día que se active (ejemplo, en SecurityMiddleware.js):
 *
 *   import { PostgresRateLimitStore } from './PostgresRateLimitStore.js';
 *
 *   export const financialPipelineLimiter = rateLimit({
 *     windowMs: 15 * 60 * 1000,
 *     max: 20,
 *     store: new PostgresRateLimitStore('financialPipeline'),
 *     keyGenerator: (req) => req.userId || getRateLimitKey(req),
 *     ...
 *   });
 *
 * Limpieza de filas vencidas (opcional, evita crecimiento indefinido de la
 * tabla) — correr como cron ocasional, igual patrón que purgeExpiredTokens():
 *
 *   DELETE FROM rate_limit_counters WHERE reset_at < NOW() - INTERVAL '1 day';
 */
