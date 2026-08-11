-- ============================================================
-- _deploy_atomico_migracion_a.sql
-- Bloque unico, atomico, para aplicar 007 + 008 en Supabase de una sola vez.
--
-- POR QUE EXISTE: 2 intentos previos de pegar 007 y 008 por separado
-- terminaron en un estado a medias (solo project_version_hashes llego a
-- existir, el resto no) sin ningun error visible reportado. Causa mas
-- probable: el editor SQL de Supabase NO envuelve el pegado completo en
-- una transaccion explicita por defecto -- cada sentencia se confirma por
-- su cuenta, y si una sentencia posterior falla (por ejemplo, una comilla
-- recta convertida en comilla tipografica al copiar/pegar), la ejecucion
-- se detiene ahi sin deshacer lo anterior. Resultado: ni todo aplicado, ni
-- todo ausente -- el peor de los dos estados.
--
-- QUE HACE ESTE ARCHIVO DISTINTO: envuelve TODO en BEGIN/COMMIT explicito
-- con puntos de control (RAISE NOTICE) entre cada bloque. Dos resultados
-- posibles, ninguno ambiguo:
--   (a) Corre completo -> veras los 7 CHECKPOINT en el panel de resultados,
--       termina en COMMIT, y la verificacion final de abajo muestra OK
--       en las 7 filas.
--   (b) Falla en algun punto -> Postgres hace ROLLBACK automatico de TODO
--       (incluida la tabla project_version_hashes que ya existia de antes
--       -- se re-crea con CREATE TABLE IF NOT EXISTS, asi que no se pierde
--       nada real, no hay datos en ella todavia) y el mensaje de error que
--       muestra el editor senala la linea exacta. Ya no hay estados a medias.
--
-- USO: pegar este archivo COMPLETO (Ctrl+A en el editor de texto antes de
-- copiar, no seleccion manual) en el SQL Editor de Supabase, proyecto
-- ozivmsvxbdtjkzleqbcy, y correrlo una sola vez.
-- ============================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 0: inicio de transaccion atomica Migracion A'; END $$;

-- =============================================================
-- BLOQUE 1 (de 007): tabla project_version_hashes + indices
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
  triggered_by        TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user     UUID,
  metadata            JSONB       NOT NULL DEFAULT '{}',
  CONSTRAINT pvh_hash_length CHECK (
    (hash_algorithm = 'sha256'   AND length(hash_value) = 64) OR
    (hash_algorithm = 'sha3-256' AND length(hash_value) = 64)
  )
);

CREATE INDEX IF NOT EXISTS idx_pvh_proyecto ON project_version_hashes (proyecto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pvh_tenant   ON project_version_hashes (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pvh_unique_hash ON project_version_hashes (proyecto_id, hash_value);

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 1: project_version_hashes creada'; END $$;

-- =============================================================
-- BLOQUE 2 (de 007): triggers WORM de project_version_hashes
-- =============================================================
CREATE OR REPLACE FUNCTION trg_pvh_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $BODY$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: project_version_hashes es append-only (proyecto_id=%, hash=%)',
    OLD.proyecto_id, OLD.hash_value
    USING ERRCODE = 'restrict_violation';
END;
$BODY$;

DROP TRIGGER IF EXISTS trg_pvh_no_update ON project_version_hashes;
CREATE TRIGGER trg_pvh_no_update
  BEFORE UPDATE ON project_version_hashes
  FOR EACH ROW EXECUTE FUNCTION trg_pvh_block_mutation();

DROP TRIGGER IF EXISTS trg_pvh_no_delete ON project_version_hashes;
CREATE TRIGGER trg_pvh_no_delete
  BEFORE DELETE ON project_version_hashes
  FOR EACH ROW EXECUTE FUNCTION trg_pvh_block_mutation();

ALTER TABLE project_version_hashes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pvh_provisional_open ON project_version_hashes;
CREATE POLICY pvh_provisional_open ON project_version_hashes AS PERMISSIVE FOR ALL USING (true);

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 2: triggers WORM de project_version_hashes instalados'; END $$;

-- =============================================================
-- BLOQUE 3 (de 007): tabla security_violations_ledger + indices
-- =============================================================
CREATE TABLE IF NOT EXISTS security_violations_ledger (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID,
  ip                TEXT,
  jwt_sub           TEXT,
  endpoint          TEXT        NOT NULL,
  violation_type    TEXT        NOT NULL CHECK (violation_type IN (
                                   'tenant_mismatch', 'worm_mutation_attempt',
                                   'rls_bypass_attempt', 'divisa_no_cop', 'otro'
                                 )),
  detalle           TEXT,
  payload_snapshot  JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_svl_tenant ON security_violations_ledger (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_svl_type   ON security_violations_ledger (violation_type, created_at DESC);

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 3: security_violations_ledger creada'; END $$;

-- =============================================================
-- BLOQUE 4 (de 007): triggers WORM de security_violations_ledger
-- =============================================================
CREATE OR REPLACE FUNCTION trg_svl_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $BODY$
BEGIN
  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: security_violations_ledger es append-only (id=%)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$BODY$;

DROP TRIGGER IF EXISTS trg_svl_no_update ON security_violations_ledger;
CREATE TRIGGER trg_svl_no_update
  BEFORE UPDATE ON security_violations_ledger
  FOR EACH ROW EXECUTE FUNCTION trg_svl_block_mutation();

DROP TRIGGER IF EXISTS trg_svl_no_delete ON security_violations_ledger;
CREATE TRIGGER trg_svl_no_delete
  BEFORE DELETE ON security_violations_ledger
  FOR EACH ROW EXECUTE FUNCTION trg_svl_block_mutation();

ALTER TABLE security_violations_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svl_provisional_open ON security_violations_ledger;
CREATE POLICY svl_provisional_open ON security_violations_ledger AS PERMISSIVE FOR ALL USING (true);

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 4: triggers WORM de security_violations_ledger instalados'; END $$;

-- =============================================================
-- BLOQUE 5 (de 007): RPCs registrar_version_hash, obtener_ultimo_hash,
-- registrar_violacion_seguridad
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
AS $BODY$
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
    SELECT id INTO v_id FROM project_version_hashes
    WHERE proyecto_id = p_proyecto_id AND hash_value = p_hash_value;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'hash_value', p_hash_value);
END;
$BODY$;

CREATE OR REPLACE FUNCTION obtener_ultimo_hash(p_tenant_id UUID, p_proyecto_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $BODY$
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
$BODY$;

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
AS $BODY$
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
$BODY$;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 5: RPCs de 007 creadas (registrar_version_hash, obtener_ultimo_hash, registrar_violacion_seguridad)'; END $$;

-- =============================================================
-- BLOQUE 6 (de 008): guardar_modulo10 con firma atomica de 5 parametros
-- =============================================================
CREATE OR REPLACE FUNCTION guardar_modulo10(
  p_tenant_id     UUID,
  p_proyecto_id   UUID,
  p_indicadores   JSONB,
  p_expected_hash TEXT DEFAULT NULL,
  p_new_hash      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $BODY$
DECLARE
  v_item        JSONB;
  v_count       INTEGER := 0;
  v_ultimo_hash TEXT;
  v_hash_id     UUID;
BEGIN
  PERFORM 1 FROM formulador_proyectos
  WHERE id = p_proyecto_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto % no pertenece al tenant % o no existe.', p_proyecto_id, p_tenant_id;
  END IF;

  IF p_expected_hash IS NOT NULL THEN
    SELECT hash_value INTO v_ultimo_hash
    FROM project_version_hashes
    WHERE proyecto_id = p_proyecto_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_ultimo_hash IS NOT NULL AND v_ultimo_hash != p_expected_hash THEN
      RAISE EXCEPTION 'OCC_CONFLICT: el proyecto fue modificado por otra sesion desde que se cargo (hash_actual=%).', v_ultimo_hash
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  DELETE FROM formulador_indicadores WHERE proyecto_id = p_proyecto_id AND tenant_id = p_tenant_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_indicadores, '[]'))
  LOOP
    INSERT INTO formulador_indicadores (
      tenant_id, proyecto_id, indicador, tipo, unidad, linea_base, meta,
      fuente_verificacion, responsable, frecuencia_medicion, avance_actual
    ) VALUES (
      p_tenant_id, p_proyecto_id, v_item->>'indicador', COALESCE(v_item->>'tipo', 'producto'),
      v_item->>'unidad', v_item->>'linea_base', v_item->>'meta',
      v_item->>'fuente_verificacion', v_item->>'responsable', v_item->>'frecuencia_medicion',
      v_item->>'avance_actual'
    );
    v_count := v_count + 1;
  END LOOP;

  IF p_new_hash IS NOT NULL THEN
    INSERT INTO project_version_hashes (
      tenant_id, proyecto_id, hash_value, project_status, triggered_by, payload_size_bytes
    ) VALUES (
      p_tenant_id, p_proyecto_id, p_new_hash, 'modulo10_guardado', 'modulo10_save',
      octet_length(p_indicadores::TEXT)
    )
    ON CONFLICT (proyecto_id, hash_value) DO NOTHING
    RETURNING id INTO v_hash_id;
  END IF;

  RETURN jsonb_build_object(
    'proyecto_id', p_proyecto_id,
    'indicadores_guardados', v_count,
    'version_hash', p_new_hash
  );
END;
$BODY$;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 6: guardar_modulo10 reemplazada con firma atomica de 5 parametros'; END $$;

-- =============================================================
-- Limpieza del overload viejo: CREATE OR REPLACE con distinto numero de
-- parametros NO reemplaza la funcion anterior en Postgres (identidad =
-- nombre + tipos de argumentos). Sin este DROP quedarian 2 versiones de
-- guardar_modulo10 coexistiendo (la de 3 parametros y la de 5).
-- =============================================================
DROP FUNCTION IF EXISTS guardar_modulo10(UUID, UUID, JSONB);

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 7: overload viejo de guardar_modulo10 (3 parametros) eliminado si existia'; END $$;

COMMIT;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 8: COMMIT exitoso -- Migracion A aplicada por completo'; END $$;

-- Forzar refresco de cache de PostgREST -- inofensivo correrlo aunque ya
-- estuviera al dia.
NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFICACION FINAL INLINE -- lee esta tabla de resultados, no hace
-- falta correr un script aparte.
-- =============================================================
SELECT
  'project_version_hashes (tabla)' AS objeto,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='project_version_hashes')
       THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL
SELECT
  'security_violations_ledger (tabla)',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='security_violations_ledger')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'obtener_ultimo_hash (rpc)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='obtener_ultimo_hash')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'registrar_version_hash (rpc)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='registrar_version_hash')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'registrar_violacion_seguridad (rpc)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='registrar_violacion_seguridad')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'guardar_modulo10 con 5 parametros (rpc)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='guardar_modulo10' AND pronargs = 5)
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'guardar_modulo10 overload viejo de 3 parametros eliminado',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='guardar_modulo10' AND pronargs = 3)
       THEN 'OK' ELSE 'FALTA (sigue existiendo el overload viejo)' END
UNION ALL
SELECT
  'triggers WORM (4 esperados)',
  CASE WHEN (SELECT COUNT(*) FROM pg_trigger
             WHERE tgname IN ('trg_pvh_no_update','trg_pvh_no_delete','trg_svl_no_update','trg_svl_no_delete'))
       = 4 THEN 'OK' ELSE 'FALTA' END;
