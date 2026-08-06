-- =============================================================
-- 003_fix_moneda.sql — Blindaje financiero: COP como única moneda válida
-- Ejecutar en: Supabase Dashboard → SQL Editor (después de 001 y 002)
-- =============================================================

UPDATE formulador_presupuesto SET moneda = 'COP' WHERE moneda IS NULL;

ALTER TABLE formulador_presupuesto
  ALTER COLUMN moneda SET NOT NULL;

ALTER TABLE formulador_presupuesto
  ADD CONSTRAINT chk_moneda_cop CHECK (moneda = 'COP');
