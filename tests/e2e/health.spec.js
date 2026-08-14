// tests/e2e/health.spec.js
// 010_INGENIERO_QA_AUTOMATIZACION — flujo real: la SPA carga en "/" sin
// pantalla en blanco ni errores de consola. Como "/" está protegido por
// RequireAuth (public/src/components/RequireAuth.jsx) y no hay sesión de
// Firebase real en el navegador de prueba, el comportamiento REAL es una
// redirección client-side a /inicio (público) — se verifica ese flujo
// completo, no un mock de él.
import { test, expect } from '@playwright/test';

test.describe('Health check — arranque real de la SPA', () => {
  test('GET /api/health responde y reporta el estado real del backend', async ({ request }) => {
    const res = await request.get('/api/health');
    // 200 = healthy, 206 = degradado pero vivo, 503 = el ping real a Claude
    // falló — cualquiera de los tres confirma que el servidor Express real
    // está arriba y el handler ejecutó sus pings reales (Claude/Tavily/Supabase).
    expect([200, 206, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('services');
    expect(body.services).toHaveProperty('claude');
    expect(body.services).toHaveProperty('supabase');
  });

  test('"/" carga sin pantalla en blanco, sin errores de consola, y redirige a /inicio (RequireAuth real)', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // RequireAuth (sin sesión Firebase real) hace Navigate a /inicio.
    await page.waitForURL('**/inicio', { timeout: 15_000 });

    // No debe quedar en blanco: el formulario de login real debe estar visible.
    await expect(page.getByRole('heading', { name: 'Acceso Seguro' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Ingresar con Google/i })).toBeVisible();

    // Errores de consola que no sean ruido conocido de terceros (favicon, etc.)
    const relevantErrors = consoleErrors.filter(
      (e) => !/favicon|Failed to load resource.*404/i.test(e)
    );
    expect(pageErrors, `Errores JS no atrapados: ${pageErrors.join(' | ')}`).toEqual([]);
    expect(relevantErrors, `Errores de consola: ${relevantErrors.join(' | ')}`).toEqual([]);
  });
});
