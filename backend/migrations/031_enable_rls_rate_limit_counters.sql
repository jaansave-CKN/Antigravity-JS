-- 031_enable_rls_rate_limit_counters.sql
-- rate_limit_counters es tabla interna del backend (rate limiting), sin columna
-- de tenant/usuario -- ningún cliente externo debe leerla/escribirla vía API
-- pública. El backend accede vía service_role (bypasea RLS), así que activar
-- RLS sin políticas permisivas cierra el acceso público sin afectar al backend.
-- Aplicada en vivo a Supabase el 2026-08-03 (mcp__supabase__apply_migration);
-- este archivo la deja versionada en el repo.

ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;
