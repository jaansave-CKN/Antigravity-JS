-- 076_convocatorias_dedup_indice_unico.sql — 2026-09-29
-- Duplicados REALES del catálogo: misma URL y mismo título (normalizados).
-- Alcance aprobado por el dueño: NO se unifica por título + donante (eso
-- borraría 39 convocatorias distintas, p. ej. las 13 secciones "Social
-- inclusion" de CGIAR, cada una con su propia URL).
--
-- ORDEN (dictamen architect C2): aplicar DESPUÉS de
-- `node backend/scripts/sanearCatalogo.mjs --aplicar`, porque los duplicados
-- se calculan sobre títulos ya decodificados ("X&#039s" y "X's" son el mismo).
-- Requiere 075 (tabla de respaldo).
--
-- Superviviente de cada grupo: la fila con entidad_id, luego la que tiene
-- vector, luego la más antigua. Las demás: soft-delete (deleted_at), con
-- respaldo; reversible poniendo deleted_at = NULL.
--
-- Índice único parcial con md5: evita el límite de tamaño de fila del btree
-- con URLs largas. No se usa ON CONFLICT (la Capa 2 REST lo ignora): los
-- catch de EntityScraper/DataIngestor ya silencian "duplicate key".

BEGIN;

CREATE TEMP TABLE _dedup_076 ON COMMIT DROP AS
SELECT id, superviviente
  FROM (
    SELECT id,
           row_number()  OVER w AS rn,
           first_value(id) OVER w AS superviviente
      FROM convocatorias
     WHERE deleted_at IS NULL AND coalesce(url_convocatoria, '') <> ''
    WINDOW w AS (
      PARTITION BY md5(lower(trim(url_convocatoria))), md5(lower(trim(titulo)))
      ORDER BY (entidad_id IS NOT NULL) DESC, (embedding_vec IS NOT NULL) DESC, created_at ASC, id ASC
    )
  ) g
 WHERE rn > 1;

DO $$
DECLARE
  n_perdedores int;
  n_favoritos  int;
  n_puntajes   int;
BEGIN
  SELECT count(*) INTO n_perdedores FROM _dedup_076;
  -- Medido el 2026-09-29: 4 pares. Un número muy distinto indica que algo
  -- cambió (o que el saneamiento no corrió): abortar y revisar a mano.
  IF n_perdedores > 20 THEN
    RAISE EXCEPTION '076: % duplicados a borrar (esperado ≤ 20) — transacción abortada, revisar', n_perdedores;
  END IF;
  SELECT count(*) INTO n_favoritos FROM user_favorites f JOIN _dedup_076 d ON d.id = f.grant_id;
  SELECT count(*) INTO n_puntajes  FROM match_scores  m JOIN _dedup_076 d ON d.id = m.convocatoria_id;
  IF n_favoritos > 0 OR n_puntajes > 0 THEN
    RAISE EXCEPTION '076: % favorito(s) y % puntaje(s) apuntan a filas duplicadas — reasignarlos a la superviviente antes de aplicar', n_favoritos, n_puntajes;
  END IF;
  RAISE NOTICE '076: % duplicado(s) real(es) a soft-delete', n_perdedores;
END $$;

INSERT INTO convocatorias_saneamiento_respaldo (lote, convocatoria_id, campo, valor_anterior, valor_nuevo, motivo)
SELECT '076_dedup', d.id, 'deleted_at', NULL, now()::text, 'duplicado_real_de:' || d.superviviente
  FROM _dedup_076 d;

UPDATE convocatorias c SET deleted_at = now()
  FROM _dedup_076 d
 WHERE c.id = d.id AND c.deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_convocatorias_url_titulo_vivas
  ON convocatorias (md5(lower(trim(url_convocatoria))), md5(lower(trim(titulo))))
  WHERE deleted_at IS NULL AND url_convocatoria <> '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM convocatorias
     WHERE deleted_at IS NULL AND coalesce(url_convocatoria, '') <> ''
     GROUP BY md5(lower(trim(url_convocatoria))), md5(lower(trim(titulo)))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '076: quedan duplicados vivos — transacción abortada';
  END IF;
END $$;

COMMIT;
