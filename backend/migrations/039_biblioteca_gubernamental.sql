-- 039_biblioteca_gubernamental.sql
--
-- Módulo "Biblioteca Gubernamental" (Bloque B, junto a Anexos) — mandato del
-- usuario 2026-08-16: clon aislado de project_anexos, sin el pipeline
-- financiero (ExtractorService/AuditorForenseService) que sí aplica a Anexos
-- — revisado con el agente architect antes de escribir esta migración.
--
-- Mismo patrón de columnas que project_anexos (016_formulador_tablas_reales.sql
-- líneas 59-73: id/project_id TEXT, no UUID — así es como vive la tabla real
-- en producción, a diferencia de lo que dice 013 que nunca se ejecutó tal
-- cual). categoria NO incluye 'presupuesto_apu': la Biblioteca no dispara
-- extracción de presupuestos, es un repositorio de documentos de referencia.
CREATE TABLE IF NOT EXISTS project_biblioteca (
  id             TEXT      PRIMARY KEY,
  project_id     TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  tenant_id      TEXT      NOT NULL,
  nombre_archivo TEXT      NOT NULL,
  ruta_storage   TEXT      NOT NULL,
  tipo_mime      TEXT      NOT NULL,
  tamano_bytes   BIGINT    NOT NULL DEFAULT 0,
  categoria      TEXT      CHECK (categoria IN ('legal','financiero','tecnico','institucional','otro')) DEFAULT 'otro',
  descripcion    TEXT,
  texto          TEXT,
  link           TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_biblioteca_project ON project_biblioteca (project_id);

-- RLS hermana de project_anexos (026_rls_policies_tenant_isolation.sql:35) —
-- defensa en profundidad; el backend real sigue conectando con service_role
-- (bypasea RLS) y el aislamiento efectivo es el checkOwnership manual
-- (WHERE org_id = ?) en biblioteca.routes.js, igual que en anexos.routes.js.
ALTER TABLE project_biblioteca ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_biblioteca FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON project_biblioteca;
CREATE POLICY tenant_isolation ON project_biblioteca
  FOR ALL USING (tenant_id = current_setting('app.org_id', true))
  WITH CHECK (tenant_id = current_setting('app.org_id', true));

-- Idempotente: seguro de correr aunque la tabla ya exista.
