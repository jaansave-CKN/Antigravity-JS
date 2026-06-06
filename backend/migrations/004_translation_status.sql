-- =============================================================================
-- RadarFondos 360 — Migration 004: Translation Status Column
-- Añade translation_status a la tabla projects para tracking del job de Inngest
-- Requiere: 003_schema_english_canonical.sql ejecutado previamente
-- =============================================================================

-- ── Añadir columna translation_status ────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS translation_status VARCHAR(20)
    NOT NULL DEFAULT 'pending'
    CHECK (translation_status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));

-- ── Índice para queries de admin (ver todos los proyectos con traducción fallida) ──
CREATE INDEX IF NOT EXISTS idx_projects_translation_status
  ON projects (tenant_id, translation_status);

-- ── Backfill: proyectos que ya tienen payload_en completo → 'completed' ───────
UPDATE projects
SET translation_status = 'completed'
WHERE payload_en IS NOT NULL
  AND payload_en::text != '{}'
  AND payload_en->>'translation_status' = 'completed';

-- ── Backfill: proyectos con error de traducción previo → 'failed' ─────────────
UPDATE projects
SET translation_status = 'failed'
WHERE payload_en IS NOT NULL
  AND payload_en->>'translation_status' = 'error';

-- ── View actualizada: incluye translation_status ──────────────────────────────
-- Actualizar la vista de compatibilidad (backward-compat view de proyectos)
CREATE OR REPLACE VIEW proyectos AS
  SELECT
    id, tenant_id, user_id, org_id,
    name AS nombre, status AS estado,
    bloqueo_razon, ficha_tecnica, presupuesto,
    crosscheck_sello, embedding, embedding_vec,
    payload_es, payload_en, translation_status,
    created_at, updated_at
  FROM projects;

-- =============================================================================
-- NOTA: translation_status es la fuente de verdad del cliente React.
-- El job de Inngest lo actualiza en 3 momentos:
--   1. Al iniciar translate-en  → 'processing'
--   2. Al completar con éxito   → 'completed'
--   3. Si falla el paso de IA   → 'failed'
-- =============================================================================
