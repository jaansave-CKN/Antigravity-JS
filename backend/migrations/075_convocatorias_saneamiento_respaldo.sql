-- 075_convocatorias_saneamiento_respaldo.sql — 2026-09-29
-- Higiene de datos del catálogo (directiva "Pulido CALCO, higiene de datos",
-- alcance aprobado por el dueño; dictamen architect condición C2).
--
-- SOLO crea la tabla de respaldo. Cada valor que toque
-- backend/scripts/sanearCatalogo.mjs (entidades HTML, montos imposibles) y la
-- migración 076 (duplicados reales) se copia aquí ANTES de cambiarlo, con el
-- lote de la ejecución, para poder revertir una ejecución concreta.
--
-- Uso interno del backend (pool principal); nunca expuesta por PostgREST:
-- RLS activo SIN políticas, sin permisos para anon/authenticated ni para
-- rf360_rls_scoped.
--
-- Revertir un lote (ejemplo, montos):
--   UPDATE convocatorias c SET monto_max = r.valor_anterior::real
--     FROM convocatorias_saneamiento_respaldo r
--    WHERE r.lote = '<lote>' AND r.campo = 'monto_max' AND r.convocatoria_id = c.id;

BEGIN;

CREATE TABLE IF NOT EXISTS convocatorias_saneamiento_respaldo (
  id              bigserial PRIMARY KEY,
  lote            text        NOT NULL,
  convocatoria_id text        NOT NULL,
  campo           text        NOT NULL CHECK (campo IN ('titulo', 'descripcion', 'donante', 'monto_min', 'monto_max', 'deleted_at')),
  valor_anterior  text,
  valor_nuevo     text,
  motivo          text        NOT NULL,
  saneado_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conv_saneamiento_lote ON convocatorias_saneamiento_respaldo (lote);
CREATE INDEX IF NOT EXISTS idx_conv_saneamiento_conv ON convocatorias_saneamiento_respaldo (convocatoria_id);

ALTER TABLE convocatorias_saneamiento_respaldo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON convocatorias_saneamiento_respaldo FROM anon, authenticated;
REVOKE ALL ON SEQUENCE convocatorias_saneamiento_respaldo_id_seq FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf360_rls_scoped') THEN
    EXECUTE 'REVOKE ALL ON convocatorias_saneamiento_respaldo FROM rf360_rls_scoped';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.convocatorias_saneamiento_respaldo'::regclass) THEN
    RAISE EXCEPTION '075: RLS no quedó activo — transacción abortada';
  END IF;
  IF has_table_privilege('anon', 'public.convocatorias_saneamiento_respaldo', 'SELECT')
     OR has_table_privilege('authenticated', 'public.convocatorias_saneamiento_respaldo', 'SELECT') THEN
    RAISE EXCEPTION '075: la tabla de respaldo quedó legible por anon/authenticated — transacción abortada';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf360_rls_scoped')
     AND has_table_privilege('rf360_rls_scoped', 'public.convocatorias_saneamiento_respaldo', 'SELECT') THEN
    RAISE EXCEPTION '075: rf360_rls_scoped no debe acceder a la tabla de respaldo — transacción abortada';
  END IF;
END $$;

COMMIT;
