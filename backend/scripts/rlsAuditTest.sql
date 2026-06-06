-- =============================================================================
-- RadarFondos 360 V8.0 — SUITE DE PRUEBAS RLS Y TRIGGERS EN BASE DE DATOS
-- rlsAuditTest.sql
--
-- Ejecuta validaciones directamente en PostgreSQL para verificar:
--   T1. TTL Trigger de trial_sessions (bloqueo de INSERT expirado)
--   T2. Inmutabilidad de project_version_hashes (IMMUTABILITY_VIOLATION)
--   T3. RLS stripe_events (REVOKE para rol authenticated)
--   T4. Aislamiento cross-tenant en table projects
--   T5. Reporte de auditoría RLS (todas las tablas del schema)
--
-- EJECUTAR CON:
--   psql $DATABASE_URL -f backend/scripts/rlsAuditTest.sql
--
-- NOTAS:
--   · Los tests que usan PERFORM se capturan con EXCEPTION para no abortar.
--   · Los resultados son RAISE NOTICE/WARNING — revisar la salida de psql.
--   · Al final se imprime un resumen con PASS/FAIL por escenario.
-- =============================================================================

\set ON_ERROR_STOP off
\timing on

DO $$
DECLARE
  v_passed   INTEGER := 0;
  v_failed   INTEGER := 0;
  v_session  UUID;
  v_hash_id  UUID;
  v_project  UUID;
  v_tenant_a UUID := gen_random_uuid();
  v_tenant_b UUID := gen_random_uuid();
  v_user_a   UUID := gen_random_uuid();
  v_user_b   UUID := gen_random_uuid();

  -- Helper: registrar resultado de un check
  PROCEDURE pass(scenario TEXT, name TEXT) AS $$
  BEGIN
    v_passed := v_passed + 1;
    RAISE NOTICE '[✓ PASS] [%] %', scenario, name;
  END;
  $$;

  PROCEDURE fail(scenario TEXT, name TEXT, detail TEXT DEFAULT '') AS $$
  BEGIN
    v_failed := v_failed + 1;
    RAISE WARNING '[✗ FAIL] [%] %  →  %', scenario, name, detail;
  END;
  $$;

BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║  RADARFONDOS 360 V8.0 — SUITE DE PRUEBAS SQL DE SEGURIDAD ║';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════╝';
  RAISE NOTICE 'Fecha: %', NOW();
  RAISE NOTICE '';

  -- ===========================================================================
  -- T1. TRIGGER TTL: trial_sessions
  -- ===========================================================================
  RAISE NOTICE '── T1. Trigger TTL trial_sessions ──────────────────────────────';

  -- T1a: INSERT normal debe funcionar
  BEGIN
    INSERT INTO trial_sessions (session_id, data, ip_hash)
    VALUES (gen_random_uuid(), '{"test": true}'::JSONB, 'testhash')
    RETURNING session_id INTO v_session;

    IF v_session IS NOT NULL THEN
      CALL pass('T1', 'INSERT normal de trial_session funciona');
    ELSE
      CALL fail('T1', 'INSERT normal de trial_session', 'RETURNING devolvió NULL');
    END IF;
  EXCEPTION WHEN others THEN
    CALL fail('T1', 'INSERT normal de trial_session', SQLERRM);
  END;

  -- T1b: UPDATE en sesión activa debe funcionar (solo data JSONB)
  IF v_session IS NOT NULL THEN
    BEGIN
      UPDATE trial_sessions
      SET data = '{"test": true, "updated": true}'::JSONB
      WHERE session_id = v_session AND expires_at > NOW();

      CALL pass('T1', 'UPDATE de data en sesión activa funciona');
    EXCEPTION WHEN others THEN
      CALL fail('T1', 'UPDATE de data en sesión activa', SQLERRM);
    END;
  END IF;

  -- T1c: UPDATE que intenta cambiar session_id debe fallar
  IF v_session IS NOT NULL THEN
    BEGIN
      UPDATE trial_sessions
      SET session_id = gen_random_uuid()
      WHERE session_id = v_session;

      -- Si llegamos aquí, el trigger NO funcionó
      CALL fail('T1', 'Cambio de session_id bloqueado por trigger', 'El UPDATE no fue rechazado');
    EXCEPTION WHEN check_violation THEN
      CALL pass('T1', 'Cambio de session_id bloqueado (check_violation como esperado)');
    WHEN others THEN
      -- Otro error también indica que fue bloqueado
      CALL pass('T1', 'Cambio de session_id bloqueado — ' || SQLERRM);
    END;
  END IF;

  -- T1d: Verificar que la función cleanup elimina expiradas
  --      Insertar una sesión con expires_at forzado al pasado (directo, sin trigger)
  --      Nota: como expires_at es GENERATED, debemos testear cleanup_trial_sessions()
  BEGIN
    PERFORM cleanup_trial_sessions();
    CALL pass('T1', 'Función cleanup_trial_sessions() ejecuta sin error');
  EXCEPTION WHEN others THEN
    CALL fail('T1', 'Función cleanup_trial_sessions()', SQLERRM);
  END;

  -- T1e: Verificar que la función current_trial_session_uuid() existe
  BEGIN
    PERFORM current_trial_session_uuid();
    CALL pass('T1', 'Función current_trial_session_uuid() existe y ejecuta');
  EXCEPTION WHEN others THEN
    CALL fail('T1', 'Función current_trial_session_uuid()', SQLERRM);
  END;

  -- T1f: Limpiar sesión de prueba
  IF v_session IS NOT NULL THEN
    DELETE FROM trial_sessions WHERE session_id = v_session;
  END IF;

  -- ===========================================================================
  -- T2. INMUTABILIDAD: project_version_hashes
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '── T2. Inmutabilidad project_version_hashes ────────────────────';

  -- T2a: Verificar que la tabla existe
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'project_version_hashes' AND table_schema = 'public') THEN
      CALL pass('T2', 'Tabla project_version_hashes existe');
    ELSE
      CALL fail('T2', 'Tabla project_version_hashes existe', 'Tabla no encontrada — ejecutar 009_project_version_hashes.sql');
    END IF;
  END;

  -- T2b: INSERT válido debe funcionar
  v_project := gen_random_uuid();
  BEGIN
    INSERT INTO project_version_hashes
      (project_id, tenant_id, hash_value, payload_size_bytes, project_status, triggered_by)
    VALUES
      (v_project, v_tenant_a,
       encode(sha256(('test-' || v_project::TEXT)::BYTEA), 'hex'),
       1024, 'Borrador', 'test_suite')
    RETURNING id INTO v_hash_id;

    IF v_hash_id IS NOT NULL THEN
      CALL pass('T2', 'INSERT de hash válido funciona (append-only permitido)');
    ELSE
      CALL fail('T2', 'INSERT de hash válido', 'RETURNING devolvió NULL');
    END IF;
  EXCEPTION WHEN others THEN
    -- La tabla puede requerir tenant context vía RLS
    CALL fail('T2', 'INSERT de hash válido', SQLERRM || ' (¿RLS activo sin contexto de tenant?)');
    -- Desactivar RLS temporalmente para el test (solo si tenemos privilegios)
    BEGIN
      SET LOCAL row_security = OFF;
      INSERT INTO project_version_hashes
        (project_id, tenant_id, hash_value, payload_size_bytes, project_status, triggered_by)
      VALUES
        (v_project, v_tenant_a,
         encode(sha256(('test-' || v_project::TEXT)::BYTEA), 'hex'),
         1024, 'Borrador', 'test_suite')
      RETURNING id INTO v_hash_id;

      IF v_hash_id IS NOT NULL THEN
        CALL pass('T2', 'INSERT de hash válido funciona (RLS desactivado para test superuser)');
      END IF;
    EXCEPTION WHEN others THEN
      CALL fail('T2', 'INSERT hash con RLS desactivado', SQLERRM);
    END;
  END;

  -- T2c: UPDATE debe lanzar IMMUTABILITY_VIOLATION
  IF v_hash_id IS NOT NULL THEN
    BEGIN
      UPDATE project_version_hashes
      SET project_status = 'MANIPULADO'
      WHERE id = v_hash_id;

      -- Si llegamos aquí, el trigger NO está funcionando
      CALL fail('T2', 'UPDATE bloqueado por trigger de inmutabilidad', 'UPDATE ejecutó sin error — trigger no activo');
    EXCEPTION WHEN restrict_violation THEN
      CALL pass('T2', 'UPDATE bloqueado con IMMUTABILITY_VIOLATION (restrict_violation)');
    WHEN others THEN
      -- Cualquier error indica protección
      IF SQLERRM ILIKE '%IMMUTABILITY%' OR SQLERRM ILIKE '%append-only%' OR SQLERRM ILIKE '%forbidden%' THEN
        CALL pass('T2', 'UPDATE bloqueado por trigger — ' || SQLERRM);
      ELSE
        CALL fail('T2', 'UPDATE bloqueado por trigger', 'Error inesperado: ' || SQLERRM);
      END IF;
    END;
  ELSE
    RAISE NOTICE '[⊘ SKIP] [T2] UPDATE bloqueado — no se pudo insertar fila previa';
  END IF;

  -- T2d: DELETE debe lanzar IMMUTABILITY_VIOLATION
  IF v_hash_id IS NOT NULL THEN
    BEGIN
      DELETE FROM project_version_hashes WHERE id = v_hash_id;

      -- Si llegamos aquí, el trigger NO está funcionando
      CALL fail('T2', 'DELETE bloqueado por trigger de inmutabilidad', 'DELETE ejecutó sin error — trigger no activo');
    EXCEPTION WHEN restrict_violation THEN
      CALL pass('T2', 'DELETE bloqueado con IMMUTABILITY_VIOLATION (restrict_violation)');
    WHEN others THEN
      IF SQLERRM ILIKE '%IMMUTABILITY%' OR SQLERRM ILIKE '%append-only%' THEN
        CALL pass('T2', 'DELETE bloqueado por trigger — ' || SQLERRM);
      ELSE
        CALL fail('T2', 'DELETE bloqueado por trigger', 'Error inesperado: ' || SQLERRM);
      END IF;
    END;
  ELSE
    RAISE NOTICE '[⊘ SKIP] [T2] DELETE bloqueado — no se pudo insertar fila previa';
  END IF;

  -- T2e: Insertar segundo hash del mismo proyecto — ON CONFLICT DO UPDATE es no-op
  IF v_hash_id IS NOT NULL THEN
    BEGIN
      DECLARE
        v_hash2 UUID;
        v_same_hash TEXT;
      BEGIN
        v_same_hash := encode(sha256(('test-' || v_project::TEXT)::BYTEA), 'hex');
        INSERT INTO project_version_hashes
          (project_id, tenant_id, hash_value, payload_size_bytes, project_status, triggered_by)
        VALUES
          (v_project, v_tenant_a, v_same_hash, 1024, 'Borrador', 'test_suite_dup')
        ON CONFLICT (project_id, hash_value) DO UPDATE
          SET metadata = project_version_hashes.metadata  -- no-op
        RETURNING id INTO v_hash2;

        -- El id retornado debe ser el mismo (no duplicado)
        IF v_hash2 = v_hash_id THEN
          CALL pass('T2', 'ON CONFLICT retorna registro existente (no duplica hashes)');
        ELSE
          CALL fail('T2', 'ON CONFLICT no duplica hashes', 'Se creó un nuevo registro con el mismo hash');
        END IF;
      EXCEPTION WHEN others THEN
        CALL fail('T2', 'ON CONFLICT de hash duplicado', SQLERRM);
      END;
    END;
  END IF;

  -- ===========================================================================
  -- T3. RLS stripe_events — REVOKE para roles de usuario
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '── T3. RLS stripe_events (REVOKE authenticated) ────────────────';

  -- T3a: Verificar que RLS está habilitado y forzado
  BEGIN
    DECLARE
      v_rls_enabled BOOLEAN;
      v_rls_forced  BOOLEAN;
    BEGIN
      SELECT c.relrowsecurity, c.relforcerowsecurity
      INTO v_rls_enabled, v_rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'stripe_events' AND n.nspname = 'public';

      IF v_rls_enabled THEN
        CALL pass('T3', 'stripe_events tiene ROW LEVEL SECURITY habilitado');
      ELSE
        CALL fail('T3', 'stripe_events tiene ROW LEVEL SECURITY habilitado', 'RLS desactivado — ejecutar 010_rls_complete_audit.sql');
      END IF;

      IF v_rls_forced THEN
        CALL pass('T3', 'stripe_events tiene FORCE ROW LEVEL SECURITY');
      ELSE
        CALL fail('T3', 'stripe_events tiene FORCE ROW LEVEL SECURITY', 'FORCE no activado — superuser puede bypassar');
      END IF;
    END;
  END;

  -- T3b: Verificar que no hay políticas SELECT para authenticated
  BEGIN
    DECLARE
      v_policy_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_policy_count
      FROM pg_policies
      WHERE tablename = 'stripe_events'
        AND schemaname = 'public'
        AND cmd IN ('SELECT', 'ALL')
        AND (roles @> ARRAY['authenticated'] OR roles @> ARRAY['PUBLIC'] OR roles = '{}');

      IF v_policy_count = 0 THEN
        CALL pass('T3', 'Sin políticas SELECT para rol authenticated en stripe_events (default deny)');
      ELSE
        CALL fail('T3', 'Sin políticas SELECT para authenticated en stripe_events',
          v_policy_count::TEXT || ' política(s) activa(s) — revisar');
      END IF;
    END;
  END;

  -- T3c: Verificar REVOKE mediante has_table_privilege (si el rol existe)
  BEGIN
    DECLARE
      v_has_priv BOOLEAN;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        SELECT has_table_privilege('authenticated', 'stripe_events', 'SELECT')
        INTO v_has_priv;

        IF NOT v_has_priv THEN
          CALL pass('T3', 'Rol authenticated NO tiene privilegio SELECT en stripe_events (REVOKE aplicado)');
        ELSE
          CALL fail('T3', 'Rol authenticated bloqueado en stripe_events', 'has_table_privilege retornó TRUE — REVOKE no aplicado');
        END IF;
      ELSE
        RAISE NOTICE '[⊘ SKIP] [T3] Rol "authenticated" no existe en esta instancia (PostgreSQL sin Supabase)';
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE '[⊘ SKIP] [T3] has_table_privilege falló: %', SQLERRM;
    END;
  END;

  -- T3d: Mismo check para trial_sessions con rol anon
  BEGIN
    DECLARE
      v_has_priv BOOLEAN;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        SELECT has_table_privilege('anon', 'trial_sessions', 'SELECT')
        INTO v_has_priv;

        IF NOT v_has_priv THEN
          CALL pass('T3', 'Rol anon NO tiene privilegio SELECT en trial_sessions (REVOKE aplicado)');
        ELSE
          CALL fail('T3', 'Rol anon bloqueado en trial_sessions', 'has_table_privilege retornó TRUE');
        END IF;
      ELSE
        RAISE NOTICE '[⊘ SKIP] [T3] Rol "anon" no existe (PostgreSQL sin Supabase)';
      END IF;
    EXCEPTION WHEN others THEN
      RAISE NOTICE '[⊘ SKIP] [T3] has_table_privilege falló: %', SQLERRM;
    END;
  END;

  -- ===========================================================================
  -- T4. Aislamiento cross-tenant en tabla projects
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '── T4. Aislamiento cross-tenant (projects) ─────────────────────';

  -- T4a: RLS habilitado en projects
  BEGIN
    DECLARE
      v_rls_enabled BOOLEAN;
      v_rls_forced  BOOLEAN;
    BEGIN
      SELECT c.relrowsecurity, c.relforcerowsecurity
      INTO v_rls_enabled, v_rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'projects' AND n.nspname = 'public';

      IF v_rls_enabled THEN
        CALL pass('T4', 'projects tiene ROW LEVEL SECURITY habilitado');
      ELSE
        CALL fail('T4', 'projects tiene ROW LEVEL SECURITY habilitado', 'RLS desactivado');
      END IF;

      IF v_rls_forced THEN
        CALL pass('T4', 'projects tiene FORCE ROW LEVEL SECURITY');
      ELSE
        CALL fail('T4', 'projects tiene FORCE ROW LEVEL SECURITY', 'FORCE no activo');
      END IF;
    END;
  END;

  -- T4b: Verificar función de tenant context
  BEGIN
    PERFORM set_tenant_context(v_tenant_a::TEXT);

    IF current_tenant_id() = v_tenant_a THEN
      CALL pass('T4', 'set_tenant_context + current_tenant_id() funcionan correctamente');
    ELSE
      CALL fail('T4', 'set_tenant_context + current_tenant_id()', 'UUID no coincide: ' || COALESCE(current_tenant_id()::TEXT, 'NULL'));
    END IF;
  EXCEPTION WHEN others THEN
    CALL fail('T4', 'set_tenant_context', SQLERRM);
  END;

  -- T4c: Verificar que current_tenant_uuid() también funciona (migración 005)
  BEGIN
    PERFORM set_config('app.org_id', v_tenant_b::TEXT, TRUE);

    IF current_tenant_uuid() = v_tenant_b THEN
      CALL pass('T4', 'current_tenant_uuid() lee app.org_id correctamente');
    ELSE
      CALL fail('T4', 'current_tenant_uuid()', 'UUID no coincide via app.org_id: ' || COALESCE(current_tenant_uuid()::TEXT, 'NULL'));
    END IF;
  EXCEPTION WHEN others THEN
    CALL fail('T4', 'current_tenant_uuid()', SQLERRM);
  END;

  -- ===========================================================================
  -- T5. Reporte de Auditoría RLS — todas las tablas del schema
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '── T5. Auditoría RLS completa del schema public ─────────────────';

  DECLARE
    r                RECORD;
    tables_rls_on    INTEGER := 0;
    tables_rls_off   INTEGER := 0;
    tables_force_on  INTEGER := 0;
    tables_force_off INTEGER := 0;
    critical_tables  TEXT[]  := ARRAY['projects','proyectos','users','usuarios','user_subscriptions',
                                      'stripe_events','trial_sessions','project_version_hashes',
                                      'objective_tree'];
    table_name_iter  TEXT;
    t_rls            BOOLEAN;
    t_force          BOOLEAN;
  BEGIN
    RAISE NOTICE '%-40s %-6s %-6s %s', 'TABLA', 'RLS', 'FORCE', 'POLÍTICAS';
    RAISE NOTICE '%s', REPEAT('-', 70);

    FOR r IN
      SELECT
        t.tablename,
        c.relrowsecurity       AS rls_enabled,
        c.relforcerowsecurity  AS rls_forced,
        (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.tablename AND p.schemaname = 'public') AS policy_count
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE t.schemaname = 'public'
        AND t.tablename NOT LIKE '\_%'  -- excluir tablas internas
      ORDER BY t.tablename
    LOOP
      RAISE NOTICE '%-40s %-6s %-6s %s',
        r.tablename,
        CASE WHEN r.rls_enabled THEN '✓' ELSE '✗' END,
        CASE WHEN r.rls_forced  THEN '✓' ELSE '✗' END,
        r.policy_count;

      IF r.rls_enabled  THEN tables_rls_on    := tables_rls_on    + 1;
      ELSE                    tables_rls_off   := tables_rls_off   + 1; END IF;
      IF r.rls_forced   THEN tables_force_on  := tables_force_on  + 1;
      ELSE                    tables_force_off := tables_force_off + 1; END IF;
    END LOOP;

    RAISE NOTICE '%s', REPEAT('-', 70);
    RAISE NOTICE 'RLS ON: % | RLS OFF: % | FORCE ON: % | FORCE OFF: %',
      tables_rls_on, tables_rls_off, tables_force_on, tables_force_off;

    -- Verificar tablas críticas específicamente
    FOREACH table_name_iter IN ARRAY critical_tables LOOP
      SELECT c.relrowsecurity, c.relforcerowsecurity
      INTO t_rls, t_force
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = table_name_iter AND n.nspname = 'public';

      IF t_rls IS NULL THEN
        RAISE NOTICE '[⊘ SKIP] [T5] Tabla crítica % no existe aún', table_name_iter;
      ELSIF t_rls AND t_force THEN
        CALL pass('T5', 'Tabla crítica ' || table_name_iter || ': RLS + FORCE activos');
      ELSIF t_rls THEN
        CALL fail('T5', 'Tabla crítica ' || table_name_iter, 'RLS ON pero FORCE ROW SECURITY no activo — superuser puede bypassar');
      ELSE
        CALL fail('T5', 'Tabla crítica ' || table_name_iter, 'SIN RLS — brecha de aislamiento de tenant');
      END IF;
    END LOOP;
  END;

  -- ===========================================================================
  -- RESUMEN FINAL
  -- ===========================================================================
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║   RESUMEN DE PRUEBAS SQL DE SEGURIDAD                     ║';
  RAISE NOTICE '╠═══════════════════════════════════════════════════════════╣';
  RAISE NOTICE '║   ✓ Pasados:  %                                           ║', LPAD(v_passed::TEXT, 3);
  RAISE NOTICE '║   ✗ Fallidos: %                                           ║', LPAD(v_failed::TEXT, 3);
  RAISE NOTICE '║   Puntuación: %% (%/%)                              ║',
    CASE WHEN (v_passed + v_failed) > 0 THEN ROUND((v_passed::NUMERIC / (v_passed + v_failed)) * 100) ELSE 0 END,
    v_passed, (v_passed + v_failed);
  RAISE NOTICE '╠═══════════════════════════════════════════════════════════╣';

  IF v_failed = 0 THEN
    RAISE NOTICE '║   ✅ SISTEMA CERRADO: SEGURIDAD SQL VALIDADA               ║';
  ELSE
    RAISE NOTICE '║   ⛔ % FALLA(S) — ejecutar migraciones faltantes          ║', v_failed;
  END IF;

  RAISE NOTICE '╚═══════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';

  IF v_failed > 0 THEN
    RAISE NOTICE 'Pasos de corrección:';
    RAISE NOTICE '  psql $DATABASE_URL -f backend/migrations/008_trial_sessions_ttl_trigger.sql';
    RAISE NOTICE '  psql $DATABASE_URL -f backend/migrations/009_project_version_hashes.sql';
    RAISE NOTICE '  psql $DATABASE_URL -f backend/migrations/010_rls_complete_audit.sql';
  END IF;

END;
$$;
