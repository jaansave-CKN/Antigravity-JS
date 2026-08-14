// tests/e2e/navigation.spec.js
// 010_INGENIERO_QA_AUTOMATIZACION — navegación real entre pantallas.
//
// Rutas verificadas leyendo el router real (public/src/App.jsx): TODA ruta
// bajo "/" (radar, panel, directorio, favoritos, calendario, modulo10,
// anexos, logistica, dialetica, ficha) vive dentro de
// <Route path="/" element={<RequireAuth><Layout/></RequireAuth>}>, o sea
// exige sesión Firebase real. Sin credenciales de prueba inyectadas (fuera
// de alcance de este agente generar/exponer secretos), el flujo de
// navegación REAL y verificable sin mocks es el guard de RequireAuth
// redirigiendo de forma consistente — y la navegación real entre las DOS
// pantallas públicas que sí existen fuera del guard: /inicio (SPA React) y
// /fase1-entrada.html (página estática real, module_b_formulador).
import { test, expect } from '@playwright/test';

const PROTECTED_ROUTES = ['/radar', '/panel', '/modulo10', '/anexos'];

test.describe('Navegación real entre pantallas', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`ruta protegida ${route} redirige a /inicio (RequireAuth real, sin sesión)`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL('**/inicio', { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Acceso Seguro' })).toBeVisible();
    });
  }

  test('navegación real: /inicio (SPA React) → /fase1-entrada.html (página estática del Formulador)', async ({ page }) => {
    // Pantalla 1: /inicio — SPA React real (public/src/pages/InicioPage.jsx)
    await page.goto('/inicio');
    await expect(page.getByRole('heading', { name: 'Acceso Seguro' })).toBeVisible();

    // Navegación real a la Pantalla 2: fase1-entrada.html, la puerta de
    // entrada real del Módulo B (Formulador) — página estática fuera del
    // bundle de Vite, servida directo desde dist/.
    await page.goto('/fase1-entrada.html');
    await expect(page.locator('#modulo-1')).toBeVisible();
    await expect(page.locator('#nombre_proyecto')).toBeVisible();
    await expect(page.locator('#btn-generar-ficha')).toBeVisible();

    // El banner de "sesión requerida" (real, controlado por Firebase
    // onAuthStateChanged en la propia página) debe reflejar la ausencia de
    // sesión — confirma que la página cargó su script de auth real, no un stub.
    await expect(page.locator('#auth-required-banner')).toBeVisible({ timeout: 10_000 });
  });
});
