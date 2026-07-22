-- =============================================================================
-- RadarFondos 360 — 015_seed_dev_user.sql
--
-- PROPÓSITO:
--   authenticateToken() en server.js acepta 'demo-mode-token' en entornos
--   NODE_ENV != production y asignaba req.userId = 'dev-user-001' — un id que
--   no correspondía a ninguna fila real de usuarios. proyectos.user_id/org_id
--   tienen FK a usuarios(id), así que cualquier INSERT/UPDATE autenticado con
--   ese token fallaba (500 "Error de conexión a la base de datos" — violación
--   de FK por fila inexistente). El fix cambia el fallback a un UUID fijo y
--   reconocible ('00000000-0000-0000-0000-000000000001'); esta migración
--   siembra la fila de usuarios correspondiente.
--
-- HALLAZGO EMPÍRICO IMPORTANTE (verificado con SELECT contra la BD real):
--   Esta instancia NUNCA recibió las migraciones formales 001-010 — el
--   esquema realmente activo es el que crea el propio bootstrap de server.js
--   (identificadores sin comillas, plegados a minúsculas por Postgres:
--   "tipoUsuario" → tipousuario; sin columna tenant_id en usuarios; org_id
--   es TEXT nullable, no UUID NOT NULL). Este script detecta en runtime cuál
--   de las dos formas del esquema está activa y siembra en consecuencia, en
--   vez de asumir una sola realidad.
--
-- SEGURIDAD:
--   NO ejecutar en una base de datos de producción real. El password_hash
--   insertado es un hash pbkdf2 mecánicamente válido de una cadena aleatoria
--   descartada — no existe una contraseña práctica que lo reproduzca; el
--   acceso a esta cuenta solo es posible vía demo-mode-token, ya gateado a
--   NODE_ENV != 'production' en server.js. Aun así, esta cuenta con rol admin
--   no debe sembrarse en producción — aplicar solo en desarrollo/staging.
--
-- APLICAR CON (solo dev/staging):
--   psql $DATABASE_URL -f 015_seed_dev_user.sql
-- =============================================================================

DO $$
DECLARE
  dev_id            UUID := '00000000-0000-0000-0000-000000000001';
  dev_password_hash TEXT := '848ee624f012a8bb30c27eed7384e692:d9c84fda6e8840d09dff5b16080c46d6407e42beaf2693cea7be047952ea99948f9c377a75155f7812cb004db2c91fb25424be8b34f5fdd1da68f0aa793f809e';
  tiene_tipo_quoted BOOLEAN;
  tiene_tenant_id   BOOLEAN;
  ya_existe         BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE id = dev_id) INTO ya_existe;
  IF ya_existe THEN
    RAISE NOTICE '[015] Usuario dev ya existe — nada que hacer (idempotente).';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'tipoUsuario'
  ) INTO tiene_tipo_quoted;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'tenant_id'
  ) INTO tiene_tenant_id;

  IF tiene_tipo_quoted AND tiene_tenant_id THEN
    -- Esquema formal (migraciones 001+002 aplicadas): columna quoted + tenant_id NOT NULL
    RAISE NOTICE '[015] Esquema formal detectado (tipoUsuario quoted + tenant_id) — sembrando esa forma.';
    EXECUTE format(
      'INSERT INTO usuarios (id, email, password_hash, nombre, %I, plan, org_id, tenant_id, is_approved, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      'tipoUsuario'
    ) USING dev_id, 'dev-user-001@radarfondos.local', dev_password_hash,
            'Usuario de Desarrollo', 'admin', 'free', dev_id, dev_id, 1, 1;
  ELSE
    -- Esquema real de este entorno (solo bootstrap): columna en minúsculas, sin tenant_id
    RAISE NOTICE '[015] Esquema de bootstrap detectado (tipousuario, sin tenant_id) — sembrando esa forma.';
    INSERT INTO usuarios (id, email, password_hash, nombre, tipousuario, plan, org_id, is_approved, is_active)
    VALUES (dev_id, 'dev-user-001@radarfondos.local', dev_password_hash,
            'Usuario de Desarrollo', 'admin', 'free', dev_id::TEXT, 1, 1);
  END IF;

  RAISE NOTICE '[015] Usuario dev sembrado: %', dev_id;
END;
$$;

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE existe INTEGER;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 015 ===';
  SELECT COUNT(*) INTO existe FROM usuarios WHERE id = '00000000-0000-0000-0000-000000000001';
  RAISE NOTICE '[usuarios] Usuario dev sembrado: %', (existe = 1);
  RAISE NOTICE '=== FIN VERIFICACIÓN 015 ===';
END;
$$;
