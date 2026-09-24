-- =============================================================================
-- 069_anexos_vigencia_documental.sql
--
-- F-10 (decisión del dueño, 2026-09-24): vigencia documental en Anexos.
--   libertad_tradicion → obsoleto a los 30 días
--   apu_cotizacion     → obsoleto a los 6 meses
--   general            → sin caducidad; advertencia visual si supera 1 año
-- El cálculo vive en backend/services/vigenciaDocumental.js (puro); aquí solo
-- el dato: fecha de emisión del documento y su tipo de vigencia.
--
-- Default de tipo por categoría: un anexo categoria='presupuesto_apu' ES un
-- APU, así que nace 'apu_cotizacion' sin tocar el upload existente. El
-- trigger de UPDATE solo actúa cuando la categoría CAMBIA de verdad
-- (fiscalización architect 2026-09-24, B1): el frontend reenvía `categoria`
-- en cada guardado por blur (AnexosCalcoView.tsx) y un trigger "UPDATE OF
-- categoria" sin WHEN revertiría en silencio el tipo elegido a mano.
--
-- GRANT a rf360_rls_scoped es a nivel de tabla (055) → cubre las columnas
-- nuevas. Se aplica ANTES de desplegar el código que las lee (B3): el GET de
-- anexos las pide explícitamente y respondería 500 sin ellas.
-- =============================================================================

BEGIN;

ALTER TABLE project_anexos
  ADD COLUMN IF NOT EXISTS fecha_documento date NULL,
  ADD COLUMN IF NOT EXISTS tipo_vigencia text NOT NULL DEFAULT 'general';

ALTER TABLE project_anexos DROP CONSTRAINT IF EXISTS project_anexos_tipo_vigencia_check;
ALTER TABLE project_anexos ADD CONSTRAINT project_anexos_tipo_vigencia_check
  CHECK (tipo_vigencia IN ('libertad_tradicion', 'apu_cotizacion', 'general'));

UPDATE project_anexos SET tipo_vigencia = 'apu_cotizacion'
 WHERE categoria = 'presupuesto_apu' AND tipo_vigencia = 'general';

CREATE OR REPLACE FUNCTION rf360_anexo_tipo_vigencia_por_categoria() RETURNS trigger
LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.categoria = 'presupuesto_apu' AND NEW.tipo_vigencia = 'general' THEN
    NEW.tipo_vigencia := 'apu_cotizacion';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_anexo_vigencia_insert ON project_anexos;
CREATE TRIGGER trg_anexo_vigencia_insert BEFORE INSERT ON project_anexos
  FOR EACH ROW EXECUTE FUNCTION rf360_anexo_tipo_vigencia_por_categoria();

DROP TRIGGER IF EXISTS trg_anexo_vigencia_categoria ON project_anexos;
CREATE TRIGGER trg_anexo_vigencia_categoria BEFORE UPDATE OF categoria ON project_anexos
  FOR EACH ROW WHEN (OLD.categoria IS DISTINCT FROM NEW.categoria)
  EXECUTE FUNCTION rf360_anexo_tipo_vigencia_por_categoria();

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'project_anexos'
         AND column_name IN ('fecha_documento', 'tipo_vigencia')) <> 2 THEN
    RAISE EXCEPTION '069: columnas no creadas — transacción abortada';
  END IF;
  IF EXISTS (SELECT 1 FROM project_anexos WHERE categoria = 'presupuesto_apu' AND tipo_vigencia <> 'apu_cotizacion') THEN
    RAISE EXCEPTION '069: backfill incompleto — transacción abortada';
  END IF;
END $$;

COMMIT;
