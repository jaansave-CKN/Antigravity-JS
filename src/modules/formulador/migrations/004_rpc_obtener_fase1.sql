-- =============================================================
-- 004_rpc_obtener_fase1.sql — Lectura atómica de Fase 1 con RLS real
-- Ejecutar en: Supabase Dashboard → SQL Editor (después de 001, 002, 003)
-- SECURITY INVOKER (default, sin SECURITY DEFINER): corre con el rol del
-- llamador para que las políticas RLS se evalúen de verdad, no se bypaseen.
-- =============================================================

CREATE OR REPLACE FUNCTION obtener_fase1(
  p_tenant_id   UUID,
  p_proyecto_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_proyecto    JSONB;
  v_objetivos   JSONB;
  v_oe          JSONB;
  v_cronograma  JSONB;
  v_presupuesto JSONB;
  v_validacion  JSONB;
BEGIN
  PERFORM set_tenant_context(p_tenant_id::TEXT);

  SELECT to_jsonb(t) INTO v_proyecto
  FROM formulador_proyectos t
  WHERE t.id = p_proyecto_id AND t.tenant_id = p_tenant_id;

  IF v_proyecto IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(t) INTO v_objetivos
  FROM formulador_objetivos t
  WHERE t.proyecto_id = p_proyecto_id AND t.tenant_id = p_tenant_id
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.oe_numero ASC), '[]'::jsonb) INTO v_oe
  FROM formulador_oe t
  WHERE t.proyecto_id = p_proyecto_id AND t.tenant_id = p_tenant_id;

  SELECT to_jsonb(t) INTO v_cronograma
  FROM formulador_cronograma t
  WHERE t.proyecto_id = p_proyecto_id AND t.tenant_id = p_tenant_id
  LIMIT 1;

  SELECT to_jsonb(t) INTO v_presupuesto
  FROM formulador_presupuesto t
  WHERE t.proyecto_id = p_proyecto_id AND t.tenant_id = p_tenant_id
  LIMIT 1;

  SELECT to_jsonb(t) INTO v_validacion
  FROM formulador_validaciones_financieras t
  WHERE t.proyecto_id = p_proyecto_id AND t.tenant_id = p_tenant_id
  ORDER BY t.evaluated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'proyecto',    v_proyecto,
    'objetivos',   COALESCE(v_objetivos, '{}'::jsonb),
    'oe',          v_oe,
    'cronograma',  COALESCE(v_cronograma, '{}'::jsonb),
    'presupuesto', COALESCE(v_presupuesto, '{}'::jsonb),
    'validacion',  v_validacion
  );
END;
$$;
