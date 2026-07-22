-- =============================================================================
-- RadarFondos 360 — 017_postulaciones_entidad.sql
--
-- PROPÓSITO:
--   "Guardar como" deja de significar "duplicar el proyecto completo" y pasa a
--   significar "crear una postulación hija para una entidad/convocatoria
--   específica" — el proyecto real (`proyectos`) actúa como el "proyecto
--   matriz" inmutable (problemática, población, presupuesto); cada
--   postulación es una instancia hija con su propio enfoque narrativo
--   generado por IA, su propio estado de trámite, y sus propios anexos.
--
--   NO se crea una tabla `proyectos_matriz` paralela — `proyectos` YA es esa
--   tabla (ficha_tecnica.contexto_narrativo.A_diagnostico = problemática
--   central, ficha_tecnica.entrada_completa.numeroBeneficiarios = población
--   objetivo, presupuesto = presupuesto). Duplicar esa tabla habría forkeado
--   Entrada/Contexto/Ficha Técnica/Viabilidad IA, todo ya construido y en uso
--   sobre `proyectos` esta misma sesión.
--
--   Esquema real de esta BD (ids TEXT, no UUID nativo; org_id no tenant_id;
--   sin auth.users — esta app usa su propia tabla `usuarios` + JWT propio,
--   NUNCA Supabase Auth). Ver 016_formulador_tablas_reales.sql para el
--   historial completo de este hallazgo.
--
--   Sin políticas RLS: esta app corre siempre sobre Capa 2 REST con la
--   service_role key (bypasea RLS por completo) — una política basada en
--   auth.uid() quedaría inerte (nunca hay una sesión de Supabase Auth real
--   llegando a Postgres). Mismo criterio ya documentado en la migración 016.
--
-- APLICAR CON:
--   Pegar el contenido completo en el SQL Editor del dashboard de Supabase
--   y ejecutar. Es idempotente (seguro de re-ejecutar).
-- =============================================================================

CREATE TABLE IF NOT EXISTS postulaciones_entidad (
  id                  TEXT      PRIMARY KEY,
  proyecto_matriz_id  TEXT      NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  org_id              TEXT      NOT NULL,
  nombre_entidad      TEXT      NOT NULL,
  url_lineamientos    TEXT      DEFAULT '',
  enfoque_generado_ia TEXT      DEFAULT '',
  enfoque_fuente       TEXT     DEFAULT NULL,  -- 'gemini-2.0-flash' | 'heuristica' | NULL (aún no generado)
  estado_postulacion  TEXT      CHECK (estado_postulacion IN ('Borrador','Radicado','Aprobado','Rechazado')) DEFAULT 'Borrador',
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_postulaciones_matriz ON postulaciones_entidad (proyecto_matriz_id);

-- Anexos por postulación: se agrega postulacion_id (nullable) a la tabla real
-- de anexos ya existente (project_anexos, migración 016) en vez de crear una
-- tabla `anexos_proyecto` paralela — reutiliza el upload/multer ya construido
-- en backend/routes/anexos.routes.js. NULL = anexo del proyecto matriz en
-- general; con valor = anexo específico de esa postulación.
ALTER TABLE project_anexos ADD COLUMN IF NOT EXISTS postulacion_id TEXT REFERENCES postulaciones_entidad(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_project_anexos_postulacion ON project_anexos (postulacion_id);

-- =============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- =============================================================================
DO $$
DECLARE r RECORD;
BEGIN
  RAISE NOTICE '=== VERIFICACIÓN MIGRACIÓN 017 ===';
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='postulaciones_entidad') THEN
    RAISE NOTICE '[postulaciones_entidad] tabla creada OK';
  END IF;
  SELECT COUNT(*) INTO r FROM information_schema.columns
    WHERE table_name='project_anexos' AND column_name='postulacion_id';
  RAISE NOTICE '[project_anexos] columna postulacion_id instalada: %', (r.count = 1);
  RAISE NOTICE '=== FIN VERIFICACIÓN 017 ===';
END;
$$;
