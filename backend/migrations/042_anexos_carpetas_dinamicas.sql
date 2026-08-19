-- 042_anexos_carpetas_dinamicas.sql
--
-- Extiende Anexos con el mismo sistema de carpetas dinámicas ya construido y
-- verificado en Biblioteca (migración 040) — mandato del usuario 2026-08-17:
-- "la configuración como la tienes en biblioteca me gustaría que también la
-- tuviera anexos tal cual, así puedo crear carpetas, editarlas, eliminarlas".
--
-- Decisiones de diseño (mismas que 040, replicadas por consistencia):
--  1. Tabla nueva `project_anexos_carpetas`, aislada de
--     `project_biblioteca_carpetas` — Anexos y Biblioteca son sistemas
--     deliberadamente separados (bucket propio, sin pipeline compartido, ver
--     comentario en biblioteca.routes.js) — no se reutiliza la tabla de
--     Biblioteca aunque el esquema sea idéntico.
--  2. `project_anexos.carpeta_id` NULLABLE — "sin carpeta" es válido.
--  3. FK con ON DELETE SET NULL, nunca CASCADE — borrar una carpeta no debe
--     borrar anexos reales (fila + archivo en Storage) de forma implícita.
--  4. `categoria` (que hoy determina el toggle "Técnico" y dispara
--     ExtractorService/AuditorForenseService para Excel `presupuesto_apu`)
--     NO se toca — sigue siendo el campo funcional real, independiente de
--     `carpeta_id`. Las carpetas son puramente organizativas, igual que en
--     Biblioteca; el toggle "Técnico" se mantiene como columna aparte.
--  5. Backfill: los anexos ya existentes se reparten en 2 carpetas seed
--     ("Documentos Técnicos"/"Anexos Generales") según su `categoria` actual
--     — exactamente la agrupación que el usuario ya ve hoy en pantalla, para
--     que la migración sea invisible (cero anexos huérfanos, cero cambio
--     visual) hasta que el usuario decida crear/renombrar carpetas.

CREATE TABLE IF NOT EXISTS project_anexos_carpetas (
  id         TEXT      PRIMARY KEY,
  project_id TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  tenant_id  TEXT      NOT NULL,
  nombre     TEXT      NOT NULL,
  orden      INTEGER   NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_anexos_carpetas_project ON project_anexos_carpetas (project_id);

ALTER TABLE project_anexos_carpetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_anexos_carpetas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_anexos_carpetas;
CREATE POLICY tenant_isolation ON project_anexos_carpetas
  FOR ALL USING (tenant_id = current_setting('app.org_id', true))
  WITH CHECK (tenant_id = current_setting('app.org_id', true));

ALTER TABLE project_anexos
  ADD COLUMN IF NOT EXISTS carpeta_id TEXT REFERENCES project_anexos_carpetas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_anexos_carpeta ON project_anexos (carpeta_id);

-- ── Backfill: 2 carpetas seed por proyecto con anexos existentes ────────────
DO $$
DECLARE
  proj RECORD;
  tecnica_id TEXT;
  general_id TEXT;
BEGIN
  FOR proj IN
    SELECT DISTINCT project_id, tenant_id FROM project_anexos WHERE carpeta_id IS NULL
  LOOP
    tecnica_id := gen_random_uuid()::text;
    general_id := gen_random_uuid()::text;

    INSERT INTO project_anexos_carpetas (id, project_id, tenant_id, nombre, orden)
      VALUES (tecnica_id, proj.project_id, proj.tenant_id, 'Documentos Técnicos', 0);
    INSERT INTO project_anexos_carpetas (id, project_id, tenant_id, nombre, orden)
      VALUES (general_id, proj.project_id, proj.tenant_id, 'Anexos Generales', 1);

    UPDATE project_anexos SET carpeta_id = tecnica_id
      WHERE project_id = proj.project_id AND categoria IN ('tecnico', 'presupuesto_apu') AND carpeta_id IS NULL;
    UPDATE project_anexos SET carpeta_id = general_id
      WHERE project_id = proj.project_id AND carpeta_id IS NULL;
  END LOOP;
END $$;
