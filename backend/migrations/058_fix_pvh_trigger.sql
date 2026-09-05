-- =============================================================================
-- 058_fix_pvh_trigger.sql
--
-- Prioridad Roja (2026-09-05) — corrige `trg_pvh_block_mutation()`, la función
-- detrás de los triggers `trg_pvh_no_delete`/`trg_pvh_no_update` sobre
-- `project_version_hashes` (ledger inmutable de versiones de proyecto).
--
-- HALLAZGO (verificado en vivo al intentar limpiar un fixture de prueba,
-- backend/migrations/056_rls_pvh_fix_policy.sql, 2026-09-05):
--   pg_get_functiondef('trg_pvh_block_mutation'::regproc) mostró:
--     RAISE EXCEPTION '...', OLD.proyecto_id, OLD.hash_value ...
--   `project_version_hashes` NO tiene columna `proyecto_id` (la real es
--   `project_id`, en inglés — confirmado por information_schema.columns).
--   Cualquier intento de DELETE/UPDATE sobre esta tabla (directo o por
--   cascada) lanza "record OLD has no field proyecto_id" en vez del mensaje
--   IMMUTABILITY_VIOLATION esperado. La protección en sí NO estaba
--   debilitada (la excepción de todos modos bloqueaba la mutación), pero el
--   efecto colateral real es grave: `project_version_hashes.project_id`
--   REFERENCES proyectos(id) ON DELETE CASCADE (migración 049) — el purge
--   de cuenta / Habeas Data (server.js, DELETE FROM proyectos WHERE
--   user_id=?) colapsa con este error para CUALQUIER usuario que tenga al
--   menos 1 fila en project_version_hashes (basta con haber usado
--   "Continuar formulación" una vez), dejando el purge a medias.
--
-- DECISIÓN DE NEGOCIO (confirmada explícitamente por el Director, 2026-09-05):
-- la regla de inmutabilidad se mantiene para el uso normal de la aplicación
-- (nadie puede editar/borrar un hash de versión individual) PERO el purge de
-- cuenta completo (Habeas Data) debe poder completarse limpio, incluyendo el
-- borrado en cascada de los hashes de ese usuario — el historial de un
-- proyecto que ya no existe no tiene sentido conservarlo indefinidamente
-- (a diferencia de tenant_audit_logs, que SÍ sobrevive a propósito porque es
-- rastro de auditoría de la plataforma, no dato del usuario).
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   1. Corrige OLD.proyecto_id -> OLD.project_id (el bug real).
--   2. Agrega una válvula de escape ESTRECHA: la sesión (transacción, vía
--      set_config con is_local=true) puede fijar `app.allow_pvh_purge =
--      'true'` para permitir un DELETE (nunca un UPDATE — la inmutabilidad
--      de "no puedes alterar un hash existente" se mantiene incondicional,
--      solo el borrado completo de la fila durante un purge está permitido).
--      Nadie más que el flujo de purga de cuenta (server.js, ver el companion
--      fix en ese archivo) fija esta variable — sin ella, el comportamiento
--      es exactamente el mismo bloqueo total de antes.
--
-- Idempotente (CREATE OR REPLACE, no toca los triggers en sí, ya existentes),
-- transacción explícita con checkpoints y verificación inline.
-- =============================================================================

BEGIN;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 0/2] Inicio — corrigiendo trg_pvh_block_mutation() (columna real + válvula de purge).'; END $$;

CREATE OR REPLACE FUNCTION public.trg_pvh_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Válvula de escape ESTRECHA: solo DELETE, solo si la transacción actual
  -- fijó explícitamente app.allow_pvh_purge='true' (server.js, purge de
  -- cuenta/Habeas Data). Un UPDATE nunca pasa por aquí — inmutabilidad de
  -- "no se altera un hash existente" sigue siendo absoluta.
  IF TG_OP = 'DELETE' AND current_setting('app.allow_pvh_purge', true) = 'true' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: project_version_hashes es append-only (project_id=%, hash=%)',
    OLD.project_id, OLD.hash_value
    USING ERRCODE = 'restrict_violation';
END;
$function$;

DO $$ BEGIN RAISE NOTICE '[CHECKPOINT 1/2] Función reemplazada — columna corregida a project_id, válvula de purge agregada.'; END $$;

-- ── Verificación inline ────────────────────────────────────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('trg_pvh_block_mutation'::regproc) INTO v_def;

  IF v_def LIKE '%OLD.proyecto_id%' THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: la función todavía referencia OLD.proyecto_id (columna inexistente).';
  END IF;
  IF v_def NOT LIKE '%OLD.project_id%' THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: la función no referencia OLD.project_id — algo salió mal en el reemplazo.';
  END IF;
  IF v_def NOT LIKE '%app.allow_pvh_purge%' THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: la válvula de purge no quedó presente en la función.';
  END IF;

  -- Los 2 triggers deben seguir existiendo y apuntando a esta función —
  -- CREATE OR REPLACE FUNCTION no debería haberlos tocado, se verifica igual.
  IF (SELECT COUNT(*) FROM pg_trigger WHERE tgrelid = 'project_version_hashes'::regclass
        AND tgfoid = 'trg_pvh_block_mutation'::regproc AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '[CHECKPOINT 2/2] FALLO: no quedaron exactamente 2 triggers (delete+update) apuntando a la función.';
  END IF;

  RAISE NOTICE '[CHECKPOINT 2/2] OK — función corregida, válvula de purge presente, 2 triggers intactos.';
END $$;

COMMIT;

-- ── Reporte final ─────────────────────────────────────────────────────────
SELECT tgname, pg_get_triggerdef(oid) AS def
FROM pg_trigger WHERE tgrelid = 'project_version_hashes'::regclass AND NOT tgisinternal;
