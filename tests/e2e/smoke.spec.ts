import { test, expect } from '@playwright/test';

test('la landing pública carga sin sesión', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Radar de Fondos/);
});

test('login rechaza credenciales inválidas con mensaje visible', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('operador@institucion.gov').fill('no-existe@radfor360.test');
  await page.getByPlaceholder('••••••••••••').fill('clave-incorrecta-123');
  await page.getByRole('button', { name: /ejecutar autenticación/i }).click();
  await expect(page.getByText(/ALERTA DE SEGURIDAD/i)).toBeVisible({ timeout: 10_000 });
});
