-- 027_rate_limit_counters.sql
-- Store de rate limiting en Postgres, alternativa a Redis (regla "Cero
-- Bloatware" de este proyecto: nada de infraestructura nueva que correr/
-- monitorear). Compartido entre instancias si algun dia se escala pm2 a
-- mas de 1 proceso -- hoy corre 1 sola instancia, MemoryStore sigue activo,
-- esta tabla queda lista sin usarse todavia (ver PostgresRateLimitStore.js).

CREATE TABLE IF NOT EXISTS rate_limit_counters (
    id         TEXT PRIMARY KEY,   -- `${limiterName}:${key}` (key = org_id o IP)
    count      INTEGER NOT NULL DEFAULT 1,
    reset_at   TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_counters(reset_at);
