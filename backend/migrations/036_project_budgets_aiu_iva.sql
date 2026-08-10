-- 036_project_budgets_aiu_iva.sql
-- Desagrega el AIU combinado de project_budgets en sus 3 componentes reales
-- (Administración/Imprevistos/Utilidad) y agrega liquidación de IVA por tipo
-- de contrato, per especificación de negocio del Director (Asfáltica S.A.S.,
-- normativa DIAN: Decreto 1372/1992 - DUR 1625/2016 Art. 1.3.1.7.9 para
-- contratos de construcción con base gravable AIU; Art. 447 E.T. para
-- consultoría/ventas sobre valor total). Fiscalizado por el Agente Arquitecto
-- 2026-08-08 antes de codificarse — ver docs/ARQUITECTURA_AGENTICA_ANTIGRAVITY.md.
--
-- Aditivo puro: `aiu`/`valor_total` NO cambian de semántica (valor_total sigue
-- SIN incluir IVA, para no invalidar filas históricas ni el cross-check ya
-- persistido en client/src/pages/ChecklistPage.tsx). El IVA vive en una
-- columna nueva, independiente, que cada consumidor decide si suma o no.

ALTER TABLE project_budgets
  ADD COLUMN IF NOT EXISTS tipo_contrato TEXT NOT NULL DEFAULT 'construccion'
    CHECK (tipo_contrato IN ('construccion', 'consultoria', 'ventas')),
  ADD COLUMN IF NOT EXISTS aiu_administracion NUMERIC(5,4) NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS aiu_imprevistos     NUMERIC(5,4) NOT NULL DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS aiu_utilidad        NUMERIC(5,4) NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS valor_iva           NUMERIC(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_budgets.tipo_contrato IS
  'construccion: IVA (19%) solo sobre aiu_utilidad*costo_directo (base gravable AIU, DUR 1625/2016). consultoria/ventas: IVA (19%) sobre valor_total.';
COMMENT ON COLUMN project_budgets.valor_iva IS
  'IVA liquidado según tipo_contrato — NO está incluido en valor_total (que preserva su semántica histórica de costo_directo + AIU, sin IVA).';
