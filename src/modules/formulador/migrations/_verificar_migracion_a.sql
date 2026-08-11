-- ============================================================
-- _verificar_migracion_a.sql — verificación quirúrgica, un solo disparo
--
-- Por qué existe: 2 intentos de aplicar 007+008 vía SQL Editor reportaron
-- "Success" pero el barrido por PostgREST (SUPABASE_URL en .env, proyecto
-- ozivmsvxbdtjkzleqbcy) sigue viendo el estado de ANTES de la migración,
-- byte por byte igual en ambos intentos. Este script elimina toda ambigüedad
-- corriendo la verificación DENTRO del mismo SQL Editor donde se aplicó el
-- DDL — si esto dice "FALTA", el problema es que el DDL no llegó a esta
-- base (proyecto equivocado, o se cortó a mitad de camino otra vez). Si esto
-- dice "OK" pero PostgREST sigue en 404, el problema es caché de esquema sin
-- refrescar — este mismo script lo fuerza al final.
--
-- USO: pegar y correr ESTE ARCHIVO COMPLETO en el SQL Editor de Supabase,
-- proyecto ozivmsvxbdtjkzleqbcy — DESPUÉS de haber corrido 007 y 008
-- completos. La salida de la última consulta es el veredicto, léela ahí
-- mismo, no hace falta reportarla de vuelta salvo que diga FALTA.
-- ============================================================

-- 1. Estado real de las 2 tablas nuevas — ANTES de forzar nada.
SELECT
  'project_version_hashes'    AS objeto,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='project_version_hashes')
       THEN 'OK' ELSE 'FALTA' END AS estado
UNION ALL
SELECT
  'security_violations_ledger',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema='public' AND table_name='security_violations_ledger')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
-- 2. Estado real de las 3 funciones RPC nuevas/modificadas.
SELECT
  'obtener_ultimo_hash',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='obtener_ultimo_hash')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
SELECT
  'registrar_version_hash',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='registrar_version_hash')
       THEN 'OK' ELSE 'FALTA' END
UNION ALL
-- 3. guardar_modulo10 debe tener AHORA 5 parámetros (p_expected_hash,
--    p_new_hash incluidos) — si sigue en 3, es la firma vieja sin reemplazar.
SELECT
  'guardar_modulo10 (5 parámetros)',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname='guardar_modulo10' AND pronargs = 5
  ) THEN 'OK' ELSE 'FALTA (revisa pronargs abajo)' END
UNION ALL
-- 4. Triggers WORM — sin esto, las tablas de arriba no son append-only de verdad.
SELECT
  'triggers WORM (4 esperados)',
  CASE WHEN (SELECT COUNT(*) FROM pg_trigger
             WHERE tgname IN ('trg_pvh_no_update','trg_pvh_no_delete','trg_svl_no_update','trg_svl_no_delete'))
       = 4 THEN 'OK' ELSE 'FALTA (revisa conteo abajo)' END;

-- Detalle de apoyo si algo de arriba dice FALTA:
SELECT proname, pronargs FROM pg_proc WHERE proname = 'guardar_modulo10';
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_pvh_%' OR tgname LIKE 'trg_svl_%';

-- 5. Fuerza el refresco del caché de esquema de PostgREST — inofensivo
--    correrlo aunque ya estuviera al día.
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- LECTURA DEL RESULTADO:
--   Los 5 "OK" arriba  -> el DDL SÍ está en esta base. Si después de esto
--                         PostgREST (yo, desde afuera) sigue devolviendo 404,
--                         era 100% caché — dile a Claude que repita el barrido.
--   Cualquier "FALTA"  -> el DDL NO llegó a esta base todavía, sin importar
--                         qué haya dicho el editor. Vuelve a pegar 007 y 008
--                         COMPLETOS (Ctrl+A antes de copiar, no selección
--                         parcial) y corre este verificador de nuevo.
-- ============================================================

-- ============================================================
-- NOTA TÉCNICA — por qué "guardar_modulo10 (5 parámetros)" puede seguir
-- fallando incluso si 008 corrió bien:
--
-- CREATE OR REPLACE FUNCTION en Postgres identifica una función por su
-- nombre + lista de tipos de parámetros. La versión nueva tiene 5
-- parámetros declarados (3 obligatorios + 2 con DEFAULT); la vieja tiene 3.
-- Postgres los trata como funciones DISTINTAS (sobrecarga/overload), no
-- reemplaza una con la otra — "CREATE OR REPLACE" con distinto número de
-- argumentos crea una función nueva y deja la vieja viva. La consulta de
-- arriba ya filtra por pronargs=5, así que un "OK" ahí confirma que la
-- versión nueva SÍ existe — pero la vieja de 3 parámetros probablemente
-- también sigue existiendo como código muerto.
--
-- Confirmar cuántas versiones hay (debería mostrar 2 filas, una con
-- pronargs=3 y otra con pronargs=5, si la migración corrió bien):
SELECT proname, pronargs FROM pg_proc WHERE proname = 'guardar_modulo10';

-- Limpieza opcional, correr SOLO después de confirmar que la versión de
-- 5 parámetros funciona de verdad en la app (no antes) — borra la versión
-- vieja para que no quede una segunda función ambigua respondiendo al
-- mismo nombre:
--   DROP FUNCTION IF EXISTS guardar_modulo10(UUID, UUID, JSONB);
-- ============================================================
