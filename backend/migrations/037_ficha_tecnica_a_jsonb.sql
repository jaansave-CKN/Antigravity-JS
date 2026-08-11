-- 037_ficha_tecnica_a_jsonb.sql
-- Migra proyectos.ficha_tecnica de TEXT a JSONB nativo, cerrando la deriva de
-- esquema real: 001_postgres_schema.sql:54 siempre declaró JSONB, pero nunca
-- se aplicó contra esta base — la fuente de verdad viva era el bootstrap
-- inline de server.js (CREATE TABLE / ALTER TABLE ADD COLUMN, ambos TEXT),
-- confirmado en vivo vía information_schema.columns (auditoría PROTOCOLO
-- TITÁN ∞, 2026-08-10) y corroborado independientemente por
-- 016_formulador_tablas_reales.sql:1-21 (sesión anterior, ya lo documentaba).
--
-- El fallback SQLite que motivó originalmente usar TEXT (portabilidad) es
-- código muerto — sin driver ni dependencia sqlite en el repo, verificado.
--
-- Integridad verificada antes de escribir esta migración: las 7 filas reales
-- de proyectos tenían JSON válido en ficha_tecnica (0 NULL, 0 vacíos,
-- 0 inválidos) — el USING de abajo igual cubre defensivamente NULL/vacío
-- por si se corre contra un entorno con datos distintos.
--
-- APLICAR CON: conexión directa (psql o el SQL Editor de Supabase), NUNCA a
-- través de runSql()/la app — database.config.js convierte cualquier DDL en
-- no-op silencioso cuando el sistema corre en Capa 2 (REST), ver
-- restQuery()/pgOrRest(). Verificar el resultado con information_schema.columns
-- por esa misma vía directa, no inferir éxito de la ausencia de error.
--
-- FUERA DE ALCANCE (deliberado): proyectos.presupuesto es la misma clase de
-- columna (TEXT real pese a JSONB en 001_postgres_schema.sql:55), pero no se
-- toca en esta migración — requiere su propio inventario de call sites.

-- El DEFAULT actual ('{}'::text) no se puede castear automáticamente a jsonb
-- en el mismo ALTER que cambia el tipo (error real 42804, visto en vivo al
-- aplicar esta migración) — se quita primero, se cambia el tipo, se repone.
ALTER TABLE proyectos
  ALTER COLUMN ficha_tecnica DROP DEFAULT;

ALTER TABLE proyectos
  ALTER COLUMN ficha_tecnica TYPE JSONB USING (
    CASE WHEN ficha_tecnica IS NULL OR btrim(ficha_tecnica) = ''
         THEN '{}'::jsonb
         ELSE ficha_tecnica::jsonb
    END
  );

ALTER TABLE proyectos
  ALTER COLUMN ficha_tecnica SET DEFAULT '{}'::jsonb;
