-- =============================================================================
-- RadarFondos 360 — 011_fix_project_status_enum.sql
--
-- PROBLEMA REAL (confirmado por lectura de 001 + 003 + 007):
--   001_postgres_schema.sql creó la columna 'estado' con:
--     CHECK (estado IN ('Borrador','En_Validacion','Finalizado','BLOQUEADO'))
--   003_schema_english_canonical.sql renombró la tabla proyectos → projects
--   y la columna estado → status. Postgres NO renombra el constraint junto
--   con la columna, así que ese CHECK original sigue activo, ahora escrito
--   sobre 'status', bajo su nombre autogenerado original.
--   007_security_hardening.sql AGREGÓ un SEGUNDO check (chk_projects_status_extended)
--   con una lista más amplia, pero NUNCA eliminó el primero.
--
--   PostgreSQL exige el cumplimiento de TODOS los CHECK de una columna a la
--   vez (se combinan con AND). Resultado real hoy: la tabla exige la
--   INTERSECCIÓN de ambas listas = solo {'Borrador','En_Validacion',
--   'Finalizado','BLOQUEADO'}. Cualquier INSERT/UPDATE con 'draft',
--   'formulado', 'processing', 'needs_human_review' o 'archived' —que es
--   exactamente lo que auditarFormulacion.js y formularProyectoInversion.js
--   escriben en producción— VIOLA el constraint original y falla, pese a que
--   007 los declaró explícitamente "permitidos".
--
-- ESTA MIGRACIÓN:
--   1. Elimina TODOS los CHECK constraints existentes sobre projects.status,
--      cualquiera sea su nombre real (no se asume un nombre fijo: el
--      autogenerado por 001 puede variar según el historial del entorno).
--   2. Traduce los valores heredados en español al vocabulario canónico.
--   3. Aplica UN ÚNICO CHECK canónico de 8 valores.
--   4. Alinea el DEFAULT de la columna.
--
-- Idempotente: puede ejecutarse más de una vez sin error ni efectos duplicados.
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 011_fix_project_status_enum.sql
-- =============================================================================

-- ── PASO 1: eliminar todo CHECK constraint existente sobre projects.status ──
DO $$
DECLARE
  r RECORD;
  dropped_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel     ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'projects'
      AND con.contype = 'c'            -- 'c' = CHECK constraint
      AND att.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE projects DROP CONSTRAINT IF EXISTS %I', r.conname);
    dropped_count := dropped_count + 1;
    RAISE NOTICE '[011] Eliminado CHECK constraint conflictivo sobre projects.status: %', r.conname;
  END LOOP;

  IF dropped_count = 0 THEN
    RAISE NOTICE '[011] No se encontraron CHECK constraints previos sobre projects.status (ya limpio).';
  END IF;
END;
$$;

-- ── PASO 2: migrar valores heredados al vocabulario canónico ────────────────
-- Idempotente: si ya están en formato canónico, el UPDATE afecta 0 filas.
UPDATE projects SET status = 'draft'      WHERE status = 'Borrador';
UPDATE projects SET status = 'in_review'  WHERE status = 'En_Validacion';
-- 'Finalizado' y 'BLOQUEADO' se preservan tal cual — son canónicos por
-- decisión explícita del vocabulario unificado (mezcla intencional ES/EN).
-- 'draft','in_review','needs_human_review','processing','formulado','archived'
-- ya son canónicos y no requieren traducción.

-- Cinturón de seguridad: cualquier valor residual no contemplado (basura,
-- typos históricos, valores de un consumidor externo) se reclasifica a
-- 'needs_human_review' en vez de dejarlo violar el nuevo constraint a ciegas
-- o abortar la migración.
UPDATE projects
SET status = 'needs_human_review'
WHERE status NOT IN ('draft','in_review','needs_human_review','processing',
                      'formulado','Finalizado','BLOQUEADO','archived');

-- ── PASO 3: aplicar el CHECK unificado y canónico (8 valores) ───────────────
ALTER TABLE projects
  ADD CONSTRAINT chk_projects_status_canonical
  CHECK (status IN ('draft','in_review','needs_human_review','processing',
                     'formulado','Finalizado','BLOQUEADO','archived'));

-- ── PASO 4: alinear el DEFAULT de la columna con el vocabulario canónico ────
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'draft';

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  bad_count INTEGER;
  check_count INTEGER;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 011 ===';

  SELECT COUNT(*) INTO check_count
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'projects' AND con.contype = 'c' AND con.conname = 'chk_projects_status_canonical';
  RAISE NOTICE '[projects] chk_projects_status_canonical instalado: %', (check_count = 1);

  SELECT COUNT(*) INTO bad_count FROM projects
  WHERE status NOT IN ('draft','in_review','needs_human_review','processing',
                        'formulado','Finalizado','BLOQUEADO','archived');
  RAISE NOTICE '[projects] Filas fuera del vocabulario canónico: % (debe ser 0)', bad_count;

  RAISE NOTICE '=== Distribución actual de projects.status ===';
  FOR r IN SELECT status, COUNT(*) AS n FROM projects GROUP BY status ORDER BY n DESC LOOP
    RAISE NOTICE '  % : % fila(s)', r.status, r.n;
  END LOOP;

  RAISE NOTICE '=== FIN VERIFICACIÓN 011 ===';
END;
$$;
