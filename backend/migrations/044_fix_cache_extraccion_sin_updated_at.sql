-- 044_fix_cache_extraccion_sin_updated_at.sql
--
-- Corrige 043: la invalidación de caché por "updated_at >= cache_en" asumía
-- que project_anexos tiene una columna updated_at — verificado en vivo que
-- NO la tiene (solo created_at). texto_extraido_cache_en (043) queda sin
-- ningún consumidor real — se reemplaza por invalidación basada en
-- contenido: cada canal (link/archivo) guarda además el valor exacto que
-- se cacheó; si ese valor cambia (el usuario edita el link o sube otro
-- archivo), la caché para ESE canal se invalida sola, sin depender de
-- ninguna columna de timestamp de modificación de fila.
ALTER TABLE project_anexos DROP COLUMN IF EXISTS texto_extraido_cache_en;
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS link_cache_de TEXT;
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS archivo_cache_de TEXT;
