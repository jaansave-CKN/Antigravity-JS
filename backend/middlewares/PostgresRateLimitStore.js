/**
 * PostgresRateLimitStore.js — Store de express-rate-limit respaldado en
 * Postgres (tabla rate_limit_counters, migración 027), como alternativa
 * a Redis cuando se escale pm2 a más de 1 instancia — con 1 sola instancia
 * MemoryStore (el default de express-rate-limit) es suficiente y más rápido;
 * este store solo tiene sentido activarlo el día que haya 2+ procesos
 * compartiendo el mismo límite.
 *
 * Implementa la interfaz Store real de express-rate-limit v7
 * (init/increment/decrement/resetKey) — no reemplaza los limiters
 * existentes en SecurityMiddleware.js, solo se les puede pasar como
 * `store: new PostgresRateLimitStore('authLimiter')` cuando haga falta.
 *
 * IMPORTANTE (lección aprendida esta sesión): nunca uses ON CONFLICT en
 * las queries de este store — bajo el fallback REST de database.config.js
 * (Capa 2) esa cláusula se ignora en silencio. Por eso el patrón aquí es
 * SELECT → decide UPDATE o INSERT, ambos con placeholders reales, igual
 * que el resto del código ya corregido en esta sesión.
 */
import { getRow, runSql } from '../config/database.config.js';

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
