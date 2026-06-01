-- =============================================================================
-- RadarFondos 360 — Migración a PostgreSQL
-- 001_postgres_schema.sql
-- Aplica: pgvector, RLS, org_id en todas las tablas, índices vectoriales
-- Motor de embeddings: Google Gemini text-embedding-004 → 768 dims
-- =============================================================================

-- ── Extensiones ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector (cosine similarity, IVFFlat)

-- ── Función helper: actualiza updated_at automáticamente ─────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- =============================================================================
-- TABLA: usuarios
-- =============================================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  nombre        TEXT        NOT NULL,
  "tipoUsuario" TEXT        NOT NULL DEFAULT 'Usuario',
  plan          TEXT        DEFAULT 'free',
  org_id        UUID        NOT NULL DEFAULT gen_random_uuid(),
  is_approved   SMALLINT    DEFAULT 1,
  is_active     SMALLINT    DEFAULT 1,
  "createdAt"   TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ DEFAULT NULL
);

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY usuarios_rls ON usuarios
  USING (org_id::TEXT = current_setting('app.org_id', TRUE));

CREATE INDEX IF NOT EXISTS idx_usuarios_email  ON usuarios (email);
CREATE INDEX IF NOT EXISTS idx_usuarios_org_id ON usuarios (org_id);

-- =============================================================================
-- TABLA: proyectos  (incluye vector de embedding para M7)
-- =============================================================================
CREATE TABLE IF NOT EXISTS proyectos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES usuarios(id),
  org_id           UUID        NOT NULL,
  nombre           TEXT        NOT NULL DEFAULT 'Sin nombre',
  estado           TEXT        NOT NULL DEFAULT 'Borrador'
                               CHECK (estado IN ('Borrador','En_Validacion','Finalizado','BLOQUEADO')),
  bloqueo_razon    TEXT,
  ficha_tecnica    JSONB       NOT NULL DEFAULT '{}',
  presupuesto      JSONB       NOT NULL DEFAULT '{}',
  crosscheck_sello JSONB,
  -- Embedding de la Ficha Técnica (Gemini text-embedding-004 = 768 dims)
  -- Cambiar a vector(1536) si se migra a OpenAI text-embedding-ada-002
  embedding        vector(768),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY proyectos_rls ON proyectos
  USING (org_id::TEXT = current_setting('app.org_id', TRUE));

-- IVFFlat index para búsqueda por similitud coseno (M7)
-- lists = sqrt(n_rows); ajustar en producción según volumen
CREATE INDEX IF NOT EXISTS idx_proyectos_embedding
  ON proyectos USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_proyectos_org_id ON proyectos (org_id);
CREATE INDEX IF NOT EXISTS idx_proyectos_estado  ON proyectos (estado);

CREATE TRIGGER trg_proyectos_updated_at
  BEFORE UPDATE ON proyectos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLA: project_budgets  (Módulo 4 — APU)
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_budgets (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id            UUID          NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id                 UUID          NOT NULL,
  fase                   TEXT          NOT NULL CHECK (fase IN ('NEGRA','GRIS','BLANCA')),
  capitulo               TEXT          NOT NULL,
  item                   TEXT          NOT NULL,
  unidad                 TEXT          NOT NULL DEFAULT 'm²',
  cantidad               NUMERIC(14,4) NOT NULL DEFAULT 0,
  -- Rendimiento en unidades/día-hombre (fuente: SENA / CAMACOL Colombia)
  rendimiento_std        TEXT          NOT NULL,   -- clave del catálogo de rendimientos
  rendimiento_real       NUMERIC(10,4) NOT NULL,   -- valor ingresado por formulador
  rendimiento_ref        NUMERIC(10,4) NOT NULL,   -- valor del catálogo (referencia)
  desviacion_pct         NUMERIC(8,4)  GENERATED ALWAYS AS (
    CASE WHEN rendimiento_ref > 0
         THEN ROUND(((rendimiento_real - rendimiento_ref) / rendimiento_ref) * 100, 4)
         ELSE 0 END
  ) STORED,
  alerta_rendimiento     BOOLEAN       GENERATED ALWAYS AS (
    ABS((rendimiento_real - rendimiento_ref) / NULLIF(rendimiento_ref, 0)) > 0.30
  ) STORED,
  costo_jornal_dia       NUMERIC(14,2) NOT NULL DEFAULT 0,  -- COP/día-hombre
  materiales             JSONB         NOT NULL DEFAULT '[]',
  equipos                JSONB         NOT NULL DEFAULT '[]',
  -- Costos calculados y persistidos en escritura (ver apuEngine.js)
  costo_mano_obra        NUMERIC(14,2) NOT NULL DEFAULT 0,
  costo_materiales       NUMERIC(14,2) NOT NULL DEFAULT 0,
  costo_equipos          NUMERIC(14,2) NOT NULL DEFAULT 0,
  costo_directo          NUMERIC(14,2) NOT NULL DEFAULT 0,
  aiu                    NUMERIC(5,4)  NOT NULL DEFAULT 0.28,
  valor_total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ   DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY budgets_rls ON project_budgets
  USING (org_id::TEXT = current_setting('app.org_id', TRUE));

CREATE INDEX IF NOT EXISTS idx_budgets_proyecto ON project_budgets (proyecto_id);
CREATE INDEX IF NOT EXISTS idx_budgets_fase     ON project_budgets (fase);
CREATE INDEX IF NOT EXISTS idx_budgets_alerta   ON project_budgets (alerta_rendimiento) WHERE alerta_rendimiento = TRUE;

CREATE TRIGGER trg_budgets_updated_at
  BEFORE UPDATE ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TABLA: convocatorias  (añade embedding para M7)
-- =============================================================================
ALTER TABLE convocatorias
  ADD COLUMN IF NOT EXISTS org_id    UUID,
  ADD COLUMN IF NOT EXISTS embedding vector(768);

ALTER TABLE convocatorias ENABLE ROW LEVEL SECURITY;

-- Las convocatorias públicas son visibles a todos (org_id IS NULL)
-- Las privadas solo al tenant propietario
CREATE POLICY convocatorias_rls ON convocatorias
  USING (org_id IS NULL OR org_id::TEXT = current_setting('app.org_id', TRUE));

CREATE INDEX IF NOT EXISTS idx_conv_embedding
  ON convocatorias USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- =============================================================================
-- TABLA: match_scores  (resultados del pipeline M7)
-- =============================================================================
CREATE TABLE IF NOT EXISTS match_scores (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id      UUID          NOT NULL,
  convocatoria_id  UUID          NOT NULL,
  org_id           UUID          NOT NULL,
  score            NUMERIC(6,4)  NOT NULL CHECK (score BETWEEN 0 AND 1),
  cosine_sim       NUMERIC(6,4),
  p_norm           NUMERIC(6,4),
  c_risk           NUMERIC(6,4),
  breakdown        JSONB         NOT NULL DEFAULT '{}',
  pipeline_version TEXT          NOT NULL DEFAULT 'v2-vector',
  calculado_en     TIMESTAMPTZ   DEFAULT NOW(),
  UNIQUE (proyecto_id, convocatoria_id)
);

ALTER TABLE match_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_scores_rls ON match_scores
  USING (org_id::TEXT = current_setting('app.org_id', TRUE));

CREATE INDEX IF NOT EXISTS idx_match_proyecto ON match_scores (proyecto_id, score DESC);

-- =============================================================================
-- OTRAS TABLAS (migrar de TEXT → UUID y añadir org_id)
-- =============================================================================

-- user_favorites
ALTER TABLE user_favorites
  ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY favorites_rls ON user_favorites
  USING (org_id::TEXT = current_setting('app.org_id', TRUE));

-- objetivos_arbol
ALTER TABLE objetivos_arbol
  ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE objetivos_arbol ENABLE ROW LEVEL SECURITY;
CREATE POLICY arbol_rls ON objetivos_arbol
  USING (org_id::TEXT = current_setting('app.org_id', TRUE));

-- =============================================================================
-- FUNCIÓN RLS: set_rls_context(org_id)
-- Llamar al inicio de cada sesión de BD: SELECT set_rls_context($1)
-- =============================================================================
CREATE OR REPLACE FUNCTION set_rls_context(p_org_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.org_id', p_org_id, TRUE);
END;
$$;

-- =============================================================================
-- CATÁLOGO DE RENDIMIENTOS  (fuente: SENA / CAMACOL Colombia 2024)
-- No modificar valores sin actualizar referencia normativa
-- =============================================================================
CREATE TABLE IF NOT EXISTS catalogo_rendimientos (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clave       TEXT          UNIQUE NOT NULL,
  descripcion TEXT          NOT NULL,
  fase        TEXT          NOT NULL CHECK (fase IN ('NEGRA','GRIS','BLANCA')),
  unidad      TEXT          NOT NULL,
  valor       NUMERIC(10,4) NOT NULL,   -- unidades/día-hombre
  fuente      TEXT          NOT NULL DEFAULT 'SENA-2024',
  activo      BOOLEAN       DEFAULT TRUE
);

INSERT INTO catalogo_rendimientos (clave, descripcion, fase, unidad, valor) VALUES
  -- Fase Negra
  ('descapote',             'Descapote y limpieza del terreno',              'NEGRA', 'm²',  250.00),
  ('excavacion_manual',     'Excavación manual en material común',           'NEGRA', 'm³',    2.00),
  ('excavacion_mecanica',   'Excavación mecánica en material común',         'NEGRA', 'm³',   50.00),
  ('relleno_compactado',    'Relleno y compactación manual',                 'NEGRA', 'm³',    4.00),
  ('concreto_cimentacion',  'Vaciado concreto de cimentación f´c=210 kg/cm²','NEGRA','m³',   1.50),
  ('mamposteria_cimientos',  'Mampostería de cimientos en bloque',           'NEGRA', 'm²',    6.00),
  ('encofrado_cimientos',    'Encofrado y desencofrado en cimentación',      'NEGRA', 'm²',    8.00),
  -- Fase Gris
  ('concreto_columnas',     'Vaciado concreto en columnas f´c=210 kg/cm²',  'GRIS',  'm³',    1.20),
  ('concreto_vigas',        'Vaciado concreto en vigas f´c=210 kg/cm²',     'GRIS',  'm³',    1.50),
  ('placa_entrepiso',       'Placa de entrepiso en concreto',               'GRIS',  'm²',    5.00),
  ('mamposteria_bloque',    'Mampostería en bloque de arcilla 0.15',        'GRIS',  'm²',    8.00),
  ('pañete_rustico',        'Pañete rústico en muros interiores',           'GRIS',  'm²',   10.00),
  ('pañete_liso',           'Pañete liso fino en muros',                    'GRIS',  'm²',    8.00),
  ('instalacion_hidro',     'Instalaciones hidrosanitarias (punto)',        'GRIS',  'pto',   1.50),
  ('instalacion_electrica', 'Instalaciones eléctricas (punto)',             'GRIS',  'pto',   2.00),
  -- Fase Blanca
  ('enchape_piso',          'Enchape cerámica en pisos',                    'BLANCA','m²',    5.00),
  ('enchape_muro',          'Enchape cerámica en muros',                    'BLANCA','m²',    4.00),
  ('pintura_interior',      'Pintura vinilo interior (2 manos)',            'BLANCA','m²',   20.00),
  ('pintura_exterior',      'Pintura exterior impermeabilizante',           'BLANCA','m²',   15.00),
  ('cielo_raso_drywall',    'Cielo raso en drywall',                        'BLANCA','m²',    8.00),
  ('piso_vinilo',           'Instalación piso vinilo',                      'BLANCA','m²',   12.00),
  ('piso_madera',           'Instalación piso madera flotante',             'BLANCA','m²',    6.00),
  ('carpinteria_madera',    'Carpintería en madera (puertas/ventanas)',     'BLANCA','m²',    3.00),
  ('aparatos_sanitarios',   'Instalación aparatos sanitarios',              'BLANCA','und',   3.00)
ON CONFLICT (clave) DO NOTHING;

-- =============================================================================
-- COMENTARIO FINAL
-- Para activar RLS en cada query de la app:
--   await pgPool.query("SELECT set_rls_context($1)", [orgId]);
-- =============================================================================
