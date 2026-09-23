-- ============================================================================
-- Limpieza de las convocatorias que nunca obtuvieron sector (2026-09-23)
-- NO SE EJECUTÓ AUTOMÁTICAMENTE. Revisar el PASO 1 antes de correr el PASO 2.
--
-- Contexto verificado: 93 filas con sectores = '[]', creadas entre 2026-06-11 y
-- 2026-09-06 por el rastreo del Directorio. Muchos títulos son basura
-- ("Formulario de solicitud", "Projects &amp Programmes"), pero ALGUNOS pueden
-- ser convocatorias reales con metadatos pobres (p. ej. "PREMIOS GLOBAL CITIZEN
-- WAISLITZ 2025") — por eso es borrado LÓGICO con respaldo, no DELETE físico.
-- Efecto: dejan de aparecer en el Radar (todas las consultas filtran deleted_at).
-- ============================================================================

-- PASO 1 · Revisar (solo lectura) ---------------------------------------------
BEGIN READ ONLY;
SELECT id, left(titulo, 90) AS titulo, length(coalesce(descripcion, '')) AS len_desc,
       fuente, created_at::date
FROM convocatorias
WHERE deleted_at IS NULL AND sectores = '[]'
ORDER BY created_at;
COMMIT;

-- PASO 2 · Respaldo + borrado lógico, atómico ---------------------------------
BEGIN;
CREATE TABLE IF NOT EXISTS respaldo_convocatorias_sin_sector_20260923 AS
  SELECT * FROM convocatorias WHERE false;
INSERT INTO respaldo_convocatorias_sin_sector_20260923
  SELECT * FROM convocatorias WHERE deleted_at IS NULL AND sectores = '[]';

UPDATE convocatorias
SET deleted_at = NOW()
WHERE deleted_at IS NULL AND sectores = '[]'
  AND id IN (SELECT id FROM respaldo_convocatorias_sin_sector_20260923);

-- Verificación: debe coincidir con el conteo revisado en el PASO 1 (93 al
-- 2026-09-23). Si no coincide, ROLLBACK en vez de COMMIT.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM respaldo_convocatorias_sin_sector_20260923;
  IF n <> 93 THEN RAISE EXCEPTION 'Conteo inesperado: % (se esperaban 93) — abortando', n; END IF;
END $$;
COMMIT;

-- REVERTIR (si hiciera falta) ---------------------------------------------------
-- BEGIN;
-- UPDATE convocatorias c SET deleted_at = NULL
-- FROM respaldo_convocatorias_sin_sector_20260923 r WHERE c.id = r.id;
-- COMMIT;
