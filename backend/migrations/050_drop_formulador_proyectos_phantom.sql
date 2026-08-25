-- =============================================================================
-- 050_drop_formulador_proyectos_phantom.sql
--
-- Elimina un subsistema completo huérfano: `formulador_proyectos` y sus 5
-- tablas hijas (formulador_presupuesto, formulador_validaciones_financieras,
-- formulador_objetivos, formulador_cronograma, formulador_indicadores) —
-- verificado en vivo el 2026-08-24 antes de escribir esto:
--   - CERO referencias en todo el código del repo (*.js, *.ts, *.tsx, *.sql)
--     para las 6 tablas — ninguna migración rastreada las crea tampoco.
--   - Las 2 filas de formulador_proyectos están auto-etiquetadas como datos
--     de prueba a borrar: "TEST_AUDIT_TENANT_A — borrar manualmente" y
--     "TITAN_TEST_AISLAMIENTO_1786802510072_BORRAR".
--   - Las 5 tablas hijas tienen 2 filas cada una (0 en formulador_indicadores)
--     — consistente con 1 fila por proyecto de prueba, ningún dato real.
-- DROP CASCADE elimina automáticamente las 5 hijas vía sus propias FK
-- ON DELETE CASCADE hacia formulador_proyectos — se listan explícitas abajo
-- de todas formas, por si alguna perdiera esa FK en el futuro.
-- =============================================================================
DROP TABLE IF EXISTS formulador_proyectos CASCADE;
DROP TABLE IF EXISTS formulador_presupuesto CASCADE;
DROP TABLE IF EXISTS formulador_validaciones_financieras CASCADE;
DROP TABLE IF EXISTS formulador_objetivos CASCADE;
DROP TABLE IF EXISTS formulador_cronograma CASCADE;
DROP TABLE IF EXISTS formulador_indicadores CASCADE;

-- Verificación post-migración
DO $$
DECLARE remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN (
    'formulador_proyectos','formulador_presupuesto',
    'formulador_validaciones_financieras','formulador_objetivos',
    'formulador_cronograma','formulador_indicadores'
  );
  RAISE NOTICE '[phantom cleanup] tablas restantes de las 6 (debe ser 0): %', remaining;
END;
$$;
