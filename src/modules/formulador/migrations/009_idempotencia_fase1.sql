-- ============================================================
-- 009_idempotencia_fase1.sql — idempotencia en creación de proyecto
-- (auditoría PROTOCOLO TITÁN, 2026-08-12, Capa 9 — Caos)
--
-- HALLAZGO: insertar_fase1 era un INSERT puro sin dedup. Un doble-click o
-- un reintento de red del cliente (típico en campo/obra, conectividad
-- móvil deficiente) creaba DOS proyectos distintos con los mismos datos.
--
-- FIX: el cliente envía un idempotency_key estable por intento de guardado
-- (mismo valor si reintenta la MISMA petición; valor nuevo si el usuario
-- arranca un proyecto distinto). Con ese key:
--   - Si ya existe un proyecto con ese (tenant_id, idempotency_key), se
--     devuelve el existente en vez de duplicar (replay idempotente).
--   - Si dos requests con el mismo key llegan realmente en simultáneo, el
--     índice único UNIQUE (tenant_id, idempotency_key) hace que solo uno
--     de los dos INSERT tenga éxito; el otro cae al bloque EXCEPTION y
--     también devuelve el proyecto ya creado, en vez de fallar con 500 ni
--     duplicar (mismo criterio de "gana el primero" que el lock FOR UPDATE
--     de guardar_modulo10, ver 008_occ_atomic_guardar_modulo10.sql).
--
-- FORMATO ATÓMICO OBLIGATORIO (criterio 6, .claude/agents/002-arquitecto-de-
-- software.md, nacido del incidente 2026-08-11 §0-J): BEGIN/COMMIT explícito
-- + CHECKPOINT (RAISE NOTICE) por bloque + idempotente (IF NOT EXISTS /
-- CREATE OR REPLACE) + verificación inline al final.
--
-- USO: pegar este archivo COMPLETO (Ctrl+A antes de copiar) en el SQL
-- Editor de Supabase, proyecto ozivmsvxbdtjkzleqbcy, y correrlo una vez.
-- ============================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 0: inicio de transacción atómica — Migración 009 (idempotencia Fase 1)'; END $$;

-- =============================================================
-- BLOQUE 1: columna + índice único parcial
-- =============================================================
ALTER TABLE formulador_proyectos
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_formulador_proyectos_idempotency
  ON formulador_proyectos (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 1: columna idempotency_key + índice único parcial listos'; END $$;

-- =============================================================
-- BLOQUE 2: insertar_fase1 con soporte de idempotencia (6º parámetro)
-- =============================================================
CREATE OR REPLACE FUNCTION insertar_fase1(
  p_tenant_id       UUID,
  p_ficha           JSONB,
  p_modulo_7        JSONB,
  p_modulo_8        JSONB,
  p_modulo_9        JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $BODY$
DECLARE
  v_proyecto_id UUID;
  v_objetivo_id UUID;
  v_oe          JSONB;
  v_regla_min   NUMERIC;
  v_total_cp    NUMERIC;
  v_pct_real    NUMERIC;
  v_fuente      JSONB;
  v_estado      TEXT;
BEGIN
  PERFORM set_tenant_context(p_tenant_id::TEXT);

  -- Replay idempotente: esta misma petición ya se procesó antes.
  -- NOTA (corregido tras prueba en vivo, 2026-08-13): formulador_validaciones_financieras
  -- usa "evaluated_at", NO "created_at" — la versión original de esta función
  -- referenciaba una columna inexistente y rompía TODO guardado de Fase 1 con
  -- idempotency_key (es decir, todo guardado real, ya que el frontend siempre
  -- lo envía). Detectado y corregido antes de impacto real vía prueba directa
  -- de la RPC con datos de prueba (tenant_id descartable, sin tocar datos reales).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT fp.id, fv.estado, fv.porcentaje_contrapartida_real
      INTO v_proyecto_id, v_estado, v_pct_real
    FROM formulador_proyectos fp
    LEFT JOIN formulador_validaciones_financieras fv ON fv.proyecto_id = fp.id
    WHERE fp.tenant_id = p_tenant_id AND fp.idempotency_key = p_idempotency_key
    ORDER BY fv.evaluated_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'proyecto_id', v_proyecto_id,
        'estado_validacion', v_estado,
        'porcentaje_contrapartida', v_pct_real,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO formulador_proyectos (
      tenant_id, nombre, codigo, enfoque, regimen, sector_codigo,
      clasificacion_infra, departamento, municipio, zona,
      diagnostico, poblacion_total, status, idempotency_key
    ) VALUES (
      p_tenant_id,
      COALESCE(p_ficha->>'nombre', p_ficha->>'nombre_proyecto', 'Sin nombre'),
      p_ficha->>'codigo', p_ficha->>'enfoque', p_ficha->>'regimen', p_ficha->>'sector_codigo',
      p_ficha->>'clasificacion_infra', p_ficha->>'departamento', p_ficha->>'municipio', p_ficha->>'zona',
      p_ficha->>'diagnostico', (p_ficha->>'poblacion_total')::INTEGER, 'draft', p_idempotency_key
    )
    RETURNING id INTO v_proyecto_id;
  EXCEPTION WHEN unique_violation THEN
    -- Dos requests con el mismo idempotency_key llegaron en simultáneo real:
    -- el otro ya ganó la carrera y creó el proyecto — devolverlo, no duplicar.
    SELECT id INTO v_proyecto_id
    FROM formulador_proyectos
    WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'proyecto_id', v_proyecto_id,
      'estado_validacion', NULL,
      'porcentaje_contrapartida', NULL,
      'idempotent_replay', true
    );
  END;

  INSERT INTO formulador_objetivos (
    tenant_id, proyecto_id, objetivo_general, og_indicador, og_meta, og_linea_base, cadena_valor
  ) VALUES (
    p_tenant_id, v_proyecto_id, p_modulo_7->>'objetivo_general',
    p_modulo_7->>'objetivo_general_indicador', p_modulo_7->>'objetivo_general_meta',
    p_modulo_7->>'objetivo_general_linea_base', COALESCE(p_modulo_7->'cadena_valor', '{}')
  )
  RETURNING id INTO v_objetivo_id;

  FOR v_oe IN SELECT * FROM jsonb_array_elements(COALESCE(p_modulo_7->'objetivos_especificos', '[]'))
  LOOP
    INSERT INTO formulador_oe (tenant_id, objetivo_id, proyecto_id, oe_numero, descripcion, indicador, meta, unidad, linea_base)
    VALUES (
      p_tenant_id, v_objetivo_id, v_proyecto_id,
      (SELECT COUNT(*) FROM formulador_oe WHERE proyecto_id = v_proyecto_id) + 1,
      v_oe->>'descripcion', v_oe->>'indicador', v_oe->>'meta', v_oe->>'unidad', v_oe->>'linea_base'
    );
  END LOOP;

  INSERT INTO formulador_cronograma (tenant_id, proyecto_id, duracion_meses, fecha_inicio, fecha_fin, fases, hitos)
  VALUES (
    p_tenant_id, v_proyecto_id, (p_modulo_8->>'duracion_meses')::SMALLINT,
    (p_modulo_8->>'fecha_inicio')::DATE, (p_modulo_8->>'fecha_fin')::DATE,
    COALESCE(p_modulo_8->'fases', '[]'), COALESCE(p_modulo_8->'hitos', '[]')
  );

  INSERT INTO formulador_presupuesto (
    tenant_id, proyecto_id, presupuesto_total, moneda, fuentes,
    contrapartida_monetaria, contrapartida_especie, contrapartida_desc, resumen, viabilidad_financiera
  ) VALUES (
    p_tenant_id, v_proyecto_id,
    COALESCE((p_modulo_9->>'presupuesto_total')::NUMERIC, 0),
    COALESCE(p_modulo_9->>'moneda', 'COP'),
    COALESCE(p_modulo_9->'fuentes', '[]'),
    COALESCE((p_modulo_9->'contrapartida'->>'monetaria')::NUMERIC, 0),
    COALESCE((p_modulo_9->'contrapartida'->>'especie')::NUMERIC, 0),
    p_modulo_9->'contrapartida'->>'descripcion',
    COALESCE(p_modulo_9->'resumen', '{}'),
    p_modulo_9->>'viabilidad_financiera'
  );

  v_total_cp := COALESCE((p_modulo_9->'contrapartida'->>'monetaria')::NUMERIC, 0)
              + COALESCE((p_modulo_9->'contrapartida'->>'especie')::NUMERIC, 0);

  SELECT f INTO v_fuente
  FROM jsonb_array_elements(COALESCE(p_modulo_9->'fuentes', '[]')) f
  WHERE (f->>'es_publica')::BOOLEAN = TRUE
    AND f->>'tipo' IN ('SGR','DNP','Kusanone','OxI','Cooperación')
  LIMIT 1;

  v_regla_min := CASE v_fuente->>'tipo'
    WHEN 'SGR'          THEN 0
    WHEN 'DNP'          THEN 20
    WHEN 'Kusanone'     THEN 30
    WHEN 'OxI'          THEN 0
    WHEN 'Cooperación'  THEN 10
    ELSE 0
  END;

  IF v_fuente IS NULL OR COALESCE((p_modulo_9->>'presupuesto_total')::NUMERIC, 0) = 0 THEN
    v_estado := 'pendiente'; v_pct_real := 0;
  ELSE
    v_pct_real := (v_total_cp / (p_modulo_9->>'presupuesto_total')::NUMERIC) * 100;
    v_estado := CASE WHEN v_pct_real >= v_regla_min THEN 'ok' ELSE 'advertencia' END;
  END IF;

  INSERT INTO formulador_validaciones_financieras (
    tenant_id, proyecto_id, estado, porcentaje_contrapartida_real, porcentaje_minimo_requerido, fuente_evaluada, mensaje
  ) VALUES (
    p_tenant_id, v_proyecto_id, v_estado, ROUND(v_pct_real, 2), v_regla_min,
    COALESCE(v_fuente->>'nombre', v_fuente->>'tipo', ''),
    CASE v_estado
      WHEN 'ok'          THEN 'Contrapartida ' || ROUND(v_pct_real,1) || '% ≥ mínimo ' || v_regla_min || '%'
      WHEN 'advertencia' THEN '⚠ Contrapartida ' || ROUND(v_pct_real,1) || '% < ' || v_regla_min || '% mínimo'
      ELSE 'Sin fondo público identificado.'
    END
  );

  RETURN jsonb_build_object('proyecto_id', v_proyecto_id, 'estado_validacion', v_estado, 'porcentaje_contrapartida', ROUND(v_pct_real, 2), 'idempotent_replay', false);
END;
$BODY$;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 2: insertar_fase1 reemplazada con soporte de idempotencia (6 parámetros)'; END $$;

COMMIT;

DO $$ BEGIN RAISE NOTICE 'CHECKPOINT 3: COMMIT exitoso — Migración 009 aplicada por completo'; END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================
-- VERIFICACIÓN FINAL INLINE — lee esta tabla de resultados.
-- =============================================================
SELECT
  'formulador_proyectos.idempotency_key (columna)' AS objeto,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='formulador_proyectos'
                       AND column_name='idempotency_key')
       THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL
SELECT
  'idx_formulador_proyectos_idempotency (índice único parcial)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname='public' AND indexname='idx_formulador_proyectos_idempotency')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'insertar_fase1 con 6 parámetros (rpc)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='insertar_fase1' AND pronargs = 6)
       THEN 'OK' ELSE 'FALTA' END;

-- =============================================================
-- PRUEBA MANUAL DE IDEMPOTENCIA (opcional, correr aparte)
-- =============================================================
-- 1) Llamar insertar_fase1(...) dos veces con el MISMO p_idempotency_key
--    -> la 2ª llamada debe devolver el MISMO proyecto_id con idempotent_replay=true,
--       NO crear un segundo proyecto.
-- 2) Llamar insertar_fase1(...) dos veces con idempotency_key distinto (o NULL)
--    -> deben crear 2 proyectos distintos (comportamiento normal, sin dedup).
