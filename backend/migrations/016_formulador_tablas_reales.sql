-- =============================================================================
-- RadarFondos 360 — 016_formulador_tablas_reales.sql
--
-- PROPÓSITO:
--   Crear las tablas que el Formulador necesita (logística por tramos,
--   anexos reales, indicadores estructurados, teoría de cambio) usando el
--   ESQUEMA REAL de la base de datos en producción — verificado en vivo vía
--   REST (GET /rest/v1/<tabla> y OpenAPI), NO a partir de los archivos de
--   migración 003/013, que describen un esquema "canónico en inglés"
--   (projects/tenant_id) que NUNCA se aplicó a esta base real. Confirmado:
--     - La tabla real de proyectos es `proyectos` (con datos reales).
--       `projects` (inglés) existe pero está VACÍA — migración fantasma.
--     - El árbol de objetivos real es `objetivos_arbol` (no `object_tree`).
--     - proyectos.id, usuarios.id, objetivos_arbol.id/proyecto_id son TEXT,
--       no UUID nativo (heredado del bootstrap SQLite original).
--     - Las columnas "JSON" de `proyectos` (ficha_tecnica, presupuesto) son
--       TEXT en la realidad (el código siempre hace JSON.stringify/parse a
--       mano), no JSONB — se sigue esa misma convención aquí.
--   No se agregan políticas RLS: esta app corrió siempre sobre Capa 2 REST
--   con la service_role key (bypasea RLS por completo) — agregar RLS aquí
--   sería falsa sensación de seguridad, no protección real.
--
-- APLICAR CON:
--   Pegar el contenido completo en el SQL Editor del dashboard de Supabase
--   y ejecutar. Es idempotente (seguro de re-ejecutar).
-- =============================================================================

-- =============================================================================
-- 1. logistica_tramos — Fase 1.2: tramos de ejecución (origen/destino/distancia)
--    Dominio DISTINTO de config_logistica (que modela datos del proponente/
--    entidad ejecutora, no tramos de transporte) — no reemplaza esa tabla.
-- =============================================================================
CREATE TABLE IF NOT EXISTS logistica_tramos (
  id              TEXT      PRIMARY KEY,
  proyecto_id     TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  numero          INTEGER   DEFAULT 0,
  origen          TEXT      DEFAULT '',
  destino         TEXT      DEFAULT '',
  duracion        TEXT      DEFAULT '',
  distancia_km    NUMERIC   DEFAULT 0,
  medio           TEXT      DEFAULT '',
  estado_via      TEXT      DEFAULT '',
  calidad         TEXT      DEFAULT '',
  tipo_transporte TEXT      DEFAULT '',
  orden_publico   TEXT      DEFAULT '',
  seleccionado    INTEGER   DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_logistica_tramos_proyecto ON logistica_tramos (proyecto_id);

-- =============================================================================
-- 2. project_anexos — Fase 1.3: reemplaza localStorage de AnexosCalcoView.tsx
--    Nombres de columna (project_id, tenant_id) elegidos para calzar EXACTO
--    con backend/routes/anexos.routes.js, ya escrito y en uso — solo se
--    corrige aquí el tipo real (TEXT) y el FK real (proyectos, no projects).
--    Se agregan descripcion/texto/link (nullable) para los campos narrativos
--    que la UI actual captura y que no tienen equivalente en un archivo real.
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_anexos (
  id             TEXT      PRIMARY KEY,
  project_id     TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  tenant_id      TEXT      NOT NULL,
  nombre_archivo TEXT      NOT NULL,
  ruta_storage   TEXT      NOT NULL,
  tipo_mime      TEXT      NOT NULL,
  tamano_bytes   BIGINT    NOT NULL DEFAULT 0,
  categoria      TEXT      CHECK (categoria IN ('legal','financiero','tecnico','institucional','otro')) DEFAULT 'otro',
  descripcion    TEXT,
  texto          TEXT,
  link           TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_anexos_project ON project_anexos (project_id);

-- =============================================================================
-- 3. project_indicators — Fase 2: indicadores MGA/BPIN estructurados.
--    Columna `project_id` (no proyecto_id) para calzar con la query ya
--    existente en backend/services/scoringDinamico.js:68 (WHERE project_id).
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_indicators (
  id                  TEXT      PRIMARY KEY,
  project_id          TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id              TEXT      NOT NULL,
  nombre              TEXT      NOT NULL,
  tipo                TEXT      CHECK (tipo IN ('Producto','Resultado','Impacto','Gestión')) NOT NULL,
  linea_base          NUMERIC   DEFAULT 0,
  meta_total          NUMERIC   NOT NULL,
  unidad_medida       TEXT      NOT NULL,
  fuente_verificacion TEXT,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_project_indicators_project ON project_indicators (project_id);

-- =============================================================================
-- 4. project_change_theory — Fase 2: Teoría de Cambio, 1 fila por proyecto.
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_change_theory (
  id                     TEXT      PRIMARY KEY,
  proyecto_id            TEXT      NOT NULL UNIQUE REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id                 TEXT      NOT NULL,
  insumos                TEXT      DEFAULT '[]',
  actividades            TEXT      DEFAULT '[]',
  productos              TEXT      DEFAULT '[]',
  resultados_corto_plazo TEXT      DEFAULT '[]',
  impacto_largo_plazo    TEXT,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 5. objetivos_arbol.supuestos — Fase 5: columna para la matriz de marco
--    lógico BID (columna "Supuestos/riesgos" por nodo). Aditiva, nullable,
--    no rompe ninguna fila existente.
-- =============================================================================
ALTER TABLE objetivos_arbol ADD COLUMN IF NOT EXISTS supuestos TEXT;

-- =============================================================================
-- 6. motor_dialectico — columnas nuevas para calzar con la UI REAL de
--    DialecticaPage.tsx (interlocutor/enfoque/humanizacion/adicionales), que
--    hoy no tienen dónde persistirse — la tabla solo modelaba tono/lista_oro/
--    lista_negra/enfasis. Aditivas, nullable, no rompen filas existentes.
--
--    `tono` ya existía con un CHECK constraint real en la BD (confirmado en
--    vivo: motor_dialectico_tono_check rechaza cualquier valor fuera de
--    formal/tecnico/comunitario/academico/normativo) que nunca coincidió con
--    los valores reales que produce la UI (Diplomatico/Institucional/
--    Tecnico/Inspirador/Ejecutivo) — CADA guardado desde DialecticaPage.tsx
--    habría fallado con 400. Se elimina el CHECK: el valor de tono ahora lo
--    valida solo la UI (ya es un <select> cerrado, no texto libre).
-- =============================================================================
ALTER TABLE motor_dialectico DROP CONSTRAINT IF EXISTS motor_dialectico_tono_check;
ALTER TABLE motor_dialectico ADD COLUMN IF NOT EXISTS interlocutor TEXT;
ALTER TABLE motor_dialectico ADD COLUMN IF NOT EXISTS enfoque      TEXT;
ALTER TABLE motor_dialectico ADD COLUMN IF NOT EXISTS humanizacion TEXT;
ALTER TABLE motor_dialectico ADD COLUMN IF NOT EXISTS adicionales  TEXT DEFAULT '[]';

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 016 ===';
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename IN ('logistica_tramos','project_anexos','project_indicators','project_change_theory')
    ORDER BY tablename
  LOOP
    RAISE NOTICE '[%] tabla creada OK', r.tablename;
  END LOOP;

  SELECT COUNT(*) INTO r FROM information_schema.columns
    WHERE table_name = 'objetivos_arbol' AND column_name = 'supuestos';
  RAISE NOTICE '[objetivos_arbol] columna supuestos instalada: %', (r.count = 1);

  SELECT COUNT(*) INTO r FROM information_schema.columns
    WHERE table_name = 'motor_dialectico' AND column_name IN ('interlocutor','enfoque','humanizacion','adicionales');
  RAISE NOTICE '[motor_dialectico] columnas nuevas instaladas (esperado 4): %', r.count;

  SELECT COUNT(*) INTO r FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'motor_dialectico' AND con.conname = 'motor_dialectico_tono_check';
  RAISE NOTICE '[motor_dialectico] CHECK de tono eliminado (esperado 0): %', r.count;
  RAISE NOTICE '=== FIN VERIFICACIÓN 016 ===';
END;
$$;
