-- =============================================================================
-- 066_project_budgets_numeric_cop.sql
--
-- F-01 (auditoría V3, 2026-09-23): las columnas de dinero de project_budgets
-- eran REAL (float4, ~7 dígitos significativos). Verificado en vivo con cast
-- contra la BD real: 1.234.567.891,23 COP se guardaba como 1.234.570.000
-- (pérdida 2.108,77 COP) y 987.654.321.987,45 perdía 321.987,45 COP. Los
-- totales por fase (presupuesto.routes.js) se recalculan desde esta columna,
-- así que el error llegaba al resumen del proyecto. valor_iva era
-- NUMERIC(14,2): un IVA >= 1 billón COP daba "numeric field overflow".
--
-- Tabla con 0 filas al momento de esta migración (verificado) — el cambio de
-- tipo no reescribe datos reales. El USING redondea a centavos por si acaso.
-- Solo columnas en COP: cantidad/rendimientos/aiu no son dinero y no se tocan.
-- =============================================================================

BEGIN;

ALTER TABLE project_budgets
  ALTER COLUMN costo_jornal_dia TYPE NUMERIC(18,2) USING round(costo_jornal_dia::numeric, 2),
  ALTER COLUMN costo_mano_obra  TYPE NUMERIC(18,2) USING round(costo_mano_obra::numeric, 2),
  ALTER COLUMN costo_materiales TYPE NUMERIC(18,2) USING round(costo_materiales::numeric, 2),
  ALTER COLUMN costo_equipos    TYPE NUMERIC(18,2) USING round(costo_equipos::numeric, 2),
  ALTER COLUMN costo_directo    TYPE NUMERIC(18,2) USING round(costo_directo::numeric, 2),
  ALTER COLUMN valor_total      TYPE NUMERIC(18,2) USING round(valor_total::numeric, 2),
  ALTER COLUMN valor_iva        TYPE NUMERIC(18,2);

DO $$
DECLARE malas int;
BEGIN
  SELECT count(*) INTO malas FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'project_budgets'
     AND column_name IN ('costo_jornal_dia','costo_mano_obra','costo_materiales','costo_equipos','costo_directo','valor_total','valor_iva')
     AND NOT (data_type = 'numeric' AND numeric_precision = 18 AND numeric_scale = 2);
  IF malas <> 0 THEN
    RAISE EXCEPTION '066: % columnas no quedaron en NUMERIC(18,2) — transacción abortada', malas;
  END IF;
END $$;

COMMIT;
