-- =============================================================================
-- 072_project_formulador_mga.sql
--
-- Fase 3 (aprobada por el dueño 2026-09-26, "Apruebo la migración 072"):
-- consolidaciones del Formulador MGA en tabla PROPIA, no en ficha_tecnica.
-- Motivo (fiscalización architect 2026-09-26, B1, re-verificado): viabilidad-ia,
-- formulación integral y radicación reescriben ficha_tecnica COMPLETA desde una
-- lectura previa (una consolidación guardada ahí se perdería sin error) y
-- PUT /api/proyectos/:id acepta ficha_tecnica del cliente (se podría falsificar
-- una "redacción de IA" que el PDF imprimiría). Aquí solo escribe el servidor.
--
-- Mismo patrón verificado que 070/071: uuid, project_id text FK ON DELETE
-- CASCADE (la purga por Habeas Data sigue funcionando), org_id, RLS
-- tenant_isolation, SOLO SELECT/INSERT para rf360_rls_scoped (append-only:
-- cada consolidación es una fila, historial auditable).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_formulador_mga (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id          text NOT NULL,
  estado          text NOT NULL CHECK (estado IN ('ok', 'no_disponible')),
  motivo          text,
  bloques         jsonb,
  descartados     jsonb NOT NULL DEFAULT '[]'::jsonb,
  huella_fuentes  text NOT NULL,
  modelo          text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_formulador_mga_project ON project_formulador_mga (project_id, created_at DESC);

ALTER TABLE project_formulador_mga ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_formulador_mga;
CREATE POLICY tenant_isolation ON project_formulador_mga FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

REVOKE ALL ON project_formulador_mga FROM anon, authenticated;
GRANT SELECT, INSERT ON project_formulador_mga TO rf360_rls_scoped;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.project_formulador_mga'::regclass) THEN
    RAISE EXCEPTION '072: RLS no quedó activo — transacción abortada';
  END IF;
  IF NOT has_table_privilege('rf360_rls_scoped', 'public.project_formulador_mga', 'INSERT')
     OR has_table_privilege('rf360_rls_scoped', 'public.project_formulador_mga', 'UPDATE')
     OR has_table_privilege('anon', 'public.project_formulador_mga', 'SELECT') THEN
    RAISE EXCEPTION '072: permisos inesperados — transacción abortada';
  END IF;
END $$;

COMMIT;
