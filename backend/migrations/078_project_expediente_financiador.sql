-- =============================================================================
-- 078_project_expediente_financiador.sql
--
-- Fase C de la directiva "Audit de Impacto Integral" (dueño 2026-09-30):
-- Expediente del Financiador en Viabilidad (backend/services/expedienteFinanciador.js).
-- Una fila por generación de sección (historial auditable, como 071): la
-- lectura toma la última por (project_id, seccion). Nunca UPDATE ni DELETE
-- desde la app.
--
-- Mismo patrón verificado que 070/071: uuid, project_id text FK ON DELETE
-- CASCADE (la purga de cuenta por Habeas Data sigue funcionando), org_id,
-- RLS tenant_isolation y GRANT SELECT/INSERT a rf360_rls_scoped.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_expediente_financiador (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id      text NOT NULL,
  seccion     text NOT NULL CHECK (seccion IN ('teoria_cambio', 'salvaguardas', 'mel', 'riesgos_pmi', 'checklist_juridico')),
  estado      text NOT NULL CHECK (estado IN ('ok', 'sin_contenido_verificable')),
  contenido   jsonb NOT NULL,
  descartados jsonb NOT NULL DEFAULT '[]'::jsonb,
  directivas  jsonb NOT NULL,
  huella      text NOT NULL,
  modelo      text,
  proveedor   text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expediente_fin_project ON project_expediente_financiador (project_id, seccion, created_at DESC);

ALTER TABLE project_expediente_financiador ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_expediente_financiador;
CREATE POLICY tenant_isolation ON project_expediente_financiador FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

REVOKE ALL ON project_expediente_financiador FROM anon, authenticated;
GRANT SELECT, INSERT ON project_expediente_financiador TO rf360_rls_scoped;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_expediente_financiador'::regclass) THEN
    RAISE EXCEPTION '078: RLS no quedó activo — transacción abortada';
  END IF;
  IF NOT has_table_privilege('rf360_rls_scoped', 'public.project_expediente_financiador', 'INSERT')
     OR has_table_privilege('rf360_rls_scoped', 'public.project_expediente_financiador', 'UPDATE')
     OR has_table_privilege('anon', 'public.project_expediente_financiador', 'SELECT') THEN
    RAISE EXCEPTION '078: permisos inesperados — transacción abortada';
  END IF;
END $$;

COMMIT;
