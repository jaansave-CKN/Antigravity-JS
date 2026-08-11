-- ============================================================
-- 008_occ_atomic_guardar_modulo10.sql — corrección de auditoría
-- (008_AUDITOR_DE_CODIGO, 2026-08-11, previo a aplicar 007 en Supabase)
--
-- HALLAZGO CRÍTICO: la implementación original de OCC hacía la comparación
-- de versión (occGuard.assertVersionOrConflict → RPC obtener_ultimo_hash)
-- y la escritura (RPC guardar_modulo10) en 2 llamadas PostgREST separadas
-- = 2 transacciones Postgres independientes, sin ningún lock entre ellas.
-- Dos requests concurrentes sobre el mismo proyecto pueden ambas leer el
-- mismo "último hash", ambas pasar el check, y ambas escribir — exactamente
-- la "modificación concurrente en obra" que la Fase 4.1 del mandato de 005
-- dice que debe prevenir (HTTP 409). Es un TOCTOU (time-of-check-to-time-
-- of-use) clásico: bajo baja concurrencia funciona "por accidente", bajo
-- concurrencia real (el único caso que le importa a OCC) no protege nada.
--
-- FIX: mover el check+escritura+hash a UNA sola función, UNA sola
-- transacción, con SELECT ... FOR UPDATE sobre la fila del proyecto para
-- serializar escritores concurrentes del mismo proyecto. Sigue sin GUC de
-- sesión ni pg.Pool — todo vive dentro de esta función SECURITY INVOKER,
-- mismo criterio que el resto del esquema (ADR-0001).
-- ============================================================

CREATE OR REPLACE FUNCTION guardar_modulo10(
  p_tenant_id     UUID,
  p_proyecto_id   UUID,
  p_indicadores   JSONB,
  p_expected_hash TEXT DEFAULT NULL,  -- version_hash que el cliente cree vigente (OCC)
  p_new_hash      TEXT DEFAULT NULL   -- hash SHA-256 del nuevo payload, calculado en Node
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_item        JSONB;
  v_count       INTEGER := 0;
  v_ultimo_hash TEXT;
  v_hash_id     UUID;
BEGIN
  -- Lock de fila: serializa cualquier otra llamada a esta función para el
  -- mismo proyecto mientras esta transacción esté abierta — el segundo
  -- request concurrente espera aquí hasta que el primero haga COMMIT,
  -- y entonces ve el hash YA actualizado, no el de antes de la carrera.
  PERFORM 1 FROM formulador_proyectos
  WHERE id = p_proyecto_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto % no pertenece al tenant % o no existe.', p_proyecto_id, p_tenant_id;
  END IF;

  -- Chequeo OCC atómico: mismo proceso, misma transacción que el lock de
  -- arriba — ningún otro escritor puede colarse entre el check y el DELETE/
  -- INSERT de abajo, a diferencia del diseño anterior (2 llamadas RPC).
  IF p_expected_hash IS NOT NULL THEN
    SELECT hash_value INTO v_ultimo_hash
    FROM project_version_hashes
    WHERE proyecto_id = p_proyecto_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_ultimo_hash IS NOT NULL AND v_ultimo_hash != p_expected_hash THEN
      RAISE EXCEPTION 'OCC_CONFLICT: el proyecto fue modificado por otra sesión desde que se cargó (hash_actual=%).', v_ultimo_hash
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

  -- Ancla el nuevo estado en la MISMA transacción — ya no es una llamada
  -- separada best-effort después del hecho (ver occGuard.js: registrarVersionHash
  -- ya no se invoca desde el controller para este endpoint, ver
  -- FormuladorPgController.js). Si p_new_hash es NULL (cliente legacy sin OCC),
  -- se omite el registro de versión sin romper el guardado.
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
$$;

-- =============================================================
-- VERIFICACIÓN POST-MIGRACIÓN (correr a mano)
-- =============================================================
-- 2 sesiones psql concurrentes sobre el mismo proyecto:
--   Sesión A: BEGIN; SELECT guardar_modulo10(...) -- no hacer COMMIT todavía
--   Sesión B: SELECT guardar_modulo10(...) con el mismo p_expected_hash
--             -> debe QUEDAR BLOQUEADA (esperando el lock), no ejecutar en paralelo
--   Sesión A: COMMIT;
--   Sesión B: se desbloquea, ve el hash ya actualizado por A, si su
--             p_expected_hash ya no coincide -> OCC_CONFLICT (correcto:
--             B tenía una versión vieja del proyecto).
