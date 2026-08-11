-- ============================================================
-- 007_worm_occ_shadow_ledger.sql — Migración A de ADR-0001
-- (docs/ADR/ADR-0001-auth-rls-worm-occ.md)
--
-- Alcance autorizado por el ADR sin nuevo veredicto de 002:
--   1. project_version_hashes — ledger append-only de hashes SHA-256,
--      soporte de OCC (Fase 4.1 del mandato de 005).
--   2. security_violations_ledger — Shadow Ledger (Fase 4.2).
--
-- EXPLÍCITAMENTE FUERA DE ALCANCE (Migración B, sigue bloqueada):
--   Políticas RLS reales sobre estas tablas. Ambas quedan con RLS
--   habilitado + una política provisional USING(true), marcada así
--   a propósito (ADR-0001 §3, ítem 2) — no confundir con protección
--   real. El aislamiento de escritura sigue viviendo en el filtro
--   WHERE tenant_id explícito de cada RPC (guardar_modulo10, etc.),
--   igual que el resto del esquema (001_formulador.sql).
--
-- Prohibido por el ADR: SET LOCAL / GUC de sesión "app.tenant_id"
-- para resolver el tenant de estas tablas fuera de una función
-- SECURITY INVOKER autocontenida (mismo patrón que set_tenant_context()
-- en 001_formulador.sql — efectivo solo dentro de la misma
-- transacción/llamada RPC, ver supabaseClient.js:106-111).
--
-- CORREGIDO tras auditoría 008_AUDITOR_DE_CODIGO (2026-08-11), antes de
-- aplicar esta migración a Supabase (nunca corrió en producción):
--   - registrar_version_hash: un guardado "sin cambios" (mismo payload,
--     mismo hash) chocaba con idx_pvh_unique_hash y fallaba con
--     duplicate key en vez de tratarse como no-op. Ahora usa
--     ON CONFLICT DO NOTHING y devuelve el registro existente.
--   - La comparación de OCC deja de vivir en 2 llamadas RPC separadas
--     (obtener_ultimo_hash + guardar_modulo10 en transacciones distintas
--     = TOCTOU real: dos requests concurrentes pasan el check antes de
--     que ninguna escriba). guardar_modulo10 ahora hace lock+check+
--     escritura+hash en UNA sola transacción — ver 008_occ_atomic_
--     guardar_modulo10.sql, que reemplaza la función.
-- ============================================================

-- =============================================================
-- TABLA: project_version_hashes (OCC — Fase 4.1)
-- =============================================================
CREATE TABLE IF NOT EXISTS project_version_hashes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  proyecto_id         UUID        NOT NULL REFERENCES formulador_proyectos(id) ON DELETE CASCADE,
  hash_value          TEXT        NOT NULL,
  hash_algorithm      TEXT        NOT NULL DEFAULT 'sha256'
                                   CHECK (hash_algorithm IN ('sha256', 'sha3-256')),
  payload_size_bytes  INTEGER,
  project_status      TEXT        NOT NULL,
  triggered_by        TEXT        NOT NULL,  -- 'modulo10_save' | 'fase1_insert' | otro futuro
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user     UUID,
  metadata            JSONB       NOT NULL DEFAULT '{}',

  CONSTRAINT pvh_hash_length CHECK (
    (hash_algorithm = 'sha256'   AND length(hash_value) = 64) OR
    (hash_algorithm = 'sha3-256' AND length(hash_value) = 64)
  )
);

CREATE INDEX IF NOT EXISTS idx_pvh_proyecto
  ON project_version_hashes (proyecto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvh_tenant
  ON project_version_hashes (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pvh_unique_hash
  ON project_version_hashes (proyecto_id, hash_value);

-- Append-only real contra UPDATE/DELETE de fila. NOTA DE ALCANCE (hallazgo de
-- auditoría, no corregible en esta capa): TRUNCATE no dispara triggers BEFORE
-- DELETE/UPDATE en Postgres — esta protección cubre mutación fila-por-fila, no
-- un TRUNCATE con acceso SQL directo/administrativo. Ese acceso ya está fuera
-- del perímetro de la aplicación (equivalente a tener las llaves de la BD),
-- documentado aquí para que "WORM" no se lea como garantía absoluta sin matiz.
CREATE OR REPLACE FUNCTION trg_pvh_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: project_version_hashes es append-only (proyecto_id=%, hash=%)',
    OLD.proyecto_id, OLD.hash_value
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

ALTER TABLE project_version_hashes ENABLE ROW LEVEL SECURITY;
-- PROVISIONAL — ver cabecera del archivo. Migración B la reemplaza.
DROP POLICY IF EXISTS pvh_provisional_open ON project_version_hashes;
CREATE POLICY pvh_provisional_open ON project_version_hashes AS PERMISSIVE FOR ALL USING (true);

-- =============================================================
-- TABLA: security_violations_ledger (Shadow Ledger — Fase 4.2)
-- =============================================================
CREATE TABLE IF NOT EXISTS security_violations_ledger (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID,       -- nullable: una violación puede no resolver tenant válido
  ip                TEXT,
  jwt_sub           TEXT,       -- uid del token, si lo había
  endpoint          TEXT        NOT NULL,
  violation_type    TEXT        NOT NULL CHECK (violation_type IN (
                                   'tenant_mismatch', 'worm_mutation_attempt',
                                   'rls_bypass_attempt', 'divisa_no_cop', 'otro'
                                 )),
  detalle           TEXT,
  payload_snapshot  JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_svl_tenant   ON security_violations_ledger (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_svl_type     ON security_violations_ledger (violation_type, created_at DESC);

-- Mismo matiz de alcance que project_version_hashes: protege contra
-- UPDATE/DELETE fila-por-fila, no contra TRUNCATE con acceso SQL directo.
CREATE OR REPLACE FUNCTION trg_svl_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: security_violations_ledger es append-only (id=%)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_svl_no_update ON security_violations_ledger;
CREATE TRIGGER trg_svl_no_update
  BEFORE UPDATE ON security_violations_ledger
  FOR EACH ROW EXECUTE FUNCTION trg_svl_block_mutation();

DROP TRIGGER IF EXISTS trg_svl_no_delete ON security_violations_ledger;
CREATE TRIGGER trg_svl_no_delete
  BEFORE DELETE ON security_violations_ledger
  FOR EACH ROW EXECUTE FUNCTION trg_svl_block_mutation();

ALTER TABLE security_violations_ledger ENABLE ROW LEVEL SECURITY;
-- PROVISIONAL — ver cabecera del archivo. Migración B la reemplaza.
DROP POLICY IF EXISTS svl_provisional_open ON security_violations_ledger;
CREATE POLICY svl_provisional_open ON security_violations_ledger AS PERMISSIVE FOR ALL USING (true);

-- =============================================================
-- RPC: registrar_version_hash — único punto de escritura de la Fase 4.1
--
-- CORREGIDO (auditoría 008): un guardado "sin cambios" produce el mismo
-- hash que el anterior y chocaba con idx_pvh_unique_hash (duplicate key,
-- error 500 para un caso que no es un error). ON CONFLICT DO NOTHING +
-- SELECT del registro existente lo trata como no-op idempotente.
-- =============================================================
CREATE OR REPLACE FUNCTION registrar_version_hash(
  p_tenant_id          UUID,
  p_proyecto_id        UUID,
  p_hash_value         TEXT,
  p_project_status     TEXT,
  p_triggered_by       TEXT,
  p_payload_size_bytes INTEGER DEFAULT NULL,
  p_created_by_user    UUID DEFAULT NULL,
  p_metadata           JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM 1 FROM formulador_proyectos WHERE id = p_proyecto_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto % no pertenece al tenant % o no existe.', p_proyecto_id, p_tenant_id;
  END IF;

  INSERT INTO project_version_hashes (
    tenant_id, proyecto_id, hash_value, project_status,
    triggered_by, payload_size_bytes, created_by_user, metadata
  ) VALUES (
    p_tenant_id, p_proyecto_id, p_hash_value, p_project_status,
    p_triggered_by, p_payload_size_bytes, p_created_by_user, COALESCE(p_metadata, '{}')
  )
  ON CONFLICT (proyecto_id, hash_value) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Ya existía (guardado sin cambios reales) — no-op, no un error.
    SELECT id INTO v_id FROM project_version_hashes
    WHERE proyecto_id = p_proyecto_id AND hash_value = p_hash_value;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'hash_value', p_hash_value);
END;
$$;

-- =============================================================
-- RPC: obtener_ultimo_hash — lectura advisory (UI: "¿alguien más editó esto?").
-- NO es el mecanismo de enforcement de OCC — ver nota en 008_occ_atomic_
-- guardar_modulo10.sql sobre por qué una comparación en 2 llamadas RPC
-- separadas no cierra la carrera de concurrencia real.
-- =============================================================
CREATE OR REPLACE FUNCTION obtener_ultimo_hash(p_tenant_id UUID, p_proyecto_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT hash_value, created_at INTO v_row
  FROM project_version_hashes
  WHERE tenant_id = p_tenant_id AND proyecto_id = p_proyecto_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('hash_value', NULL, 'created_at', NULL);
  END IF;

  RETURN jsonb_build_object('hash_value', v_row.hash_value, 'created_at', v_row.created_at);
END;
$$;

-- =============================================================
-- RPC: registrar_violacion_seguridad — único punto de escritura del Shadow Ledger
-- =============================================================
CREATE OR REPLACE FUNCTION registrar_violacion_seguridad(
  p_endpoint         TEXT,
  p_violation_type   TEXT,
  p_tenant_id        UUID DEFAULT NULL,
  p_ip               TEXT DEFAULT NULL,
  p_jwt_sub          TEXT DEFAULT NULL,
  p_detalle          TEXT DEFAULT NULL,
  p_payload_snapshot JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO security_violations_ledger (
    tenant_id, ip, jwt_sub, endpoint, violation_type, detalle, payload_snapshot
  ) VALUES (
    p_tenant_id, p_ip, p_jwt_sub, p_endpoint, p_violation_type, p_detalle, COALESCE(p_payload_snapshot, '{}')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (correr a mano)
-- =============================================================
-- INSERT de prueba en project_version_hashes, luego:
--   UPDATE project_version_hashes SET hash_value = 'x' WHERE id = '<id>';
-- debe fallar con IMMUTABILITY_VIOLATION.
-- Igual para security_violations_ledger.
-- Re-registrar el mismo (proyecto_id, hash_value) vía registrar_version_hash
-- debe devolver el id existente sin error (antes: duplicate key).
