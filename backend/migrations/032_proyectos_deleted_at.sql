-- 032_proyectos_deleted_at.sql
-- server.js (initDb, CREATE TABLE IF NOT EXISTS proyectos + el posterior
-- "ALTER TABLE proyectos ADD COLUMN deleted_at...") siempre asumió que esta
-- columna existía, pero un `SELECT column_name FROM information_schema.columns
-- WHERE table_name='proyectos'` contra la BD real (2026-08-04) confirmó que
-- NUNCA se creó — probable causa: la ALTER TABLE vive en un try{}catch{}
-- silencioso, y solo corre contra Capa 1 (pg.Pool); si DATABASE_URL estaba
-- roto en el momento del primer arranque real (documentado esta misma sesión
-- en el incidente de deploy de Render), el ALTER falló en silencio y Capa 2
-- (REST) nunca pudo compensarlo — PostgREST no ejecuta DDL.
-- Confirmado el bug real disparando DELETE /api/proyectos/:id en vivo:
-- "[REST] column proyectos.deleted_at does not exist".

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
