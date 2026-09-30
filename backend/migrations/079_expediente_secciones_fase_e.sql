-- =============================================================================
-- 079_expediente_secciones_fase_e.sql
--
-- Fase E (dueño 2026-09-30): el Expediente del Financiador suma 4 secciones
-- independientes — marco_logico (árbol de problemas + matriz 4×4),
-- cadena_valor (sin montos), hseq (ISO 9001/14001/45001) y
-- sostenibilidad_oym (operación y mantenimiento). Solo se amplía el CHECK de
-- `seccion` (nombre verificado en la BD viva: project_expediente_financiador_seccion_check).
-- Aditiva: ninguna fila existente queda fuera del nuevo dominio.
-- =============================================================================

BEGIN;

ALTER TABLE project_expediente_financiador DROP CONSTRAINT IF EXISTS project_expediente_financiador_seccion_check;
ALTER TABLE project_expediente_financiador ADD CONSTRAINT project_expediente_financiador_seccion_check
  CHECK (seccion IN ('marco_logico', 'teoria_cambio', 'cadena_valor', 'salvaguardas', 'hseq', 'mel', 'riesgos_pmi', 'sostenibilidad_oym', 'checklist_juridico'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.project_expediente_financiador'::regclass
       AND conname = 'project_expediente_financiador_seccion_check'
       AND pg_get_constraintdef(oid) LIKE '%sostenibilidad_oym%'
  ) THEN
    RAISE EXCEPTION '079: el CHECK de secciones no quedó ampliado — transacción abortada';
  END IF;
  -- Si el nombre del CHECK viejo no coincidiera, DROP IF EXISTS no haría nada en silencio:
  -- debe quedar EXACTAMENTE un CHECK sobre `seccion` (architect, cond. 6).
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.project_expediente_financiador'::regclass
         AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%seccion%') <> 1 THEN
    RAISE EXCEPTION '079: debe existir un solo CHECK sobre seccion — transacción abortada';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_expediente_financiador'::regclass) THEN
    RAISE EXCEPTION '079: RLS inesperadamente inactivo — transacción abortada';
  END IF;
END $$;

COMMIT;
