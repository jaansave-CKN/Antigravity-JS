import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // Serial a propósito: global-setup.ts crea UN usuario/proyecto compartido
  // por corrida (no uno por test) — bajo 4 workers concurrentes, la
  // contención real (varios Chromium + backend single-thread) alcanzó a
  // producir intentos de login fallidos suficientes para disparar el
  // bloqueo de cuenta de 5 intentos (server.js, ACCOUNT_LOCKED) — reproducido
  // y confirmado: la misma prueba pasa limpia con --workers=1. Suite chica
  // (4 tests) — confiabilidad > velocidad acá.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    // El NAVEGADOR usa el mismo origen que VITE_API_URL (client/.env):
    // el frontend arma URLs absolutas con esa variable, y con otro origen la
    // CSP (connect-src 'self') bloquea el login — verificado 2026-09-23 con
    // 127.0.0.1 aquí y localhost en VITE_API_URL. Las comprobaciones del
    // lado Node (webServer.url, global-setup) sí van a 127.0.0.1: el backend
    // escucha solo en loopback IPv4 y Node puede resolver localhost a ::1.
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Levanta backend+frontend solo si no hay uno ya corriendo (pm2 lo suele
  // tener arriba en este proyecto) — reuseExistingServer evita procesos
  // duplicados compitiendo por el mismo puerto.
  webServer: [
    {
      command: 'npm run dev:backend',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:frontend',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
