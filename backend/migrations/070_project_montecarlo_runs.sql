-- =============================================================================
-- 070_project_montecarlo_runs.sql
--
-- F-06 (decisión del dueño, 2026-09-24): motor Montecarlo real de VAN/TIR.
-- Cada corrida se guarda como FILA propia (historial auditable), NO dentro de
-- proyectos.ficha_tecnica: fiscalización de architect (2026-09-24, B2/B3)
-- verificada en el código — formulacionIntegral.routes.js (persistirProgreso)
-- y server.js (viabilidad-ia) reescriben ficha_tecnica COMPLETA con una copia
-- leída antes de esperar a Gemini, así que una corrida guardada ahí podía
-- desaparecer sin error.
--
-- Mismo patrón que project_sroi_metrics / project_escenarios_estres
-- (verificado en vivo): id uuid, project_id text con FK ON DELETE CASCADE,
-- org_id text, RLS tenant_isolation (026) y GRANT al rol rf360_rls_scoped
-- (053). Solo SELECT/INSERT para ese rol: una corrida no se edita. Sin
-- trigger de inmutabilidad a propósito — la purga de cuenta (Habeas Data,
-- server.js) borra proyectos y esta tabla debe seguir el CASCADE.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_montecarlo_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             text NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id                 text NOT NULL,
  inversion_cop          numeric(18,2) NOT NULL CHECK (inversion_cop > 0),
  inversion_fuente       text NOT NULL,
  beneficio_min_cop      numeric(18,2) NOT NULL CHECK (beneficio_min_cop >= 0),
  beneficio_probable_cop numeric(18,2) NOT NULL,
  beneficio_max_cop      numeric(18,2) NOT NULL,
  horizonte_anios        integer NOT NULL CHECK (horizonte_anios BETWEEN 1 AND 50),
  tasa_descuento         numeric(6,4) NOT NULL,
  iteraciones            integer NOT NULL CHECK (iteraciones BETWEEN 1 AND 10000),
  semilla                bigint NOT NULL,
  resultado              jsonb NOT NULL,
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (beneficio_min_cop <= beneficio_probable_cop AND beneficio_probable_cop <= beneficio_max_cop)
);

CREATE INDEX IF NOT EXISTS idx_montecarlo_runs_project ON project_montecarlo_runs (project_id, created_at DESC);

ALTER TABLE project_montecarlo_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_montecarlo_runs;
CREATE POLICY tenant_isolation ON project_montecarlo_runs FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

REVOKE ALL ON project_montecarlo_runs FROM anon, authenticated;
GRANT SELECT, INSERT ON project_montecarlo_runs TO rf360_rls_scoped;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_montecarlo_runs'::regclass) THEN
    RAISE EXCEPTION '070: RLS no quedó activo — transacción abortada';
  END IF;
  IF NOT has_table_privilege('rf360_rls_scoped', 'public.project_montecarlo_runs', 'INSERT')
     OR has_table_privilege('rf360_rls_scoped', 'public.project_montecarlo_runs', 'UPDATE')
     OR has_table_privilege('anon', 'public.project_montecarlo_runs', 'SELECT') THEN
    RAISE EXCEPTION '070: permisos inesperados — transacción abortada';
  END IF;
END $$;

COMMIT;
