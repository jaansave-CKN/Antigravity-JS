-- =============================================================================
-- 053_rls_scoped_role.sql
--
-- 005_INGENIERO_BACKEND (2026-09-04) — Fase 3 de aislamiento multi-tenant,
-- veredicto de 002_ARQUITECTO_DE_SOFTWARE.
--
-- HALLAZGO QUE ORIGINA ESTA MIGRACIÓN (verificado en vivo, no hipótesis):
--   SELECT current_user, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;
--   → {"current_user":"postgres","rolbypassrls":true,"rolsuper":false}
-- El rol "postgres" que usa DATABASE_URL bypasea RLS incondicionalmente. Las
-- políticas de 026_rls_policies_tenant_isolation.sql (y las de 002/005/010)
-- existen y están bien escritas, pero NUNCA se han evaluado contra ninguna
-- conexión real de esta app.
--
-- QUÉ HACE ESTA MIGRACIÓN (puramente aditiva, cero impacto sobre "postgres"):
--   1. Crea un rol nuevo, sin BYPASSRLS/SUPERUSER/CREATEDB/CREATEROLE, dueño de
--      cero tablas (todas las tablas siguen siendo propiedad de "postgres" —
--      confirmado por auditoría: 51/51 tablas de public, owner = postgres).
--      Como este rol NO es el owner, las políticas RLS se aplican de forma
--      automática y completa sin necesitar FORCE ROW LEVEL SECURITY.
--   2. Otorga GRANT mínimo (SELECT/INSERT/UPDATE/DELETE, sin DDL) sobre las
--      tablas que hoy tocan los 8 sitios que bypasean RLS vía supabaseAdmin
--      (service_role) en vez de pasar por withTenant():
--        AuditorForenseService.js, CopilotoService.js,
--        EstresadoFinancieroService.js, ExtractorService.js,
--        ValorExponencialService.js, anexos.routes.js (línea ~496-497,
--        mismo patrón, no listado originalmente pero mismo gap real),
--        proyectos.routes.js (línea ~607-610).
--      No incluye ai_token_logs (aiTokenLogger.js) ni gemini_key_state
--      (geminiCircuitBreaker.js) — el primero es bajo riesgo (solo escribe
--      con su propio user_id), el segundo es estado GLOBAL de rotación de
--      llaves, no dato por-tenant (mismo criterio que convocatorias/
--      system_config en 026_rls_policies_tenant_isolation.sql:54-59).
--   3. NO se le otorga contraseña aquí (ALTER ROLE ... PASSWORD se ejecuta
--      aparte, fuera de este archivo versionado en git, para no commitear un
--      secreto en texto plano — mismo criterio ya documentado en
--      database.config.js:30-35 sobre la fuga histórica de SUPABASE_SERVICE_KEY).
--
-- QUÉ NO HACE (restricción dura del mandato, respetada explícitamente):
--   - NO toca el rol "postgres" (ni REVOKE, ni ALTER, ni DROP).
--   - NO reemplaza DATABASE_URL del pool principal — ver nota de diseño en
--     database.config.js sobre por qué (280+ call sites de getRow/getRows/
--     runSql en server.js y backend/routes/*.js nunca hacen SET LOCAL
--     app.org_id; conectarlos con un rol sin BYPASSRLS los dejaría viendo 0
--     filas silenciosamente en el 100% de las rutas no migradas — verificado
--     por conteo real, no supuesto).
--
-- Idempotente: seguro de re-ejecutar completo si una corrida previa quedó a
-- medias. Envuelto en transacción explícita (todo o nada).
-- =============================================================================

BEGIN;

-- ── Paso 1: rol nuevo, sin privilegios elevados ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf360_rls_scoped') THEN
    CREATE ROLE rf360_rls_scoped WITH
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      CONNECTION LIMIT 20;
    RAISE NOTICE '[CHECKPOINT 1/4] Rol rf360_rls_scoped creado.';
  ELSE
    -- Re-afirma LOGIN/límite de conexión en cada corrida. NO se reafirman
    -- aquí SUPERUSER/REPLICATION/BYPASSRLS: verificado en vivo (Postgres 17)
    -- que un rol con CREATEROLE pero SIN SUPERUSER (como "postgres" en esta
    -- instancia — rolsuper=false) recibe "permission denied to alter role"
    -- al intentar tocar esos 3 atributos vía ALTER ROLE, incluso para
    -- reafirmar el valor "NO" en un rol que él mismo creó y donde tiene
    -- ADMIN OPTION. Esto es una garantía de seguridad ESTRUCTURAL, no una
    -- limitación: significa que "postgres" (el rol que usa esta migración)
    -- es físicamente incapaz de escalar rf360_rls_scoped (ni ningún otro rol
    -- que cree) a BYPASSRLS/SUPERUSER/REPLICATION después de creado — solo
    -- un superusuario real de la instancia podría hacerlo. El CHECKPOINT 4
    -- de abajo sigue verificando estos 3 flags contra pg_roles de todos modos.
    ALTER ROLE rf360_rls_scoped WITH
      LOGIN
      CONNECTION LIMIT 20;
    RAISE NOTICE '[CHECKPOINT 1/4] Rol rf360_rls_scoped ya existía — LOGIN/límite de conexión reafirmados (SUPERUSER/REPLICATION/BYPASSRLS no se re-tocan por diseño, ver comentario).';
  END IF;
END $$;

-- ── Paso 2: acceso a la base y al schema ─────────────────────────────────────
GRANT CONNECT ON DATABASE postgres TO rf360_rls_scoped;
GRANT USAGE ON SCHEMA public TO rf360_rls_scoped;

DO $$
BEGIN
  RAISE NOTICE '[CHECKPOINT 2/4] CONNECT + USAGE otorgados sobre schema public.';
END $$;

-- ── Paso 3: GRANT mínimo (DML, sin DDL) sobre las tablas afectadas ───────────
-- Todas estas tablas ya tienen RLS habilitado (verificado: rls_on=true en las
-- 7) con políticas tenant_isolation de 026_rls_policies_tenant_isolation.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  proyectos,
  project_apu_lineas,
  project_hallazgos,
  project_escenarios_estres,
  project_sroi_metrics,
  project_ods_mapping,
  project_chat_history
TO rf360_rls_scoped;

-- Defensivo: si alguna de estas tablas usa una secuencia (SERIAL/IDENTITY)
-- hoy o en el futuro, el rol necesita poder avanzarla en el INSERT. Auditado
-- hoy: ninguna de las 7 usa nextval() (todas PK de tipo UUID/gen_random_uuid),
-- pero esto es barato y evita una sorpresa silenciosa si eso cambia.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rf360_rls_scoped;

DO $$
BEGIN
  RAISE NOTICE '[CHECKPOINT 3/4] GRANT DML otorgado sobre las 7 tablas objetivo + secuencias.';
END $$;

-- ── Paso 4: verificación inline ───────────────────────────────────────────────
DO $$
DECLARE
  v_role_ok BOOLEAN;
  v_bypass  BOOLEAN;
  v_super   BOOLEAN;
  v_missing TEXT := '';
  v_tabla   TEXT;
BEGIN
  SELECT TRUE, rolbypassrls, rolsuper INTO v_role_ok, v_bypass, v_super
  FROM pg_roles WHERE rolname = 'rf360_rls_scoped';

  IF v_role_ok IS NULL THEN
    RAISE EXCEPTION '[CHECKPOINT 4/4] FALLO: rol rf360_rls_scoped no existe tras la migración.';
  END IF;
  IF v_bypass IS TRUE OR v_super IS TRUE THEN
    RAISE EXCEPTION '[CHECKPOINT 4/4] FALLO: rf360_rls_scoped tiene BYPASSRLS/SUPERUSER activo — inseguro.';
  END IF;

  FOREACH v_tabla IN ARRAY ARRAY['proyectos','project_apu_lineas','project_hallazgos',
                                  'project_escenarios_estres','project_sroi_metrics',
                                  'project_ods_mapping','project_chat_history']
  LOOP
    IF NOT (
      has_table_privilege('rf360_rls_scoped', v_tabla, 'SELECT') AND
      has_table_privilege('rf360_rls_scoped', v_tabla, 'INSERT') AND
      has_table_privilege('rf360_rls_scoped', v_tabla, 'UPDATE') AND
      has_table_privilege('rf360_rls_scoped', v_tabla, 'DELETE')
    ) THEN
      v_missing := v_missing || v_tabla || ' ';
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION '[CHECKPOINT 4/4] FALLO: privilegios DML incompletos en: %', v_missing;
  END IF;

  RAISE NOTICE '[CHECKPOINT 4/4] OK — rol seguro (sin bypass/super) y GRANT DML completo en las 7 tablas.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Reporte final (una fila por tabla, OK/FALTA) ─────────────────────────────
SELECT
  t.tablename,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'SELECT') AS puede_select,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'INSERT') AS puede_insert,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'UPDATE') AS puede_update,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'DELETE') AS puede_delete,
  c.relrowsecurity AS rls_activo
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN ('proyectos','project_apu_lineas','project_hallazgos',
                       'project_escenarios_estres','project_sroi_metrics',
                       'project_ods_mapping','project_chat_history')
ORDER BY t.tablename;
