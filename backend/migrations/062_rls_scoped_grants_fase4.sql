-- =============================================================================
-- 062_rls_scoped_grants_fase4.sql
--
-- Fase 4 de docs/ROADMAP_MIGRACION_TENANT_2026.md (2026-09-06) — pagos y
-- suscripciones: GRANT DML a rf360_rls_scoped sobre user_subscriptions, la
-- única tabla de subscriptions.routes.js/subscriptionEvents.js/stripeProvider.js
-- que aún no lo tenía.
--
-- HALLAZGO (verificado en vivo contra la BD real, mismo método que 059/060/061):
--   usuarios            -> ya tenía GRANT (política real: id = app.org_id,
--                          NO org_id como asumía 001_postgres_schema.sql --
--                          ese archivo quedó desactualizado por una migración
--                          posterior no vista hasta ahora).
--   proyectos           -> ya tenía GRANT (053_rls_scoped_role.sql).
--   user_subscriptions  -> RLS activo, política real (user_id = app.org_id),
--                          CERO grant a rf360_rls_scoped. <- esta migración.
--
-- EXCLUIDAS A PROPÓSITO: stripe_events / wompi_events. stripe_events SÍ tiene
-- una política RLS real (tenant_id = app.org_id, verificado en vivo) pero su
-- `tenant_id` es NULL para la mayoría de eventos de Stripe (solo
-- checkout.completed lo trae resuelto de entrada) -- son un ledger de
-- IDEMPOTENCIA GLOBAL (dedup por id de evento de la pasarela), no datos de
-- tenant. El chequeo de "¿ya procesé este evento?" debe poder ejecutarse
-- ANTES de saber a qué tenant pertenece, para cualquier tipo de evento.
-- Escoparlo habría bloqueado el INSERT bajo RLS (NULL no satisface
-- `tenant_id = ?`) o vuelto invisible el registro para chequeos futuros de
-- otros eventos. Se quedan en el pool principal -- mismo criterio que
-- catalogo_rendimientos/gemini_key_state/trial_sessions. wompi_events además
-- no existe todavía en esta BD (creación perezosa vía CREATE TABLE IF NOT
-- EXISTS en wompi.webhook.js, sin tráfico real de Wompi que la haya disparado
-- con éxito) -- no hay nada que otorgar hoy.
--
-- No se otorga GRANT de secuencias: user_subscriptions usa `id TEXT`
-- generado en JS (crypto.randomUUID()) o vía gen_random_uuid() en SQL,
-- column_default = NULL, sin SERIAL/IDENTITY -- verificado en vivo antes de
-- escribir esta migración.
--
-- Idempotente, transacción explícita, con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio -- GRANT DML a rf360_rls_scoped sobre user_subscriptions (Fase 4, pagos y suscripciones).'; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  user_subscriptions
TO rf360_rls_scoped;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] GRANT DML otorgado sobre user_subscriptions.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT (
    has_table_privilege('rf360_rls_scoped', 'user_subscriptions', 'SELECT') AND
    has_table_privilege('rf360_rls_scoped', 'user_subscriptions', 'INSERT') AND
    has_table_privilege('rf360_rls_scoped', 'user_subscriptions', 'UPDATE') AND
    has_table_privilege('rf360_rls_scoped', 'user_subscriptions', 'DELETE')
  ) THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: privilegios DML incompletos en user_subscriptions';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK -- GRANT DML completo y verificado en user_subscriptions.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Reporte final ─────────────────────────────────────────────────────────
SELECT
  t.tablename,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'SELECT') AS puede_select,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'INSERT') AS puede_insert,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'UPDATE') AS puede_update,
  has_table_privilege('rf360_rls_scoped', t.tablename, 'DELETE') AS puede_delete,
  c.relrowsecurity AS rls_activo,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = t.tablename) AS num_politicas
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename = 'user_subscriptions';
