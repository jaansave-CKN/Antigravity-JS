-- 035_fix_categoria_hseq_encoding.sql
--
-- Bug real encontrado por tests/e2e/formulador-financiero.spec.ts (2026-08-08):
-- el CHECK constraint EN VIVO de project_apu_lineas.categoria_hseq tiene el
-- valor 'SEÑALIZACION' con la Ñ corrupta (bytes que no decodifican como UTF-8
-- válido) — verificado con pg_get_constraintdef(oid), no es un supuesto.
-- La migración original (019_project_apu_lineas_y_hallazgos.sql) SÍ tiene el
-- valor correcto en el archivo; la corrupción entró después vía un ALTER
-- fuera de control de versiones que también agregó 'SGC' (presente en vivo,
-- ausente en 019) — probablemente una sesión psql con client_encoding mal
-- configurado.
--
-- Efecto real: ExtractorService.js (HEADER_ALIASES/HSEQ_RULES) genera el
-- string 'SEÑALIZACION' correctamente en UTF-8 vía JavaScript — cualquier
-- línea de presupuesto real que contenga "cinta", "cono", "señalizaci*",
-- "valla", "barricada" o "paleta" en su descripción (común en presupuestos de
-- obra colombianos) rompe el INSERT con un 500 real, no un caso raro.
--
-- Idempotente: seguro de correr aunque el constraint ya esté correcto.
ALTER TABLE project_apu_lineas DROP CONSTRAINT IF EXISTS project_apu_lineas_categoria_hseq_check;
ALTER TABLE project_apu_lineas ADD CONSTRAINT project_apu_lineas_categoria_hseq_check
  CHECK (categoria_hseq IN ('EPP', 'SEÑALIZACION', 'AMBIENTAL', 'SST', 'SGC', 'NINGUNA'));
