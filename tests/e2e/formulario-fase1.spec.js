// tests/e2e/formulario-fase1.spec.js
// 010_INGENIERO_QA_AUTOMATIZACION — formulario real accesible sin login
// complejo: public/fase1-entrada.html (Fase 1 del Formulador, Módulo B).
//
// Comportamiento ESPERADO leyendo public/app.js (FinalizarFase1, líneas
// 84-126): al hacer click en #btn-generar-ficha SIN token de Firebase real,
// el propio código de producción debería llamar
// window.__antigravityAuth.requireLogin() y showBlockingErrors() (crea
// #blocking-overlay con "Debes iniciar sesión..."), sin llegar nunca a
// hacer POST a /api/formulador/fase1. Este spec no simula un login (fuera
// del alcance de este agente inventar/exponer credenciales de prueba) —
// verifica el comportamiento de bloqueo real de producción.
//
// HALLAZGO REAL (2026-08-13, capturado por este mismo spec, no editado a
// mano): en `dist/` (lo que server.js sirve de verdad) el bug rompe el
// flujo ANTES de llegar a ese bloqueo esperado. `vite.config.js` →
// copyStaticPlugin() sólo copia a dist/ un allowlist fijo
// (municipios_index.json, data.js, styles.css) + *.html + assets/ — NUNCA
// copia public/app.js ni public/firebase-config.js. fase1-entrada.html
// carga ambos como <script type="module" src="...">; en dist/ ese request
// cae en el catch-all SPA de server.js (líneas ~312-323) y responde
// index.html con Content-Type text/html, que el navegador rechaza para un
// module script ("Failed to load module script: ... MIME type of
// text/html"). Consecuencia real para el usuario: app.js NUNCA se ejecuta,
// por lo que el listener de #btn-generar-ficha (public/app.js línea 285)
// jamás se registra — el botón "Finalizar Fase 1" quedó MUDO en producción,
// sin overlay de bloqueo, sin llamada a la API, sin ningún feedback. Fuera
// del alcance de este agente (tests/e2e/** y playwright.config.* únicamente)
// corregir vite.config.js o public/*.js — se reporta como hallazgo, no se
// parchea aquí ni se ajusta la aserción para "hacerlo pasar".
import { test, expect } from '@playwright/test';

test.describe('Formulario real — Fase 1 del Formulador (public/fase1-entrada.html)', () => {
  test('el formulario carga, acepta datos reales de prueba, y bloquea el envío sin sesión (comportamiento real de producción)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const consoleLogs = [];
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    await page.goto('/fase1-entrada.html');

    // Módulo 1 — Enfoque y Régimen del Proyecto (campos reales del DOM).
    await page.locator('#nombre_proyecto').fill('Construcción aulas escuela rural vereda El Progreso (E2E test)');
    await page.locator('#user_type').selectOption({ index: 1 });
    await page.locator('#sector').selectOption({ index: 1 });

    // El mecanismo "inversion_directa" viene marcado por defecto (checked)
    // en el HTML real; se confirma en vez de asumirlo.
    await expect(page.locator('input[name="mecanismo"][value="inversion_directa"]')).toBeChecked();

    // Envío real — dispara FinalizarFase1() (único dueño del listener,
    // público/app.js línea 285).
    await page.locator('#btn-generar-ficha').click();

    // Comportamiento real sin sesión: bloqueo visible, no un crash silencioso
    // ni una redirección falsa a "éxito".
    const overlay = page.locator('#blocking-overlay');
    await expect(overlay, `Consola: ${consoleLogs.join(' || ')}`).toBeVisible({ timeout: 10_000 });
    await expect(overlay).toContainText('Debes iniciar sesión');

    // No debe haber quedado en un estado roto (excepción JS no atrapada).
    expect(pageErrors, `Errores JS no atrapados: ${pageErrors.join(' | ')}`).toEqual([]);
  });
});
