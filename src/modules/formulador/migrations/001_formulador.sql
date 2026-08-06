-- ============================================================
-- Formulador AI 7.1 — PostgreSQL Schema v2 (Multi-Tenant SaaS)
-- Motor: PostgreSQL ≥ 14  |  Extensiones: pgcrypto, pgvector
-- Ejecución: psql $DATABASE_URL -f 001_formulador.sql
-- Cambios v2: tenant_id (UUID NOT NULL) + RLS en todas las tablas
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- El identificador real de la extensión pgvector en Postgres es "vector", no "pgvector"
-- (ese es el nombre del proyecto). Corregido 2026-08-06 tras fallo real de despliegue
-- (CREATE EXTENSION pgvector -> "extension pgvector is not available"). Ninguna columna
-- de este esquema usa el tipo vector(N) todavía; se deja instalada para uso futuro.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Función helper: updated_at automático ───────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

-- ── Función RLS: establece contexto de tenant por sesión ────
-- Llamar al inicio de cada transacción: SELECT set_tenant_context($1)
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id, TRUE);
END;
$$;

-- ── Helper: retorna el tenant_id del contexto actual ────────
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN current_setting('app.tenant_id', TRUE)::UUID;
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$;

-- =============================================================
-- TABLA: formulador_proyectos  (cabecera, módulos 1-6)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_proyectos (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL,
  nombre               TEXT        NOT NULL,
  codigo               TEXT,
  -- Módulo 1
  enfoque              TEXT,
  regimen              TEXT,
  sector_codigo        TEXT,
  clasificacion_infra  TEXT,
  -- Módulo 2
  departamento         TEXT,
  municipio            TEXT,
  zona                 TEXT,
  -- Módulo 3
  diagnostico          TEXT,
  -- Módulo 4
  poblacion_total      INTEGER,
  -- Estado
  status               TEXT        NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft','in_review','published','archived')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE formulador_proyectos ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_proyectos_tenant_isolation ON formulador_proyectos
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_proyectos_tenant
  ON formulador_proyectos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_formulador_proyectos_sector
  ON formulador_proyectos (tenant_id, sector_codigo, clasificacion_infra);
CREATE INDEX IF NOT EXISTS idx_formulador_proyectos_geo
  ON formulador_proyectos (tenant_id, departamento, municipio);

DROP TRIGGER IF EXISTS trg_formulador_proyectos_updated ON formulador_proyectos;
CREATE TRIGGER trg_formulador_proyectos_updated
  BEFORE UPDATE ON formulador_proyectos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- TABLA: formulador_objetivos  (Módulo 7 — Objetivo General)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_objetivos (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL,
  proyecto_id         UUID        NOT NULL REFERENCES formulador_proyectos(id) ON DELETE CASCADE,
  objetivo_general    TEXT,
  og_indicador        TEXT,
  og_meta             TEXT,
  og_linea_base       TEXT,
  cadena_valor        JSONB       DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE formulador_objetivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_objetivos_tenant_isolation ON formulador_objetivos
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_objetivos_tenant
  ON formulador_objetivos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_formulador_objetivos_proyecto
  ON formulador_objetivos (tenant_id, proyecto_id);

-- =============================================================
-- TABLA: formulador_oe  (Módulo 7 — Objetivos Específicos)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_oe (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  objetivo_id     UUID        NOT NULL REFERENCES formulador_objetivos(id) ON DELETE CASCADE,
  proyecto_id     UUID        NOT NULL,
  oe_numero       SMALLINT    NOT NULL,
  descripcion     TEXT,
  indicador       TEXT,
  meta            TEXT,
  unidad          TEXT,
  linea_base      TEXT
);

ALTER TABLE formulador_oe ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_oe_tenant_isolation ON formulador_oe
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_oe_tenant   ON formulador_oe (tenant_id);
CREATE INDEX IF NOT EXISTS idx_formulador_oe_proyecto ON formulador_oe (tenant_id, proyecto_id);

-- =============================================================
-- TABLA: formulador_cronograma  (Módulo 8)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_cronograma (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  proyecto_id     UUID        NOT NULL REFERENCES formulador_proyectos(id) ON DELETE CASCADE,
  duracion_meses  SMALLINT,
  fecha_inicio    DATE,
  fecha_fin       DATE,
  fases           JSONB       DEFAULT '[]',
  hitos           JSONB       DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE formulador_cronograma ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_cronograma_tenant_isolation ON formulador_cronograma
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_cronograma_tenant
  ON formulador_cronograma (tenant_id, proyecto_id);

-- =============================================================
-- TABLA: formulador_presupuesto  (Módulo 9)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_presupuesto (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL,
  proyecto_id             UUID          NOT NULL REFERENCES formulador_proyectos(id) ON DELETE CASCADE,
  presupuesto_total       NUMERIC(18,2) DEFAULT 0,
  moneda                  CHAR(3)       DEFAULT 'COP',
  fuentes                 JSONB         DEFAULT '[]',
  contrapartida_monetaria NUMERIC(18,2) DEFAULT 0,
  contrapartida_especie   NUMERIC(18,2) DEFAULT 0,
  contrapartida_desc      TEXT,
  resumen                 JSONB         DEFAULT '{}',
  viabilidad_financiera   TEXT,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE formulador_presupuesto ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_presupuesto_tenant_isolation ON formulador_presupuesto
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_presupuesto_tenant
  ON formulador_presupuesto (tenant_id, proyecto_id);

-- =============================================================
-- TABLA: formulador_validaciones_financieras  (MGR/DNP/SGR)
-- =============================================================
CREATE TABLE IF NOT EXISTS formulador_validaciones_financieras (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID        NOT NULL,
  proyecto_id                   UUID        NOT NULL REFERENCES formulador_proyectos(id) ON DELETE CASCADE,
  estado                        TEXT        NOT NULL CHECK (estado IN ('ok','advertencia','pendiente')),
  porcentaje_contrapartida_real NUMERIC(6,2),
  porcentaje_minimo_requerido   NUMERIC(6,2),
  fuente_evaluada               TEXT,
  mensaje                       TEXT,
  evaluated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE formulador_validaciones_financieras ENABLE ROW LEVEL SECURITY;

CREATE POLICY formulador_validaciones_tenant_isolation ON formulador_validaciones_financieras
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_formulador_val_fin_tenant
  ON formulador_validaciones_financieras (tenant_id, proyecto_id, estado);

-- =============================================================
-- NOTA DE OPERACIÓN:
-- Antes de cualquier query en la app, establecer el contexto:
--   await pgPool.query("SELECT set_tenant_context($1)", [tenantId]);
-- El tenant_id debe provenir del JWT validado del usuario.
-- Ningún tenant puede leer ni escribir datos de otro tenant.
-- =============================================================
