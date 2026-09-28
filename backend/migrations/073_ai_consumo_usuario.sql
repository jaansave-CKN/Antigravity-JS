-- =============================================================================
-- 073_ai_consumo_usuario.sql
--
-- B1 (decisión del dueño 2026-09-28): se retira el gate BYOK y la IA del
-- Formulador pasa a OpenRouter (anthropic/claude-sonnet-5) pagado con la llave
-- del servidor. El tope de gasto POR USUARIO debe persistir en la BD — Render
-- reinicia la instancia y un contador en RAM se perdería (iaPresupuesto.js).
--
-- ai_consumo_usuario: una fila por llamada a OpenRouter. Se inserta
--   'reservado' (peor caso) ANTES de llamar y se pasa a 'liquidado' (costo
--   real) o 'liberado' (falló antes de generar). Las reservas huérfanas siguen
--   contando: el error siempre favorece al dinero.
-- ai_tope_usuario: tope propio de un usuario (NULL = usar LLM_TOPE_USD_DIA /
--   LLM_TOPE_USD_MES del entorno). Solo lo escribe un admin por psql.
--
-- org_id = id del usuario (un usuario = un tenant, server.js). Mismo patrón
-- de RLS que 070-072: tenant_isolation sobre app.org_id.
-- ai_consumo_usuario sin DELETE para el rol escopado (historial auditable).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_consumo_usuario (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               text NOT NULL,
  agente               text NOT NULL,
  proveedor            text NOT NULL CHECK (proveedor IN ('openrouter', 'gemini_servidor')),
  modelo               text,
  estado               text NOT NULL CHECK (estado IN ('reservado', 'liquidado', 'liberado')),
  costo_reservado_usd  numeric(12,6) NOT NULL CHECK (costo_reservado_usd >= 0),
  costo_real_usd       numeric(12,6) CHECK (costo_real_usd >= 0),
  tokens_in            integer,
  tokens_out           integer,
  created_at           timestamptz NOT NULL DEFAULT now(),
  liquidado_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_consumo_org_fecha ON ai_consumo_usuario (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_tope_usuario (
  org_id        text PRIMARY KEY,
  tope_usd_dia  numeric(12,4) CHECK (tope_usd_dia IS NULL OR tope_usd_dia >= 0),
  tope_usd_mes  numeric(12,4) CHECK (tope_usd_mes IS NULL OR tope_usd_mes >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

ALTER TABLE ai_consumo_usuario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_consumo_usuario;
CREATE POLICY tenant_isolation ON ai_consumo_usuario FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

ALTER TABLE ai_tope_usuario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_tope_usuario;
CREATE POLICY tenant_isolation ON ai_tope_usuario FOR ALL
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

REVOKE ALL ON ai_consumo_usuario FROM anon, authenticated;
REVOKE ALL ON ai_tope_usuario FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ai_consumo_usuario TO rf360_rls_scoped;
GRANT SELECT ON ai_tope_usuario TO rf360_rls_scoped;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_consumo_usuario'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_tope_usuario'::regclass) THEN
    RAISE EXCEPTION '073: RLS no quedó activo — transacción abortada';
  END IF;
  IF NOT has_table_privilege('rf360_rls_scoped', 'public.ai_consumo_usuario', 'UPDATE')
     OR has_table_privilege('rf360_rls_scoped', 'public.ai_consumo_usuario', 'DELETE')
     OR has_table_privilege('rf360_rls_scoped', 'public.ai_tope_usuario', 'INSERT')
     OR has_table_privilege('anon', 'public.ai_consumo_usuario', 'SELECT') THEN
    RAISE EXCEPTION '073: permisos inesperados — transacción abortada';
  END IF;
END $$;

COMMIT;
