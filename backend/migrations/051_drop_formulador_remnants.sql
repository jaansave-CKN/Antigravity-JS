-- =============================================================================
-- 051_drop_formulador_remnants.sql
--
-- Barrido final del patrón `formulador_*` huérfano (ver migración 050).
-- Verificado en vivo el 2026-08-24 antes de escribir esto:
--   - Barrido completo de information_schema.tables con LIKE 'formulador_%':
--     UNA sola tabla restante, formulador_oe.
--   - formulador_oe: 0 filas, 0 tablas dependientes por FK, 0 referencias en
--     todo el código del repo (*.js, *.ts, *.tsx, *.sql).
-- =============================================================================
DROP TABLE IF EXISTS formulador_oe CASCADE;

-- Verificación post-migración
DO $$
DECLARE remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name LIKE 'formulador_%';
  RAISE NOTICE '[formulador_* sweep] tablas restantes con ese prefijo (debe ser 0): %', remaining;
END;
$$;
