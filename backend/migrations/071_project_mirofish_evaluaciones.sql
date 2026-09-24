-- =============================================================================
-- 071_project_mirofish_evaluaciones.sql
--
-- F-09 (decisión del dueño, 2026-09-24): comité hostil MIROFISH = reglas
-- deterministas (PDET → rubro de seguridad) + IA adversarial con BYOK.
-- Cada convocatoria del comité es una fila (historial auditable). No se
-- escribe en project_hallazgos a propósito (fiscalización architect
-- 2026-09-24): re-ejecutar duplicaría hallazgos y sus severidades
-- (INFO/ALERTA/CRITICO, migración 019) no coinciden con las de MIROFISH.
--
-- Mismo patrón verificado que 070: uuid, project_id text FK ON DELETE
-- CASCADE (la purga de cuenta por Habeas Data sigue funcionando), org_id,
-- RLS tenant_isolation y GRANT SELECT/INSERT a rf360_rls_scoped.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_mirofish_evaluaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id          text NOT NULL,
  municipio_match jsonb NOT NULL,
  reglas          jsonb NOT NULL,
  ia              jsonb NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mirofish_eval_project ON project_mirofish_evaluaciones (project_id, created_at DESC);

ALTER TABLE project_mirofish_evaluaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_mirofish_evaluaciones;
CREATE POLICY tenant_isolation ON project_mirofish_evaluaciones FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

REVOKE ALL ON project_mirofish_evaluaciones FROM anon, authenticated;
GRANT SELECT, INSERT ON project_mirofish_evaluaciones TO rf360_rls_scoped;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_mirofish_evaluaciones'::regclass) THEN
    RAISE EXCEPTION '071: RLS no quedó activo — transacción abortada';
  END IF;
  IF NOT has_table_privilege('rf360_rls_scoped', 'public.project_mirofish_evaluaciones', 'INSERT')
     OR has_table_privilege('rf360_rls_scoped', 'public.project_mirofish_evaluaciones', 'UPDATE')
     OR has_table_privilege('anon', 'public.project_mirofish_evaluaciones', 'SELECT') THEN
    RAISE EXCEPTION '071: permisos inesperados — transacción abortada';
  END IF;
END $$;

COMMIT;
