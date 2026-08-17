-- 041_anexos_embedding_semantico.sql
--
-- Búsqueda semántica sobre el contenido de Anexos (mandato del usuario
-- 2026-08-17, alcance corregido tras revisión con el agente architect:
-- objeción al pedido original — ver commit de esta migración para el
-- veredicto completo). Alcance confirmado por el usuario:
--   1. Conectar al RAG real del proyecto (embeddingsService.js + pgvector),
--      NO a `motor_dialectico` (que es config de tono/estilo narrativo, sin
--      relación con búsqueda semántica — premisa falsa del pedido original).
--   2. Solo Anexos — Biblioteca se diseñó explícitamente el mismo día para
--      NO tener pipeline de extracción estructurada (ver migración 040 y
--      biblioteca.routes.js). Esta migración NO toca project_biblioteca.
--
-- Mismo patrón ya usado en producción para proyectos.embedding/
-- convocatorias.embedding (001_postgres_schema.sql) — columna TEXT (JSON,
-- fallback universal/SQLite) + columna vector(768) nativa para pgvector.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS embedding TEXT;
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS embedding_vec vector(768);

CREATE INDEX IF NOT EXISTS idx_project_anexos_embedding_vec
  ON project_anexos USING hnsw (embedding_vec vector_cosine_ops);
