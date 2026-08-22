-- 043_cache_extraccion_y_estado_gemini.sql
--
-- 1. Caché de extracción de anexos (link/archivo) — evita re-descargar y
--    re-parsear en cada clic de "Generar con AI" si el anexo no cambió
--    desde la última extracción. Postgres, no SQLite — este proyecto ya
--    tiene una abstracción (runSql/getRow) que funciona igual sobre pg
--    real o el fallback SQLite legado; agregar un archivo SQLite aparte
--    solo para esto crearía una segunda base de datos desconectada de la
--    que ya usa todo el resto de la app.
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS link_texto_cache TEXT;
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS archivo_texto_cache TEXT;
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS texto_extraido_cache_en TIMESTAMPTZ;

-- 2. Estado del circuit breaker de Gemini persistido por llave — hoy vive
--    solo en memoria (GeminiCircuitBreaker), así que cada reinicio de PM2
--    resetea dailyCount/state a CLOSED/0, aunque la cuota REAL de Google
--    siga agotada del lado de ellos. Con esto, un reinicio no hace que la
--    app crea erróneamente que hay cuota disponible cuando no la hay.
CREATE TABLE IF NOT EXISTS gemini_key_state (
  key_index         INTEGER PRIMARY KEY,
  state             TEXT NOT NULL DEFAULT 'CLOSED',
  daily_count       INTEGER NOT NULL DEFAULT 0,
  daily_reset_at    TIMESTAMPTZ,
  last_quota_error  TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
