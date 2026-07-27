-- 019_project_apu_lineas_y_hallazgos.sql
-- "Pieza Cero" — ingesta de presupuestos/APU adjuntos como datos estructurados.
--
-- Diseño (revisado tras auditoría): project_apu_lineas queda EXCLUSIVAMENTE
-- para las líneas numéricas del presupuesto en COP. Los hallazgos de auditoría
-- a nivel de proyecto/anexo (ej. "no hay presupuesto de seguridad industrial")
-- viven en project_hallazgos, una tabla aparte — un hallazgo de "ausencia
-- total" no puede ser un UPDATE sobre filas que no existen.
--
-- project_id/anexo_id/org_id son TEXT (no UUID): proyectos.id y
-- project_anexos.id son TEXT en el esquema real de esta instancia (bootstrap
-- de server.js, no las migraciones formales 001-010) — verificado contra
-- information_schema antes de escribir esto.

CREATE TABLE IF NOT EXISTS project_apu_lineas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    anexo_id TEXT NOT NULL REFERENCES project_anexos(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    codigo_item VARCHAR(50),
    descripcion TEXT NOT NULL,
    unidad VARCHAR(20),
    cantidad NUMERIC(12, 4) NOT NULL DEFAULT 0,
    valor_unitario_cop NUMERIC(15, 2) NOT NULL DEFAULT 0,
    valor_total_cop NUMERIC(18, 2) NOT NULL DEFAULT 0,
    categoria_hseq VARCHAR(50) NOT NULL DEFAULT 'NINGUNA'
        CHECK (categoria_hseq IN ('EPP', 'SEÑALIZACION', 'AMBIENTAL', 'SST', 'NINGUNA')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT check_valores_positivos CHECK (cantidad >= 0 AND valor_unitario_cop >= 0 AND valor_total_cop >= 0)
);
CREATE INDEX IF NOT EXISTS idx_apu_lineas_project ON project_apu_lineas(project_id);
CREATE INDEX IF NOT EXISTS idx_apu_lineas_anexo   ON project_apu_lineas(anexo_id);
ALTER TABLE project_apu_lineas ENABLE ROW LEVEL SECURITY;

-- Hallazgos de auditoría a nivel de proyecto/anexo — no son certificaciones
-- legales, son alertas de coherencia técnica (ver ExtractorService.js).
CREATE TABLE IF NOT EXISTS project_hallazgos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
    anexo_id TEXT REFERENCES project_anexos(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    tipo VARCHAR(50) NOT NULL,
    severidad VARCHAR(20) NOT NULL DEFAULT 'ALERTA'
        CHECK (severidad IN ('INFO', 'ALERTA', 'CRITICO')),
    titulo TEXT NOT NULL,
    detalle TEXT,
    resuelto BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hallazgos_project ON project_hallazgos(project_id);
ALTER TABLE project_hallazgos ENABLE ROW LEVEL SECURITY;
