/**
 * planes.ts — ¿se aplica el control de planes en el cliente?
 *
 * En desarrollo (vite dev) el control se salta para poder navegar todo sin
 * suscripción. Pero la suite E2E del CI también corre vite dev, así que el CI
 * nunca ejercía PlanGate: una regresión de acceso o facturación pasaba en
 * verde (y el bug de recarga del PR #46 solo se vio en producción).
 * VITE_TEST_PLAN_ENFORCEMENT=true (definida en el paso E2E de
 * .github/workflows/playwright.yml) fuerza el control también en dev.
 *
 * Solo para los gates de PLANES (PlanGate, candados de AppLeftNav/TopNavBar).
 * Las rutas /dev/*, UserMenu y AdminGuard tienen su propia lógica de DEV.
 */
export const planesAplicados: boolean =
  !import.meta.env.DEV || import.meta.env.VITE_TEST_PLAN_ENFORCEMENT === 'true';
