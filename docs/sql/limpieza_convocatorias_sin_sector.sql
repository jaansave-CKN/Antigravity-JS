-- ============================================================================
-- Purga de las 93 convocatorias sin sector — con archivo de respaldo (2026-09-23)
-- Transacción única: si cualquier verificación falla, NADA se aplica.
-- Verificado el 2026-09-23: ninguna FK apunta a convocatorias y ningún
-- favorito referencia estas filas.
-- ============================================================================

BEGIN;

-- 1. Respaldo con las 93 filas exactas (misma estructura que convocatorias).
CREATE TABLE convocatorias_archivo AS
  SELECT * FROM convocatorias
  WHERE deleted_at IS NULL AND sectores = '[]';

-- 2. Verificar el respaldo ANTES de borrar.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM convocatorias_archivo;
  IF n <> 93 THEN
    RAISE EXCEPTION 'Respaldo con % filas (se esperaban 93) — transacción abortada', n;
  END IF;
END $$;

-- 3. Borrado físico SOLO de las filas respaldadas (por id, no por condición).
DELETE FROM convocatorias c
USING convocatorias_archivo a
WHERE c.id = a.id;

-- 4. Verificar que se borró exactamente lo respaldado.
DO $$
DECLARE restantes int;
BEGIN
  SELECT count(*) INTO restantes FROM convocatorias c JOIN convocatorias_archivo a ON a.id = c.id;
  IF restantes <> 0 THEN
    RAISE EXCEPTION 'Quedaron % filas sin borrar — transacción abortada', restantes;
  END IF;
END $$;

COMMIT;

-- Restaurar si hiciera falta:
-- BEGIN;
-- INSERT INTO convocatorias SELECT * FROM convocatorias_archivo;
-- COMMIT;
