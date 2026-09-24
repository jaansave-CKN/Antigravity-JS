-- =============================================================================
-- 067_rls_convocatorias_archivo.sql
--
-- F-05 (auditoría V3, 2026-09-23): convocatorias_archivo (respaldo de las 93
-- convocatorias sin sector, docs/sql/limpieza_convocatorias_sin_sector.sql)
-- se creó con CREATE TABLE AS, que no hereda RLS ni revoca los GRANT por
-- defecto de Supabase. Verificado en vivo: la llave anon leía las 93 filas por
-- PostgREST (HTTP 206, Content-Range 0-0/93).
--
-- Es un respaldo interno: ninguna ruta del backend ni el frontend lo lee. RLS
-- sin políticas + REVOKE deja el acceso solo a los roles con BYPASSRLS
-- (postgres/service_role), que es como se restauraría si hiciera falta.
-- =============================================================================

BEGIN;

ALTER TABLE convocatorias_archivo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON convocatorias_archivo FROM anon, authenticated;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.convocatorias_archivo'::regclass) THEN
    RAISE EXCEPTION '067: RLS no quedó activo — transacción abortada';
  END IF;
  IF has_table_privilege('anon', 'public.convocatorias_archivo', 'SELECT')
     OR has_table_privilege('authenticated', 'public.convocatorias_archivo', 'SELECT') THEN
    RAISE EXCEPTION '067: anon/authenticated conservan SELECT — transacción abortada';
  END IF;
END $$;

COMMIT;
