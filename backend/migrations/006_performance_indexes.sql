-- =============================================================================
-- RadarFondos 360 — FASE 3: INDEXACIÓN DE ALTA VELOCIDAD
-- 006_performance_indexes.sql
-- Prepara la BD para tráfico masivo sin colapsar CPU.
--
-- ESTRATEGIA:
--   · B-Tree  → filtros exactos/rango: estado, sector, fecha, user_id
--   · GIN/trgm → búsqueda de texto libre LIKE/ILIKE: titulo, donante, descripcion
--   · GIN/jsonb → búsqueda en arrays JSON: sectores, paises_elegibles, requisitos
--   · CONCURRENTLY → no bloquea la tabla durante la creación (producción segura)
--
-- APLICAR CON:
--   psql $DATABASE_URL -f 006_performance_indexes.sql
--
-- NOTA: CREATE INDEX CONCURRENTLY no puede ejecutarse dentro de una transacción.
--       Aplicar fuera de BEGIN/COMMIT (este script no tiene bloque de transacción).
-- =============================================================================

-- ── Extensiones necesarias ────────────────────────────────────────────────────
-- pg_trgm: habilita GIN sobre LIKE/ILIKE sin cambiar las queries existentes
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- btree_gin: permite índices GIN en columnas simples (complemento)
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- =============================================================================
-- TABLA: convocatorias
-- =============================================================================

-- ── B-Tree: filtros exactos ───────────────────────────────────────────────────

-- estado ('nueva', 'abierta', 'cerrada') — el filtro más frecuente del Radar
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_estado
  ON convocatorias (estado)
  WHERE deleted_at IS NULL;

-- fecha_limite — ordenamiento y filtros de cierre próximo
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_fecha_limite
  ON convocatorias (fecha_limite)
  WHERE deleted_at IS NULL AND fecha_limite IS NOT NULL;

-- fecha_publicacion — ordenamiento cronológico inverso
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_fecha_publicacion
  ON convocatorias (fecha_publicacion DESC)
  WHERE deleted_at IS NULL;

-- created_at DESC — ORDER BY por defecto del endpoint GET /api/convocatorias
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_created_at_desc
  ON convocatorias (created_at DESC)
  WHERE deleted_at IS NULL;

-- org_id — aislamiento por tenant en convocatorias privadas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_org_id
  ON convocatorias (org_id)
  WHERE org_id IS NOT NULL;

-- ── GIN/trgm: búsqueda de texto libre (reemplaza LIKE costoso) ───────────────
-- Con pg_trgm, PostgreSQL usa estos índices para LIKE '%texto%' e ILIKE
-- sin modificar las queries existentes en server.js.

-- titulo — campo de búsqueda principal del usuario
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_titulo_trgm
  ON convocatorias USING GIN (titulo gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- donante — filtro de entidad financiadora
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_donante_trgm
  ON convocatorias USING GIN (donante gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- descripcion — búsqueda semántica por palabras clave
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_descripcion_trgm
  ON convocatorias USING GIN (descripcion gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── GIN/jsonb: búsqueda en arrays JSON ───────────────────────────────────────
-- sectores almacena un JSON array TEXT: ["Educación", "Salud"]
-- Permite queries: WHERE sectores::jsonb @> '["Educación"]'::jsonb
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_sectores_gin
  ON convocatorias USING GIN ((sectores::jsonb))
  WHERE deleted_at IS NULL AND sectores IS NOT NULL AND sectores != '[]';

-- paises_elegibles — filtro geográfico
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_paises_gin
  ON convocatorias USING GIN ((paises_elegibles::jsonb))
  WHERE deleted_at IS NULL AND paises_elegibles IS NOT NULL AND paises_elegibles != '[]';

-- ── GIN/FTS: Full-Text Search en español (para búsquedas futuras) ─────────────
-- Índice FTS sobre titulo + donante + descripcion concatenados.
-- Requiere migrar queries de LIKE a to_tsquery (tarea futura de optimización).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_fts_es
  ON convocatorias USING GIN (
    to_tsvector(
      'spanish',
      coalesce(titulo, '') || ' ' ||
      coalesce(donante, '') || ' ' ||
      coalesce(descripcion, '')
    )
  )
  WHERE deleted_at IS NULL;

-- =============================================================================
-- TABLA: user_favorites
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_favs_user_id
  ON user_favorites (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_favs_grant_id
  ON user_favorites (grant_id);

-- =============================================================================
-- TABLA: user_subscriptions
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_user_id
  ON user_subscriptions (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_tenant_id
  ON user_subscriptions (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_stripe_customer
  ON user_subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Índice parcial: solo suscriptores activos (optimiza RBAC en requireAccess)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_active_radar
  ON user_subscriptions (user_id, access_radar)
  WHERE access_radar = TRUE;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subs_active_formulador
  ON user_subscriptions (user_id, access_formulador)
  WHERE access_formulador = TRUE;

-- =============================================================================
-- TABLA: proyectos
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proy_user_id
  ON proyectos (user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proy_org_id
  ON proyectos (org_id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_proy_estado
  ON proyectos (estado)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- VERIFICACIÓN: muestra índices creados en tablas clave
-- =============================================================================
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('convocatorias', 'user_favorites', 'user_subscriptions', 'proyectos')
  AND schemaname = 'public'
ORDER BY tablename, indexname;
