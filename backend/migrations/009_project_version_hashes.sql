-- =============================================================================
-- RadarFondos 360 — TRAZABILIDAD E INMUTABILIDAD V8.0
-- 009_project_version_hashes.sql
--
-- PROPÓSITO:
--   Implementar registro de hashes SHA-256 de proyectos formulados para
--   cumplir con el requisito de inmutabilidad del Acta Final V8.0.
--
--   Cada vez que un proyecto cambia de estado relevante (formulado, aprobado,
--   enviado a entidad), se genera un hash SHA-256 del payload completo + timestamp.
--   Esta tabla actúa como un ledger inmutable de versiones.
--
--   GARANTÍAS:
--     · Cada fila es append-only (no hay UPDATE permitido — solo INSERT)
--     · La combinación (project_id, hash_value) es UNIQUE
--     · RLS: solo el tenant dueño del proyecto puede leer sus hashes
--     · El hash incluye: payload_es, payload_en, status, timestamp → no manipulable
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 009_project_version_hashes.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS project_version_hashes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID        NOT NULL,
  tenant_id       UUID        NOT NULL,
  hash_value      TEXT        NOT NULL,    -- SHA-256 hex digest
  hash_algorithm  TEXT        NOT NULL DEFAULT 'sha256',
  payload_size_bytes INTEGER,             -- tamaño del payload hasheado (auditoría)
  project_status  TEXT        NOT NULL,   -- status del proyecto en el momento del hash
  triggered_by    TEXT        NOT NULL,   -- 'api_request' | 'status_change' | 'formulacion_complete'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user UUID,                  -- userId que disparó el hash (puede ser sistema)
  metadata        JSONB       NOT NULL DEFAULT '{}',  -- info adicional (módulos incluidos, versión pipeline)

  CONSTRAINT pvh_hash_length CHECK (length(hash_value) = 64),  -- SHA-256 siempre 64 hex chars
  CONSTRAINT pvh_algorithm_valid CHECK (hash_algorithm IN ('sha256', 'sha3-256'))
);

-- Índices de consulta
CREATE INDEX IF NOT EXISTS idx_pvh_project_id
  ON project_version_hashes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pvh_tenant_id
  ON project_version_hashes (tenant_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pvh_unique_hash
  ON project_version_hashes (project_id, hash_value);

CREATE INDEX IF NOT EXISTS idx_pvh_triggered_by
  ON project_version_hashes (triggered_by);

-- =============================================================================
-- GARANTÍA DE APPEND-ONLY: Bloquear UPDATE y DELETE
-- Ningún actor (ni el backend) puede modificar o eliminar un hash registrado.
-- =============================================================================
CREATE OR REPLACE FUNCTION trg_pvh_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: project_version_hashes is append-only. UPDATE and DELETE are forbidden. (project_id=%, hash=%)',
    OLD.project_id, OLD.hash_value
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_pvh_no_update ON project_version_hashes;
CREATE TRIGGER trg_pvh_no_update
  BEFORE UPDATE ON project_version_hashes
  FOR EACH ROW EXECUTE FUNCTION trg_pvh_block_mutation();

DROP TRIGGER IF EXISTS trg_pvh_no_delete ON project_version_hashes;
CREATE TRIGGER trg_pvh_no_delete
  BEFORE DELETE ON project_version_hashes
  FOR EACH ROW EXECUTE FUNCTION trg_pvh_block_mutation();

-- =============================================================================
-- RLS: Aislamiento por tenant — cada organización ve solo sus propios hashes
-- =============================================================================
ALTER TABLE project_version_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_version_hashes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pvh_select ON project_version_hashes;
DROP POLICY IF EXISTS pvh_insert ON project_version_hashes;

CREATE POLICY pvh_select ON project_version_hashes
  FOR SELECT USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

CREATE POLICY pvh_insert ON project_version_hashes
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- No hay políticas UPDATE/DELETE — los triggers bloquean antes de llegar a RLS

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE
  trigger_count INTEGER;
  rls_forced    BOOLEAN;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 009 ===';

  SELECT COUNT(*) INTO trigger_count
  FROM information_schema.triggers
  WHERE event_object_table = 'project_version_hashes'
    AND trigger_schema = 'public';
  RAISE NOTICE '[project_version_hashes] Triggers instalados: %', trigger_count;

  SELECT c.relrowsecurity AND c.relforcerowsecurity INTO rls_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'project_version_hashes' AND n.nspname = 'public';
  RAISE NOTICE '[project_version_hashes] RLS+FORCE habilitado: %', COALESCE(rls_forced, FALSE);

  RAISE NOTICE '=== FIN VERIFICACIÓN 009 ===';
END;
$$;
