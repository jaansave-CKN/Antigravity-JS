-- 040_biblioteca_carpetas_dinamicas.sql
--
-- Reemplaza las 2 carpetas fijas de Biblioteca (Documentos Técnicos/Generales,
-- derivadas antes del enum `categoria`) por carpetas dinámicas ilimitadas por
-- proyecto. Revisado con el agente architect antes de escribir esta migración
-- (2026-08-16) — decisiones de diseño documentadas aquí porque el mandato
-- original dejaba una abierta:
--
--  1. Tabla nueva `project_biblioteca_carpetas` (no un texto libre en
--     `categoria`) — una carpeta vacía recién creada debe poder existir y
--     listarse, algo imposible con un modelo derivado de valores distintos.
--  2. `project_biblioteca.carpeta_id` es NULLABLE — documentos "sin carpeta"
--     es un estado válido (los que ya existían hoy antes de esta migración
--     quedan re-mapeados a 2 carpetas seed más abajo, no huérfanos).
--  3. FK con ON DELETE SET NULL, NUNCA CASCADE por defecto: eliminar una
--     carpeta no debe borrar archivos reales de Storage de forma implícita.
--     biblioteca.routes.js ya trata el borrado de un documento como
--     irreversible (fila + objeto en Storage); encadenar eso a un borrado de
--     carpeta sin confirmación explícita por documento sería una pérdida de
--     datos silenciosa. El borrado explícito de documentos junto con su
--     carpeta es una acción aparte y opt-in en el backend (query param
--     ?eliminarDocumentos=true en DELETE .../carpetas/:carpetaId).
--  4. `categoria` en project_biblioteca NO se toca ni se elimina — queda
--     deprecada (el frontend deja de usarla para agrupar) pero el PATCH
--     existente que la actualiza sigue funcionando hasta un retiro explícito
--     posterior.
--  5. Backfill: los documentos ya insertados hoy (categoria='tecnico'/'otro')
--     se migran a 2 carpetas seed por proyecto para no perder su
--     clasificación visible al aplicar esta migración.

CREATE TABLE IF NOT EXISTS project_biblioteca_carpetas (
  id         TEXT      PRIMARY KEY,
  project_id TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  tenant_id  TEXT      NOT NULL,
  nombre     TEXT      NOT NULL,
  orden      INTEGER   NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_biblioteca_carpetas_project ON project_biblioteca_carpetas (project_id);

ALTER TABLE project_biblioteca_carpetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_biblioteca_carpetas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON project_biblioteca_carpetas;
CREATE POLICY tenant_isolation ON project_biblioteca_carpetas
  FOR ALL USING (tenant_id = current_setting('app.org_id', true))
  WITH CHECK (tenant_id = current_setting('app.org_id', true));

ALTER TABLE project_biblioteca
  ADD COLUMN IF NOT EXISTS carpeta_id TEXT REFERENCES project_biblioteca_carpetas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_biblioteca_carpeta ON project_biblioteca (carpeta_id);

-- ── Backfill: 2 carpetas seed por proyecto con documentos existentes ─────────
DO $$
DECLARE
  proj RECORD;
  tecnica_id TEXT;
  general_id TEXT;
BEGIN
  FOR proj IN
    SELECT DISTINCT project_id, tenant_id FROM project_biblioteca WHERE carpeta_id IS NULL
  LOOP
    tecnica_id := gen_random_uuid()::text;
    general_id := gen_random_uuid()::text;

    INSERT INTO project_biblioteca_carpetas (id, project_id, tenant_id, nombre, orden)
      VALUES (tecnica_id, proj.project_id, proj.tenant_id, 'Documentos Técnicos', 0);
    INSERT INTO project_biblioteca_carpetas (id, project_id, tenant_id, nombre, orden)
      VALUES (general_id, proj.project_id, proj.tenant_id, 'Documentos Generales', 1);

    UPDATE project_biblioteca SET carpeta_id = tecnica_id
      WHERE project_id = proj.project_id AND categoria = 'tecnico' AND carpeta_id IS NULL;
    UPDATE project_biblioteca SET carpeta_id = general_id
      WHERE project_id = proj.project_id AND carpeta_id IS NULL;
  END LOOP;
END $$;
