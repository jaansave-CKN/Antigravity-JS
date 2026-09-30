-- 077_respaldo_admite_estado.sql — 2026-09-29
-- Curaduría del catálogo (directiva "Sellado de puntos ciegos", fase 2, decisión
-- del dueño): ~14 programas reales pasan a estado 'fondo_continuo'. Cada cambio
-- de estado se respalda en convocatorias_saneamiento_respaldo, cuyo CHECK (075)
-- no admitía el campo 'estado'.
--
-- La CHECK de 075 es ANÓNIMA (Postgres le puso nombre automático): se busca en
-- pg_constraint en vez de suponer su nombre, y se reemplaza por una con nombre.
-- Aplicar en producción ANTES de `purgarBasuraCatalogo.mjs --curaduria`.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.convocatorias_saneamiento_respaldo'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%campo%'
  LOOP
    EXECUTE format('ALTER TABLE convocatorias_saneamiento_respaldo DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE convocatorias_saneamiento_respaldo
  ADD CONSTRAINT conv_saneamiento_respaldo_campo_valido
  CHECK (campo IN ('titulo', 'descripcion', 'donante', 'monto_min', 'monto_max', 'deleted_at', 'estado'));

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.convocatorias_saneamiento_respaldo'::regclass AND contype = 'c') <> 1 THEN
    RAISE EXCEPTION '077: debe quedar exactamente una CHECK sobre campo — transacción abortada';
  END IF;
  IF NOT (SELECT pg_get_constraintdef(oid) ILIKE '%estado%' FROM pg_constraint
           WHERE conname = 'conv_saneamiento_respaldo_campo_valido') THEN
    RAISE EXCEPTION '077: la CHECK nueva no admite estado — transacción abortada';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.convocatorias_saneamiento_respaldo'::regclass) THEN
    RAISE EXCEPTION '077: la tabla de respaldo perdió RLS — transacción abortada';
  END IF;
END $$;

COMMIT;
