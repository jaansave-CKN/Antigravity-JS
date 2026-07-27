-- 024_project_chat_history.sql
-- Historial de conversación del Co-Piloto RadFor-360 (Gemini) por proyecto.
-- project_id/org_id son TEXT: proyectos.id es TEXT en el esquema real (bootstrap
-- server.js), mismo patrón usado en project_apu_lineas/project_hallazgos/etc.

CREATE TABLE IF NOT EXISTS project_chat_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT NOT NULL,
    modulo_activo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_history_project ON project_chat_history(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_org     ON project_chat_history(org_id);
ALTER TABLE project_chat_history ENABLE ROW LEVEL SECURITY;
