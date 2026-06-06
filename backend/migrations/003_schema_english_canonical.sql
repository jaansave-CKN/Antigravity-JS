-- =============================================================================
-- RadarFondos 360 — Migration 003: English Canonical Schema
-- Zero Spanglish: all table and column names standardized to English
-- Requires: 001_postgres_schema.sql + 002_multitenant_saas.sql executed first
-- Strategy: RENAME tables → CREATE backward-compat VIEWS → ADD bilingual JSONB
-- =============================================================================

-- ── STEP 1: RENAME TABLES (Spanish → English) ─────────────────────────────

-- Core application tables
ALTER TABLE IF EXISTS usuarios            RENAME TO users;
ALTER TABLE IF EXISTS proyectos           RENAME TO projects;
ALTER TABLE IF EXISTS convocatorias       RENAME TO grants;
ALTER TABLE IF EXISTS objetivos_arbol     RENAME TO objective_tree;
ALTER TABLE IF EXISTS versiones_proyecto  RENAME TO project_versions;

-- Formulador module tables
ALTER TABLE IF EXISTS config_logistica    RENAME TO logistic_config;
ALTER TABLE IF EXISTS motor_dialectico    RENAME TO dialectic_engine;
ALTER TABLE IF EXISTS marco_normativo     RENAME TO regulatory_framework;
ALTER TABLE IF EXISTS catalogo_rendimientos RENAME TO performance_catalog;

-- Infrastructure tables
ALTER TABLE IF EXISTS directorio_entidades RENAME TO entity_directory;
ALTER TABLE IF EXISTS agentes_registro    RENAME TO agent_registry;
ALTER TABLE IF EXISTS predios             RENAME TO land_parcels;

-- ── STEP 2: RENAME COLUMNS (Spanish → English) ────────────────────────────

-- users (formerly: usuarios)
ALTER TABLE users RENAME COLUMN nombre         TO full_name;
ALTER TABLE users RENAME COLUMN "tipoUsuario"  TO user_type;
ALTER TABLE users RENAME COLUMN "createdAt"    TO created_at;

-- Add user_type default constraint
ALTER TABLE users ALTER COLUMN user_type SET DEFAULT 'User';
UPDATE users SET user_type = 'User' WHERE user_type = 'Usuario';

-- projects (formerly: proyectos)
ALTER TABLE projects RENAME COLUMN nombre       TO name;
ALTER TABLE projects RENAME COLUMN estado       TO status;

-- grants (formerly: convocatorias)
ALTER TABLE grants RENAME COLUMN titulo         TO title;
ALTER TABLE grants RENAME COLUMN donante        TO donor;
ALTER TABLE grants RENAME COLUMN descripcion    TO description;
ALTER TABLE grants RENAME COLUMN fecha_limite   TO deadline_date;
ALTER TABLE grants RENAME COLUMN fecha_publicacion TO published_at;
ALTER TABLE grants RENAME COLUMN estado         TO status;
ALTER TABLE grants RENAME COLUMN paises_elegibles TO eligible_countries;
ALTER TABLE grants RENAME COLUMN sectores       TO sectors;
ALTER TABLE grants RENAME COLUMN url_convocatoria TO grant_url;
ALTER TABLE grants RENAME COLUMN url_fuente     TO source_url;
ALTER TABLE grants RENAME COLUMN score_probabilidad TO probability_score;
ALTER TABLE grants RENAME COLUMN monto_min      TO amount_min;
ALTER TABLE grants RENAME COLUMN monto_max      TO amount_max;
ALTER TABLE grants RENAME COLUMN moneda         TO currency;
ALTER TABLE grants RENAME COLUMN requisitos     TO requirements;
ALTER TABLE grants RENAME COLUMN fuente         TO source;

-- objective_tree (formerly: objetivos_arbol)
ALTER TABLE objective_tree RENAME COLUMN texto          TO content;
ALTER TABLE objective_tree RENAME COLUMN generado_por_ia TO ai_generated;
ALTER TABLE objective_tree RENAME COLUMN confirmado     TO confirmed;
ALTER TABLE objective_tree RENAME COLUMN created_at     TO created_at; -- no-op, already correct

-- project_versions (formerly: versiones_proyecto)
ALTER TABLE project_versions RENAME COLUMN version_num      TO version_number;
ALTER TABLE project_versions RENAME COLUMN hash_sha256      TO sha256_hash;
ALTER TABLE project_versions RENAME COLUMN contenido_resumido TO content_summary;
ALTER TABLE project_versions RENAME COLUMN firmado_en        TO signed_at;

-- logistic_config (formerly: config_logistica)
ALTER TABLE logistic_config RENAME COLUMN proponente_nombre TO applicant_name;
ALTER TABLE logistic_config RENAME COLUMN proponente_nit    TO applicant_tax_id;
ALTER TABLE logistic_config RENAME COLUMN tipo_entidad      TO entity_type;
ALTER TABLE logistic_config RENAME COLUMN departamento      TO department;
ALTER TABLE logistic_config RENAME COLUMN municipio         TO municipality;
ALTER TABLE logistic_config RENAME COLUMN zona              TO zone;
ALTER TABLE logistic_config RENAME COLUMN fecha_inicio      TO start_date;
ALTER TABLE logistic_config RENAME COLUMN duracion_meses    TO duration_months;
ALTER TABLE logistic_config RENAME COLUMN equipo_director   TO director_team;
ALTER TABLE logistic_config RENAME COLUMN equipo_coordinador TO coordinator_team;

-- dialectic_engine (formerly: motor_dialectico)
ALTER TABLE dialectic_engine RENAME COLUMN tono         TO tone;
ALTER TABLE dialectic_engine RENAME COLUMN lista_oro    TO gold_list;
ALTER TABLE dialectic_engine RENAME COLUMN lista_negra  TO blacklist;
ALTER TABLE dialectic_engine RENAME COLUMN enfasis      TO emphasis;

-- regulatory_framework (formerly: marco_normativo)
ALTER TABLE regulatory_framework RENAME COLUMN sector           TO sector;
ALTER TABLE regulatory_framework RENAME COLUMN municipio        TO municipality;
ALTER TABLE regulatory_framework RENAME COLUMN normas_aplicables    TO applicable_norms;
ALTER TABLE regulatory_framework RENAME COLUMN citas_bibliograficas TO bibliographic_citations;
ALTER TABLE regulatory_framework RENAME COLUMN notas_adicionales    TO additional_notes;

-- performance_catalog (formerly: catalogo_rendimientos)
ALTER TABLE performance_catalog RENAME COLUMN clave       TO key;
ALTER TABLE performance_catalog RENAME COLUMN descripcion TO description;
ALTER TABLE performance_catalog RENAME COLUMN fase        TO phase;
ALTER TABLE performance_catalog RENAME COLUMN unidad      TO unit;
ALTER TABLE performance_catalog RENAME COLUMN valor       TO value;
ALTER TABLE performance_catalog RENAME COLUMN fuente      TO source;
ALTER TABLE performance_catalog RENAME COLUMN activo      TO active;

-- entity_directory (formerly: directorio_entidades)
ALTER TABLE entity_directory RENAME COLUMN nombre           TO name;
ALTER TABLE entity_directory RENAME COLUMN sigla            TO acronym;
ALTER TABLE entity_directory RENAME COLUMN tipo             TO type;
ALTER TABLE entity_directory RENAME COLUMN pais             TO country;
ALTER TABLE entity_directory RENAME COLUMN sitio_web        TO website;
ALTER TABLE entity_directory RENAME COLUMN url_convocatorias TO grants_url;
ALTER TABLE entity_directory RENAME COLUMN telefono         TO phone;
ALTER TABLE entity_directory RENAME COLUMN alcance          TO scope;
ALTER TABLE entity_directory RENAME COLUMN validation_status TO validation_status; -- already English
ALTER TABLE entity_directory RENAME COLUMN fuente           TO source;

-- agent_registry (formerly: agentes_registro)
ALTER TABLE agent_registry RENAME COLUMN nombre       TO name;
ALTER TABLE agent_registry RENAME COLUMN modulo       TO module;
ALTER TABLE agent_registry RENAME COLUMN configuracion TO configuration;
ALTER TABLE agent_registry RENAME COLUMN creado_en    TO created_at;
ALTER TABLE agent_registry RENAME COLUMN actualizado_en TO updated_at;

-- project_budgets (column renames — table name already English)
ALTER TABLE project_budgets RENAME COLUMN fase        TO phase;
ALTER TABLE project_budgets RENAME COLUMN capitulo    TO chapter;
ALTER TABLE project_budgets RENAME COLUMN item        TO item_name;
ALTER TABLE project_budgets RENAME COLUMN unidad      TO unit;
ALTER TABLE project_budgets RENAME COLUMN cantidad    TO quantity;
ALTER TABLE project_budgets RENAME COLUMN costo_jornal_dia    TO daily_labor_cost;
ALTER TABLE project_budgets RENAME COLUMN materiales          TO materials;
ALTER TABLE project_budgets RENAME COLUMN equipos             TO equipment;
ALTER TABLE project_budgets RENAME COLUMN costo_mano_obra     TO labor_cost;
ALTER TABLE project_budgets RENAME COLUMN costo_materiales    TO materials_cost;
ALTER TABLE project_budgets RENAME COLUMN costo_equipos       TO equipment_cost;
ALTER TABLE project_budgets RENAME COLUMN costo_directo       TO direct_cost;
ALTER TABLE project_budgets RENAME COLUMN valor_total         TO total_value;

-- user_subscriptions — Stripe columns (already English, add stripe alias columns)
ALTER TABLE user_subscriptions RENAME COLUMN trial_expires_at TO trial_expires_at; -- no-op

-- ── STEP 3: ADD BILINGUAL JSONB FIELDS TO projects ────────────────────────
-- payload_es: Spanish formulation tree (objectives, schedule, budget, norms)
-- payload_en: English translation (for international funding applications)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS payload_es JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payload_en JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_projects_payload_es
  ON projects USING gin(payload_es);
CREATE INDEX IF NOT EXISTS idx_projects_payload_en
  ON projects USING gin(payload_en);

-- ── STEP 4: UPDATE RLS POLICIES on renamed tables ─────────────────────────

-- users
DROP POLICY IF EXISTS usuarios_rls ON users;
DROP POLICY IF EXISTS usuarios_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- projects
DROP POLICY IF EXISTS proyectos_rls ON projects;
DROP POLICY IF EXISTS proyectos_tenant_isolation ON projects;
CREATE POLICY projects_tenant_isolation ON projects
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- grants (public grants visible to all tenants)
DROP POLICY IF EXISTS convocatorias_rls ON grants;
DROP POLICY IF EXISTS convocatorias_tenant_isolation ON grants;
CREATE POLICY grants_tenant_isolation ON grants
  AS PERMISSIVE FOR ALL
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- objective_tree
DROP POLICY IF EXISTS arbol_rls ON objective_tree;
DROP POLICY IF EXISTS arbol_tenant_isolation ON objective_tree;
CREATE POLICY objective_tree_tenant_isolation ON objective_tree
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- project_versions
DROP POLICY IF EXISTS versiones_proyecto_tenant_isolation ON project_versions;
CREATE POLICY project_versions_tenant_isolation ON project_versions
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- logistic_config
DROP POLICY IF EXISTS config_logistica_tenant_isolation ON logistic_config;
CREATE POLICY logistic_config_tenant_isolation ON logistic_config
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- dialectic_engine
DROP POLICY IF EXISTS motor_dialectico_tenant_isolation ON dialectic_engine;
CREATE POLICY dialectic_engine_tenant_isolation ON dialectic_engine
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- regulatory_framework
DROP POLICY IF EXISTS marco_normativo_tenant_isolation ON regulatory_framework;
CREATE POLICY regulatory_framework_tenant_isolation ON regulatory_framework
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- compliance_data (already English name, update policy name only)
DROP POLICY IF EXISTS compliance_data_tenant_isolation ON compliance_data;
CREATE POLICY compliance_data_tenant_isolation ON compliance_data
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_tenant_id());

-- ── STEP 5: BACKWARD-COMPAT VIEWS (legacy SQL in server.js/routes keep working) ──
-- These views map old Spanish table names → new English tables + column aliases
-- Remove these views once server.js queries are migrated to English names.

CREATE OR REPLACE VIEW usuarios AS
  SELECT
    id, tenant_id, email, full_name AS nombre,
    password_hash, user_type AS "tipoUsuario",
    plan, is_approved, is_active, org_id,
    created_at AS "createdAt", deleted_at
  FROM users;

CREATE OR REPLACE VIEW proyectos AS
  SELECT
    id, tenant_id, user_id, org_id,
    name AS nombre, status AS estado,
    bloqueo_razon, ficha_tecnica, presupuesto,
    crosscheck_sello, embedding, embedding_vec,
    payload_es, payload_en,
    created_at, updated_at
  FROM projects;

CREATE OR REPLACE VIEW convocatorias AS
  SELECT
    id, tenant_id, externo_id,
    title AS titulo, donor AS donante, source AS fuente,
    description AS descripcion,
    amount_min AS monto_min, amount_max AS monto_max,
    currency AS moneda,
    eligible_countries AS paises_elegibles,
    sectors AS sectores,
    grant_url AS url_convocatoria, source_url AS url_fuente,
    deadline_date AS fecha_limite, published_at AS fecha_publicacion,
    requirements AS requisitos, status AS estado,
    probability_score AS score_probabilidad,
    embedding, embedding_vec, org_id,
    created_at, deleted_at
  FROM grants;

CREATE OR REPLACE VIEW objetivos_arbol AS
  SELECT
    id, tenant_id, proyecto_id, tipo, nivel,
    content AS texto, parent_id,
    ai_generated AS generado_por_ia,
    confirmed AS confirmado, created_at
  FROM objective_tree;

CREATE OR REPLACE VIEW versiones_proyecto AS
  SELECT
    id, tenant_id, proyecto_id, user_id,
    version_number AS version_num,
    sha256_hash AS hash_sha256,
    content_summary AS contenido_resumido,
    signed_at AS firmado_en
  FROM project_versions;

CREATE OR REPLACE VIEW config_logistica AS
  SELECT
    id, tenant_id, proyecto_id, user_id,
    applicant_name AS proponente_nombre,
    applicant_tax_id AS proponente_nit,
    entity_type AS tipo_entidad,
    department AS departamento, municipality AS municipio,
    zone AS zona, start_date AS fecha_inicio,
    duration_months AS duracion_meses,
    director_team AS equipo_director,
    coordinator_team AS equipo_coordinador,
    created_at, updated_at
  FROM logistic_config;

CREATE OR REPLACE VIEW motor_dialectico AS
  SELECT
    id, tenant_id, proyecto_id, user_id,
    tone AS tono, gold_list AS lista_oro,
    blacklist AS lista_negra, emphasis AS enfasis,
    created_at, updated_at
  FROM dialectic_engine;

CREATE OR REPLACE VIEW marco_normativo AS
  SELECT
    id, tenant_id, proyecto_id, user_id,
    sector, municipality AS municipio,
    applicable_norms AS normas_aplicables,
    bibliographic_citations AS citas_bibliograficas,
    additional_notes AS notas_adicionales,
    created_at, updated_at
  FROM regulatory_framework;

CREATE OR REPLACE VIEW catalogo_rendimientos AS
  SELECT
    id, key AS clave, description AS descripcion,
    phase AS fase, unit AS unidad,
    value AS valor, source AS fuente, active AS activo
  FROM performance_catalog;

CREATE OR REPLACE VIEW directorio_entidades AS
  SELECT
    id, name AS nombre, acronym AS sigla, type AS tipo,
    country AS pais, website AS sitio_web,
    grants_url AS url_convocatorias, phone AS telefono,
    email, scope AS alcance, validation_status,
    source AS fuente, created_at, updated_at, deleted_at
  FROM entity_directory;

CREATE OR REPLACE VIEW agentes_registro AS
  SELECT
    id, name AS nombre, version, module AS modulo,
    status, configuration AS configuracion,
    created_at AS creado_en, updated_at AS actualizado_en
  FROM agent_registry;

-- ── STEP 6: UPDATED tenant_summary VIEW ───────────────────────────────────
CREATE OR REPLACE VIEW tenant_summary AS
SELECT
  o.tenant_id,
  o.name                AS org_name,
  o.plan,
  o.plan_expires_at,
  o.seats_limit,
  o.stripe_customer_id,
  COUNT(DISTINCT u.id)  AS total_users,
  COUNT(DISTINCT p.id)  AS total_projects,
  o.created_at
FROM organizations o
LEFT JOIN users u       ON u.tenant_id = o.tenant_id
LEFT JOIN projects p    ON p.tenant_id = o.tenant_id
GROUP BY o.tenant_id, o.name, o.plan, o.plan_expires_at,
         o.seats_limit, o.stripe_customer_id, o.created_at;

-- =============================================================================
-- CANONICAL TABLE MAP (English names — use these in all new code)
-- =============================================================================
-- users                 (was: usuarios)
-- projects              (was: proyectos)         → +payload_es, +payload_en
-- grants                (was: convocatorias)
-- project_budgets       (unchanged)
-- match_scores          (unchanged)
-- user_favorites        (unchanged)
-- user_subscriptions    (unchanged)
-- organizations         (unchanged)
-- objective_tree        (was: objetivos_arbol)
-- project_versions      (was: versiones_proyecto)
-- logistic_config       (was: config_logistica)
-- dialectic_engine      (was: motor_dialectico)
-- regulatory_framework  (was: marco_normativo)
-- compliance_data       (unchanged)
-- performance_catalog   (was: catalogo_rendimientos)
-- entity_directory      (was: directorio_entidades)
-- agent_registry        (was: agentes_registro)
-- land_parcels          (was: predios)
-- crawl_log             (unchanged)
-- system_config         (unchanged)
-- system_logs           (unchanged)
-- =============================================================================
