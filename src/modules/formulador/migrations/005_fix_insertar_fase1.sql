-- =============================================================
-- 005_fix_insertar_fase1.sql — Cierre de asimetría RLS (escritura)
-- Ejecutar en: Supabase Dashboard → SQL Editor (después de 001, 002, 003, 004)
-- Reemplaza insertar_fase1: SECURITY DEFINER -> SECURITY INVOKER (default,
-- se omite la cláusula) + set_tenant_context() al inicio de la transacción,
-- simétrico con 004_rpc_obtener_fase1.sql.
-- =============================================================

CREATE OR REPLACE FUNCTION insertar_fase1(
  p_tenant_id   UUID,
  p_ficha       JSONB,
  p_modulo_7    JSONB,
  p_modulo_8    JSONB,
  p_modulo_9    JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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

  INSERT INTO formulador_proyectos (
    tenant_id, nombre, codigo, enfoque, regimen, sector_codigo,
    clasificacion_infra, departamento, municipio, zona,
    diagnostico, poblacion_total, status
  ) VALUES (
    p_tenant_id,
    COALESCE(p_ficha->>'nombre', p_ficha->>'nombre_proyecto', 'Sin nombre'),
    p_ficha->>'codigo', p_ficha->>'enfoque', p_ficha->>'regimen', p_ficha->>'sector_codigo',
    p_ficha->>'clasificacion_infra', p_ficha->>'departamento', p_ficha->>'municipio', p_ficha->>'zona',
    p_ficha->>'diagnostico', (p_ficha->>'poblacion_total')::INTEGER, 'draft'
  )
  RETURNING id INTO v_proyecto_id;

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

  RETURN jsonb_build_object('proyecto_id', v_proyecto_id, 'estado_validacion', v_estado, 'porcentaje_contrapartida', ROUND(v_pct_real, 2));
END;
$$;
