-- ============================================================
-- 006_modulo10_y_listado.sql — Módulo 10 (Indicadores y Seguimiento)
-- + listado de proyectos por tenant (requerido para el selector de
-- proyecto en las pantallas de Oleada 3, Grupo Elite, 2026-08-06).
-- Mismo patrón de aislamiento que 001-005: tabla propia + RLS +
-- función SECURITY INVOKER que fija el contexto de tenant al inicio
-- de la transacción (nunca SELECT directo sin ese paso — un SELECT
-- REST plano con SERVICE_KEY bypasea RLS por completo y filtraría
-- entre tenants; ver comentario en supabaseClient.js).
-- ============================================================

-- =============================================================
-- TABLA: formulador_indicadores  (Módulo 10)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_indicadores (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL,
  proyecto_id           UUID        NOT NULL REFERENCES formulador_proyectos(id) ON DELETE CASCADE,
  indicador             TEXT        NOT NULL,
  tipo                  TEXT        CHECK (tipo IN ('producto','resultado','impacto')) DEFAULT 'producto',
  unidad                TEXT,
  linea_base            TEXT,
  meta                  TEXT,
  fuente_verificacion   TEXT,
  responsable           TEXT,
  frecuencia_medicion   TEXT,
  avance_actual         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE formulador_indicadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_indicadores_tenant_isolation ON formulador_indicadores
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_indicadores_tenant
  ON formulador_indicadores (tenant_id, proyecto_id);

-- =============================================================
-- RPC: listar_proyectos — proyectos del tenant actual, resumen
-- =============================================================
CREATE OR REPLACE FUNCTION listar_proyectos(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_tenant_context(p_tenant_id::TEXT);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'sector_codigo', sector_codigo,
    'departamento', departamento, 'municipio', municipio,
    'status', status, 'created_at', created_at
  ) ORDER BY created_at DESC), '[]')
  INTO v_result
  FROM formulador_proyectos
  WHERE tenant_id = p_tenant_id;

  RETURN v_result;
END;
$$;

-- =============================================================
-- RPC: guardar_modulo10 — reemplaza indicadores del proyecto (upsert por borrado+inserción)
-- =============================================================
CREATE OR REPLACE FUNCTION guardar_modulo10(
  p_tenant_id   UUID,
  p_proyecto_id UUID,
  p_indicadores JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item  JSONB;
  v_count INTEGER := 0;
BEGIN
  PERFORM set_tenant_context(p_tenant_id::TEXT);

  -- Confirma que el proyecto pertenece al tenant antes de tocar sus indicadores.
  PERFORM 1 FROM formulador_proyectos WHERE id = p_proyecto_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto % no pertenece al tenant % o no existe.', p_proyecto_id, p_tenant_id;
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

  RETURN jsonb_build_object('proyecto_id', p_proyecto_id, 'indicadores_guardados', v_count);
END;
$$;

-- =============================================================
-- RPC: obtener_modulo10
-- =============================================================
CREATE OR REPLACE FUNCTION obtener_modulo10(p_tenant_id UUID, p_proyecto_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_tenant_context(p_tenant_id::TEXT);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'indicador', indicador, 'tipo', tipo, 'unidad', unidad,
    'linea_base', linea_base, 'meta', meta, 'fuente_verificacion', fuente_verificacion,
    'responsable', responsable, 'frecuencia_medicion', frecuencia_medicion,
    'avance_actual', avance_actual
  ) ORDER BY created_at), '[]')
  INTO v_result
  FROM formulador_indicadores
  WHERE tenant_id = p_tenant_id AND proyecto_id = p_proyecto_id;

  RETURN jsonb_build_object('proyecto_id', p_proyecto_id, 'indicadores', v_result);
END;
$$;
