// playwright.config.js — Configuración E2E real para RadFor-360 (Antigravity OS).
// Propiedad exclusiva de 010_INGENIERO_QA_AUTOMATIZACION. No tocar public/src/.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Levanta el backend real (Express, sirve dist/ + API) antes de correr la
  // suite y lo apaga al terminar. Requiere `npm run build` previo si dist/
  // está desactualizado — el propio server.js responde 404 explicando esto
  // si dist/index.html no existe (ver server.js líneas ~318-324).
  // Nota: /api/health puede devolver 206/503 si algún servicio externo
  // (Claude/Tavily/Supabase) está degradado — eso NO significa que el server
  // no levantó. Se usa '/' (servido por el catch-all de dist/index.html,
  // siempre 200 si dist/ está compilado) como señal de arranque real.
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:5000/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
