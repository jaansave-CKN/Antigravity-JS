-- =============================================================================
-- RadarFondos 360 — 013_domain_entities_materialization.sql
--
-- ⚠ ADVERTENCIA (2026-08-02, verificado contra la BD en vivo con Management API):
--   Este archivo originalmente tenía un typo — "object_tree" en vez de
--   "objective_tree" — ya corregido abajo. PERO el problema es más profundo:
--   ni "objective_tree" ni "projects" (el esquema canónico en inglés de la
--   migración 003) existen realmente en producción. Solo existen "objetivos_arbol"
--   y "proyectos" (español) — projects sí existe como tabla pero con 0 filas.
--   server.js (el proceso que sirve la app real) usa exclusivamente los nombres
--   en español. NO ejecutar esta migración contra producción tal cual: el primer
--   ALTER TABLE fallaría (relation "objective_tree" does not exist) y, si en el
--   futuro alguien la adapta a "objetivos_arbol" sin revisar el bloque de FK que
--   compara contra "projects", el chequeo de huérfanos borraría TODAS las filas
--   reales (viven en "proyectos", no en "projects", que está vacía). Requiere
--   reescritura consciente antes de aplicarse, no solo un rename de tabla.
--
-- PROPÓSITO:
--   Materializar las entidades de dominio que la auditoría técnica encontró
--   ausentes del esquema: Anexos, Indicadores y Teoría del Cambio no existían
--   como tablas (Anexos vivía solo en localStorage del cliente; Indicadores y
--   Teoría del Cambio eran etiquetas de campo de formulario sin persistencia
--   estructurada). Además formaliza 'Problema' dentro de la tabla ya existente
--   objective_tree (antes objetivos_arbol), que hoy solo modela el árbol de
--   OBJETIVOS (MGA: CENTRAL/ESPECIFICO/RESULTADO/ACTIVIDAD) pero no tiene
--   forma de representar un árbol de PROBLEMAS (Causas→Problema→Efectos).
--
--   Todas las tablas nuevas usan tenant_id (no org_id) como columna de
--   aislamiento — es el estándar consolidado del repo desde 002_multitenant_saas.sql
--   y 010_rls_complete_audit.sql; usar org_id habría reintroducido exactamente
--   la duplicación tenant_id/org_id que 002 se creó para eliminar.
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 013_domain_entities_materialization.sql
-- =============================================================================

-- =============================================================================
-- 1. TABLA: project_anexos
--    Reemplaza el almacenamiento en localStorage de AnexosView.tsx
--    (localStorage key: radar360_anexos_data) — nunca llegaba al backend.
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_anexos (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id      UUID          NOT NULL,
  nombre_archivo TEXT          NOT NULL,
  ruta_storage   TEXT          NOT NULL,   -- path en Supabase Storage o filesystem local
  tipo_mime      TEXT          NOT NULL,
  tamano_bytes   BIGINT        NOT NULL DEFAULT 0,
  categoria      TEXT          CHECK (categoria IN ('legal','financiero','tecnico','institucional','otro'))
                               DEFAULT 'otro',
  created_at     TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_anexos_project_id ON project_anexos (project_id);
CREATE INDEX IF NOT EXISTS idx_project_anexos_tenant_id  ON project_anexos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_anexos_categoria  ON project_anexos (categoria);

ALTER TABLE project_anexos ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_anexos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_anexos_tenant_rls ON project_anexos;
CREATE POLICY project_anexos_tenant_rls ON project_anexos
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- 2. TABLA: project_indicators
--    Indicadores MGA/BPIN (Producto/Resultado/Impacto/Gestión) — antes solo
--    existían como texto libre dentro de ficha_tecnica/payload_es JSONB,
--    sin estructura consultable ni validable por el motor de coherencia.
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_indicators (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id           UUID          NOT NULL,
  nombre              TEXT          NOT NULL,
  tipo                TEXT          CHECK (tipo IN ('Producto','Resultado','Impacto','Gestión')) NOT NULL,
  linea_base          NUMERIC(14,4) DEFAULT 0,
  meta_total          NUMERIC(14,4) NOT NULL,
  unidad_medida       TEXT          NOT NULL,
  fuente_verificacion TEXT,
  created_at          TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_indicators_project_id ON project_indicators (project_id);
CREATE INDEX IF NOT EXISTS idx_project_indicators_tenant_id  ON project_indicators (tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_indicators_tipo       ON project_indicators (tipo);

ALTER TABLE project_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_indicators FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_indicators_tenant_rls ON project_indicators;
CREATE POLICY project_indicators_tenant_rls ON project_indicators
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

-- =============================================================================
-- 3. TABLA: project_change_theory (Teoría del Cambio — 1:1 con projects)
--    Antes: campo D_alineacion en Radford360_Agent.ts, validado solo por
--    longitud mínima (40 caracteres), nunca cruzado semánticamente ni
--    persistido de forma estructurada.
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_change_theory (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              UUID          NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id               UUID          NOT NULL,
  insumos                 JSONB         NOT NULL DEFAULT '[]',
  actividades              JSONB        NOT NULL DEFAULT '[]',
  productos                JSONB        NOT NULL DEFAULT '[]',
  resultados_corto_plazo   JSONB        NOT NULL DEFAULT '[]',
  impacto_largo_plazo      TEXT,
  updated_at               TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_change_theory_tenant_id ON project_change_theory (tenant_id);

ALTER TABLE project_change_theory ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_change_theory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_change_theory_tenant_rls ON project_change_theory;
CREATE POLICY project_change_theory_tenant_rls ON project_change_theory
  FOR ALL USING (
    tenant_id = current_tenant_uuid()
    OR tenant_id = current_auth_uid()
  );

CREATE OR REPLACE FUNCTION set_updated_at_change_theory()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_change_theory_updated_at ON project_change_theory;
CREATE TRIGGER trg_change_theory_updated_at
  BEFORE UPDATE ON project_change_theory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_change_theory();

-- =============================================================================
-- 4. FORMALIZACIÓN DE 'Problema' EN objective_tree (antes objetivos_arbol)
--
-- objective_tree ya existe (creada originalmente en el bootstrap de server.js,
-- renombrada de objetivos_arbol → objective_tree en 003, con RLS+FORCE ya
-- aplicado en 010_rls_complete_audit.sql). Hoy solo modela el ÁRBOL DE
-- OBJETIVOS (columna 'tipo': CENTRAL/ESPECIFICO/RESULTADO/ACTIVIDAD, usado
-- por arbolObjetivosAgent.js). No existe ninguna representación del ÁRBOL DE
-- PROBLEMAS (Causas→Problema Central→Efectos) — el hallazgo original de la
-- auditoría ("Problema no existe como tabla, solo tipo='CENTRAL' dentro de
-- objetivos_arbol") describe exactamente esta laguna.
--
-- Se añade 'tipo_nodo' como clasificador canónico AMPLIO que puede etiquetar
-- tanto nodos de árbol de problemas (PROBLEMA_CENTRAL/CAUSA/EFECTO) como de
-- árbol de objetivos (OBJETIVO_GENERAL/OBJETIVO_ESPECIFICO), sin reemplazar
-- la columna 'tipo' existente (que sigue siendo la granularidad MGA de 4
-- niveles usada por el agente de IA). Backfill: CENTRAL→OBJETIVO_GENERAL,
-- ESPECIFICO→OBJETIVO_ESPECIFICO; RESULTADO/ACTIVIDAD quedan con tipo_nodo
-- NULL (son sub-niveles operativos sin equivalente en el árbol de problemas).
-- Filas nuevas de árbol de problemas (CAUSA/EFECTO/PROBLEMA_CENTRAL) usan
-- 'tipo_nodo' como único clasificador — 'tipo' puede quedar NULL para ellas
-- desde el código que las inserte.
-- =============================================================================

ALTER TABLE objective_tree
  ADD COLUMN IF NOT EXISTS tipo_nodo TEXT
  CHECK (tipo_nodo IN ('PROBLEMA_CENTRAL','CAUSA','EFECTO','OBJETIVO_GENERAL','OBJETIVO_ESPECIFICO'));

UPDATE objective_tree SET tipo_nodo = 'OBJETIVO_GENERAL'    WHERE tipo = 'CENTRAL'    AND tipo_nodo IS NULL;
UPDATE objective_tree SET tipo_nodo = 'OBJETIVO_ESPECIFICO' WHERE tipo = 'ESPECIFICO' AND tipo_nodo IS NULL;

-- ── FK explícita objective_tree.proyecto_id → projects(id) ──────────────────────
-- proyecto_id fue creada como TEXT en el bootstrap original (nunca migrada a
-- UUID por 001-012, a diferencia de projects/match_scores que sí lo fueron).
-- Todo el código que inserta en esta tabla (formularProyectoInversion.js:211)
-- ya usa crypto.randomUUID() y el UUID real de projects.id/tenant_id, así que
-- los valores existentes son UUIDs válidos almacenados como texto — el cast
-- es seguro. Se valida el formato ANTES de intentarlo para fallar con un
-- mensaje claro (no un error críptico de casteo) si algún entorno tiene datos
-- legacy no conformes.
DO $$
DECLARE
  bad_format_count INTEGER;
  orphan_count      INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_format_count
  FROM objective_tree
  WHERE proyecto_id IS NOT NULL
    AND proyecto_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF bad_format_count > 0 THEN
    RAISE EXCEPTION '[013] % fila(s) en objective_tree.proyecto_id no tienen formato UUID válido — limpiar manualmente antes de re-ejecutar esta migración.', bad_format_count;
  END IF;

  -- Limpieza de huérfanos: proyecto_id que ya no existe en projects.
  -- Sin esto, la conversión de tipo tendría éxito pero la FK posterior fallaría.
  SELECT COUNT(*) INTO orphan_count
  FROM objective_tree ot
  WHERE ot.proyecto_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id::TEXT = ot.proyecto_id);

  IF orphan_count > 0 THEN
    RAISE WARNING '[013] % fila(s) huérfana(s) en objective_tree.proyecto_id (sin proyecto asociado) — eliminando antes de aplicar FK.', orphan_count;
    DELETE FROM objective_tree ot
    WHERE ot.proyecto_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id::TEXT = ot.proyecto_id);
  END IF;
END;
$$;

-- Conversión de tipo TEXT → UUID (segura tras las validaciones anteriores)
ALTER TABLE objective_tree ALTER COLUMN id         TYPE UUID USING id::uuid;
ALTER TABLE objective_tree ALTER COLUMN proyecto_id TYPE UUID USING proyecto_id::uuid;
ALTER TABLE objective_tree ALTER COLUMN parent_id  TYPE UUID USING NULLIF(parent_id, '')::uuid;

ALTER TABLE objective_tree
  DROP CONSTRAINT IF EXISTS fk_object_tree_project;

ALTER TABLE objective_tree
  ADD CONSTRAINT fk_object_tree_project
  FOREIGN KEY (proyecto_id) REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_object_tree_tipo_nodo ON objective_tree (tipo_nodo);

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 013 ===';

  FOR r IN
    SELECT t.tablename,
           c.relrowsecurity   AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = t.tablename AND p.schemaname = 'public') AS policy_count
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE t.schemaname = 'public'
      AND t.tablename IN ('project_anexos','project_indicators','project_change_theory')
    ORDER BY t.tablename
  LOOP
    RAISE NOTICE '[%] existe · RLS: % · FORCE: % · políticas: %',
      r.tablename, r.rls_enabled, r.rls_forced, r.policy_count;
  END LOOP;

  SELECT COUNT(*) INTO r FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'objective_tree' AND con.contype = 'f' AND con.conname = 'fk_object_tree_project';
  RAISE NOTICE '[objective_tree] fk_object_tree_project instalada: %', (r.count = 1);

  SELECT COUNT(*) INTO r FROM information_schema.columns
    WHERE table_name = 'objective_tree' AND column_name = 'tipo_nodo';
  RAISE NOTICE '[objective_tree] columna tipo_nodo instalada: %', (r.count = 1);

  RAISE NOTICE '=== FIN VERIFICACIÓN 013 ===';
END;
$$;
